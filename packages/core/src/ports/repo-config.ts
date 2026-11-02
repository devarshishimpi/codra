import type { RepoConfig } from "@codraoss/schema";

export interface RepoConfigStore {
  getRepoConfigRecord(
    owner: string,
    repo: string,
  ): Promise<{
    parsedJson: RepoConfig;
    enabled: boolean;
    mainModel: string | null;
    fallbackModels: string[] | null;
    sizeOverrides: unknown[] | null;
  } | null>;
  syncRepoConfig(input: {
    installationId: string;
    owner: string;
    repo: string;
  }): Promise<void>;
}
