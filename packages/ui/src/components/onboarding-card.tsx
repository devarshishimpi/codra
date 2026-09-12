import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface OnboardingStep {
  id: string;
  label: React.ReactNode;
  done: boolean;
  onClick?: () => void;
}

export interface OnboardingCardProps {
  title?: React.ReactNode;
  completedTitle?: React.ReactNode;
  description?: React.ReactNode;
  steps: OnboardingStep[];
  onDismiss?: () => void;
  className?: string;
  segments?: number;
}

export function OnboardingCard({
  title = "You're almost there!",
  completedTitle = "You're all set! 🎉",
  description,
  steps,
  onDismiss,
  className,
  segments = 22,
}: OnboardingCardProps) {
  const doneCount = steps.filter((s) => s.done).length;
  const totalSteps = steps.length;
  const allDone = doneCount === totalSteps && totalSteps > 0;
  
  const filledCount =
    doneCount > 0
      ? Math.max(1, Math.round((doneCount / totalSteps) * segments))
      : 0;

  return (
    <div className={cn("ui-well overflow-hidden rounded-lg", className)}>
      <div className="px-3.5 pb-3.5 pt-5">
        
        {/* Header */}
        <div className="relative mb-3.5 text-center">
          <p className="text-[14px] font-semibold leading-tight text-black dark:text-white">
            {allDone ? completedTitle : title}
          </p>
          {!allDone && description && (
            <p className="mt-1 text-[12px] leading-snug text-black/50 dark:text-white/50">
              {description}
            </p>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded text-ui-subtle/60 transition-colors hover:bg-ui-fill hover:text-ui-default"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Segmented bar */}
        <div
          className="mb-3.5 grid h-[22px] gap-[4px]"
          style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }}
          aria-label={`${doneCount} of ${totalSteps} steps complete`}
          aria-hidden
        >
          {Array.from({ length: segments }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "rounded-[1px] transition-colors duration-500",
                i < filledCount 
                  ? "bg-[oklch(68%_0.14_185)]" 
                  : "bg-[#ffffff] dark:bg-[#3B3B3E]"
              )}
            />
          ))}
        </div>

        {/* Step list */}
        <div className="-mx-2 overflow-hidden rounded-md divide-y divide-ui-line/60">
          {steps.map((step) => {
            const content = (
              <div className={cn(
                'flex w-full items-center gap-2.5 px-2 py-[9px]',
                'text-left text-[12px] font-medium leading-tight',
                'transition-colors duration-150',
                step.done
                  ? 'text-ui-subtle cursor-default'
                  : 'text-foreground hover:bg-ui-fill/50',
              )}>
                {/* Check circle */}
                <span
                  className={cn(
                    'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
                    step.done
                      ? 'border-[#00B3A3] bg-[#00B3A3] text-white'
                      : 'border-ui-line bg-transparent text-transparent'
                  )}
                >
                  <Check size={10} strokeWidth={3} />
                </span>
                
                {/* Text */}
                <span className="flex-1 truncate">{step.label}</span>
              </div>
            );

            if (step.onClick) {
              return (
                <button key={step.id} onClick={step.onClick} className="w-full outline-none focus-visible:bg-ui-fill/50">
                  {content}
                </button>
              );
            }

            return <div key={step.id}>{content}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
