/**
 * The non-component half of the row vocabulary in `job-chips.tsx` - formatters and shared class
 * strings, kept out of the component module so Fast Refresh can preserve chip state.
 */
import { formatDateTime } from "@client/lib/timezone";

// Re-exported so the sibling job-detail components get the whole row vocabulary from one place.
export { formatRelativeDate, statusLabel } from "@client/lib/job-format";

/** Full stamp for `title` tooltips, in the account's display time zone (falling back to UTC). */
export function formatAbsoluteDate(value: string | Date | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  // Component options, not dateStyle/timeStyle: Intl throws if a style shorthand is combined
  // with a component option like `timeZoneName`.
  return formatDateTime(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** One label → value row. Fixed height and hairline dividers echo the table's 48px rhythm. */
export const DETAIL_ROW =
  "flex h-11 items-center justify-between gap-4 border-t border-ui-line first:border-transparent";

export const DETAIL_LABEL =
  "shrink-0 text-xs leading-none text-ui-default dark:text-ui-subtle";
