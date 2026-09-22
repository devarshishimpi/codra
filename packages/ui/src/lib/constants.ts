// Core UI magic numbers and standard constants.

// Animation timings (ms)
export const UI_DURATION_FAST = 150;
export const UI_DURATION_NORMAL = 200;
export const UI_DURATION_SLOW = 300;
export const UI_DURATION_TOOLTIP = 1500;

// Standard opacities
export const OPACITY_DISABLED = 0.5;
export const OPACITY_HOVER = 0.8;

// Common chart/graph colors
export const CHART_COLORS = {
  hatchGray: 'url(#hatchGray)',
  defaultGrid: '#333',
  transparent: 'transparent',
  tooltipBg: 'rgba(0,0,0,0.5)',
} as const;

// Layout thresholds
export const LAYOUT_CONSTANTS = {
  mobileBreakpoint: 768,
} as const;
