import { Button, Select } from "@codraoss/ui";
import { useId, useMemo, useState } from "react";
import { cn } from "@codraoss/ui/utils";
import { Trash2, ListPlus } from "lucide-react";

import type {
  ModelDensity,
  ModelOption,
  ModelRouteConfig,
  ModelRouteTier,
  ProviderOption,
} from "./model-route";

interface ModelSelectorProps {
  value: string | null;
  onValueChange: (value: string) => void;
  models: ModelOption[];
  providers: ProviderOption[];
  hideLabels?: boolean;
  density?: ModelDensity;
  className?: string;
}

function ModelSelector({
  value,
  onValueChange,
  models,
  providers,
  hideLabels,
  density = "comfortable",
  className,
}: ModelSelectorProps) {
  // The shown provider follows the selected model, so it stays derived rather than synced. The picked
  // provider only decides the filter while nothing is selected yet.
  const [pickedProvider, setPickedProvider] = useState<string | null>(null);
  const currentModel = models.find((m) => m.value === value);
  const provider =
    currentModel?.providerId ?? pickedProvider ?? providers[0]?.value ?? "";

  const filteredModels = useMemo(
    () =>
      models.flatMap((m) =>
        m.providerId === provider ? [{ value: m.value, label: m.label }] : [],
      ),
    [models, provider],
  );

  if (models.length === 0 || providers.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground",
          className,
        )}
      >
        No configured models
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-2",
        density === "compact"
          ? "sm:grid-cols-[112px_minmax(0,1fr)]"
          : "sm:grid-cols-[minmax(120px,160px)_minmax(0,1fr)] sm:items-end",
        className,
      )}
    >
      <Select
        label={hideLabels ? undefined : "Provider"}
        value={provider}
        onValueChange={(nextProvider) => {
          setPickedProvider(nextProvider);
          const first = models.find((m) => m.providerId === nextProvider);
          if (first) onValueChange(first.value);
        }}
        options={providers}
        triggerClassName={cn(density === "compact" && "h-8 text-xs")}
      />
      <Select
        label={hideLabels ? undefined : "Model"}
        value={value ?? ""}
        onValueChange={onValueChange}
        options={filteredModels}
        placeholder="Select model..."
        triggerClassName={cn(density === "compact" && "h-8 text-xs")}
      />
    </div>
  );
}

interface ModelChainProps {
  primary: string | null;
  fallbacks: string[];
  onChange: (primary: string | null, fallbacks: string[]) => void;
  models: ModelOption[];
  providers: ProviderOption[];
  density?: ModelDensity;
}

