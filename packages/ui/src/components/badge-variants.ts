import { cva } from "class-variance-authority";

// Borderless tinted pills (Cloudflare-dashboard style): translucent fill + saturated text of the same hue.
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        secondary: "bg-ui-fill/45 text-ui-default",
        neutral: "bg-ui-fill/45 text-ui-default",
        info: "bg-info/15 text-info",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        danger: "bg-danger/15 text-danger",
        outline:
          "text-ui-default ring-1 ring-inset ring-ui-line bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
