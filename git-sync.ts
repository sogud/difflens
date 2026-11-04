import type { RepositoryDetails } from "difflens/native";
import { t } from "./i18n";

export type PushFeedback =
  | { kind: "idle" }
  | { kind: "running"; root: string; branch: string }
  | { kind: "confirmed"; root: string; branch: string; refreshError?: string | null }
  | { kind: "unconfirmed"; root: string; branch: string; error: string };

type BranchSyncSnapshot = Pick<RepositoryDetails, "branchName" | "hasCommits" | "remoteNames" | "hasUpstream" | "syncKnown" | "ahead" | "behind">;

export function branchSyncLabel(details: BranchSyncSnapshot): string {
  if (!details.branchName) return t("Detached HEAD");
  if (!details.hasCommits) return t("No commits yet.");
  if (!details.remoteNames.length) return t("No remotes configured.");
  if (!details.hasUpstream) return t("Not tracking an upstream");
  if (!details.syncKnown) return t("Upstream status unavailable");
  if (details.ahead > 0 && details.behind > 0) return t("Diverged · ↑{ahead} ↓{behind}", { ahead: details.ahead, behind: details.behind });
  if (details.ahead > 0) return t("{count} commits to push", { count: details.ahead });
  if (details.behind > 0) return t("{count} commits to pull", { count: details.behind });
  return t("No commits to push");
}

export function canPushBranch(details: RepositoryDetails): boolean {
  return !!details.branchName && details.hasCommits && details.remoteNames.length > 0;
}
