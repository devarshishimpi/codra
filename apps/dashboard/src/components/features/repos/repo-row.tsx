import { Badge, Button, Switch } from "@codraoss/ui";
import { Settings2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { RepoConfigRecord } from "@codraoss/schema";
import {
  describeModelRoute,
  type ModelOption,
  type ModelRouteConfig,
} from "@client/components/features/models/model-route";
import {
  getRepoRoute,
  hasMeaningfulCustomStrategy,
  formatLastActivity,
  type GlobalModelConfig,
} from "./repo-route";

export interface RepoRowProps {
  repo: RepoConfigRecord;
  globalConfig: GlobalModelConfig | ModelRouteConfig | null;
  modelOptions: ModelOption[];
  togglePending: boolean;
  onToggleEnabled: (repo: RepoConfigRecord, enabled: boolean) => void;
  onEdit: (repo: RepoConfigRecord) => void;
}

export function RepoRow({
  repo,
  globalConfig,
  modelOptions,
  togglePending,
  onToggleEnabled,
  onEdit,
}: RepoRowProps) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(repo.enabled);

  useEffect(() => {
    setOptimisticEnabled(repo.enabled);
  }, [repo.enabled]);

  const handleToggle = (nextEnabled: boolean) => {
    setOptimisticEnabled(nextEnabled);
    onToggleEnabled(repo, nextEnabled);
  };

  const route = getRepoRoute(repo, globalConfig);
  const custom = hasMeaningfulCustomStrategy(repo, globalConfig);
  const lastActivity = formatLastActivity(repo.lastJobCreatedAt);

  // Deliberately no per-row card chrome (Cloudflare-dashboard style flat list).
  return (
    <div className="min-w-0 px-4 py-3 transition-colors hover:bg-ui-fill/30 sm:px-5">
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(200px,1.1fr)_minmax(220px,1.4fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="ui-font-mono truncate text-[13px] text-ui-default">
              {repo.owner}/{repo.repo}
            </h2>
            <Badge
              variant={optimisticEnabled ? "success" : "neutral"}
              className="shrink-0"
            >
              {optimisticEnabled ? "Enabled" : "Paused"}
            </Badge>
            <Badge
              variant={custom ? "default" : "neutral"}
              className="hidden shrink-0 sm:inline-flex"
            >
              {custom ? "Custom strategy" : "Global strategy"}
            </Badge>
          </div>
          {lastActivity && (
            <p className="ui-font-mono mt-1 text-[11px] text-ui-subtle">
              Last activity {lastActivity}
            </p>
          )}
        </div>

        <p className="min-w-0 truncate text-xs text-ui-subtle lg:px-2">
          {describeModelRoute(route, modelOptions)}
        </p>

        <div className="flex min-w-0 flex-wrap items-center gap-3 lg:justify-end">
          <label className="flex cursor-pointer items-center gap-2 py-2 pl-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ui-subtle">
              Reviews
            </span>
            <Switch
              checked={optimisticEnabled}
              disabled={togglePending}
              aria-label={`${optimisticEnabled ? "Pause" : "Enable"} reviews for ${repo.owner}/${repo.repo}`}
              onCheckedChange={handleToggle}
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEdit(repo)}
            icon={<Settings2 size={13} />}
            className="shrink-0"
          >
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}
