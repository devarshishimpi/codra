// Shared between the producer in index.ts and the consumer in worker.ts: they must agree on the
// name or enqueued reviews are never picked up.
export const REVIEW_QUEUE_NAME = 'codra-reviews';
