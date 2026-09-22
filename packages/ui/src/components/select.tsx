import { domAnimation, LazyMotion, useReducedMotion } from 'motion/react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';
import { SelectPanel } from './select-panel';
import type { Placement, SelectOption, TriggerRect } from './select-shared';
import { SelectTrigger } from './select-trigger';

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  leadingIcon?: ReactNode;
  variant?: 'page' | 'card';
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  label,
  className,
  triggerClassName,
  triggerStyle,
  leadingIcon,
  variant = 'page',
}: SelectProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const listId = `${baseId}-list`;
  const labelId = `${baseId}-label`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>('bottom');
  const [height, setHeight] = useState(0);
  const [rect, setRect] = useState<TriggerRect | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const highlightSource = useRef<'keyboard' | 'pointer'>('keyboard');

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;
    highlightSource.current = 'keyboard';
    const idx = options.findIndex((opt) => opt.value === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || highlightSource.current !== 'keyboard') return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      if (labelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const r = trigger.getBoundingClientRect();
      setRect({ left: r.left, width: r.width, top: r.top, bottom: r.bottom });
      const h = innerRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      setPlacement(below < h + 16 && above > below ? 'top' : 'bottom');
    };
    const scheduleUpdate = (e?: Event) => {
      if (e && e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      if (frame !== null) return;
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [open]);

  const moveHighlight = (next: number) => {
    highlightSource.current = 'keyboard';
    setHighlightedIndex(Math.min(Math.max(next, 0), options.length - 1));
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (options.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveHighlight(highlightedIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveHighlight(highlightedIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveHighlight(0);
        break;
      case 'End':
        e.preventDefault();
        moveHighlight(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onValueChange(options[highlightedIndex].value);
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const selectOption = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };

  const highlightOption = (index: number) => {
    highlightSource.current = 'pointer';
    setHighlightedIndex(index);
  };

  const isTop = placement === 'top';

  return (
    <LazyMotion features={domAnimation}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label && (
          <label
            ref={labelRef}
            id={labelId}
            htmlFor={triggerId}
            className="text-[10px] font-bold uppercase tracking-wider text-ui-subtle"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <SelectTrigger
            triggerRef={triggerRef}
            triggerId={triggerId}
            listId={listId}
            labelId={label ? labelId : undefined}
            activeDescendantId={
              open && options[highlightedIndex] ? `${listId}-option-${highlightedIndex}` : undefined
            }
            open={open}
            isTop={isTop}
            reduce={reduce}
            selectedOption={selectedOption}
            placeholder={placeholder}
            leadingIcon={leadingIcon}
            variant={variant}
            className={triggerClassName}
            style={triggerStyle}
            onToggle={() => setOpen((v) => !v)}
            onKeyDown={onTriggerKeyDown}
          />
        </div>

        {createPortal(
          <SelectPanel
            panelRef={panelRef}
            innerRef={innerRef}
            optionRefs={optionRefs}
            listId={listId}
            triggerId={triggerId}
            options={options}
            value={value}
            highlightedIndex={highlightedIndex}
            open={open}
            isTop={isTop}
            reduce={reduce}
            height={height}
            rect={rect}
            onSelect={selectOption}
            onHighlight={highlightOption}
          />,
          document.body,
        )}
      </div>
    </LazyMotion>
  );
}
