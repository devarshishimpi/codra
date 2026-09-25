import type { Transition, Variants } from "motion/react";

export type Placement = "bottom" | "top";

export interface SelectOption {
  value: string;
  label: string;
}

export interface TriggerRect {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

// Spring with bounce powers the unfold.
export const CHEVRON_TRANSITION: Transition = {
  type: "spring",
  duration: 0.4,
  bounce: 0.3,
};

// Compounds per option; 0.035 delayed the last item ~0.9s on long lists, so 0.02 is the compromise.
export const LIST_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.02, delayChildren: 0.03 } },
};
export const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -5, filter: "blur(2px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

/** Snaps a property to its target. */
export const INSTANT_TRANSITION: Transition = { duration: 0 };
