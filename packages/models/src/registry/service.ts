import bundledRegistry from "./model-profiles.json" with { type: "json" };
import { ModelRegistrySchema, type ModelProfile, type ModelRegistry } from "@codraoss/schema";

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

  public getProfile(modelId: string, provider?: string): ModelProfile {
    const key = `${provider ? provider + "/" : ""}${modelId}`;
    const defaultGates = {
      maxComments: 5,
      minSeverity: "P2" as const,
      minConfidence: 0.65,
      suppressTestFiles: true,
    };

    const found = this.currentRegistry.profiles[key] ?? this.currentRegistry.profiles[modelId];
    if (found) {
      return {
        ...found,
        gates: {
          ...defaultGates,
          ...found.gates,
        },
      };
    }

    // Fallback profile if model is not explicitly registered:
    // Uses optimized Codra v5 defaults so any custom or unknown model achieves high precision out of the box.
    return {
      id: modelId,
      provider: provider ?? "generic",
      displayName: modelId,
      sampling: { temperature: 0.6, thinkingBudget: "auto" },
      prompts: { style: "calibrated", systemPromptAdditions: [], instructionFocus: [] },
      schema: { format: "strict_json_schema", flattenCodeLocation: false },
      limits: { maxConcurrentCalls: 3, rpmLimit: 15 },
      verification: { sensitivity: "balanced", downgradeUnverifiedToP3: false, dropUndecidable: true, strictDiffOnly: true },
      gates: defaultGates,
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
