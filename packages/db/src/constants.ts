import {
  reviewConcurrencyLevels,
  reviewMaxCommentsOptions,
} from "@codraoss/schema";

// accounts.ts
export const ACCOUNT_COLUMNS =
  "id, github_user_id, github_username, account_name, account_email, timezone";

// app-settings.ts
export const CONCURRENCY_KEY = "review_concurrency_level";
export const MAX_COMMENTS_KEY = "review_max_comments";
export const MAX_FILES_KEY = "review_max_files";
export const CONCURRENCY_LEVELS = new Set<string>(reviewConcurrencyLevels);
export const MAX_COMMENTS_OPTIONS = new Set<number>(reviewMaxCommentsOptions);

// jobs-activity.ts
export const SYSTEM_ACTIVE_JOBS_KEY = "system:active_jobs";

// model-configs.ts
export const PROVIDER_COLUMNS =
  "id, name, api_format, base_url, encrypted_api_key, enabled, created_at, updated_at";
export const MODEL_SELECT = `
  SELECT
    mc.model_id,
    mc.provider_id,
    p.name AS provider_name,
    p.api_format,
    mc.model_name,
    mc.updated_at
  FROM model_configs mc
  JOIN llm_providers p ON mc.provider_id = p.id
`;

// repo-configs.ts
export const REPO_CONFIG_SELECT = `
  SELECT
    r.installation_id,
    r.owner,
    r.repo,
    rc.parsed_json,
    rc.updated_at,
    rc.main_model,
    rc.fallback_models,
    rc.size_overrides,
    rc.enabled,
    lj.created_at AS last_job_created_at,
    lj.verdict AS last_job_verdict
  FROM repo_configs rc
  JOIN repositories r ON rc.repository_id = r.id
  LEFT JOIN LATERAL (
    SELECT created_at, verdict
    FROM jobs
    WHERE repository_id = r.id
    ORDER BY created_at DESC
    LIMIT 1
  ) lj ON true
`;

// instance-id-repository.ts
export const INSTANCE_ID_KEY = "codra:instance_id";
