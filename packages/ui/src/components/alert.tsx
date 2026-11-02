import * as React from "react";
import { cn } from "../lib/utils";
import { AlertCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react";

const variants = {
  default: {
    bg: "var(--info-bg)",
    border: "var(--info-border)",
    color: "var(--info)",
    icon: Info,
  },
  destructive: {
    bg: "var(--danger-bg)",
    border: "var(--danger-border)",
    color: "var(--danger)",
    icon: AlertCircle,
  },
  warning: {
    bg: "var(--warning-bg)",
    border: "var(--warning-border)",
    color: "var(--warning)",
    icon: AlertTriangle,
  },
  success: {
    bg: "var(--success-bg)",
    border: "var(--success-border)",
    color: "var(--success)",
    icon: CheckCircle2,
  },
};

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
  icon?: React.ElementType;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    { className, variant = "default", icon: IconOverride, children, ...props },
    ref,
  ) => {
    const config = variants[variant];
    const Icon = IconOverride || config.icon;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "flex gap-3 rounded-lg border px-4 py-3 text-sm",
          className,
        )}
        style={{
          backgroundColor: config.bg,
          borderColor: config.border,
          color: config.color,
        }}
        {...props}
      >
        <Icon className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="flex-1">{children}</div>
      </div>
    );
  },
);
Alert.displayName = "Alert";
