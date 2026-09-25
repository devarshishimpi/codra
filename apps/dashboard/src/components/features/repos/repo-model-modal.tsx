import { Alert, Button } from "@codraoss/ui";
import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { toast } from "sonner";
import { api } from "@client/lib/api";
import { Save, RotateCcw, X } from "lucide-react";
import type { RepoConfigRecord } from "@codraoss/schema";
import { ModelRouteEditor } from "@client/components/features/models/model-chain";
import {
  EMPTY_MODEL_ROUTE,
  routesEqual,
  type ModelOption,
  type ModelRouteConfig,
  type ProviderOption,
} from "@client/components/features/models/model-route";
import {
  getGlobalRoute,
  getRepoRoute,
  hasStoredModelStrategy,
  repoId,
  type GlobalModelConfig,
} from "./repo-route";

export interface RepoModelModalProps {
  repo: RepoConfigRecord | null;
  globalConfig: GlobalModelConfig | ModelRouteConfig | null;
  modelOptions: ModelOption[];
  providerOptions: ProviderOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModelApplied: (repo: RepoConfigRecord, route: ModelRouteConfig) => void;
  onModelReset: (repo: RepoConfigRecord) => void;
}

type RepoModelFormProps = Omit<RepoModelModalProps, "open" | "onOpenChange">;

// Lives inside `Dialog.Portal`, which unmounts on close, so the draft starts from the repo's stored
// route on every open instead of being synced back from props.
function RepoModelForm({
  repo,
  globalConfig,
  modelOptions,
  providerOptions,
  onModelApplied,
  onModelReset,
}: RepoModelFormProps) {
  const [route, setRoute] = useState<ModelRouteConfig>(() =>
    repo ? getRepoRoute(repo, globalConfig) : EMPTY_MODEL_ROUTE,
  );
  const [initialRoute, setInitialRoute] = useState<ModelRouteConfig>(route);
  const [saving, setSaving] = useState<"apply" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () => !routesEqual(route, initialRoute),
    [initialRoute, route],
  );
  const hasStoredStrategy = repo ? hasStoredModelStrategy(repo) : false;

  const handleApply = async () => {
    if (!repo || !dirty) return;
    setSaving("apply");
    setError(null);
    const tid = toast.loading("Applying model strategy…");
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        model: {
          main: route.main,
          fallbacks: route.fallbacks,
          size_overrides: route.size_overrides,
        },
      });
      setInitialRoute(route);
      onModelApplied(repo, route);
      toast.success("Strategy saved", {
        id: tid,
        description: `${repo.owner}/${repo.repo} now uses a custom model chain.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save model strategy.";
      setError(msg);
      toast.error("Could not save strategy", {
        id: tid,
        description: "Your changes were not applied. Please try again.",
      });
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async () => {
    if (!repo) return;
    setSaving("reset");
    setError(null);
    const tid = toast.loading("Resetting to global defaults…");
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        model: {
          main: null,
          fallbacks: null,
          size_overrides: null,
        },
      });
      const globalRoute = getGlobalRoute(globalConfig);
      setRoute(globalRoute);
      setInitialRoute(globalRoute);
      onModelReset(repo);
      toast.success("Reset to global strategy", {
        id: tid,
        description: `${repo.owner}/${repo.repo} will inherit account defaults.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to reset model strategy.";
      setError(msg);
      toast.error("Reset failed", {
        id: tid,
        description: "Could not remove the custom strategy. Try again.",
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            {error}
          </Alert>
        )}
        <ModelRouteEditor
          value={route}
          onChange={setRoute}
          models={modelOptions}
          providers={providerOptions}
          density="comfortable"
        />
      </div>

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-ui-line bg-ui-fill/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Button
          variant="ghost"
          onClick={handleReset}
          disabled={!repo || saving !== null || !hasStoredStrategy}
          loading={saving === "reset"}
          icon={<RotateCcw size={14} />}
          className="text-ui-subtle hover:text-ui-default"
        >
          Use global
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close
            render={<Button variant="secondary" disabled={saving !== null} />}
          >
            Cancel
          </Dialog.Close>
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={!dirty || saving !== null}
            loading={saving === "apply"}
            icon={<Save size={14} />}
          >
            Apply
          </Button>
        </div>
      </div>
    </>
  );
}

export function RepoModelModal({
  repo,
  globalConfig,
  modelOptions,
  providerOptions,
  open,
  onOpenChange,
  onModelApplied,
  onModelReset,
}: RepoModelModalProps) {
  // Keyed on the route's value identity, not object identity, so a poll returning a structurally
  // identical global config doesn't discard the user's unsaved edits. The repo is part of the key
  // because Base UI keeps the portal mounted for the 150 ms close animation: reopening on a
  // different repo inside that window would otherwise reuse the previous repo's draft and save it
  // to the new one.
  const formKey = useMemo(
    () =>
      `${repo ? repoId(repo) : "none"}:${JSON.stringify(getGlobalRoute(globalConfig))}`,
    [repo, globalConfig],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-background/75 backdrop-blur-sm transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-ui-line bg-card shadow-2xl transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-ui-line px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-default">
                Edit model strategy
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-sm text-ui-subtle">
                {repo ? repoId(repo) : "Repository routing"}
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close modal"
                  className="h-8 w-8 shrink-0"
                />
              }
            >
              <X size={15} />
            </Dialog.Close>
          </div>

          <RepoModelForm
            key={formKey}
            repo={repo}
            globalConfig={globalConfig}
            modelOptions={modelOptions}
            providerOptions={providerOptions}
            onModelApplied={onModelApplied}
            onModelReset={onModelReset}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
