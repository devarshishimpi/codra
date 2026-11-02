import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestEnv } from "../helpers";

// The cron must keep the serverless Postgres asleep when idle: it only opens a DB connection when
// the `system:active_jobs` KV flag is set, and it clears that flag as soon as there is no pending
// maintenance work so the next tick skips the DB entirely.

const { runBestEffortJobMaintenanceMock, hasPendingMaintenanceWorkMock } =
  vi.hoisted(() => ({
    runBestEffortJobMaintenanceMock: vi.fn().mockResolvedValue(undefined),
    hasPendingMaintenanceWorkMock: vi.fn(),
  }));

vi.mock("@server/core/job-recovery", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  runBestEffortJobMaintenance: runBestEffortJobMaintenanceMock,
}));

vi.mock("@codraoss/db/jobs", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  hasPendingMaintenanceWork: hasPendingMaintenanceWorkMock,
}));

import worker from "../../apps/worker/src/index";

const controller = {} as ScheduledController;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("scheduled() cron maintenance gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips all DB work (no maintenance) when the active-jobs flag is absent", async () => {
    const env = createTestEnv();
    await worker.scheduled(controller, env, ctx);
    expect(runBestEffortJobMaintenanceMock).not.toHaveBeenCalled();
    expect(hasPendingMaintenanceWorkMock).not.toHaveBeenCalled();
  });

  it("runs maintenance and clears the flag when no pending work remains", async () => {
    const env = createTestEnv();
    await env.APP_KV.put("system:active_jobs", "1");
    hasPendingMaintenanceWorkMock.mockResolvedValue(false);

    await worker.scheduled(controller, env, ctx);

    expect(runBestEffortJobMaintenanceMock).toHaveBeenCalledTimes(1);
    // Flag cleared -> the next tick will early-return without touching Postgres.
    expect(await env.APP_KV.get("system:active_jobs")).toBeNull();
  });

  it("runs maintenance but keeps the flag while work is still pending", async () => {
    const env = createTestEnv();
    await env.APP_KV.put("system:active_jobs", "1");
    hasPendingMaintenanceWorkMock.mockResolvedValue(true);

    await worker.scheduled(controller, env, ctx);

    expect(runBestEffortJobMaintenanceMock).toHaveBeenCalledTimes(1);
    // Flag retained -> the cron keeps maintaining the still-active job(s).
    expect(await env.APP_KV.get("system:active_jobs")).toBe("1");
  });

  it("markSystemActive writes the flag only once while it is set (no per-chunk KV write storm)", async () => {
    const { markSystemActive } = await import("@codraoss/db/jobs");
    const env = createTestEnv();
    const putSpy = vi.spyOn(env.APP_KV, "put");

    await markSystemActive(env); // flag absent -> one write
    await markSystemActive(env); // flag present -> skipped
    await markSystemActive(env); // still present -> skipped

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(await env.APP_KV.get("system:active_jobs")).toBe("1");
  });
});
