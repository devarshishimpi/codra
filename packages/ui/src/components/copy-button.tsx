import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/utils";
import { UI_DURATION_TOOLTIP } from "../lib/constants";

/**
 * Drag-selecting a long, scrollable `<pre>` is miserable - the container
 * scrolls while you drag, so one click is the reliable path instead.
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  // The timeout outlives the component if the panel is collapsed right after a copy.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => setCopied(false),
        UI_DURATION_TOOLTIP,
      );
    } catch {
      // Clipboard access can be refused (insecure origin, permissions policy); fail quietly since manual selection still works.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border border-ui-line px-1.5 py-0.5",
        "text-[10px] font-medium transition-colors",
        copied ? "text-emerald-500" : "text-ui-subtle hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : label}
    </button>
  );
}
