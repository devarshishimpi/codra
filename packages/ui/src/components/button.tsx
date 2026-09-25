import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { buttonVariants } from "../components/button-variants";

type Shape = "base" | "square" | "circle";

const SQUARE_WIDTH: Record<string, string> = {
  xs: "w-6 p-0",
  sm: "w-8 p-0",
  base: "w-9 p-0",
  default: "w-9 p-0",
  lg: "w-11 p-0",
  icon: "p-0",
};

function shapeClass(
  shape: Shape,
  size: VariantProps<typeof buttonVariants>["size"],
) {
  if (shape === "base") return "";
  return cn(
    SQUARE_WIDTH[size ?? "default"],
    shape === "circle" && "rounded-full",
  );
}

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  shape?: Shape;
  icon?: React.ReactNode;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      shape = "base",
      asChild = false,
      icon,
      loading,
      children,
      ...props
    },
    ref,
  ) => {
    const classes = cn(
      buttonVariants({ variant, size }),
      shapeClass(shape, size),
      className,
    );

    return useRender({
      render: asChild && React.isValidElement(children) ? children : undefined,
      defaultTagName: "button",
      ref,
      props: {
        className: classes,
        ...props,
        ...(asChild
          ? {}
          : {
              disabled: props.disabled || loading,
              children: (
                <>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
                  {children}
                </>
              ),
            }),
      },
    });
  },
);
Button.displayName = "Button";

export interface LinkButtonProps
  extends
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {
  shape?: Shape;
  icon?: React.ReactNode;
  external?: boolean;
}

const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    {
      className,
      variant,
      size,
      shape = "base",
      icon,
      external,
      children,
      ...props
    },
    ref,
  ) => (
    <a
      ref={ref}
      className={cn(
        buttonVariants({ variant, size }),
        shapeClass(shape, size),
        className,
      )}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {icon}
      {children}
    </a>
  ),
);
LinkButton.displayName = "LinkButton";

export { Button, LinkButton };
