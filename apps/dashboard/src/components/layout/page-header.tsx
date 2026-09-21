import * as React from 'react';
import { cn } from '@codraoss/ui/utils';
import { UpdatesEmailPrompt } from '@client/components/shared/updates-email-prompt';

interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  versionBadge?: string;
}

export function PageHeader({
  title,
  description, 
  actions, 
  className, 
  ...props 
}: PageHeaderProps) {
  return (
    <>
      <header
        className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-3', className)}
        {...props}
      >
        <div>
          <h1
            className="flex items-center gap-3 text-xl font-bold text-foreground"
            style={{ letterSpacing: '-0.02em' }}
          >
            {title}
            {props.versionBadge && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">
                v{props.versionBadge}
              </span>
            )}
          </h1>
          {description && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto sm:shrink-0">
            {actions}
          </div>
        )}
      </header>
      <UpdatesEmailPrompt />
    </>
  );
}
