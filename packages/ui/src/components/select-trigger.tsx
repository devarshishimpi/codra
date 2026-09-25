import { ChevronDown } from "lucide-react";
import { m, type Transition } from "motion/react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { cn } from "../lib/utils";
import { EASE_OUT } from "../lib/ease";
import {
  CHEVRON_TRANSITION,
  INSTANT_TRANSITION,
  type SelectOption,
} from "./select-shared";

// Gooey: the edge facing the panel snaps flat while attached, then rounds as the two pinch apart.
const RADIUS_OPEN = [0, 0, 7];
const RADIUS_CLOSED = [7, 0, 7];
const RADIUS_TRANSITION_OPEN: Transition = {
  duration: 0.46,
  times: [0, 0.4, 1],
  ease: EASE_OUT,
};
const RADIUS_TRANSITION_CLOSED: Transition = {
  duration: 0.34,
  times: [0, 0.5, 1],
  ease: EASE_OUT,
};

interface SelectTriggerProps {
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerId: string;
  listId: string;
  labelId: string | undefined;
  activeDescendantId: string | undefined;
  open: boolean;
  isTop: boolean;
  reduce: boolean;
  selectedOption: SelectOption | undefined;
  placeholder: string;
  leadingIcon: ReactNode;
  variant: "page" | "card";
  className: string | undefined;
  style: CSSProperties | undefined;
  onToggle: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

export function SelectTrigger({
  triggerRef,
  triggerId,
  listId,
  labelId,
  activeDescendantId,
  open,
  isTop,
  reduce,
  selectedOption,
  placeholder,
  leadingIcon,
  variant,
  className,
  style,
  onToggle,
  onKeyDown,
}: SelectTriggerProps) {
  const kf = open ? RADIUS_OPEN : RADIUS_CLOSED;
  const kfT = reduce
    ? INSTANT_TRANSITION
    : open
      ? RADIUS_TRANSITION_OPEN
      : RADIUS_TRANSITION_CLOSED;

  return (
    <m.button
      ref={triggerRef}
      type="button"
      id={triggerId}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      // Self-reference keeps the selected label in the accessible name now that <label> also points here.
      aria-labelledby={labelId ? `${labelId} ${triggerId}` : undefined}
      aria-activedescendant={activeDescendantId}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      initial={false}
      animate={{
        borderTopLeftRadius: isTop ? kf : 7,
        borderTopRightRadius: isTop ? kf : 7,
        borderBottomLeftRadius: isTop ? 7 : kf,
        borderBottomRightRadius: isTop ? 7 : kf,
      }}
      transition={{
        borderTopLeftRadius: isTop ? kfT : INSTANT_TRANSITION,
        borderTopRightRadius: isTop ? kfT : INSTANT_TRANSITION,
        borderBottomLeftRadius: isTop ? INSTANT_TRANSITION : kfT,
        borderBottomRightRadius: isTop ? INSTANT_TRANSITION : kfT,
      }}
      style={style}
      className={cn(
        "relative z-10 flex h-9 w-full items-center justify-between gap-2 border border-ui-line px-3 py-2 text-sm font-normal text-ui-default outline-none transition-colors",
        variant === "page" ? "bg-ui-base" : "bg-ui-fill/50",
        "hover:bg-ui-fill/70 focus-visible:ring-2 focus-visible:ring-ui-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        !selectedOption && "text-ui-subtle",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {leadingIcon && (
          <span className="shrink-0 text-primary/70">{leadingIcon}</span>
        )}
        <span className="min-w-0 truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
      </span>
      <m.span
        aria-hidden
        animate={{ rotate: open ? 180 : 0 }}
        transition={reduce ? INSTANT_TRANSITION : CHEVRON_TRANSITION}
        className="shrink-0 text-ui-subtle"
      >
        <ChevronDown className="h-4 w-4" />
      </m.span>
    </m.button>
  );
}
