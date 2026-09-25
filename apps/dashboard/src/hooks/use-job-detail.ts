import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@client/lib/api";
import type { JobDetail } from "@codraoss/schema";

/* Job detail carries every file's full diff, so cache writes are best-effort (quota is swallowed). */
function jobCacheKey(id: string) {
  return `codra:job:${id}`;
}

function readJobCache(id: string): JobDetail | null {
  try {
    const raw = sessionStorage.getItem(jobCacheKey(id));
    return raw ? (JSON.parse(raw) as JobDetail) : null;
  } catch {
    return null;
  }
}

function writeJobCache(id: string, job: JobDetail) {
  try {
    sessionStorage.setItem(jobCacheKey(id), JSON.stringify(job));
  } catch {
    // best-effort
  }
}

export function useJobDetail(id: string) {
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollTimeout = useRef<number | null>(null);
  const etag = useRef<string | null>(null);
  const latestJob = useRef<JobDetail | null>(null);

  const terminalStatuses: string[] = [
    "done",
    "failed",
    "superseded",
    "cancelled",
  ];
  const isTerminal = (candidate: JobDetail | null) =>
    !!candidate && terminalStatuses.includes(candidate.status);

  const getPollDelay = (candidate: JobDetail | null) => {
    if (!candidate || isTerminal(candidate)) return null;

    const nextRetryAt = candidate.nextRetryAt
      ? new Date(candidate.nextRetryAt).getTime()
      : null;
    const waitingForRetry =
      nextRetryAt !== null &&
      Number.isFinite(nextRetryAt) &&
      nextRetryAt > Date.now();
    const baseDelay = waitingForRetry
      ? Math.min(Math.max(nextRetryAt - Date.now(), 10_000), 15_000)
      : 3_000;

    return document.visibilityState === "hidden"
      ? Math.max(baseDelay, 45_000)
      : baseDelay;
  };

  const fetchJob = async (silent = false) => {
    try {
      const response = await api.getJob(id, { etag: etag.current });
      if (response.etag) etag.current = response.etag;
      if (!response.notModified && response.data) {
        latestJob.current = response.data.job;
        setJob(response.data.job);
        // Do not cache here synchronously to prevent jank on the main thread every 3 seconds
      }
      setError(null);
      schedulePolling();
    } catch (loadError) {
      if (!silent)
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load job.",
        );
      schedulePolling();
    }
  };

  const stopPolling = () => {
    if (pollTimeout.current) {
      window.clearTimeout(pollTimeout.current);
      pollTimeout.current = null;
    }
  };

  const schedulePolling = () => {
    stopPolling();
    const delay = getPollDelay(latestJob.current);
    if (delay === null) return;
    pollTimeout.current = window.setTimeout(() => fetchJob(true), delay);
  };

  // `fetchJob` and `schedulePolling` are mutually recursive and get a new identity every render;
  // holding them in refs gives the effects below a stable thing to call.
  const fetchJobRef = useRef(fetchJob);
  const schedulePollingRef = useRef(schedulePolling);
  useEffect(() => {
    fetchJobRef.current = fetchJob;
    schedulePollingRef.current = schedulePolling;
  });

  useEffect(() => {
    if (id) {
      etag.current = null;
      // Paint the cached copy immediately, then revalidate over the network.
      const cached = readJobCache(id);
      if (cached) {
        latestJob.current = cached;
        setJob(cached);
      } else {
        latestJob.current = null;
        setJob(null);
      }
      fetchJobRef.current();
    }
    return () => stopPolling();
  }, [id]);

  // Only the two fields `getPollDelay` reads; `fetchJob` already keeps `latestJob.current` in sync.
  useEffect(() => {
    schedulePollingRef.current();
  }, [job?.status, job?.nextRetryAt]);

  useEffect(() => {
    const saveCache = () => {
      if (latestJob.current && latestJob.current.id === id) {
        writeJobCache(id, latestJob.current);
      }
    };
    window.addEventListener("pagehide", saveCache);
    return () => {
      window.removeEventListener("pagehide", saveCache);
      saveCache();
    };
  }, [id]);

  // Mount-only: the listener reads through the ref, so it never needs rebinding.
  useEffect(() => {
    const reschedule = () => schedulePollingRef.current();
    document.addEventListener("visibilitychange", reschedule);
    return () => document.removeEventListener("visibilitychange", reschedule);
  }, []);

  const handleRetry = async () => {
    if (!job) return;
    setIsRetrying(true);
    try {
      const response = await api.retryJob(job.id);
      navigate(`/jobs/${response.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to retry job.");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleRerun = async () => {
    if (!job) return;
    setIsRerunning(true);
    const t = toast.loading("Starting a fresh review…");
    try {
      const response = await api.rerunJob(job.id);
      toast.success("Fresh review started.", { id: t });
      navigate(`/jobs/${response.job.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to rerun job.";
      toast.error("Could not start a fresh review.", {
        id: t,
        description: msg,
      });
      setError(msg);
    } finally {
      setIsRerunning(false);
    }
  };

  const handleStop = async () => {
    if (!job) return;
    setIsStopping(true);
    const t = toast.loading("Stopping review…");
    try {
      await api.stopJob(job.id);
      toast.success("Review stopped.", { id: t });
      await fetchJob();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to stop job.";
      toast.error("Could not stop the review.", { id: t, description: msg });
      setError(msg);
    } finally {
      setIsStopping(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    setIsDeleting(true);
    const t = toast.loading("Deleting job…");
    try {
      await api.deleteJob(job.id);
      toast.success("Job deleted.", { id: t });
      navigate("/jobs");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete job.";
      toast.error("Could not delete the job.", { id: t, description: msg });
      setError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    job,
    error,
    isRetrying,
    isRerunning,
    isStopping,
    isDeleting,
    handleRetry,
    handleRerun,
    handleStop,
    handleDelete,
    fetchJob,
  };
}
