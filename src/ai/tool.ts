/** The model's tools, with their `input_schema` generated from the Zod grammar at module init.
    Hand-writing a JSON Schema beside a Zod schema is a drift bug waiting for the first grammar
    change; generating it means the two cannot disagree.

    One tool per ModelReply kind rather than one tool over the union: `input_schema` has to be an
    object schema, and a discriminated union is an `anyOf` at the top level. Three object schemas
    need no wrapper and no unwrapping — whatever the model sends goes to `ModelReply.safeParse`
    exactly as it arrived, because each tool's schema *is* one member of that union, `kind`
    literal and all. */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ModelReply } from '../spec/grammar';

/** The string formats the tool schema keeps. Anything else is dropped rather than sent. */
const FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

type Schema = Record<string, unknown>;

/** Rewrite a Zod-emitted JSON Schema into the subset the tool API accepts.

    Three things happen here. `oneOf` becomes `anyOf`, because Zod renders a discriminated union
    as the former and the API takes the latter. Every object gains `additionalProperties: false`,
    which closes each object. And every keyword outside the supported set is dropped —
    `maxLength`, `maxItems`, `minItems` and the numeric bounds among them. Those limits are not
    lost: Zod still enforces every one of them at `message_stop`, and the ones the model needs to
    know about are stated in the system prompt's rules, where a sentence reads better than a
    schema annotation. */
export function toStrictSchema(schema: Schema): Schema {
  const out: Schema = {};
  for (const key of ['type', 'enum', 'const', 'description', 'title']) {
    if (key in schema) out[key] = schema[key];
  }
  const variants = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (variants) out.anyOf = variants.map(toStrictSchema);
  if (schema.allOf) out.allOf = (schema.allOf as Schema[]).map(toStrictSchema);

  if (schema.type === 'object') {
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([name, prop]) => [name, toStrictSchema(prop)]),
    );
    out.required = schema.required ?? [];
    out.additionalProperties = false;
  }
  if (schema.type === 'array' && schema.items) out.items = toStrictSchema(schema.items as Schema);
  if (schema.type === 'string' && FORMATS.has(schema.format as string)) out.format = schema.format;
  return out;
}

/** The three kinds, named as tools. A tool name is what the model chooses between, so each says
    what it is for rather than what shape it has. */
const TOOLS_BY_KIND = {
  analysis: {
    name: 'submit_analysis',
    description:
      'Answer the question with one analysis: the Operation to run over the Dataset and the ' +
      'Visualization to draw from its result. Use this whenever the question can be expressed ' +
      'in the grammar, even approximately.',
  },
  clarification: {
    name: 'ask_clarification',
    description:
      'The question is ambiguous — it could reasonably mean two or more different analyses. ' +
      'Offer the concrete readings to choose between rather than guessing at one.',
  },
  unsupported: {
    name: 'report_unsupported',
    description:
      'The question is outside what the Operation grammar can express. Name the boundary ' +
      'plainly and suggest nearby questions that are inside it.',
  },
} as const;

export type ReplyKind = keyof typeof TOOLS_BY_KIND;

/** Not `strict: true`, though the schema is shaped for it. Strict tool use compiles a decoding
    grammar server-side, and this grammar — a seven-field Operation holding a six-variant Filter
    union, under a six-field reply — compiles to one the API rejects outright: "The compiled
    grammar is too large". Nothing here shrinks it enough to fit without gutting the grammar
    itself, so the schema is a strong hint rather than an enforced shape, and the two layers that
    were always going to run anyway do the enforcing: `ModelReply.safeParse` at `message_stop`
    and the semantic validator after it, both feeding the single Repair. */
export const TOOLS: Anthropic.Tool[] = ModelReply.options.map((member) => {
  const kind = member.shape.kind.value as ReplyKind;
  return {
    ...TOOLS_BY_KIND[kind],
    input_schema: toStrictSchema(
      z.toJSONSchema(member, { io: 'input' }) as Schema,
    ) as Anthropic.Tool.InputSchema,
  };
});

/** Which kind a tool name carries, for turning a `tool_use` block back into a ModelReply. */
export const KIND_BY_TOOL_NAME: Record<string, ReplyKind> = Object.fromEntries(
  Object.entries(TOOLS_BY_KIND).map(([kind, tool]) => [tool.name, kind as ReplyKind]),
);
