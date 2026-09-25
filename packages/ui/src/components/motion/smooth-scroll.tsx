// beui.dev/components/motion/scroll-animation
import type Lenis from "lenis";
import { ReactLenis, useLenis } from "lenis/react";
import {
  type MotionValue,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

const EASE_SCROLL = (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t));

export type ScrollTarget = number | string | HTMLElement;

export type ScrollToOptions = {
  offset?: number;
  immediate?: boolean;
  duration?: number;
};

export type SmoothScrollApi = {
  lenis: Lenis | null;
  scrollY: MotionValue<number>;
  progress: MotionValue<number>;
  velocity: MotionValue<number>;
  scrollTo: (target: ScrollTarget, options?: ScrollToOptions) => void;
};

const SmoothScrollContext = createContext<SmoothScrollApi | null>(null);

export interface SmoothScrollProps {
  children: ReactNode;
  root?: boolean;
  lerp?: number;
  duration?: number;
  orientation?: "vertical" | "horizontal";
  wheelMultiplier?: number;
  touch?: boolean;
  className?: string;
}

type ScrollSource = Window | HTMLElement;

function readMetrics(target: ScrollSource) {
  if (target instanceof Window) {
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    return { y: window.scrollY, max };
  }
  return {
    y: target.scrollTop,
    max: Math.max(0, target.scrollHeight - target.clientHeight),
  };
}

function resolveTop(
  target: ScrollTarget,
  source: ScrollSource,
  offset = 0,
): number {
  if (typeof target === "number") return target + offset;
  if (source instanceof Window) {
    const el =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return window.scrollY;
    return el.getBoundingClientRect().top + window.scrollY + offset;
  }
  const el = typeof target === "string" ? source.querySelector(target) : target;
  if (!(el instanceof HTMLElement)) return source.scrollTop;
  return el.offsetTop + offset;
}

function LenisBridge({
  scrollY,
  progress,
  velocity,
  lenisRef,
}: {
  scrollY: MotionValue<number>;
  progress: MotionValue<number>;
  velocity: MotionValue<number>;
  lenisRef: { current: Lenis | null };
}) {
  const lenis = useLenis((instance) => {
    scrollY.set(instance.scroll);
    progress.set(instance.progress);
    velocity.set(instance.velocity);
  });
  useEffect(() => {
    lenisRef.current = lenis ?? null;
    return () => {
      lenisRef.current = null;
    };
  }, [lenis, lenisRef]);
  return null;
}

function useNativeScrollSync(
  enabled: boolean,
  getTarget: () => ScrollSource | null,
  scrollY: MotionValue<number>,
  progress: MotionValue<number>,
  velocity: MotionValue<number>,
) {
  useEffect(() => {
    if (!enabled) return;
    const target = getTarget();
    if (!target) return;
    let lastY = readMetrics(target).y;
    let lastT = performance.now();
    const onScroll = () => {
      const { y, max } = readMetrics(target);
      const now = performance.now();
      const dt = now - lastT || 16;
      scrollY.set(y);
      progress.set(max > 0 ? y / max : 0);
      velocity.set(((y - lastY) / dt) * 16);
      lastY = y;
      lastT = now;
    };
    onScroll();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [enabled, getTarget, scrollY, progress, velocity]);
}

export function SmoothScroll({
  children,
  root = true,
  lerp = 0.1,
  duration = 1.2,
  orientation = "vertical",
  wheelMultiplier = 1,
  touch = false,
  className,
}: SmoothScrollProps) {
  const reduce = useReducedMotion();
  const scrollY = useMotionValue(0);
  const progress = useMotionValue(0);
  const velocity = useMotionValue(0);
  const lenisRef = useRef<Lenis | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const nativeSource = useCallback(
    (): ScrollSource | null => (root ? window : containerRef.current),
    [root],
  );

  const scrollTo = useCallback(
    (target: ScrollTarget, options?: ScrollToOptions) => {
      const lenis = lenisRef.current;
      if (lenis && !reduce) {
        lenis.scrollTo(target, {
          offset: options?.offset,
          duration: options?.duration,
          immediate: options?.immediate,
        });
        return;
      }
      const source = nativeSource();
      const behavior = reduce || options?.immediate ? "auto" : "smooth";
      const top = resolveTop(target, source ?? window, options?.offset);
      (source ?? window).scrollTo({ top, behavior });
    },
    [reduce, nativeSource],
  );

  useNativeScrollSync(!!reduce, nativeSource, scrollY, progress, velocity);

  const api = useMemo<SmoothScrollApi>(
    () => ({ lenis: lenisRef.current, scrollY, progress, velocity, scrollTo }),
    [scrollY, progress, velocity, scrollTo],
  );

  if (reduce) {
    return (
      <SmoothScrollContext.Provider value={api}>
        <div ref={containerRef} className={className}>
          {children}
        </div>
      </SmoothScrollContext.Provider>
    );
  }

  return (
    <SmoothScrollContext.Provider value={api}>
      <ReactLenis
        root={root}
        className={className}
        options={{
          lerp,
          duration,
          orientation,
          wheelMultiplier,
          smoothWheel: true,
          syncTouch: touch,
          easing: EASE_SCROLL,
          allowNestedScroll: true,
        }}
      >
        <LenisBridge
          scrollY={scrollY}
          progress={progress}
          velocity={velocity}
          lenisRef={lenisRef}
        />
        {children}
      </ReactLenis>
    </SmoothScrollContext.Provider>
  );
}
