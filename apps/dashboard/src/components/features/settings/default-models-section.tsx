import { Skeleton } from "@codraoss/ui";
import { useMemo } from "react";
import type { ModelConfig } from "@codraoss/schema";
import { ModelRouteEditor } from "@client/components/features/models/model-chain";
import type {
  ModelOption,
  ModelRouteConfig,
  ProviderOption,
} from "@client/components/features/models/model-route";
import type { ProviderDraft } from "./settings-support";

export function DefaultModelsSection({
  loading,
  providers,
  configs,
  globalConfig,
  setGlobalConfig,
}: {
  loading: boolean;
  providers: ProviderDraft[];
  configs: ModelConfig[];
  globalConfig: ModelRouteConfig | null;
  setGlobalConfig: (value: ModelRouteConfig) => void;
}) {
  const providerOptions: ProviderOption[] = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
      })),
    [providers],
  );

  const modelOptions: ModelOption[] = useMemo(
    () =>
      configs.map((config) => ({
        value: config.modelId,
        label: `${config.providerName} / ${config.modelName}`,
        providerId: config.providerId,
      })),
    [configs],
  );

  return (
    <div className="border-t border-ui-line">
      <div className="px-4 py-4 sm:px-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-default">
          Default models
        </h3>
        <p className="mt-0.5 text-xs text-ui-subtle">
          Used by repos that don't set their own model
        </p>
      </div>
      <div className="p-5 pt-0">
        {!loading && globalConfig ? (
          <ModelRouteEditor
            value={globalConfig}
            onChange={setGlobalConfig}
            models={modelOptions}
            providers={providerOptions}
            density="comfortable"
          />
        ) : (
          <div className="min-w-0 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <Skeleton height={16} width="60%" />
              <Skeleton height={32} width={90} borderRadius={6} />
            </div>
            <div className="overflow-hidden rounded-lg border border-ui-line">
              <div className="border-b border-ui-line/60 bg-ui-fill/4 px-4 py-3">
                <Skeleton height={14} width={100} />
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-[160px_1fr] gap-2">
                  <Skeleton height={36} borderRadius={6} />
                  <Skeleton height={36} borderRadius={6} />
                </div>
                <Skeleton height={16} width={100} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
