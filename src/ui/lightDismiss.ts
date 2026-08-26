import { useEffect } from 'react';

/** Light-dismiss for every `<details>` menu on the page, which the element has none of natively.

    A named `<details>` is a menu in this codebase and a bare one is a disclosure — the name is
    what makes an exclusive group, so document-wide there is at most one open and one listener
    covers all of them. That is why the selector is `details[name]` rather than a class: the
    exclusive group is what this behaviour is about, and it is a browser mechanism with document
    scope, not a styling hook a stylesheet tidy-up is free to rename.

    `pointerdown` rather than `focusout`, because a macOS button does not take focus when it is
    clicked: a focus-based dismiss would shut the menu on the way down and the item's own click
    would never fire. */
export function useLightDismiss(): void {
  useEffect(() => {
    const open = () => document.querySelector<HTMLDetailsElement>('details[name][open]');
    const away = (e: PointerEvent) => {
      const menu = open();
      if (menu && !menu.contains(e.target as Node)) menu.removeAttribute('open');
    };
    // Not `preventDefault`: an Escape that shuts a menu must still reach whatever else wants it.
    const escape = (e: KeyboardEvent) => {
      const menu = e.key === 'Escape' ? open() : null;
      if (!menu) return;
      menu.removeAttribute('open');
      menu.querySelector<HTMLElement>('summary')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, []);
}
