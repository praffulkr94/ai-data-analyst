/** The tooltip: a hover-and-focus label for a control that cannot say everything on its face.

    Radix, per `docs/ui-primitives.md` §5.1 — a new overlay surface, so it brings its own
    package rather than being hand-rolled. What it supplies and a `title` attribute does not: it
    is styled like the rest of the interface, it opens on keyboard focus as well as hover, it is
    wired to the trigger with `aria-describedby`, and it survives being portalled out of the
    composer's `overflow` and stacking context.

    `asChild` on the trigger, always: the thing being described is the caller's own button, and a
    wrapper element around it would break the `.segmented` track's layout. That has one
    consequence worth knowing — a natively `disabled` trigger receives no pointer events, so a
    control that explains why it is unavailable must use `aria-disabled` and refuse the click
    itself. The model picker does exactly that. */
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/** One Provider for the page, so moving between adjacent triggers does not re-pay the delay. */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={280} skipDelayDuration={120}>
      {children}
    </Tooltip.Provider>
  );
}

export function Tip({
  children,
  label,
  side = 'top',
}: {
  /** The trigger. Rendered as itself — `Tip` adds no box of its own. */
  children: ReactNode;
  /** Lines, not one string: a tooltip that states a fact and then the reason for it reads as two
      rows, and a `<br/>` in a string cannot be styled differently. */
  label: ReactNode[];
  side?: 'top' | 'bottom';
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={7} collisionPadding={8}>
          {label.map((line, i) => (
            <span key={i} className={i === 0 ? 'tip-head' : 'tip-note'}>
              {line}
            </span>
          ))}
          <Tooltip.Arrow className="tip-arrow" width={9} height={4} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
