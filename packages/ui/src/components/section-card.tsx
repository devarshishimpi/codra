import type { ReactNode } from "react";

export function SectionCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ui-panel min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-ui-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="shrink-0 text-ui-subtle">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-default">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 truncate text-xs text-ui-subtle">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
