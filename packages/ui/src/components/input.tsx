import * as React from "react";
import { cn } from "../lib/utils";

type InputSize = "xs" | "sm" | "base" | "lg";

const SIZE_CLASS: Record<InputSize, string> = {
  xs: "h-6 rounded-md px-1.5 text-base sm:text-xs",
  sm: "h-8 rounded-md px-2 text-base sm:text-xs",
  base: "h-9 rounded-md px-3 text-base sm:text-sm",
  lg: "h-10 rounded-md px-4 text-base",
};

// Omit the native numeric `size` attribute so our string-union size wins.
export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  size?: InputSize;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "base", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full border border-ui-line bg-ui-base text-ui-default transition-colors placeholder:text-ui-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
