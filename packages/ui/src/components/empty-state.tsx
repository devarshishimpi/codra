import React from "react";
import { cn } from "../lib/utils";
import { Button } from "../components/button";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Bullet hints with a green dot prefix. */
  hints?: string[];
  linkAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Legacy single action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  hints,
  linkAction,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-8 py-16 text-center",
        className,
      )}
    >
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center text-muted-foreground/40 [&_svg]:h-9 [&_svg]:w-9 [&_svg]:stroke-[1.35]">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {hints && hints.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1.5 text-left">
          {hints.map((hint) => (
            <li
              key={hint}
              className="flex items-start gap-2.5 text-sm text-muted-foreground"
            >
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary opacity-80" />
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      )}

      {linkAction && (
        <div className="mt-3">
          {linkAction.href ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={linkAction.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {linkAction.label}
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={linkAction.onClick}
            >
              {linkAction.label}
            </Button>
          )}
        </div>
      )}

      {action && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={action.onClick}
          className="mt-2 text-muted-foreground hover:text-foreground"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
