import type {
  AccountResponse,
  AuthSessionResponse,
  JobDetailResponse,
  JobDiffsResponse,
  JobsResponse,
  ModelConfigsResponse,
  RepoConfigResponse,
  RepoConfigsResponse,
  RetryJobResponse,
  StatsResponse,
  SyncReposResponse,
  UpdatesEmailResponse,
} from "@codraoss/schema/api";
import type {
  LlmApiFormat,
  LlmProvider,
  RepoConfig,
  ReviewSettings,
} from "@codraoss/schema";
import { resolvedTimeZone } from "@client/lib/timezone";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function pathSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Path segment cannot be empty.");
  }
  return encodeURIComponent(trimmed);
}

type QueryValue = string | number | boolean | null | undefined;
export type ProviderPayload = {
  name: string;
  apiFormat: LlmApiFormat;
  baseUrl: string | null;
  apiKey?: string;
  clearApiKey?: boolean;
  enabled: boolean;
};
type RepoConfigPatch = Partial<
  Pick<RepoConfig, "review" | "model"> & { enabled: boolean }
>;

async function request<T>(input: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init?.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (!SAFE_METHODS.has(method)) {
    headers.set("x-requested-with", "XMLHttpRequest");
  }

  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (response.status === 401) {
    if (location.pathname !== "/") {
      location.href = "/";
    }
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestWithMeta<T>(input: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init?.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (!SAFE_METHODS.has(method)) {
    headers.set("x-requested-with", "XMLHttpRequest");
  }

  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (response.status === 401) {
    if (location.pathname !== "/") {
      location.href = "/";
    }
    throw new Error("Unauthorized");
  }

  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");

  if (response.status === 304) {
    return {
      status: response.status,
      etag,
      lastModified,
      notModified: true as const,
    };
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return {
    status: response.status,
    etag,
    lastModified,
    notModified: false as const,
    data: (await response.json()) as T,
  };
}

let updatesEmailPromise: Promise<UpdatesEmailResponse> | null = null;
let updatesEmailFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export const api = {
  getSession() {
    return request<AuthSessionResponse>("/api/auth/session");
  },
  getAccount() {
    return request<AccountResponse>("/api/auth/account");
  },
  updateAccountName(name: string) {
    return request<AccountResponse>("/api/auth/account", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  /** `null` = follow the viewer's browser timezone. */
  updateAccountTimezone(timezone: string | null) {
    return request<AccountResponse>("/api/auth/account", {
      method: "PATCH",
      body: JSON.stringify({ timezone }),
    });
  },
  logout() {
    return request<{ ok: boolean }>("/auth/logout", {
      method: "POST",
    });
  },
  getUpdatesEmailStatus() {
    const now = Date.now();
    if (!updatesEmailPromise || now - updatesEmailFetchTime > CACHE_TTL) {
      updatesEmailFetchTime = now;
      updatesEmailPromise = request<UpdatesEmailResponse>(
        "/api/auth/updates-email",
      ).catch((err) => {
        updatesEmailPromise = null;
        throw err;
      });
    }
    return updatesEmailPromise;
  },
  subscribeUpdates(email: string) {
    updatesEmailPromise = request<UpdatesEmailResponse>(
      "/api/auth/updates-email",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    ).catch((err) => {
      updatesEmailPromise = null;
      throw err;
    });
    return updatesEmailPromise;
  },
  getJobs(params: Record<string, QueryValue> = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    }
    const query = searchParams.toString();
    return request<JobsResponse>(`/api/jobs${query ? `?${query}` : ""}`);
  },
  getJob(id: string, options: { etag?: string | null } = {}) {
    const headers = new Headers();
    if (options.etag) {
      headers.set("if-none-match", options.etag);
    }
    return requestWithMeta<JobDetailResponse>(`/api/jobs/${id}`, { headers });
  },
  getJobDiffs(id: string) {
    return request<JobDiffsResponse>(`/api/jobs/${id}/diffs`);
  },
  retryJob(id: string) {
    return request<RetryJobResponse>(`/api/jobs/${id}/retry`, {
      method: "POST",
    });
  },
  rerunJob(id: string) {
    return request<RetryJobResponse>(`/api/jobs/${pathSegment(id)}/rerun`, {
      method: "POST",
    });
  },
  stopJob(id: string) {
    return request<RetryJobResponse>(`/api/jobs/${pathSegment(id)}/stop`, {
      method: "POST",
    });
  },
  deleteJob(id: string) {
    return request<void>(`/api/jobs/${pathSegment(id)}`, {
      method: "DELETE",
    });
  },
  /** Record a human verdict on one finding. 'wrong' also suppresses it repo-wide; 'right' does not. */
  setFindingLabel(
    jobId: string,
    fingerprint: string,
    label: "right" | "wrong",
  ) {
    return request<{ label: "right" | "wrong" }>(
      `/api/jobs/${pathSegment(jobId)}/findings/${pathSegment(fingerprint)}/label`,
      { method: "PUT", body: JSON.stringify({ label }) },
    );
  },
  clearFindingLabel(jobId: string, fingerprint: string) {
    return request<void>(
      `/api/jobs/${pathSegment(jobId)}/findings/${pathSegment(fingerprint)}/label`,
      { method: "DELETE" },
    );
  },
  getRepos() {
    return request<RepoConfigsResponse>("/api/repos");
  },
  getRepo(owner: string, repo: string) {
    return request<RepoConfigResponse>(
      `/api/repos/${pathSegment(owner)}/${pathSegment(repo)}/config`,
    );
  },
  getStats(days?: number) {
    // Send the display zone so day buckets group the same way timestamps render.
    const params = new URLSearchParams({ tz: resolvedTimeZone() });
    if (days) params.set("days", String(days));
    return request<StatsResponse>(`/api/stats?${params.toString()}`);
  },
  syncRepos() {
    return request<SyncReposResponse>("/api/repos/sync", {
      method: "POST",
    });
  },
  updateRepoConfig(owner: string, repo: string, config: RepoConfigPatch) {
    return request<{ ok: boolean }>(
      `/api/repos/${pathSegment(owner)}/${pathSegment(repo)}/config`,
      {
        method: "PATCH",
        body: JSON.stringify(config),
      },
    );
  },
  getModelConfigs() {
    return request<ModelConfigsResponse>("/api/models");
  },
  refreshModelCatalog() {
    return request<ModelConfigsResponse>("/api/models/sync", {
      method: "POST",
    });
  },
  createProvider(config: ProviderPayload) {
    return request<{ provider: LlmProvider }>("/api/models/providers", {
      method: "POST",
      body: JSON.stringify(config),
    });
  },
  updateProvider(id: string, config: ProviderPayload) {
    return request<{ provider: LlmProvider }>(
      `/api/models/providers/${pathSegment(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(config),
      },
    );
  },
  deleteProvider(id: string) {
    return request<{ ok: boolean }>(
      `/api/models/providers/${pathSegment(id)}`,
      {
        method: "DELETE",
      },
    );
  },
  getGlobalConfig() {
    return request<{ config: RepoConfig["model"] }>("/api/models/global");
  },
  updateGlobalConfig(config: RepoConfig["model"]) {
    return request<{ ok: boolean }>("/api/models/global", {
      method: "PATCH",
      body: JSON.stringify(config),
    });
  },
  getReviewSettings() {
    return request<{ settings: ReviewSettings }>("/api/settings");
  },
  updateReviewSettings(settings: ReviewSettings) {
    return request<{ ok: boolean; settings: ReviewSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  },
};
