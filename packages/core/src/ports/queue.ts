export interface QueueProducer<T> {
  send(message: T, options?: { delaySeconds?: number }): Promise<void>;
  deleteJob?(jobId: string): Promise<void>;
}
