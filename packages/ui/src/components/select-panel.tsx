import { Check } from 'lucide-react';
import { m, type Transition } from 'motion/react';
import type { RefObject } from 'react';
import { cn } from '../lib/utils';
import { EASE_OUT } from '../lib/ease';
import {
  INSTANT_TRANSITION,
  ITEM_VARIANTS,
  LIST_VARIANTS,
  type SelectOption,
  type TriggerRect,
} from './select-shared';

const REDUCED_TRANSITION: Transition = { duration: 0.12 };
const GAP_TRANSITION_OPEN: Transition = { type: 'spring', duration: 0.44, bounce: 0.45, delay: 0.09 };
const GAP_TRANSITION_CLOSED: Transition = { type: 'spring', duration: 0.26, bounce: 0.1 };
const RADIUS_TRANSITION_OPEN: Transition = { duration: 0.26, ease: EASE_OUT, delay: 0.1 };
const RADIUS_TRANSITION_CLOSED: Transition = { duration: 0.15, ease: EASE_OUT };
const OPACITY_TRANSITION_OPEN: Transition = { duration: 0.18 };
const OPACITY_TRANSITION_CLOSED: Transition = { duration: 0.16, delay: 0.1 };
const HEIGHT_TRANSITION_OPEN: Transition = { type: 'spring', duration: 0.4, bounce: 0.14 };
const HEIGHT_TRANSITION_CLOSED: Transition = { duration: 0.24, ease: EASE_OUT, delay: 0.1 };

interface SelectPanelProps {
  panelRef: RefObject<HTMLDivElement | null>;
  innerRef: RefObject<HTMLUListElement | null>;
  optionRefs: RefObject<Array<HTMLButtonElement | null>>;
  listId: string;
  triggerId: string;
  options: SelectOption[];
  value: string;
  highlightedIndex: number;
  open: boolean;
  isTop: boolean;
  reduce: boolean;
  height: number;
  rect: TriggerRect | null;
  onSelect: (value: string) => void;
  onHighlight: (index: number) => void;
}

export function SelectPanel({
  panelRef,
  innerRef,
  optionRefs,
  listId,
  triggerId,
  options,
  value,
  highlightedIndex,
  open,
  isTop,
  reduce,
  height,
  rect,
  onSelect,
  onHighlight,
}: SelectPanelProps) {
  const nearGap = open ? 8 : 0;
  const nearRadius = open ? 7 : 0;
  const gapT = open ? GAP_TRANSITION_OPEN : GAP_TRANSITION_CLOSED;
  const radiusT = open ? RADIUS_TRANSITION_OPEN : RADIUS_TRANSITION_CLOSED;

  return (
    <m.div
      ref={panelRef}
      id={listId}
      role="listbox"
      aria-labelledby={triggerId}
      aria-hidden={!open}
      initial={false}
      animate={
        reduce
          ? { opacity: open ? 1 : 0, height: open ? height : 0 }
          : {
              opacity: open ? 1 : 0,
              height: open ? height : 0,
              // gap opens on the side facing the trigger
              marginTop: isTop ? 0 : nearGap,
              marginBottom: isTop ? nearGap : 0,
              // near corners go flat->round; far corners stay rounded
              borderTopLeftRadius: isTop ? 7 : nearRadius,
              borderTopRightRadius: isTop ? 7 : nearRadius,
              borderBottomLeftRadius: isTop ? nearRadius : 7,
              borderBottomRightRadius: isTop ? nearRadius : 7,
            }
      }
      transition={
        reduce
          ? REDUCED_TRANSITION
          : {
              opacity: open ? OPACITY_TRANSITION_OPEN : OPACITY_TRANSITION_CLOSED,
              height: open ? HEIGHT_TRANSITION_OPEN : HEIGHT_TRANSITION_CLOSED,
              marginTop: isTop ? INSTANT_TRANSITION : gapT,
              marginBottom: isTop ? gapT : INSTANT_TRANSITION,
              borderTopLeftRadius: isTop ? INSTANT_TRANSITION : radiusT,
              borderTopRightRadius: isTop ? INSTANT_TRANSITION : radiusT,
              borderBottomLeftRadius: isTop ? radiusT : INSTANT_TRANSITION,
              borderBottomRightRadius: isTop ? radiusT : INSTANT_TRANSITION,
            }
      }
      style={{
        position: 'fixed',
        left: rect?.left ?? 0,
        width: rect?.width ?? 0,
        top: isTop ? undefined : (rect?.bottom ?? 0),
        bottom: isTop ? window.innerHeight - (rect?.top ?? 0) : undefined,
        transformOrigin: isTop ? 'bottom' : 'top',
        overflow: 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
      className="z-50 border border-ui-line bg-ui-base shadow-lg shadow-black/[0.04] dark:shadow-black/40"
    >
      <m.ul
        ref={innerRef}
        variants={reduce ? undefined : LIST_VARIANTS}
        initial={false}
        animate={open ? 'show' : 'hidden'}
        className="max-h-[min(28rem,60vh)] overflow-y-auto p-1"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const highlighted = index === highlightedIndex;
          return (
            <m.li key={option.value} variants={reduce ? undefined : ITEM_VARIANTS}>
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors',
                  selected
                    ? 'bg-ui-brand/10 font-medium text-ui-brand'
                    : 'text-ui-default hover:bg-ui-fill hover:text-ui-strong focus-visible:bg-ui-fill',
                  highlighted && !selected && 'bg-ui-fill text-ui-strong',
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
              </button>
            </m.li>
          );
        })}
      </m.ul>
    </m.div>
  );
}
