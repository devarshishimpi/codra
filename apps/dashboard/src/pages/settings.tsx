import { Alert, Button, LoadError } from "@codraoss/ui";
import { useEffect, useState } from "react";
import { PageHeader } from "@client/components/layout/page-header";
import { RefreshCw, Plus, X } from "lucide-react";
import { cn } from "@codraoss/ui/utils";
import { AboutSection } from "@client/components/features/settings/about-section";
import { DefaultModelsSection } from "@client/components/features/settings/default-models-section";
import { NewProviderForm } from "@client/components/features/settings/new-provider-form";
import { ProviderList } from "@client/components/features/settings/provider-list";
import { ReviewSection } from "@client/components/features/settings/review-section";
import { useReviewSettings } from "@client/hooks/use-review-settings";
import { useProviderSettings } from "@client/hooks/use-provider-settings";

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Review-settings half of the page. Hydrated by the provider hook from the same combined load.
  const {
    reviewSettings,
    maxFilesDraft,
    setMaxFilesDraft,
    pendingConfirm,
    setPendingConfirm,
    hydrate: hydrateReviewSettings,
    handleConcurrencyChange,
    handleCommentsChange,
    commitMaxFiles,
    applyPendingConfirm,
  } = useReviewSettings({ setSaving, setError });

  const {
    providers,
    savedProviders,
    configs,
    globalConfig,
    setGlobalConfig,
    newProvider,
    setNewProvider,
    syncErrors,
    catalogRefreshing,
    catalogRefreshedOnce,
    addingProvider,
    setAddingProvider,
    expandedProviderId,
    setExpandedProviderId,
    providerModelCounts,
    selectedProviderNameExists,
    newProviderReady,
    configuredProviderCount,
    loadConfigs,
    refreshModelCatalog,
    updateProviderDraft,
    saveProvider,
    removeProvider,
    clearProviderKey,
    createProvider,
  } = useProviderSettings({
    setLoading,
    setSaving,
    setError,
    hydrateReviewSettings,
  });

  // The load lives here, not inside the hook: it writes `loading`/`error` and the review settings,
  // all of which this page owns, and a hook effect pushing them up would cost an extra render.
  useEffect(() => {
    let mounted = true;
    loadConfigs().then((loaded) => {
      if (mounted && loaded) void refreshModelCatalog({ quiet: true });
    });
    return () => {
      mounted = false;
    };
    // Mount-only: both callbacks close over 15+ state setters and are recreated every render, so listing deps would re-fetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="page-enter flex flex-col gap-5 pb-20">
      <PageHeader
        title="Settings"
        description="Manage LLM providers, model routing, and usage limits."
      />

      {error && (
        <LoadError
          title="Something went wrong"
          hint="The last request didn't go through. Retry the action, or reload the page."
          detail={error}
        />
      )}

      {syncErrors.length > 0 && (
        <Alert variant="warning">
          <div className="space-y-0.5">
            <p className="font-semibold text-sm">
              Some provider catalogs could not refresh
            </p>
            <p className="text-xs opacity-75">
              {syncErrors
                .map((item) => `${item.providerName}: ${item.error}`)
                .join(" · ")}
            </p>
          </div>
        </Alert>
      )}

      <ReviewSection
        loading={loading}
        reviewSettings={reviewSettings}
        maxFilesDraft={maxFilesDraft}
        setMaxFilesDraft={setMaxFilesDraft}
        pendingConfirm={pendingConfirm}
        setPendingConfirm={setPendingConfirm}
        handleConcurrencyChange={handleConcurrencyChange}
        handleCommentsChange={handleCommentsChange}
        commitMaxFiles={commitMaxFiles}
        applyPendingConfirm={applyPendingConfirm}
      />

      <section className="ui-panel min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-ui-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-default">
              LLM Providers
            </h2>
            <p className="mt-0.5 text-xs text-ui-subtle">
              {loading
                ? "Loading…"
                : `${configuredProviderCount} of ${providers.length} configured`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshModelCatalog()}
              disabled={loading || catalogRefreshing || saving !== null}
              icon={
                <RefreshCw
                  size={13}
                  className={cn(catalogRefreshing && "animate-spin")}
                />
              }
              className="text-ui-subtle hover:text-ui-default"
            >
              {catalogRefreshing ? "Syncing…" : "Sync"}
            </Button>
            <Button
              variant={addingProvider ? "ghost" : "primary"}
              size="sm"
              onClick={() => setAddingProvider((v) => !v)}
              icon={addingProvider ? <X size={13} /> : <Plus size={13} />}
            >
              {addingProvider ? "Cancel" : "Add"}
            </Button>
          </div>
        </div>

        {addingProvider && (
          <NewProviderForm
            newProvider={newProvider}
            setNewProvider={setNewProvider}
            selectedProviderNameExists={selectedProviderNameExists}
            newProviderReady={newProviderReady}
            saving={saving}
            onCreate={createProvider}
            onCancel={() => setAddingProvider(false)}
          />
        )}

        <ProviderList
          loading={loading}
          addingProvider={addingProvider}
          providers={providers}
          savedProviders={savedProviders}
          providerModelCounts={providerModelCounts}
          expandedProviderId={expandedProviderId}
          setExpandedProviderId={setExpandedProviderId}
          updateProviderDraft={updateProviderDraft}
          saveProvider={saveProvider}
          removeProvider={removeProvider}
          clearProviderKey={clearProviderKey}
          saving={saving}
        />

        <DefaultModelsSection
          loading={loading}
          providers={providers}
          configs={configs}
          globalConfig={globalConfig}
          setGlobalConfig={setGlobalConfig}
        />

        {!loading && (
          <div className="border-t border-ui-line/50 px-4 py-2.5 sm:px-5">
            <p className="text-xs text-ui-subtle/70">
              {catalogRefreshing
                ? "Syncing model lists…"
                : catalogRefreshedOnce
                  ? "Synced this session"
                  : "Loaded from database"}
            </p>
          </div>
        )}
      </section>

      <AboutSection />
    </section>
  );
}
