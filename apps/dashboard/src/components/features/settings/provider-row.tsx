import { Badge, Button, Input, Select, Switch } from "@codraoss/ui";
import { ChevronRight, Save, Trash2 } from "lucide-react";
import { cn } from "@codraoss/ui/utils";
import type { LlmApiFormat, LlmProvider } from "@codraoss/schema";
import { FieldLabel } from "./field-label";
import {
  API_FORMAT_OPTIONS,
  apiKeyFieldLabel,
  domId,
  isCustomProvider,
  providerDraftDirty,
  providerHasCredential,
  providerIsReady,
  providerKeyPlaceholder,
  providerStatusLabel,
  type ProviderDraft,
} from "./settings-support";

// Extracted from settings.tsx as its largest single block of markup; the section shell stays put,
// so only these values are threaded through instead of the whole page's state.
export function ProviderRow({
  provider,
  savedProviders,
  providerModelCounts,
  expandedProviderId,
  setExpandedProviderId,
  updateProviderDraft,
  saveProvider,
  removeProvider,
  clearProviderKey,
  saving,
  toast,
}: {
  provider: ProviderDraft;
  savedProviders: LlmProvider[];
  providerModelCounts: Map<string, number>;
  expandedProviderId: string | null;
  setExpandedProviderId: (id: string | null) => void;
  updateProviderDraft: (id: string, updates: Partial<ProviderDraft>) => void;
  saveProvider: (provider: ProviderDraft) => void | Promise<void>;
  removeProvider: (id: string) => void | Promise<void>;
  clearProviderKey: (provider: ProviderDraft) => void | Promise<void>;
  saving: string | null;
  // Passed in rather than imported so this component stays free of the toast singleton.
  toast: { error: (message: string, opts?: { description?: string }) => void };
}) {
  const nativeCloudflare = provider.apiFormat === "cloudflare-workers-ai";
  const customProvider = isCustomProvider(provider);
  const savedProvider = savedProviders.find(
    (saved) => saved.id === provider.id,
  );
  const dirty = providerDraftDirty(provider, savedProvider);
  const modelCount = providerModelCounts.get(provider.id) ?? 0;
  const configOpen = expandedProviderId === provider.id;
  const canEnableProvider = providerHasCredential(provider);
  const providerNameId = domId("provider-name", provider.id);
  const providerBaseUrlId = domId("provider-base-url", provider.id);
  const providerApiKeyId = domId("provider-api-key", provider.id);

  return (
    <article
      className={cn(
        "group min-w-0 transition-colors duration-150",
        dirty && "bg-primary/[0.018]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
        <button
          type="button"
          onClick={() => setExpandedProviderId(configOpen ? null : provider.id)}
          aria-expanded={configOpen}
          aria-label={`${configOpen ? "Collapse" : "Configure"} ${provider.name}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-ui-fill/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-brand/40"
        >
          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-ui-subtle transition-transform duration-200",
              configOpen && "rotate-90 text-ui-default",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-ui-default">
                {provider.name}
              </span>
              <Badge
                variant={
                  !provider.enabled
                    ? "neutral"
                    : providerIsReady(provider)
                      ? "success"
                      : "warning"
                }
                className="shrink-0"
              >
                {providerStatusLabel(provider)}
              </Badge>
            </span>
            <span className="mt-0.5 block text-xs text-ui-subtle">
              <span className="font-mono">{provider.apiFormat}</span>
              {modelCount > 0 && (
                <span className="ml-2 opacity-70">
                  · {modelCount} model{modelCount !== 1 ? "s" : ""}
                </span>
              )}
              {nativeCloudflare && (
                <span className="ml-2 opacity-70">· Worker binding</span>
              )}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {dirty && (
            <Button
              variant="primary"
              size="xs"
              onClick={() => saveProvider(provider)}
              disabled={saving !== null}
              loading={saving === `provider:${provider.id}`}
              icon={<Save size={11} />}
              className="animate-fade-in h-7 px-2.5"
            >
              Save
            </Button>
          )}

          <Switch
            checked={provider.enabled && canEnableProvider}
            aria-label={`${provider.enabled && canEnableProvider ? "Disable" : "Enable"} ${provider.name}`}
            onCheckedChange={(enabled) => {
              if (enabled && !canEnableProvider) {
                setExpandedProviderId(provider.id);
                toast.error("Add an API key before enabling this provider.");
                return;
              }
              updateProviderDraft(provider.id, { enabled });
            }}
          />

          {customProvider && (
            <button
              type="button"
              aria-label="Delete provider"
              onClick={() => removeProvider(provider.id)}
              disabled={saving !== null}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ui-subtle/50 transition-colors hover:text-danger disabled:pointer-events-none group-hover:text-ui-subtle"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {configOpen && (
        <div className="animate-slide-down border-t border-ui-line/60 bg-ui-fill/20 px-4 py-5 sm:px-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {customProvider && (
              <>
                <div>
                  <FieldLabel htmlFor={providerNameId}>Display name</FieldLabel>
                  <Input
                    id={providerNameId}
                    value={provider.name}
                    onChange={(e) =>
                      updateProviderDraft(provider.id, { name: e.target.value })
                    }
                  />
                </div>
                <Select
                  label="Protocol"
                  value={provider.apiFormat}
                  onValueChange={(value) =>
                    updateProviderDraft(provider.id, {
                      apiFormat: value as LlmApiFormat,
                    })
                  }
                  options={API_FORMAT_OPTIONS.filter(
                    (option) => option.value !== "cloudflare-workers-ai",
                  )}
                />
                <div>
                  <FieldLabel htmlFor={providerBaseUrlId}>Base URL</FieldLabel>
                  <Input
                    id={providerBaseUrlId}
                    placeholder={
                      provider.apiFormat === "vertex"
                        ? "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1"
                        : "https://llm.example.com/v1"
                    }
                    value={provider.baseUrl ?? ""}
                    onChange={(e) =>
                      updateProviderDraft(provider.id, {
                        baseUrl: e.target.value || null,
                      })
                    }
                  />
                  {provider.apiFormat === "vertex" && (
                    <p className="mt-1.5 text-xs text-ui-subtle">
                      Must include your GCP project ID and region.
                    </p>
                  )}
                </div>
              </>
            )}
            {nativeCloudflare ? (
              <p className="col-span-full text-xs text-ui-subtle">
                Uses the Worker AI binding defined in your Wrangler
                configuration.
              </p>
            ) : (
              <div className="col-span-full">
                <FieldLabel htmlFor={providerApiKeyId}>
                  {apiKeyFieldLabel(provider.apiFormat)}
                </FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={providerApiKeyId}
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={
                      provider.hasApiKey
                        ? "Enter a new key to replace the saved one"
                        : providerKeyPlaceholder(
                            provider.name,
                            provider.apiFormat,
                          )
                    }
                    value={provider.apiKey}
                    onChange={(e) => {
                      const apiKey = e.target.value;
                      // Losing the only credential must also drop `enabled`, or the switch desyncs from the draft and Save is rejected by the server.
                      const losesCredential =
                        !apiKey.trim() && !provider.hasApiKey;
                      updateProviderDraft(provider.id, {
                        apiKey,
                        ...(losesCredential ? { enabled: false } : {}),
                      });
                    }}
                    className="min-w-0 max-w-sm flex-1 basis-64"
                  />
                  {provider.hasApiKey && (
                    <Button
                      variant="destructive-outline"
                      size="xs"
                      onClick={() => void clearProviderKey(provider)}
                      disabled={saving !== null}
                      loading={saving === `provider:${provider.id}`}
                      icon={<Trash2 size={12} />}
                      className="h-8 px-2.5"
                    >
                      Remove key
                    </Button>
                  )}
                </div>
                {provider.hasApiKey && (
                  <p className="mt-1.5 text-xs text-ui-subtle">
                    Removing the saved key also turns the provider off.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
