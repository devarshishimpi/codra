import bundledRegistry from "./model-profiles.json" with { type: "json" };
import { ModelRegistrySchema, type ModelProfile, type ModelRegistry } from "@codraoss/schema";

const PROFILE_ALIASES: Record<string, string> = {
  "glm-4.7-flash": "zai-glm-4",
  "glm-4-flash": "zai-glm-4",
  "nvidia/nemotron-3-super-120b-a12b": "nvidia/nemotron-3-120b",
  "stepfun-ai/step-5-preview": "nvidia/step-5-preview",
  "gemma-4-26b-a4b-it": "google/gemma-4-26b",
  "gemma-4-31b-it": "google/gemma-4-31b",
};

/** The id as configured, then progressively undecorated: `google:x` -> `x`, `@cf/org/x` -> `org/x` -> `x`. */
function profileIdCandidates(modelId: string): string[] {
  const candidates = [modelId];
  const add = (id: string) => {
    if (id && !candidates.includes(id)) candidates.push(id);
  };
  const withoutProvider = /^[a-z][\w-]*:(?!\/)/i.test(modelId) ? modelId.slice(modelId.indexOf(":") + 1) : modelId;
  add(withoutProvider);
  const withoutCf = withoutProvider.replace(/^@cf\//, "");
  add(withoutCf);
  if (withoutCf !== withoutProvider) add(withoutCf.slice(withoutCf.indexOf("/") + 1));
  return candidates;
}

export class ModelRegistryService {
  private static instance: ModelRegistryService;
  private currentRegistry: ModelRegistry;
  private lastFetchedAt = 0;
  private etag: string | null = null;
  private remoteUrl: string | null = null;

  private constructor() {
    this.currentRegistry = ModelRegistrySchema.parse(bundledRegistry);
    this.remoteUrl = typeof process !== "undefined" ? process.env?.CODRA_MODEL_REGISTRY_URL ?? null : null;
  }

  public static getInstance(): ModelRegistryService {
    if (!ModelRegistryService.instance) {
      ModelRegistryService.instance = new ModelRegistryService();
    }
    return ModelRegistryService.instance;
  }

  /**
   * The registered profile for a model, or undefined when the registry has none (no fallback).
   *
   * Configured ids carry provider decoration the registry keys do not: a strategy stores
   * `google:gemini-3.1-flash-lite`, Workers AI ids look like `@cf/zai-org/glm-4.7-flash`. The id is tried
   * as given first, then without the `provider:` prefix, then without `@cf/` and finally without its org.
   */
  public findProfile(modelId: string, provider?: string): ModelProfile | undefined {
    for (const candidate of profileIdCandidates(modelId)) {
      const resolvedId = PROFILE_ALIASES[candidate] ?? candidate;
      const found =
        (provider ? this.currentRegistry.profiles[`${provider}/${resolvedId}`] : undefined) ??
        this.currentRegistry.profiles[resolvedId];
      if (found) return found;
    }
    return undefined;
  }

  public getProfile(modelId: string, provider?: string): ModelProfile {
    const found = this.findProfile(modelId, provider);
    if (found) return found;

    // Fallback profile if model is not explicitly registered
    return {
      id: modelId,
      provider: provider ?? "generic",
      displayName: modelId,
      sampling: { temperature: 0.7, thinkingBudget: "auto" },
      prompts: { style: "calibrated", systemPromptAdditions: [], instructionFocus: [] },
      schema: { format: "strict_json_schema", flattenCodeLocation: false },
      limits: { maxConcurrentCalls: 3, rpmLimit: 15 },
      verification: { sensitivity: "strict", downgradeUnverifiedToP3: false, dropUndecidable: true, strictDiffOnly: true },
      gates: { maxComments: 5, minSeverity: "P2", minConfidence: 0.7, suppressTestFiles: true },
      topology: { mode: "unified", maxDiffLinesPerFile: 1000, maxDiffChars: 300000, jsonFirst: false, verifierFullContext: true },
    };
  }

  public async refreshFromRemote(url?: string): Promise<boolean> {
    const targetUrl = url ?? this.remoteUrl;
    if (!targetUrl) return false;

    // Cache TTL check: do not re-fetch more than once every 10 minutes
    if (Date.now() - this.lastFetchedAt < 10 * 60 * 1000) return true;

    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "User-Agent": "Codra-Model-Registry/1.0",
      };
      if (this.etag) headers["If-None-Match"] = this.etag;

      const res = await fetch(targetUrl, { headers });
      if (res.status === 304) {
        this.lastFetchedAt = Date.now();
        return true;
      }
      if (!res.ok) return false;

      const newEtag = res.headers.get("ETag");
      const data = await res.json();
      const parsed = ModelRegistrySchema.safeParse(data);
      if (parsed.success) {
        this.currentRegistry = parsed.data;
        this.lastFetchedAt = Date.now();
        if (newEtag) this.etag = newEtag;
        return true;
      }
      return false;
    } catch {
      // Remote fetch failed; preserve existing valid registry
      return false;
    }
  }
}
