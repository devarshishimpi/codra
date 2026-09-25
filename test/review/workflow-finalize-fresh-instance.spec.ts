import { describe, it, expect, vi, beforeEach } from "vitest";

// Pins: freshInstance forces the next phase into a new instance (long-lived ones lose their subrequest budget).

const { runReviewJobMock, maintenanceMock, setInstanceMock } = vi.hoisted(
  () => ({
    runReviewJobMock: vi.fn(),
    maintenanceMock: vi.fn().mockResolvedValue(undefined),
    setInstanceMock: vi.fn().mockResolvedValue(undefined),
  }),
);

// Partial mock: review.ts also imports FRESH_INVOCATION_YIELD_SECONDS from this barrel.
vi.mock("@server/core/review", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  runReviewJob: runReviewJobMock,
}));
vi.mock("@server/core/job-recovery", () => ({
  runBestEffortJobMaintenance: maintenanceMock,
}));
vi.mock("@codraoss/db/jobs", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  setJobWorkflowInstance: setInstanceMock,
}));
vi.mock("@codraoss/db/client", () => ({
  runWithDb: (_env: any, fn: any) => fn(),
}));

import { ReviewWorkflow } from "../../apps/worker/src/workflows/review";

// step.sleep is a no-op.
function makeStep() {
  return {
    do: vi.fn(async (_name: string, optsOrFn: any, maybeFn?: any) => {
      const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
      return fn();
    }),
    sleep: vi.fn(async () => {}),
  };
}

function runWorkflow(env: any, payload: any) {
  // Mocked constructor ignores args, so env is set explicitly after.
  const wf = new ReviewWorkflow({} as any, env) as any;
  wf.env = env;
  return wf.run({ payload, instanceId: "inst-test" }, makeStep());
}

describe("ReviewWorkflow: fresh instance on freshInstance flag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-enqueues the next phase as a fresh instance (carrying the resolved jobId) when freshInstance is set", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = {
      REVIEW_QUEUE: { send },
      HYPERDRIVE: { connectionString: "mock" },
    };
    runReviewJobMock.mockResolvedValueOnce({
      action: "next_phase",
      phase: "finalize",
      delaySeconds: 60,
      jobId: "real-job-id",
      freshInstance: true,
    });

    await runWorkflow(env, { jobId: "real-job-id", phase: "review" });

    expect(runReviewJobMock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "real-job-id",
        phase: "finalize",
        forceFreshInstance: true,
      }),
    );
  });

  it("re-enqueues a fresh instance for a subrequest-limit review deferral (same phase)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = {
      REVIEW_QUEUE: { send },
      HYPERDRIVE: { connectionString: "mock" },
    };
    runReviewJobMock.mockResolvedValueOnce({
      action: "next_phase",
      phase: "review",
      delaySeconds: 60,
      jobId: "real-job-id",
      freshInstance: true,
    });

    await runWorkflow(env, { jobId: "real-job-id", phase: "review" });

    expect(runReviewJobMock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "real-job-id",
        phase: "review",
        forceFreshInstance: true,
      }),
    );
  });

  it("does NOT re-enqueue when freshInstance is not set (normal in-instance continuation)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = {
      REVIEW_QUEUE: { send },
      HYPERDRIVE: { connectionString: "mock" },
    };
    // Hibernation resets budget, so it stays in-instance and completes.
    runReviewJobMock
      .mockResolvedValueOnce({
        action: "next_phase",
        phase: "review",
        delaySeconds: 60,
        jobId: "real-job-id",
        freshInstance: false,
      })
      .mockResolvedValueOnce({ action: "ack" });

    await runWorkflow(env, { jobId: "real-job-id", phase: "review" });

    expect(runReviewJobMock).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the payload jobId to re-enqueue when the result omits it (auto jobs)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = {
      REVIEW_QUEUE: { send },
      HYPERDRIVE: { connectionString: "mock" },
    };
    runReviewJobMock.mockResolvedValueOnce({
      action: "next_phase",
      phase: "finalize",
      delaySeconds: 60,
      freshInstance: true,
    });

    await runWorkflow(env, { jobId: "payload-job-id", phase: "review" });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "payload-job-id",
        phase: "finalize",
        forceFreshInstance: true,
      }),
    );
  });
});
