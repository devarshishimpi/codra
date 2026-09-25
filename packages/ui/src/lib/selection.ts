import type { MouseEvent } from "react";

/**
 * `<summary>` toggles its `<details>` on any click, including the one that ends a drag-select -
 * so selecting text in an accordion header would immediately collapse the panel. This swallows
 * the toggle only when the click ended a real selection inside this summary; a plain click still
 * toggles normally.
 */
export function preventToggleOnTextSelection(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  // Scope to this header - a selection made elsewhere on the page shouldn't block the toggle.
  const anchor = selection.anchorNode;
  if (anchor && event.currentTarget.contains(anchor)) {
    event.preventDefault();
  }
}
