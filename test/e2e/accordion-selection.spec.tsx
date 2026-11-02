/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { preventToggleOnTextSelection } from "@codraoss/ui/selection";

/**
 * Accordion headers used to carry `select-none`, making the file path uncopyable. Removing it is
 * only half the fix: `<summary>` is a button, so releasing a drag-select also toggles the panel.
 * These pin both halves.
 */
describe("accordion header text selection", () => {
  function renderAccordion() {
    const view = render(
      <details open>
        <summary onClick={preventToggleOnTextSelection} data-testid="summary">
          <span data-testid="path">src/server/core/review.ts</span>
        </summary>
        <div data-testid="content">body text</div>
      </details>,
    );
    return {
      summary: view.getByTestId("summary"),
      path: view.getByTestId("path"),
      outside: document.body,
    };
  }

  /** jsdom implements Selection well enough to place a real range. */
  function selectContentsOf(node: Node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it("swallows the toggle when the click ends a selection made in the header", () => {
    const { summary, path } = renderAccordion();
    selectContentsOf(path);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    summary.dispatchEvent(event);

    // preventDefault on a summary click is what stops <details> opening/closing.
    expect(event.defaultPrevented).toBe(true);
  });

  it("still toggles on a plain click with nothing selected", () => {
    const { summary } = renderAccordion();
    window.getSelection()!.removeAllRanges();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    summary.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // A selection elsewhere on the page must not make the accordion unclickable -- that would be a
  // far more annoying bug than the one being fixed.
  it("still toggles when the selection lies outside this header", () => {
    const { summary } = renderAccordion();
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "unrelated paragraph";
    document.body.appendChild(elsewhere);
    selectContentsOf(elsewhere);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    summary.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
