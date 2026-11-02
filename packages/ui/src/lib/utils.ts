import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

/**
 * Like {@link fmtNumber} but returns the numeric part and its unit suffix
 * separately, so a card can render "1.4" large and "M" as a smaller unit.
 */
export function fmtStat(n: number): { value: string; unit: string } {
  if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(1), unit: "M" };
  if (n >= 1_000)
    return { value: (n / 1_000).toFixed(n >= 10_000 ? 0 : 1), unit: "k" };
  return { value: n.toLocaleString(), unit: "" };
}

export function formatPreciseDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  // Sub-minute: show one decimal so e.g. a 724ms review reads as "0.7s" rather than "0s".
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
