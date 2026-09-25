import type { ReviewJobMessage } from "@codraoss/schema";

export interface JobOrchestrator {
  startReviewJob(id: string, params: ReviewJobMessage): Promise<void>;
}
