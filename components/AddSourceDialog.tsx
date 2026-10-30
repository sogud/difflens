import { t } from "../i18n";
import { accentClasses } from "../appearance";
import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { Button, Dialog, Tab, Tabs } from "nsh/base";
import { Workspace } from "difflens/native";
import type { SourceKind } from "../library";
import { LoadingStatus } from "./LoadingStatus";

export function AddSourceDialog(props: {
  kind: SourceKind;
  initialPath: string;
  initialError: string | null;
  onCancel: () => void;
  onAdd: (kind: SourceKind, path: string) => Promise<string | null>;
  loadingMessage: string;
}) {
  const kind = signal(props.kind);
  const path = signal(props.initialPath);
  const error = signal(props.initialError);
  const activity = signal<"idle" | "choosing" | "adding">("idle");
  const busy = () => activity() !== "idle";

  async function browse() {
    if (busy()) return;
    activity.set("choosing");
    try {
      const selected = await Workspace.chooseFolder(
        kind() === "repository"
          ? t("Choose an existing Git repository")
          : t("Choose a directory to scan"),
      );
      if (selected !== null) {
        path.set(selected);
        error.set(null);
      }
    } catch (cause) {
      error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      activity.set("idle");
    }
  }

  async function add() {
    if (busy() || !path().trim()) return;
    activity.set("adding");
    error.set(null);
    try {
      error.set(await props.onAdd(kind(), path().trim()));
    } finally {
      activity.set("idle");
    }
  }

  return (
    <Dialog
      testID="add-source-dialog"
      animation="fade"
      closeOnBackdropPress={false}
      closeOnEscape={!busy()}
      onOpenChange={(open) => {
        if (!open && !busy()) props.onCancel();
      }}
      backdropClass="bg-black/30"
      class="flex-1 items-center justify-center p-4"
    >
      <View class="w-[440px] max-w-full gap-3 rounded-lg border border-border bg-background p-4 shadow-sm">
        <Text class="text-[15px] font-semibold text-foreground">
          {t("Add to your library")}
        </Text>
        <Tabs class="flex-row gap-1 rounded bg-muted p-1">
          {(["repository", "directory"] satisfies SourceKind[]).map(
            (option) => (
              <Tab
                selected={kind() === option}
                disabled={busy()}
                onPress={() => {
                  kind.set(option);
                  error.set(null);
                }}
                class="group flex-1 items-center rounded px-2 py-1 selected:bg-background"
              >
                <Text class="text-[12px] text-muted-foreground group-selected:text-foreground">
                  {option === "repository"
                    ? t("Existing repository")
                    : t("Workspace directory")}
                </Text>
              </Tab>
            ),
          )}
        </Tabs>
        <Text class="text-[12px] text-muted-foreground">
          {kind() === "repository"
            ? t("Open an existing repository. Subfolders resolve to its root.")
            : t(
                "Find nested repositories, skipping dependency and build caches.",
              )}
        </Text>
        <View class="gap-1.5">
          <Text class="text-[12px] font-medium text-foreground">
            {t("Folder path")}
          </Text>
          <View class="flex-row gap-1.5">
            <Input
              testID="source-path"
              autoFocus
              value={path()}
              onChange={(value) => {
                path.set(value);
                error.set(null);
              }}
              onSubmit={() => {
                void add();
              }}
              disabled={busy()}
              accessibilityLabel={t("Folder path")}
              placeholder={t("Paste a folder path or browse…")}
              class={"h-7 min-w-0 flex-1 rounded border border-transparent bg-subtle-input px-2 text-[12px] text-foreground focus:bg-background " + accentClasses().focus}
            />
            <Button
              disabled={busy()}
              onPress={() => {
                void browse();
              }}
              class="rounded px-2 py-1 hover:bg-muted active:bg-accent disabled:opacity-35"
            >
              <Text class="text-[12px] text-foreground">{t("Browse…")}</Text>
            </Button>
          </View>
          {error() ? (
            <Text testID="import-error" class="text-[12px] text-destructive">
              {error()}
            </Text>
          ) : null}
        </View>
        {busy() ? (
          <LoadingStatus
            testID="import-loading"
            label={
              activity() === "choosing"
                ? t("Choosing folder…")
                : props.loadingMessage
            }
            path={activity() === "adding" ? path() : undefined}
            hint={
              activity() === "adding" && kind() === "directory"
                ? t("Large directories may take a moment.")
                : undefined
            }
          />
        ) : null}
        <View class="flex-row items-center gap-1.5">
          <Text class="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {t("Saved between launches.")}
          </Text>
          <Button
            disabled={busy()}
            onPress={props.onCancel}
            class="rounded px-2 py-1 hover:bg-muted active:bg-accent disabled:opacity-35"
          >
            <Text class="text-[12px] text-muted-foreground">{t("Cancel")}</Text>
          </Button>
          <Button
            testID="confirm-add-source"
            disabled={busy() || !path().trim()}
            onPress={() => {
              void add();
            }}
            class={"h-7 items-center justify-center rounded px-2 active:opacity-80 disabled:opacity-40 " + accentClasses().fill}
          >
            <Text class={"text-[12px] font-medium " + accentClasses().foreground}>
              {busy()
                ? t("Opening…")
                : kind() === "repository"
                  ? t("Add repository")
                  : t("Add directory")}
            </Text>
          </Button>
        </View>
      </View>
    </Dialog>
  );
}
