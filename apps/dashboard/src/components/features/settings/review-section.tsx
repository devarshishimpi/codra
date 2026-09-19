import { ConfirmDialog, Input, SectionCard, Skeleton } from '@codraoss/ui';
import { SteppedSlider } from '@codraoss/ui/motion';
import type { ReviewSettings } from '@codraoss/schema';
import { REVIEW_CONCURRENCY_LIMITS, reviewMaxFilesRange } from '@codraoss/schema/review-limits';
import { FieldLabel } from './field-label';
import {
  CONCURRENCY_LEVEL_LABEL,
  CONCURRENCY_MAX_VALUE,
  CONCURRENCY_STEPS,
  CONCURRENCY_VALUE_TO_LEVEL,
  MAX_COMMENTS_CEILING,
  MAX_COMMENTS_STEPS,
} from './settings-support';

// Everything this needs comes from useReviewSettings, so the page spreads that hook's return value straight in.
export function ReviewSection({
  loading,
  reviewSettings,
  maxFilesDraft,
  setMaxFilesDraft,
  pendingConfirm,
  setPendingConfirm,
  handleConcurrencyChange,
  handleCommentsChange,
  commitMaxFiles,
  applyPendingConfirm,
}: {
  loading: boolean;
  reviewSettings: ReviewSettings | null;
  maxFilesDraft: string;
  setMaxFilesDraft: (value: string) => void;
  pendingConfirm: { field: 'concurrency' | 'comments'; value: number } | null;
  setPendingConfirm: (value: { field: 'concurrency' | 'comments'; value: number } | null) => void;
  handleConcurrencyChange: (value: number) => void;
  handleCommentsChange: (value: number) => void;
  commitMaxFiles: () => void;
  applyPendingConfirm: () => void;
}) {
  return (
    <>
      <SectionCard
        title="Review performance"
        description="Concurrency, comment and file limits for automated reviews, changes save automatically"
      >
        <div className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-2">
          {!loading && reviewSettings ? (
            <>
              <div>
                <FieldLabel htmlFor="concurrency-slider" id="concurrency-slider-label">Concurrent jobs & files</FieldLabel>
                <SteppedSlider
                  id="concurrency-slider"
                  value={REVIEW_CONCURRENCY_LIMITS[reviewSettings.concurrencyLevel]}
                  onValueChange={handleConcurrencyChange}
                  min={1}
                  max={CONCURRENCY_MAX_VALUE}
                  step={1}
                  steps={CONCURRENCY_STEPS}
                  aria-labelledby="concurrency-slider-label"
                  formatValue={(v) => `${CONCURRENCY_LEVEL_LABEL[CONCURRENCY_VALUE_TO_LEVEL[v]]} · ${v} job${v === 1 ? '' : 's'} · ${v} file${v === 1 ? '' : 's'} at a time`}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  How many pull requests are reviewed at once, and how many files within each PR are reviewed at once.
                </p>
              </div>

              <div>
                <FieldLabel htmlFor="max-comments-slider" id="max-comments-slider-label">Comments per review</FieldLabel>
                <SteppedSlider
                  id="max-comments-slider"
                  value={reviewSettings.maxComments}
                  onValueChange={handleCommentsChange}
                  min={5}
                  max={MAX_COMMENTS_CEILING}
                  step={5}
                  steps={MAX_COMMENTS_STEPS}
                  aria-labelledby="max-comments-slider-label"
                  formatValue={(v) => `${v} comments`}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  A hard ceiling on the number of comments posted per review, applied on top of any repo-specific limit.
                </p>
              </div>

              <div>
                <FieldLabel htmlFor="max-files-input">Files per review</FieldLabel>
                <Input
                  id="max-files-input"
                  type="number"
                  inputMode="numeric"
                  min={reviewMaxFilesRange.min}
                  max={reviewMaxFilesRange.max}
                  step={1}
                  value={maxFilesDraft}
                  onChange={(event) => setMaxFilesDraft(event.target.value)}
                  // Committed on blur/Enter, not every keystroke, so typing "200" doesn't persist "2" mid-way.
                  onBlur={commitMaxFiles}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setMaxFilesDraft(String(reviewSettings.maxFiles));
                  }}
                  aria-describedby="max-files-help"
                />
                <p id="max-files-help" className="mt-2 text-xs text-muted-foreground">
                  How many changed files a single review covers, {reviewMaxFilesRange.min}-{reviewMaxFilesRange.max}.
                  Anything beyond this is left unreviewed and called out in the review summary.
                </p>
              </div>
            </>
          ) : (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton height={16} width="40%" />
                  <Skeleton height={36} />
                  <Skeleton height={32} />
                </div>
              ))}
            </>
          )}
        </div>
      </SectionCard>

      <ConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => { if (!open) setPendingConfirm(null); }}
        title="This could exceed your rate limit"
        description={
          pendingConfirm?.field === 'concurrency'
            ? 'Running the maximum number of concurrent jobs and files can exceed your model provider\'s rate limits. Continue anyway?'
            : 'Posting the maximum number of comments per review can increase the chance of hitting your model provider\'s rate limits. Continue anyway?'
        }
        confirmLabel="Continue"
        cancelLabel="Cancel"
        onConfirm={applyPendingConfirm}
      />
    </>
  );
}
