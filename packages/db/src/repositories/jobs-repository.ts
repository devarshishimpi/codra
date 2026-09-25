import type {
  JobLeaseClaim as CoreJobLeaseClaim,
  JobRow as CoreJobRow,
  JobStore,
  PersistedReviewJob,
} from "@codraoss/core/ports";
import type { DbEnv } from "../env";
import {
  claimJobLease,
  completeJob,
  completePreparationStep,
  failJob,
  findExistingJobForHead,
  getJobForProcessing,
  getOtherRunningJobsCount,
  heartbeatJobLease,
  insertJob,
  mapJob,
  markJobCheckRunCompleted,
  markJobContinuationQueued,
  releaseJobLease,
  resetJobContinuationCount,
  setJobPullRequestMeta,
  setJobWorkflowInstance,
  supersedeOlderJobs,
  updateJobCheckRun,
  updateJobStep,
  type JobRow,
  recoverExpiredJobLeases,
  getTerminalJobsNeedingCheckRunCompletion,
  hasPendingMaintenanceWork,
  clearSystemActive,
} from "../jobs";

// Pins PersistedReviewJob to mapJob's return type for compile-time safety.
type _PinPersistedReviewJob =
  ReturnType<typeof mapJob> extends PersistedReviewJob
    ? PersistedReviewJob extends ReturnType<typeof mapJob>
      ? true
      : never
    : never;
const _pinPersistedReviewJob: _PinPersistedReviewJob = true;
void _pinPersistedReviewJob;

// Hand-copied because DB version has full job row. Pins status/busy fields.
type _PinLeaseStatuses = Awaited<
  ReturnType<typeof claimJobLease>
>["status"] extends CoreJobLeaseClaim["status"]
  ? CoreJobLeaseClaim["status"] extends Awaited<
      ReturnType<typeof claimJobLease>
    >["status"]
    ? true
    : never
  : never;
const _pinLeaseStatuses: _PinLeaseStatuses = true;
void _pinLeaseStatuses;

type _PinBusyRetryField = Extract<
  Awaited<ReturnType<typeof claimJobLease>>,
  { status: "busy" }
>["retryAfterSeconds"] extends number
  ? true
  : never;
const _pinBusyRetryField: _PinBusyRetryField = true;
void _pinBusyRetryField;

export function makeJobStore(env: DbEnv): JobStore {
  return {
    // The one cast in the extraction. The db row type flows INTO core's JobRow freely (it is an
    // object-literal alias, so TS gives it an implicit index signature); only the return leg needs
    // telling that a row core handed back is the same row it was given.
    mapJob: (row: CoreJobRow) => mapJob(row as unknown as JobRow),

    getJobForProcessing: (jobId) => getJobForProcessing(env, jobId),
    claimJobLease: (jobId, leaseOwner, leaseSeconds) =>
      claimJobLease(env, jobId, leaseOwner, leaseSeconds),
    heartbeatJobLease: (jobId, leaseOwner, leaseSeconds) =>
      heartbeatJobLease(env, jobId, leaseOwner, leaseSeconds),
    releaseJobLease: (jobId, leaseOwner) =>
      releaseJobLease(env, jobId, leaseOwner),
    markJobContinuationQueued: (jobId, delaySeconds) =>
      markJobContinuationQueued(env, jobId, delaySeconds),
    resetJobContinuationCount: (jobId) => resetJobContinuationCount(env, jobId),
    getOtherRunningJobsCount: (excludeJobId) =>
      getOtherRunningJobsCount(env, excludeJobId),

    setJobWorkflowInstance: (jobId, workflowInstanceId) =>
      setJobWorkflowInstance(env, jobId, workflowInstanceId),
    setJobPullRequestMeta: (jobId, meta) =>
      setJobPullRequestMeta(env, jobId, meta),
    insertJob: (input) => insertJob(env, input),
    findExistingJobForHead: (input) => findExistingJobForHead(env, input),

    updateJobCheckRun: (jobId, checkRunId) =>
      updateJobCheckRun(env, jobId, checkRunId),
    markJobCheckRunCompleted: (jobId) => markJobCheckRunCompleted(env, jobId),
    completePreparationStep: (jobId, fileCount) =>
      completePreparationStep(env, jobId, fileCount),
    updateJobStep: (jobId, stepName, update) =>
      updateJobStep(env, jobId, stepName, update),
    completeJob: (jobId, input) => completeJob(env, jobId, input),
    failJob: (jobId, errorMessage) => failJob(env, jobId, errorMessage),
    supersedeOlderJobs: (input) => supersedeOlderJobs(env, input),

    recoverExpiredJobLeases: (maxCount) =>
      recoverExpiredJobLeases(env, maxCount),
    getTerminalJobsNeedingCheckRunCompletion: (limit) =>
      getTerminalJobsNeedingCheckRunCompletion(env, limit),
    hasPendingMaintenanceWork: () => hasPendingMaintenanceWork(env),
    clearSystemActive: () => clearSystemActive(env),
  };
}
