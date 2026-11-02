import { LayerCard, Skeleton, Text } from "@codraoss/ui";
import { useState } from "react";
import { cn } from "@codraoss/ui/utils";

export function DetailGroup({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 px-0.5 text-[10px] font-bold uppercase tracking-wider text-ui-subtle">
        {caption}
      </p>
      <LayerCard className="divide-y divide-ui-line rounded-lg">
        {children}
      </LayerCard>
    </div>
  );
}

export function RevealOnClick({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const hint = revealed ? "Click to hide" : "Click to reveal";

  return (
    // `group` drives the tooltip; `inline-flex` keeps the row's right alignment.
    <span className="group relative inline-flex max-w-full justify-end">
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-pressed={revealed}
        aria-label={`${hint} ${label}`}
        className={cn(
          "max-w-full cursor-pointer truncate rounded-[4px] align-middle outline-none",
          // `filter` is the animated property, so the blur eases in/out on toggle.
          "transition-[filter,opacity] duration-300 ease-[var(--ease-out-quart)]",
          "focus-visible:ring-2 focus-visible:ring-ring",
          // `select-none` while hidden so the value can't be copied out of a blur.
          !revealed && "select-none blur-[5px] hover:opacity-70",
        )}
      >
        {children}
      </button>

      {/* `pointer-events-none` so the tooltip can never sit between the cursor and the button underneath it. */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-[calc(100%+0.4rem)] right-0 z-20 w-max",
          "rounded-md border border-ui-line bg-ui-base px-2 py-1",
          "text-[11px] font-medium text-ui-default shadow-sm",
          "opacity-0 translate-y-0.5 transition-[opacity,transform] duration-150 ease-[var(--ease-out-quart)]",
          "group-hover:opacity-100 group-hover:translate-y-0",
          "group-focus-within:opacity-100 group-focus-within:translate-y-0",
        )}
      >
        {hint}
      </span>
    </span>
  );
}

export function DetailRow({
  label,
  mono,
  loading,
  skeletonWidth = 130,
  children,
}: {
  label: string;
  /** Render the value as an identifier (Geist Mono + tabular figures). */
  mono?: boolean;
  loading?: boolean;
  skeletonWidth?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <Text
        variant="body"
        size="sm"
        bold
        as="span"
        className="shrink-0 text-[13px] dark:text-ui-subtle"
      >
        {label}
      </Text>
      {loading ? (
        <Skeleton
          height={11}
          width={skeletonWidth}
          borderRadius={4}
          className="max-w-[45%]"
        />
      ) : (
        <span
          className={cn(
            "min-w-0 truncate text-right text-[13px] font-medium text-ui-strong",
            mono && "ui-font-mono text-xs tabular-nums",
          )}
        >
          {children}
        </span>
      )}
    </div>
  );
}
