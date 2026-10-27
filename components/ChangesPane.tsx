import { t } from "../i18n";
import { Icon } from "./Icon";
import { FileBrowser } from "./FileBrowser";
import { computed, Input, Scroll, Text, View } from "nsh";
import { Button, Menu, MenuItem, MenuSeparator, Tab, Tabs } from "nsh/base";
import { LoadingStatus } from "./LoadingStatus";
import type {
  ChangedFile,
  CommitSummary,
  RepositoryDetails,
} from "difflens/native";
import type {
  ChangedFileRowProps,
  DetailState,
  DiffState,
  OperationState,
  RepositoryAction,
  RepositoryTab,
} from "../ui-types";

function ChangedFileRow(props: ChangedFileRowProps) {
  const actionLabel = computed(() =>
    props.section === "staged" ? t("Unstage") : t("Stage"),
  );
  const canChange = computed(
    () => props.file.actionable && !props.file.conflicted && !props.disabled,
  );
  const displayPath = props.file.oldPath
    ? props.file.oldPath + " → " + props.file.path
    : props.file.path;

  return (
    <View class="flex-row items-center gap-1 border-b border-border px-2 py-1">
      <Button
        selected={props.selected}
        disabled={props.disabled}
        accessibilityLabel={t("Show diff for {path}", { path: displayPath })}
        onPress={() =>
          props.onSelect(props.file.path, props.section === "staged")
        }
        class="group min-w-0 flex-1 rounded px-2 py-1 text-left active:bg-accent/60 selected:bg-accent"
      >
        <View class="flex-row items-center gap-1.5">
          <Text class="w-6 font-mono text-[11px] text-muted-foreground">
            {props.file.statusLabel}
          </Text>
          <Text
            numberOfLines={1}
            class="min-w-0 flex-1 font-mono text-[11px] text-foreground"
          >
            {displayPath}
          </Text>
          {props.file.conflicted ? (
            <Text class="text-[11px] font-medium text-destructive">
              {t("Conflict")}
            </Text>
          ) : null}
        </View>
      </Button>
      <Button
        disabled={!canChange()}
        accessibilityLabel={actionLabel() + " " + displayPath}
        onPress={() => {
          const action: RepositoryAction =
            props.section === "staged"
              ? { kind: "unstageFile", filePath: props.file.path }
              : { kind: "stageFile", filePath: props.file.path };
          props.onAction(action);
        }}
        class="rounded border border-border px-2 py-1 text-[11px] active:bg-muted disabled:opacity-40"
      >
        <Text class="text-[11px] text-foreground">{actionLabel()}</Text>
      </Button>
    </View>
  );
}

function FileSection(props: {
  title: string;
  files: ChangedFile[];
  section: "staged" | "unstaged";
  selectedPath: string | undefined;
  selectedStaged: boolean;
  busy: boolean;
  onSelectFile: (path: string, staged: boolean) => void;
  onAction: (action: RepositoryAction) => void;
  onStageAll?: () => void;
}) {
  return (
    <View>
      <View class="flex-row items-center justify-between border-y border-border bg-muted/40 px-2 py-1">
        <Text class="text-[11px] font-semibold text-foreground">
          {props.title + " · " + String(props.files.length)}
        </Text>
        {props.onStageAll ? (
          <Button
            disabled={props.busy || props.files.length === 0}
            onPress={props.onStageAll}
            class="rounded px-2 py-1 text-[11px] active:bg-muted disabled:opacity-40"
          >
            <Text class="text-[11px] text-muted-foreground">
              {t("Stage all")}
            </Text>
          </Button>
        ) : null}
      </View>
      {props.files.length === 0 ? (
        <Text class="px-2 py-1.5 text-[11px] text-muted-foreground">
          {t("No files")}
        </Text>
      ) : (
        props.files.map((file) => (
          <ChangedFileRow
            file={file}
            section={props.section}
            selected={
              props.selectedPath === file.path &&
              props.selectedStaged === (props.section === "staged")
            }
            disabled={props.busy}
            onSelect={props.onSelectFile}
            onAction={props.onAction}
          />
        ))
      )}
    </View>
  );
}

