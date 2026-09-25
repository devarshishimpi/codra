import { cva } from "class-variance-authority";

// `primary`/`secondary` use the bordered-panel look; remaining variants are legacy, kept for screens still on the older palette. Also drives <LinkButton>.
export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border border-[var(--btn-primary-border)] bg-[var(--btn-primary-surface)] text-[var(--btn-primary-fg)] hover:bg-[var(--btn-primary-hover)]",
        secondary:
          "border border-ui-line bg-ui-base text-ui-default hover:bg-ui-fill/60",
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[.98]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        "destructive-outline":
          "border border-danger-border bg-danger-bg/40 text-danger shadow-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive",
        "warning-outline":
          "border border-warning-border bg-warning-bg/40 text-warning shadow-sm hover:bg-warning-bg hover:border-warning",
        outline:
          "border border-zinc-200 bg-white shadow-sm hover:bg-zinc-50 hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:hover:text-foreground",
        ghost: "hover:bg-secondary hover:text-secondary-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        accent:
          "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90 active:scale-[.98]",
      },
      size: {
        default: "h-9 rounded-md px-4 py-2 text-sm",
        sm: "h-8 rounded-md px-3 text-xs",
        base: "h-9 rounded-md px-3 text-sm",
        lg: "h-11 rounded-md px-6 text-sm",
        xs: "h-6 rounded-md px-1.5 text-xs",
        icon: "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
