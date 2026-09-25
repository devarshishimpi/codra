import { Button, Input, Select } from "@codraoss/ui";
import type { Dispatch, SetStateAction } from "react";
import { Plus } from "lucide-react";
import { FieldLabel } from "./field-label";
import {
  PROVIDER_PRESETS,
  apiKeyFieldLabel,
  providerKeyPlaceholder,
  type NewProviderDraft,
} from "./settings-support";

// The draft lives in `useProviderSettings`, not here, so toggling this panel closed doesn't throw
// away a half-typed provider.
export function NewProviderForm({
  newProvider,
  setNewProvider,
  selectedProviderNameExists,
  newProviderReady,
  saving,
  onCreate,
  onCancel,
}: {
  newProvider: NewProviderDraft;
  setNewProvider: Dispatch<SetStateAction<NewProviderDraft>>;
  selectedProviderNameExists: boolean;
  newProviderReady: boolean;
  saving: string | null;
  onCreate: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const selectedPreset =
    PROVIDER_PRESETS.find((preset) => preset.value === newProvider.preset) ??
    PROVIDER_PRESETS[0];

  return (
    <div className="animate-slide-down border-b border-ui-line bg-ui-fill/20 px-4 py-5 sm:px-5 sm:py-6">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
        New provider
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="new-provider-type">Protocol</FieldLabel>
          <Select
            value={newProvider.preset}
            onValueChange={(value) => {
              const preset =
                PROVIDER_PRESETS.find((item) => item.value === value) ??
                PROVIDER_PRESETS[0];
              setNewProvider((current) => ({
                ...current,
                preset: preset.value,
                name: preset.name,
                apiFormat: preset.apiFormat,
                baseUrl: preset.baseUrl,
              }));
            }}
            options={PROVIDER_PRESETS.map((preset) => ({
              value: preset.value,
              label: preset.label,
            }))}
          />
        </div>
        <div>
          <FieldLabel htmlFor="new-provider-name">Display name</FieldLabel>
          <Input
            id="new-provider-name"
            placeholder="My provider"
            value={newProvider.name}
            onChange={(e) =>
              setNewProvider((current) => ({
                ...current,
                name: e.target.value,
              }))
            }
          />
          {selectedProviderNameExists && (
            <p className="mt-1.5 text-xs text-warning">
              {newProvider.name.trim()} already exists
            </p>
          )}
        </div>
        <div>
          <FieldLabel htmlFor="new-provider-base-url">Base URL</FieldLabel>
          <Input
            id="new-provider-base-url"
            placeholder={selectedPreset.exampleUrl}
            value={newProvider.baseUrl}
            onChange={(e) =>
              setNewProvider((current) => ({
                ...current,
                baseUrl: e.target.value,
              }))
            }
          />
        </div>
        <div>
          <FieldLabel htmlFor="new-provider-api-key">
            {apiKeyFieldLabel(newProvider.apiFormat)}
          </FieldLabel>
          <Input
            id="new-provider-api-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={providerKeyPlaceholder(
              newProvider.name,
              newProvider.apiFormat,
            )}
            value={newProvider.apiKey}
            onChange={(e) =>
              setNewProvider((current) => ({
                ...current,
                apiKey: e.target.value,
              }))
            }
          />
        </div>
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-ui-subtle hover:text-ui-default"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onCreate}
          disabled={saving !== null || !newProviderReady}
          loading={saving === "provider:new"}
          icon={<Plus size={13} />}
        >
          Create
        </Button>
      </div>
    </div>
  );
}