function CommitHistory(props: { commits: CommitSummary[] }) {
  if (props.commits.length === 0) {
    return (
      <Text class="px-3 py-2 text-[12px] text-muted-foreground">
        {t("No commits yet.")}
      </Text>
    );
  }

  return (
    <Scroll style={{ flex: 1 }}>
      <View>
        {props.commits.map((commit) => (
          <View class="gap-1 border-b border-border px-3 py-1.5">
            <View class="flex-row items-center gap-1.5">
              <Text class="font-mono text-[11px] text-muted-foreground">
                {commit.shortId}
              </Text>
              <Text
                numberOfLines={1}
                class="min-w-0 flex-1 text-[12px] font-medium text-foreground"
              >
                {commit.subject}
              </Text>
            </View>
            <Text class="text-[11px] text-muted-foreground">
              {commit.author + " · " + commit.authoredAt}
            </Text>
          </View>
        ))}
      </View>
    </Scroll>
  );
}

function RepositoryChanges(props: {
  disabled: boolean;
  details: RepositoryDetails;
  operation: OperationState;
  diff: DiffState;
  commitMessage: string;
  branchName: string;
  onCommitMessageChange: (value: string) => void;
  onBranchNameChange: (value: string) => void;
  onSelectFile: (path: string, staged: boolean) => void;
  onPreviewFile: (path: string) => void;
  previewedFile: string | null;
  tab: RepositoryTab;
  onTabChange: (tab: RepositoryTab) => void;
  onAction: (action: RepositoryAction) => void;
}) {
  const activeTab = () => props.tab;
  const busy = computed(
    () => props.disabled || props.operation.kind === "running",
  );
  const selectedFile = computed(() => {
    if (props.diff.kind === "idle") {
      return undefined;
    }
    return { path: props.diff.filePath, staged: props.diff.staged };
  });
  const stagedFiles = computed(() =>
    props.details.changes.filter((file) => file.staged),
  );
  const unstagedFiles = computed(() =>
    props.details.changes.filter((file) => file.unstaged || file.untracked),
  );
  const repositoryName = computed(() => {
    const pathSegments = props.details.path.split(/[\\/]/);
    return pathSegments[pathSegments.length - 1] || props.details.path;
  });
  const canPull = props.details.hasUpstream;
  const canSync = props.details.remoteNames.length > 0;

  return (
    <View class="min-h-0 flex-1 flex-col">
      <View class="gap-2 border-b border-border p-2">
        <View class="gap-1">
          <Text
            numberOfLines={1}
            class="text-[13px] font-semibold text-foreground"
          >
            {repositoryName()}
          </Text>
          <Text
            numberOfLines={1}
            class="font-mono text-[11px] text-muted-foreground"
          >
            {props.details.path}
          </Text>
        </View>

        <View class="flex-row items-center gap-1.5">
          <Menu
            offset={4}
            margin={8}
            popupClass="min-w-52 gap-1 rounded-md border border-border bg-popover p-1"
            trigger={
              <View
                disabled={busy()}
                role="button"
                focusable
                accessibilityLabel={t("Choose local branch")}
                class="rounded border border-border px-2 py-1 active:bg-muted disabled:opacity-40"
              >
                <Text class="font-mono text-[11px] text-foreground">
                  {(props.details.branchName ?? props.details.headLabel) + " ▾"}
                </Text>
              </View>
            }
          >
            {props.details.branches.length === 0 ? (
              <MenuItem disabled>
                <Text class="text-[12px] text-muted-foreground">
                  {t("No local branches")}
                </Text>
              </MenuItem>
            ) : (
              props.details.branches.map((branch) => (
                <MenuItem
                  class="rounded px-2 py-1 active:bg-accent"
                  disabled={busy() || branch === props.details.branchName}
                  onSelect={() =>
                    props.onAction({ kind: "switchBranch", branchName: branch })
                  }
                >
                  <Text class="text-[12px] text-foreground">
                    {(branch === props.details.branchName ? "✓  " : "") +
                      branch}
                  </Text>
                </MenuItem>
              ))
            )}
            <MenuSeparator class="my-1 h-px bg-border" />
            <MenuItem disabled>
              <Text class="text-[11px] text-muted-foreground">
                {props.details.hasUpstream
                  ? props.details.upstream
                  : t("No upstream branch")}
              </Text>
            </MenuItem>
          </Menu>
          <Text class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {props.details.ahead > 0 || props.details.behind > 0
              ? "↑ " +
                String(props.details.ahead) +
                "  ↓ " +
                String(props.details.behind)
              : props.details.hasUpstream
                ? t("Up to date")
                : t("No upstream")}
          </Text>
        </View>

        <View class="flex-row gap-1">
          <Button
            disabled={busy() || !canSync}
            accessibilityLabel={t("Fetch")}
            tooltip={t("Fetch")}
            onPress={() => props.onAction({ kind: "fetch" })}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
          >
            <Icon name="fetch" />
          </Button>
          <Button
            disabled={busy() || !canPull}
            accessibilityLabel={t("Pull")}
            tooltip={t("Pull")}
            onPress={() => props.onAction({ kind: "pull" })}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
          >
            <Icon name="pull" />
          </Button>
          <Button
            disabled={busy() || !canSync}
            accessibilityLabel={t("Push")}
            tooltip={t("Push")}
            onPress={() => props.onAction({ kind: "push" })}
            class="size-7 items-center justify-center rounded hover:bg-muted active:bg-muted disabled:opacity-40"
          >
            <Icon name="push" />
          </Button>
          <View class="min-w-0 flex-1 flex-row items-center gap-1">
            <Input
              value={props.branchName}
              onChange={props.onBranchNameChange}
              disabled={busy()}
              placeholder={t("New branch")}
              accessibilityLabel={t("New branch name")}
              class="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[11px] text-foreground"
            />
            <Button
              disabled={busy() || props.branchName.trim().length === 0}
              onPress={() =>
                props.onAction({
                  kind: "createBranch",
                  branchName: props.branchName.trim(),
                })
              }
              class="rounded bg-secondary px-2 py-1 active:opacity-80 disabled:opacity-40"
            >
              <Text class="text-[11px] text-secondary-foreground">
                {t("New")}
              </Text>
            </Button>
          </View>
        </View>

        {props.operation.kind === "running" ? (
          <LoadingStatus label={t(props.operation.label) + "…"} />
        ) : props.operation.kind === "failed" ? (
          <Text class="text-[11px] text-destructive">
            {props.operation.message}
          </Text>
        ) : props.operation.kind === "succeeded" ? (
          <Text class="text-[11px] text-emerald-700 dark:text-emerald-400">
            {t(props.operation.message)}
          </Text>
        ) : null}

        <Tabs class="flex-row gap-1 border-b border-border">
          <Tab
            selected={activeTab() === "changes"}
            onPress={() => props.onTabChange("changes")}
            class="group border-b-2 border-transparent px-2 py-1 selected:border-primary"
          >
            <Text class="text-[11px] text-muted-foreground group-selected:text-foreground">
              {t("Changes")}
            </Text>
          </Tab>
          <Tab testID="files-tab" selected={activeTab() === "files"} onPress={() => props.onTabChange("files")}
            class="group border-b-2 border-transparent px-2 py-1 selected:border-primary">
            <Text class="text-[11px] text-muted-foreground group-selected:text-foreground">{t("Files")}</Text>
          </Tab>
          <Tab
            selected={activeTab() === "history"}
            onPress={() => props.onTabChange("history")}
            class="group border-b-2 border-transparent px-2 py-1 selected:border-primary"
          >
            <Text class="text-[11px] text-muted-foreground group-selected:text-foreground">
              {t("History")}
            </Text>
          </Tab>
        </Tabs>
      </View>

      {activeTab() === "files" ? (
        <FileBrowser repository={props.details} selectedPath={props.previewedFile} disabled={busy()} onPreview={props.onPreviewFile} />
      ) : activeTab() === "history" ? (
        <CommitHistory commits={props.details.history} />
      ) : (
        <>
          <Scroll style={{ flex: 1 }}>
            <View>
              <FileSection
                title={t("Staged")}
                files={stagedFiles()}
                section="staged"
                selectedPath={selectedFile()?.path}
                selectedStaged={selectedFile()?.staged ?? false}
                busy={busy()}
                onSelectFile={props.onSelectFile}
                onAction={props.onAction}
              />
              <FileSection
                title={t("Unstaged")}
                files={unstagedFiles()}
                section="unstaged"
                selectedPath={selectedFile()?.path}
                selectedStaged={selectedFile()?.staged ?? false}
                busy={busy()}
                onSelectFile={props.onSelectFile}
                onAction={props.onAction}
                onStageAll={() => props.onAction({ kind: "stageAll" })}
              />
            </View>
          </Scroll>
          <View class="gap-1.5 border-t border-border p-2">
            <Input
              value={props.commitMessage}
              onChange={props.onCommitMessageChange}
              disabled={
                busy() || props.details.changes.every((file) => !file.staged)
              }
              placeholder={t("Commit message")}
              accessibilityLabel={t("Commit message")}
              onSubmit={() => {
                const message = props.commitMessage.trim();
                if (message.length > 0) {
                  props.onAction({ kind: "commit", message });
                }
              }}
              class="h-7 rounded border border-input bg-background px-2 text-[12px] text-foreground"
            />
            <Button
              disabled={
                busy() ||
                props.commitMessage.trim().length === 0 ||
                props.details.changes.every((file) => !file.staged)
              }
              onPress={() => {
                props.onAction({
                  kind: "commit",
                  message: props.commitMessage.trim(),
                });
              }}
              class="h-7 items-center justify-center rounded bg-primary px-2 active:opacity-80 disabled:opacity-40"
            >
              <Text class="text-[12px] font-medium text-primary-foreground">
                {t("Commit staged")}
              </Text>
            </Button>
          </View>
        </>
      )}
    </View>
  );
}

