// Beui tabs.
import {
  LazyMotion,
  m,
  domMax,
  MotionConfig,
  useReducedMotion,
  type Transition,
} from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

type Variant = "pill" | "underline" | "segment";

type Ctx = {
  value: string;
  setValue: (v: string) => void;
  layoutId: string;
  variant: Variant;
};

const TabsCtx = createContext<Ctx | null>(null);

function useTabs() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>");
  return ctx;
}

const transition: Transition = {
  type: "spring",
  stiffness: 170,
  damping: 24,
  mass: 1.2,
};

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  variant = "pill",
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const layoutId = useId();
  const reduce = useReducedMotion();
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = useCallback(
    (v: string) => {
      if (!controlled) setInternal(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );
  const ctx = useMemo(
    () => ({ value: current, setValue, layoutId, variant }),
    [current, setValue, layoutId, variant],
  );
  return (
    <MotionConfig transition={reduce ? { duration: 0 } : transition}>
      <TabsCtx.Provider value={ctx}>
        <LazyMotion features={domMax}>
          <m.div layoutRoot className={className}>
            {children}
          </m.div>
        </LazyMotion>
      </TabsCtx.Provider>
    </MotionConfig>
  );
}

const listClasses: Record<Variant, string> = {
  pill: "inline-flex items-center gap-1 rounded-full bg-card p-1",
  underline: "inline-flex items-center gap-1 border-b border-border",
  segment:
    "inline-flex items-center gap-0 rounded-md border border-ui-line bg-ui-fill/40 p-0.5",
};

export function TabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { variant } = useTabs();
  return (
    <div role="tablist" className={cn(listClasses[variant], className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  indicatorClassName,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  indicatorClassName?: string;
}) {
  const { value: current, setValue, layoutId, variant } = useTabs();
  const active = current === value;

  if (variant === "underline") {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setValue(value)}
        className={cn(
          "relative isolate px-3 pb-2.5 pt-1 -mb-px text-sm font-medium transition-colors min-h-[44px] inline-flex items-center",
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        {children}
        {active ? (
          <m.span
            layoutId={layoutId}
            className={cn(
              "absolute -bottom-px left-0 right-0 h-px bg-primary",
              indicatorClassName,
            )}
          />
        ) : null}
      </button>
    );
  }

  const isSegment = variant === "segment";
  const radius = variant === "pill" ? "rounded-full" : "rounded-[5px]";
  const indicatorBg = isSegment
    ? "bg-ui-base shadow-sm ring-1 ring-ui-line"
    : "bg-primary";
  const activeText = isSegment ? "text-ui-strong" : "text-primary-foreground";
  const inactiveText = isSegment
    ? "text-ui-subtle hover:text-ui-default"
    : "text-muted-foreground hover:text-foreground";

  return (
    <div className="relative">
      {active ? (
        <m.span
          layoutId={layoutId}
          style={{ borderRadius: variant === "pill" ? 9999 : 5 }}
          className={cn(
            "absolute inset-0",
            indicatorBg,
            radius,
            indicatorClassName,
          )}
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setValue(value)}
        className={cn(
          "relative z-10 inline-flex items-center justify-center whitespace-nowrap bg-transparent px-3.5 py-1.5 text-sm font-medium capitalize transition-colors outline-none",
          active ? activeText : inactiveText,
          radius,
          className,
        )}
      >
        {children}
      </button>
    </div>
  );
}
