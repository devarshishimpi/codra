import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, type ProviderPayload } from "@client/lib/api";
import type {
  LlmProvider,
  ModelConfig,
  ReviewSettings,
} from "@codraoss/schema";
import type { ModelConfigsResponse } from "@codraoss/schema/api";
import {
  normalizeModelRoute,
  routesEqual,
  type ModelRouteConfig,
} from "@client/components/features/models/model-route";
import {
  providerDraftDirty,
  providerHasCredential,
  providerIsReady,
  providerToDraft,
  type NewProviderDraft,
  type ProviderDraft,
  type SyncError,
} from "@client/components/features/settings/settings-support";

/** Alias for the global route normalizer; `test/api/settings.spec.ts` imports it from this module. */
export const normalizeGlobalConfig = normalizeModelRoute;

const BLANK_NEW_PROVIDER: NewProviderDraft = {
  preset: "custom-openai",
  name: "Custom OpenAI",
  apiFormat: "openai",
  baseUrl: "",
  apiKey: "",
  enabled: true,
};

// Every provider, model-catalog and default-route value SettingsPage renders, plus the one batched
// load that hydrates them. `setLoading` / `setSaving` / `setError` and the review-settings hydrator
// are passed in because the page shares those across both halves of the page; for the same reason
// `loadConfigs` is returned rather than run from an effect here, so the state it writes lands in the
// page's own render pass instead of costing a second one.
export function useProviderSettings({
  setLoading,
  setSaving,
  setError,
  hydrateReviewSettings,
}: {
  setLoading: (value: boolean) => void;
  setSaving: (value: string | null) => void;
  setError: (value: string | null) => void;
  hydrateReviewSettings: (settings: ReviewSettings) => void;
}) {
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [savedProviders, setSavedProviders] = useState<LlmProvider[]>([]);
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [globalConfig, setGlobalConfig] = useState<ModelRouteConfig | null>(
    null,
  );
  const [savedGlobalConfig, setSavedGlobalConfig] =
    useState<ModelRouteConfig | null>(null);

  const [newProvider, setNewProvider] =
    useState<NewProviderDraft>(BLANK_NEW_PROVIDER);
  const [syncErrors, setSyncErrors] = useState<SyncError[]>([]);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogRefreshedOnce, setCatalogRefreshedOnce] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(
    null,
  );

  const existingProviderNames = useMemo(
    () => new Set(providers.map((provider) => provider.name.toLowerCase())),
    [providers],
  );

  const selectedProviderNameExists = existingProviderNames.has(
    newProvider.name.trim().toLowerCase(),
  );

  const providerModelCounts = useMemo(
    () =>
      configs.reduce((counts, config) => {
        counts.set(config.providerId, (counts.get(config.providerId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    [configs],
  );

  const globalDirty = useMemo(
    () => !routesEqual(globalConfig, savedGlobalConfig),
    [globalConfig, savedGlobalConfig],
  );

  const applyModelConfigResponse = (modelsRes: ModelConfigsResponse) => {
    // A save on one provider triggers a catalog refresh that can land here mid-edit on other rows; only overwrite rows without an unsaved draft.
    setProviders((current) =>
      modelsRes.providers.map((fresh) => {
        const draft = current.find((item) => item.id === fresh.id);
        const lastKnownSaved = savedProviders.find(
          (item) => item.id === fresh.id,
        );
        if (draft && providerDraftDirty(draft, lastKnownSaved)) {
          return draft;
        }
        return providerToDraft(fresh);
      }),
    );
    setSavedProviders(modelsRes.providers);
    setConfigs(modelsRes.configs);
    setSyncErrors(modelsRes.syncErrors ?? []);
  };

  const refreshModelCatalog = async ({
    quiet = false,
  }: { quiet?: boolean } = {}) => {
    if (catalogRefreshing) return;
    setCatalogRefreshing(true);
    setSyncErrors([]);
    const tid = quiet ? null : toast.loading("Syncing providers and models...");
    try {
      let savedProviderCount = 0;
      let failedProviderCount = 0;
      if (!quiet) {
        const dirtyProviders = providers.filter((provider) =>
          providerDraftDirty(
            provider,
            savedProviders.find((saved) => saved.id === provider.id),
          ),
        );
        if (dirtyProviders.length > 0) {
          const results = await Promise.all(
            dirtyProviders.map((provider) =>
              persistProvider(provider, { quiet: true }),
            ),
          );
          savedProviderCount = results.filter(Boolean).length;
          failedProviderCount = results.length - savedProviderCount;
        }
      }

      const modelsRes = await api.refreshModelCatalog();
      applyModelConfigResponse(modelsRes);
      setCatalogRefreshedOnce(true);

      if (!quiet) {
        const failedCatalogs = modelsRes.syncErrors?.length ?? 0;
        const parts: string[] = [];
        if (savedProviderCount > 0)
          parts.push(
            `${savedProviderCount} provider${savedProviderCount === 1 ? "" : "s"} saved`,
          );
        if (failedProviderCount > 0)
          parts.push(
            `${failedProviderCount} provider${failedProviderCount === 1 ? "" : "s"} failed to save`,
          );
        if (failedCatalogs > 0)
          parts.push(
            `${failedCatalogs} provider${failedCatalogs === 1 ? "" : "s"} reported a catalog error`,
          );

        const description =
          parts.length > 0
            ? parts.join(" · ")
            : "Providers and model lists are up to date.";
        if (failedProviderCount > 0 || failedCatalogs > 0) {
          toast.error("Sync finished with issues", {
            id: tid ?? undefined,
            description,
          });
        } else {
          toast.success("Sync complete", { id: tid ?? undefined, description });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Catalog refresh failed";
      setSyncErrors([
        {
          providerId: "catalog-refresh",
          providerName: "Model catalog",
          error: msg,
        },
      ]);
      if (!quiet)
        toast.error("Could not refresh catalog", {
          id: tid ?? undefined,
          description: msg,
        });
    } finally {
      setCatalogRefreshing(false);
    }
  };

  const loadConfigs = async () => {
    try {
      const [modelsRes, globalRes, reviewSettingsRes] = await Promise.all([
        api.getModelConfigs(),
        api.getGlobalConfig(),
        api.getReviewSettings(),
      ]);
      const nextGlobalConfig = normalizeGlobalConfig(globalRes.config);
      applyModelConfigResponse(modelsRes);
      setGlobalConfig(nextGlobalConfig);
      setSavedGlobalConfig(nextGlobalConfig);
      hydrateReviewSettings(reviewSettingsRes.settings);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load settings";
      setError(msg);
      toast.error("Could not load settings", {
        description: "Something went wrong fetching your configuration.",
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Memoized because the debounced autosave below lists it as a dependency, so it has to be stable
  // or the 600 ms timer restarts on every render. `setSaving`/`setError` are the page's raw
  // `useState` setters, which React guarantees are stable -- don't pass inline wrappers instead.
  const persistGlobalConfig = useCallback(
    async (next: ModelRouteConfig) => {
      setSaving("global");
      setError(null);
      const tid = toast.loading("Saving model strategy...");
      try {
        await api.updateGlobalConfig(next);
        setSavedGlobalConfig(next);
        toast.success("Global strategy saved", {
          id: tid,
          description:
            "Repositories without a custom strategy will use these settings.",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Update failed";
        setError(msg);
        toast.error("Could not save strategy", {
          id: tid,
          description: "Your changes were not applied.",
        });
      } finally {
        setSaving(null);
      }
    },
    [setSaving, setError],
  );

  useEffect(() => {
    if (!globalConfig || !globalDirty) return;
    const handle = setTimeout(
      () => void persistGlobalConfig(globalConfig),
      600,
    );
    return () => clearTimeout(handle);
  }, [globalConfig, globalDirty, persistGlobalConfig]);

  const updateProviderDraft = (id: string, updates: Partial<ProviderDraft>) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === id ? { ...provider, ...updates } : provider,
      ),
    );
  };

  const persistProvider = async (
    provider: ProviderDraft,
    {
      quiet = false,
      clearApiKey = false,
      successMessage,
    }: { quiet?: boolean; clearApiKey?: boolean; successMessage?: string } = {},
  ) => {
    if (provider.enabled && !clearApiKey && !providerHasCredential(provider)) {
      if (!quiet) {
        setExpandedProviderId(provider.id);
        toast.error("Add an API key before enabling this provider.");
      }
      return null;
    }

    setSaving(`provider:${provider.id}`);
    setError(null);
    const tid = quiet ? null : toast.loading("Saving provider...");
    try {
      const payload: ProviderPayload = {
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl || null,
        enabled: provider.enabled,
      };
      if (clearApiKey) {
        payload.clearApiKey = true;
      } else if (provider.apiKey.trim()) {
        payload.apiKey = provider.apiKey.trim();
      }
      const { provider: saved } = await api.updateProvider(
        provider.id,
        payload,
      );
      setProviders((current) =>
        current.map((item) =>
          item.id === saved.id ? providerToDraft(saved) : item,
        ),
      );
      setSavedProviders((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      if (!quiet)
        toast.success(successMessage ?? "Provider saved", {
          id: tid ?? undefined,
        });
      return saved;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider update failed";
      setError(msg);
      toast.error("Could not save provider", {
        id: tid ?? undefined,
        description: msg,
      });
      return null;
    } finally {
      setSaving(null);
    }
  };

  const saveProvider = async (provider: ProviderDraft) => {
    const saved = await persistProvider(provider);
    if (
      saved &&
      saved.enabled &&
      (saved.hasApiKey || saved.apiFormat === "cloudflare-workers-ai")
    ) {
      void refreshModelCatalog({ quiet: true });
    }
  };

  const clearProviderKey = async (provider: ProviderDraft) => {
    // Build from the last saved state, not the draft, so clearing the key doesn't persist unrelated unsaved edits; a provider without a key can't stay enabled.
    const saved = savedProviders.find((item) => item.id === provider.id);
    const base = saved ? providerToDraft(saved) : provider;
    await persistProvider(
      { ...base, apiKey: "", enabled: false },
      { clearApiKey: true, successMessage: "API key removed" },
    );
  };

  const createProvider = async () => {
    if (!newProvider.name.trim() || selectedProviderNameExists) return;
    setSaving("provider:new");
    setError(null);
    const tid = toast.loading("Creating provider...");
    try {
      const { provider } = await api.createProvider({
        name: newProvider.name.trim(),
        apiFormat: newProvider.apiFormat,
        baseUrl: newProvider.baseUrl.trim() || null,
        apiKey: newProvider.apiKey.trim() || undefined,
        enabled: newProvider.enabled,
      });
      setProviders((current) => [...current, providerToDraft(provider)]);
      setSavedProviders((current) => [...current, provider]);
      setNewProvider(BLANK_NEW_PROVIDER);
      setAddingProvider(false);
      toast.success("Provider created", { id: tid });
      if (
        provider.enabled &&
        (provider.hasApiKey || provider.apiFormat === "cloudflare-workers-ai")
      ) {
        void refreshModelCatalog({ quiet: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider creation failed";
      setError(msg);
      toast.error("Could not create provider", { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const removeProvider = async (id: string) => {
    setSaving(`provider:${id}`);
    setError(null);
    const tid = toast.loading("Deleting provider...");
    try {
      await api.deleteProvider(id);
      setProviders((current) =>
        current.filter((provider) => provider.id !== id),
      );
      setSavedProviders((current) =>
        current.filter((provider) => provider.id !== id),
      );
      toast.success("Provider deleted", { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Provider delete failed";
      setError(msg);
      toast.error("Could not delete provider", { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const newProviderReady =
    newProvider.name.trim().length > 0 &&
    newProvider.baseUrl.trim().length > 0 &&
    newProvider.apiKey.trim().length > 0 &&
    !selectedProviderNameExists;

  const configuredProviderCount = providers.filter(providerIsReady).length;

  return {
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
  };
}
