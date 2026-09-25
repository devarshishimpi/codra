import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const textVariants = cva("", {
  variants: {
    variant: {
      body: "text-ui-default",
      secondary: "text-ui-subtle",
      strong: "text-ui-strong",
    },
    size: {
      sm: "text-sm",
      base: "text-base",
    },
    bold: {
      true: "font-semibold",
      false: "",
    },
  },
  defaultVariants: { variant: "body", size: "base", bold: false },
});

interface TextProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof textVariants> {
  /** Element to render (e.g. "span", "h3"). Defaults to <p>. */
  as?: React.ElementType;
}

/** Typographic primitive keyed off the ui-* surface text tokens. */
export function Text({
  as: Comp = "p",
  variant,
  size,
  bold,
  className,
  ...props
}: TextProps) {
  return (
    <Comp
      className={cn(textVariants({ variant, size, bold }), className)}
      {...props}
    />
  );
}
