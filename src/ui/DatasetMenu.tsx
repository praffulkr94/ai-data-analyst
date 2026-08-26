/** The dataset switcher: the control that names the Dataset is the control that changes it.

    Before this, the picker was the app's root screen and unreachable the moment anything was
    loaded — a second Dataset meant reloading the tab, and the worker-crash message that says
    "re-select the Dataset to carry on" pointed at a screen nobody could get to.

    Radix, because this is a dropdown menu and `docs/ui-primitives.md` §5.1 makes Radix the
    default for a new one. The first draft was a `<details name>` disclosure, copying the column
    type chips — which is row 6 of that document's table, the surface *drawn* as a dropdown and
    *built* as a disclosure, listed there as a gap and not as an exception. What Radix supplies
    and the disclosure did not: `aria-haspopup` and a real `role="menu"`, arrow keys and
    typeahead over the items, focus returned to the trigger on every close path, and a portal, so
    the panel is not clipped by the card the inference gate draws.

    Every route in goes through `workspace.loadDataset`, never the loader directly: a Dataset the
    Analyses were not asked against makes every one of them meaningless, and that is where the
    in-flight Request is abandoned and the exchanges are cleared. */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useRef, type ReactNode } from 'react';
import { SAMPLES } from '../data/samples';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';

export function DatasetMenu({
  workspace,
  className,
  align = 'start',
  children,
}: {
  workspace: Workspace;
  /** Applied to the trigger: the header wears the dataset chip, the gate and the failure stage
      wear a plain tertiary button. The trigger is the caller's, the menu is this component's. */
  className: string;
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const current = useApp((s) => s.datasetHandle?.ref);
  const analyses = useApp((s) => s.analyses.length);
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className={className}>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu-panel" align={align} sideOffset={6}>
            <DropdownMenu.Label className="strip">Switch dataset</DropdownMenu.Label>
            {SAMPLES.map((s) => {
              const isCurrent = current?.kind === 'sample' && current.id === s.id;
              return (
                <DropdownMenu.Item
                  key={s.id}
                  className="list-row"
                  onSelect={() => {
                    if (!isCurrent) void workspace.loadDataset(s);
                  }}
                >
                  <span className="tick" aria-hidden="true">
                    {isCurrent ? '✓' : ''}
                  </span>
                  <span className="label">{s.label}</span>
                  <span className="muted">{s.rowCount.toLocaleString()} rows</span>
                </DropdownMenu.Item>
              );
            })}
            <div className="menu-foot">
              <span className="muted">or drop a CSV on the picker</span>
              {/* The input is outside the menu on purpose: Radix unmounts the content on select,
                  and a file dialog opened from an element that is about to be unmounted is a
                  race. Outside, the click lands in the same user-activation window and the menu
                  closing underneath it changes nothing. */}
              <DropdownMenu.Item className="as-button" onSelect={() => input.current?.click()}>
                Pick a file…
              </DropdownMenu.Item>
            </div>
            {/* The one consequence worth stating before it happens, and only when there is
                something to lose. Analyses are not saved, so this is the warning and there is
                no undo. */}
            {analyses > 0 && (
              <p className="card-foot">
                Analyses name columns of the Dataset they were asked against, so switching clears
                the {analyses === 1 ? 'one you have' : `${analyses} you have`}.
              </p>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void workspace.loadDataset(file);
        }}
      />
    </>
  );
}