export function ChangesPane(props: {
  disabled: boolean;
  details: DetailState;
  operation: OperationState;
  diff: DiffState;
  commitMessage: string;
  branchName: string;
  onCommitMessageChange: (value: string) => void;
  onBranchNameChange: (value: string) => void;
  onSelectFile: (path: string, staged: boolean) => void;
  onPreviewFile: (path: string) => void;
  previewedFile: string | null;
  tab: RepositoryTab;
  onTabChange: (tab: RepositoryTab) => void;
  onAction: (action: RepositoryAction) => void;
}) {
  const content = computed(() => {
    if (props.details.kind === "loading") {
      return (
        <EmptyPanel
          loading
          title={t("Reading repository")}
          message={t("Loading status, branches, and history.")}
        />
      );
    }
    if (props.details.kind === "failed") {
      return (
        <EmptyPanel
          title={t("Could not read repository")}
          message={props.details.message}
        />
      );
    }
    if (props.details.kind === "idle") {
      return (
        <EmptyPanel
          title={t("Select a repository")}
          message={t("Choose a repository to see its changes.")}
        />
      );
    }
    return (
      <RepositoryChanges
        disabled={props.disabled}
        details={props.details.details}
        operation={props.operation}
        diff={props.diff}
        commitMessage={props.commitMessage}
        branchName={props.branchName}
        onCommitMessageChange={props.onCommitMessageChange}
        onBranchNameChange={props.onBranchNameChange}
        onSelectFile={props.onSelectFile}
        onPreviewFile={props.onPreviewFile}
        previewedFile={props.previewedFile}
        tab={props.tab}
        onTabChange={props.onTabChange}
        onAction={props.onAction}
      />
    );
  });

  return (
    <View class="min-h-0 flex-1 flex-col border-r border-border">
      {content()}
    </View>
  );
}

function EmptyPanel(props: {
  title: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <View class="flex-1 items-center justify-center gap-1.5 p-4">
      {props.loading ? (
        <LoadingStatus label={props.title} />
      ) : (
        <Text class="text-[12px] font-medium text-foreground">
          {props.title}
        </Text>
      )}
      <Text class="max-w-72 text-center text-[11px] text-muted-foreground">
        {props.message}
      </Text>
    </View>
  );
}