function ModelChain({
  primary,
  fallbacks,
  onChange,
  models,
  providers,
  density = "comfortable",
}: ModelChainProps) {
  const addFallback = () => {
    const first = models[0]?.value;
    if (first) onChange(primary, [...fallbacks, first]);
  };
  const removeFallback = (idx: number) =>
    onChange(
      primary,
      fallbacks.filter((_, i) => i !== idx),
    );
  const updateFallback = (idx: number, val: string) => {
    const next = [...fallbacks];
    next[idx] = val;
    onChange(primary, next);
  };

  return (
    <div
      className={cn(
        "min-w-0",
        density === "compact" ? "space-y-2" : "space-y-4",
      )}
    >
      <div
        className={cn(
          "relative min-w-0 border-l border-border/60",
          density === "compact" ? "space-y-2 pl-3" : "space-y-3 pl-4",
        )}
      >
        <div className="relative min-w-0">
          <div
            className={cn(
              "absolute top-4 h-0.5 bg-primary/20",
              density === "compact"
                ? "-left-[0.85rem] w-2"
                : "-left-[1.35rem] w-3",
            )}
          />
          <ModelSelector
            value={primary}
            models={models}
            providers={providers}
            density={density}
            hideLabels={density === "compact"}
            onValueChange={(val) => onChange(val, fallbacks)}
          />
        </div>

        {fallbacks.map((fb, i) => (
          <div
            key={`${fb}-${i}`}
            className="relative flex min-w-0 items-end gap-2 animate-in slide-in-from-left-2 fade-in"
          >
            <div
              className={cn(
                "absolute top-4 h-0.5 bg-warning/25",
                density === "compact"
                  ? "-left-[0.85rem] w-2"
                  : "-left-[1.35rem] w-3",
              )}
            />
            <div className="min-w-0 flex-1">
              <ModelSelector
                value={fb}
                models={models}
                providers={providers}
                hideLabels
                density={density}
                onValueChange={(val) => updateFallback(i, val)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Remove fallback model"
              className={cn(
                "shrink-0 text-muted-foreground/45 hover:bg-danger/5 hover:text-danger",
                density === "compact" ? "h-8 w-8" : "h-9 w-9",
              )}
              onClick={(e) => {
                e.stopPropagation();
                removeFallback(i);
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}

        <button
          type="button"
          className={cn(
            "ml-1 flex items-center gap-1.5 py-1 font-bold text-primary/70 transition-colors hover:text-primary",
            density === "compact" ? "text-[10px]" : "text-xs",
          )}
          onClick={addFallback}
        >
          <ListPlus size={12} /> Add fallback
        </button>
      </div>
    </div>
  );
}

interface ModelRouteEditorProps {
  value: ModelRouteConfig;
  onChange: (value: ModelRouteConfig) => void;
  models: ModelOption[];
  providers: ProviderOption[];
  density?: ModelDensity;
  className?: string;
}

export function ModelRouteEditor({
  value,
  onChange,
  models,
  providers,
  density = "comfortable",
  className,
}: ModelRouteEditorProps) {
  const fieldId = useId();
  const tiers = value.size_overrides ?? [];

  const updateTier = (index: number, updates: Partial<ModelRouteTier>) => {
    const next = [...tiers];
    next[index] = { ...next[index], ...updates };
    onChange({ ...value, size_overrides: next });
  };

  const addTier = () => {
    const first = models[0]?.value;
    if (!first) return;
    onChange({
      ...value,
      size_overrides: [
        ...tiers,
        { max_lines: 300, model: first, fallbacks: [] },
      ],
    });
  };

  const removeTier = (index: number) => {
    onChange({
      ...value,
      size_overrides: tiers.filter((_, i) => i !== index),
    });
  };

  const largestTier =
    tiers.length > 0
      ? Math.max(...tiers.map((tier) => Number(tier.max_lines) || 0))
      : null;

  return (
    <div className={cn("min-w-0 space-y-5", className)}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Baseline route plus file-size tiers for smaller changes.
        </p>
        <button
          type="button"
          onClick={addTier}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <ListPlus size={13} />
          Add tier
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/[0.04] px-4 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Baseline route
          </span>
          {largestTier !== null && (
            <span className="text-xs text-muted-foreground">
              · files over {largestTier} lines
            </span>
          )}
        </div>
        <div className="p-4">
          <ModelChain
            primary={value.main}
            fallbacks={value.fallbacks ?? []}
            models={models}
            providers={providers}
            density={density}
            onChange={(main, fallbacks) =>
              onChange({ ...value, main, fallbacks })
            }
          />
        </div>
      </div>

      {tiers.length > 0 && (
        <div className="space-y-3">
          {tiers.map((tier, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-lg border border-border"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/[0.04] px-4 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Size tier {tiers.length > 1 ? index + 1 : ""}
                </span>
                <button
                  type="button"
                  aria-label="Remove size tier"
                  onClick={() => removeTier(index)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-danger/5 hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-4 p-4 lg:grid-cols-[160px_minmax(0,1fr)]">
                <div className="min-w-0 space-y-1.5">
                  <label
                    htmlFor={`${fieldId}-tier-${index}-max-lines`}
                    className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Max lines
                  </label>
                  <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:ring-1 focus-within:ring-ring">
                    <input
                      id={`${fieldId}-tier-${index}-max-lines`}
                      type="number"
                      min={1}
                      value={tier.max_lines}
                      onChange={(e) =>
                        updateTier(index, {
                          max_lines: Number(e.target.value) || 1,
                        })
                      }
                      className="min-w-0 flex-1 bg-transparent text-base sm:text-sm font-semibold outline-none"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      lines
                    </span>
                  </div>
                </div>
                <ModelChain
                  primary={tier.model}
                  fallbacks={tier.fallbacks || []}
                  models={models}
                  providers={providers}
                  density={density}
                  onChange={(model, fallbacks) => {
                    if (model) updateTier(index, { model, fallbacks });
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
