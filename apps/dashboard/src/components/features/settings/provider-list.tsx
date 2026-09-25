import { Skeleton } from "@codraoss/ui";
import { toast } from "sonner";
import type { LlmProvider } from "@codraoss/schema";
import { ProviderRow } from "./provider-row";
import type { ProviderDraft } from "./settings-support";

const SKELETON_ROWS = ["first", "second", "third"];

export function ProviderList({
  loading,
  addingProvider,
  providers,
  savedProviders,
  providerModelCounts,
  expandedProviderId,
  setExpandedProviderId,
  updateProviderDraft,
  saveProvider,
  removeProvider,
  clearProviderKey,
  saving,
}: {
  loading: boolean;
  addingProvider: boolean;
  providers: ProviderDraft[];
  savedProviders: LlmProvider[];
  providerModelCounts: Map<string, number>;
  expandedProviderId: string | null;
  setExpandedProviderId: (id: string | null) => void;
  updateProviderDraft: (id: string, updates: Partial<ProviderDraft>) => void;
  saveProvider: (provider: ProviderDraft) => void | Promise<void>;
  removeProvider: (id: string) => void | Promise<void>;
  clearProviderKey: (provider: ProviderDraft) => void | Promise<void>;
  saving: string | null;
}) {
  if (loading) {
    return (
      <div className="divide-y divide-ui-line/60">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-4 sm:px-5">
            <div className="flex-1 space-y-2">
              <Skeleton height={13} width="40%" />
              <Skeleton height={11} width="25%" />
            </div>
            <Skeleton height={20} width={36} />
          </div>
        ))}
      </div>
    );
  }

  if (providers.length === 0 && !addingProvider) {
    return (
      <div className="px-5 py-14 text-center">
        <p className="text-sm font-medium text-ui-default">No providers yet</p>
        <p className="mt-1 text-xs text-ui-subtle">
          Add one to start routing models.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-ui-line/60">
      {providers.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          savedProviders={savedProviders}
          providerModelCounts={providerModelCounts}
          expandedProviderId={expandedProviderId}
          setExpandedProviderId={setExpandedProviderId}
          updateProviderDraft={updateProviderDraft}
          saveProvider={saveProvider}
          removeProvider={removeProvider}
          clearProviderKey={clearProviderKey}
          saving={saving}
          toast={toast}
        />
      ))}
    </div>
  );
}
