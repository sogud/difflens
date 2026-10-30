import type { GitOperationRequest } from "difflens/native";
import { t, type Message } from "./i18n";
import type { Menu } from "nsh/desktop";

export type WorkflowKind = "merge" | "rebase" | "cherryPick" | "revert" | "checkoutCommit" |
  "createBranch" | "renameBranch" | "deleteBranch" | "tagCreate" | "tagDelete" |
  "stashPush" | "stashApply" | "stashPop" | "stashDrop" | "unstageAll" | "resolve" | "continue" | "abort" | "skip";
export type RequestWorkflow = (request: GitOperationRequest) => void;
export const workflowTitles: Record<WorkflowKind, Message> = {
  merge: "Merge into current branch…", rebase: "Rebase current branch onto…",
  cherryPick: "Cherry-pick commit…", revert: "Revert commit…", checkoutCommit: "Check out commit…",
  createBranch: "Create branch…", renameBranch: "Rename branch…", deleteBranch: "Delete branch…",
  tagCreate: "Create tag…", tagDelete: "Delete tag…", stashPush: "Stash changes…",
  stashApply: "Apply stash…", stashPop: "Pop stash…", stashDrop: "Drop stash…",
  unstageAll: "Unstage all", resolve: "Mark resolved…", continue: "Continue…", abort: "Abort…", skip: "Skip commit…",
};
export function commitWorkflowMenu(id: string, disabled: boolean, onRequest: RequestWorkflow): Parameters<typeof Menu.popup>[0] {
  return (["cherryPick", "revert", "createBranch", "tagCreate", "checkoutCommit"] as WorkflowKind[]).map(kind => ({
    label: t(workflowTitles[kind]), disabled, onSelect: () => onRequest(workflowRequest(kind, id)),
  }));
}

export function workflowRequest(kind: WorkflowKind, target = ""): GitOperationRequest {
  return { kind, target, name: "", message: "", includeUntracked: false, mainline: 0 };
}
