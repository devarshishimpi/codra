import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "../lib/utils";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  "aria-label"?: string;
  id?: string;
}

/** Toggle switch on Base UI, styled with the ui-* tokens (brand track when on). */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, onCheckedChange, ...props }, ref) => (
    <BaseSwitch.Root
      ref={ref}
      onCheckedChange={(checked) => onCheckedChange?.(checked)}
      className={cn(
        // Squarish track + knob (Cloudflare-dashboard switch shape).
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-[5px] p-[2px] transition-colors duration-200",
        // Dark mode: lighter zinc when off (reads against the page), deeper lime when on (knob doesn't blend).
        "bg-ui-fill dark:bg-[oklch(40%_0_0)]",
        "data-checked:bg-ui-brand dark:data-checked:bg-[oklch(64%_0.21_118)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-ui-base",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="h-3 w-3 rounded-[3px] bg-white shadow-sm transition-transform duration-200 data-checked:translate-x-3" />
    </BaseSwitch.Root>
  ),
);
Switch.displayName = "Switch";

export { Switch };
