import type {
  ChangedFile,
  GitOperationRequest,
  FilePreview,
  RepositoryDetails,
  RepositoryNode,
} from "difflens/native";
import type { Message } from "./i18n";

export type DisplayMode = "nested" | "flat";
export type RepositoryTab = "changes" | "files" | "history";

export type DetailState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; details: RepositoryDetails }
  | { kind: "failed"; message: string };

export type DiffState =
  | { kind: "idle" }
  | { kind: "loading"; filePath: string; staged: boolean; cachedPatch?: string }
  | { kind: "ready"; filePath: string; staged: boolean; patch: string }
  | { kind: "failed"; filePath: string; staged: boolean; message: string };

export type OperationState =
  | { kind: "idle" }
  | { kind: "running"; label: Message }
  | { kind: "succeeded"; message: Message }
  | { kind: "failed"; message: string };

export type RepositoryAction =
  | { kind: "stageFile"; filePath: string }
  | { kind: "unstageFile"; filePath: string }
  | { kind: "stageAll" }
  | { kind: "commit"; message: string }
  | { kind: "createBranch"; branchName: string }
  | { kind: "switchBranch"; branchName: string }
  | { kind: "fetch" }
  | { kind: "pull" }
  | { kind: "push" };

export interface RepositoryTreeProps {
  repositories: RepositoryNode[];
  selectedPath: string | null;
  mode: DisplayMode;
  warnings: number;
  disabled: boolean;
  onModeChange: (mode: DisplayMode) => void;
  onSelect: (path: string) => void;
}

export interface ChangedFileRowProps {
  file: ChangedFile;
  section: "staged" | "unstaged";
  selected: boolean;
  disabled: boolean;
  tree?: boolean;
  onSelect: (path: string, staged: boolean) => void;
  onAction: (action: RepositoryAction) => void;
  onWorkflow?: (request: GitOperationRequest) => void;
  onOpenEditor?: (path: string) => void;
}

export type FilePreviewState =
  | { kind: "loading"; path: string; cachedFile?: FilePreview }
  | { kind: "ready"; file: FilePreview }
  | { kind: "failed"; path: string; message: string };

export type ReviewView =
  | { kind: "diff" }
  | { kind: "commit"; repositoryPath: string; commitId: string }
  | { kind: "file"; state: FilePreviewState };
