/** The generated tool schemas. The point of generating them is that they cannot drift from the
    Zod grammar, so what is asserted here is the correspondence and the strict-mode subset —
    never a copy of the schema, which would only assert that the generator ran twice. */
import { describe, expect, it } from 'vitest';
import { KIND_BY_TOOL_NAME, TOOLS, toStrictSchema } from '../../src/ai/tool';
import { ModelReply } from '../../src/spec/grammar';

type Schema = Record<string, unknown>;

/** Every node of a schema, so an invariant can be asserted over all of them at once. */
function* nodes(schema: Schema): Generator<Schema> {
  yield schema;
  for (const variants of [schema.anyOf, schema.allOf]) {
    for (const v of (variants ?? []) as Schema[]) yield* nodes(v);
  }
  for (const prop of Object.values((schema.properties ?? {}) as Record<string, Schema>)) {
    yield* nodes(prop);
  }
  if (schema.items) yield* nodes(schema.items as Schema);
}

/** Keywords strict tool use does not accept. Zod emits most of these from the grammar's
    `.max()`, `.min()` and `.default()` calls, so the generator has to remove them. */
const UNSUPPORTED = [
  '$schema',
  'oneOf',
  'default',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
];

describe('the tool schemas generated from the grammar', () => {
  it('offers one tool per ModelReply kind, each strict', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'submit_analysis',
      'ask_clarification',
      'report_unsupported',
    ]);
    for (const tool of TOOLS) expect(tool.strict).toBe(true);
    expect(KIND_BY_TOOL_NAME.submit_analysis).toBe('analysis');
  });

  it('carries the same fields the grammar does, so the two cannot drift', () => {
    for (const member of ModelReply.options) {
      const kind = member.shape.kind.value as string;
      const tool = TOOLS.find((t) => KIND_BY_TOOL_NAME[t.name] === kind)!;
      const schema = tool.input_schema as unknown as Schema;
      expect(Object.keys(schema.properties as object)).toEqual(Object.keys(member.shape));
    }
  });

  it('requires every field the grammar has no default for, and no others', () => {
    const analysis = TOOLS[0]!.input_schema as unknown as Schema;
    const operation = (analysis.properties as Record<string, Schema>).operation!;
    // `aggregations` is the one field of an Operation with neither a default nor a nullable
    // type, so it is the one the model must always send.
    expect(operation.required).toEqual(['aggregations']);
    expect(analysis.required).toEqual([
      'kind',
      'intent',
      'title',
      'narration',
      'operation',
      'visualization',
    ]);
  });

  it('closes every object and uses no keyword outside the strict subset', () => {
    for (const tool of TOOLS) {
      for (const node of nodes(tool.input_schema as unknown as Schema)) {
        if (node.type === 'object') expect(node.additionalProperties).toBe(false);
        for (const keyword of UNSUPPORTED) expect(node).not.toHaveProperty(keyword);
      }
    }
  });

  it('keeps enums and consts, which the discriminated unions are built from', () => {
    const filters = (
      (
        (TOOLS[0]!.input_schema as unknown as Schema).properties as Record<string, Schema>
      ).operation!.properties as Record<string, Schema>
    ).filters!;
    const ops = ((filters.items as Schema).anyOf as Schema[]).map(
      (v) => (v.properties as Record<string, Schema>).op,
    );
    expect(ops).toContainEqual({ type: 'string', const: 'in' });
    expect(ops).toContainEqual({ type: 'string', enum: ['gt', 'gte', 'lt', 'lte'] });
  });

  it('rewrites oneOf to anyOf and drops an unsupported string format', () => {
    const rewritten = toStrictSchema({
      oneOf: [{ type: 'string', format: 'emoji' }, { type: 'string', format: 'date' }],
    });
    expect(rewritten).toEqual({
      anyOf: [{ type: 'string' }, { type: 'string', format: 'date' }],
    });
  });
});
