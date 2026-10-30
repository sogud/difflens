import { t } from "../i18n";
import { computed, effect, signal, Text, View } from "nsh";
import { CodeDiff, type CodeDiffRef } from "difflens/native";
import { Button } from "nsh/base";
import { CODE_FONT, CODE_FONT_SIZE, CODE_LINE_HEIGHT } from "../code-style";
import type { DiffState } from "../ui-types";
import { IconButton } from "./IconButton";
import { preferences, updatePreferences } from "../preferences";
import { errorMessage } from "../diagnostics";
import { LoadingStatus } from "./LoadingStatus";

export function DiffPane(props: { diff: DiffState; title?: string }) {
  let view: CodeDiffRef | undefined;
  const activeHunk = signal<number | null>(null);
  const preferenceError = signal<string | null>(null);
  function toggleLayout() {
    preferenceError.set(null);
    void updatePreferences({ diffLayout: preferences().diffLayout === "split" ? "unified" : "split" }).catch(cause => {
      preferenceError.set(t("Could not save settings: {error}", { error: errorMessage(cause) }));
    });
  }
  effect(() => { void props.diff; activeHunk.set(null); });
  const header = computed(() => {
    if (props.title) return props.title;
    if (props.diff.kind === "idle") return t("Diff");
    return t(props.diff.staged ? "Staged" : "Working tree") + " · " + props.diff.filePath;
  });
  const fileInfo = computed(() => {
    if (props.title || props.diff.kind === "idle") return null;
    const path = props.diff.filePath;
    const separator = path.lastIndexOf("/");
    return { name: path.slice(separator + 1), directory: separator >= 0 ? path.slice(0, separator) : "" };
  });
  const overview = computed(() => {
    let added = 0;
    let deleted = 0;
    let rows = 0;
    const hunks: { index: number; row: number; removed: boolean }[] = [];
    if (props.diff.kind === "ready") {
      let inHunk = false;
      for (const line of props.diff.patch.split("\n")) {
        if (line.startsWith("diff --git ")) inHunk = false;
        if (line.startsWith("@@")) {
          hunks.push({ index: hunks.length, row: rows, removed: false });
          inHunk = true;
          rows += 1;
        } else if (inHunk) {
          if (line.startsWith("+")) added += 1;
          if (line.startsWith("-")) {
            deleted += 1;
            hunks[hunks.length - 1].removed = true;
          }
          if (/^[ +\-]/.test(line)) rows += 1;
        }
      }
    }
    const stride = Math.max(1, Math.ceil(hunks.length / 48));
    return { added, deleted, rows, count: hunks.length, markers: hunks.filter((hunk, index) => index % stride === 0 || index === hunks.length - 1) };
  });
  async function moveHunk(direction: "previous" | "next") {
    const snapshot = props.diff;
    const index = direction === "next" ? await view?.nextHunk() : await view?.previousHunk();
    if (props.diff === snapshot && index != null) activeHunk.set(index);
  }
  function goToHunk(index: number) {
    view?.goToHunk(index);
    activeHunk.set(index);
  }
  const body = computed(() => {
    if (props.diff.kind === "idle") return <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("Select a changed file to inspect its diff.")}</Text></View>;
    if (props.diff.kind === "loading") return <View class="flex-1 items-center justify-center p-4"><LoadingStatus label={t("Loading diff…")} /></View>;
    if (props.diff.kind === "failed") return <View class="flex-1 items-center justify-center gap-1.5 p-4">
      <Text class="text-[12px] font-medium text-destructive">{t("Could not load diff")}</Text>
      <Text class="max-w-80 text-center text-[11px] text-muted-foreground">{props.diff.message}</Text>
    </View>;
    if (props.diff.patch.length === 0 || !props.diff.patch.includes("\n@@")) return <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("No textual diff is available for this file.")}</Text></View>;
    return <CodeDiff ref={reference => { view = reference; }} testID="review-diff" patch={props.diff.patch} layout={preferences().diffLayout}
      fontFamily={CODE_FONT} fontSize={CODE_FONT_SIZE} lineHeight={CODE_LINE_HEIGHT}
      class="min-h-0 flex-1 bg-background text-foreground" />;
  });
  return <View class="min-h-0 flex-1 flex-col">
    <View accessibilityLabel={header()} class="h-[34px] shrink-0 flex-row items-center gap-2 border-b border-border bg-background pl-3 pr-[140px]">
      {fileInfo() ? <>
        <Text numberOfLines={1} class="max-w-72 min-w-0 text-[12px] font-semibold text-foreground">{fileInfo()?.name}</Text>
        <Text numberOfLines={1} class="max-w-56 min-w-0 text-[10px] text-muted-foreground">{fileInfo()?.directory}</Text>
      </> : <Text numberOfLines={1} class="min-w-0 text-[12px] font-medium text-foreground">{header()}</Text>}
      {overview().count > 0 ? <>
        <Text class="font-mono text-[10px] text-success">{"+" + overview().added}</Text>
        <Text class="font-mono text-[10px] text-destructive">{"−" + overview().deleted}</Text>
      </> : null}
      <View class="min-w-0 flex-1" />
      <IconButton icon={preferences().diffLayout === "split" ? "diffSplit" : "diffUnified"} compact
        testID="toggle-diff-layout" label={t(preferences().diffLayout === "split" ? "Switch to unified diff" : "Switch to side-by-side diff")}
        onPress={toggleLayout} />
      <IconButton icon="chevronUp" compact label={t("Previous change")} disabled={overview().count === 0} onPress={() => { void moveHunk("previous"); }} />
      <Text class="font-mono text-[10px] text-muted-foreground">{(overview().count ? (activeHunk() ?? 0) + 1 : 0) + " / " + overview().count}</Text>
      <IconButton icon="chevronDown" compact label={t("Next change")} disabled={overview().count === 0} onPress={() => { void moveHunk("next"); }} />
    </View>
    {preferenceError() ? <Text class="px-3 py-1 text-[11px] text-destructive">{preferenceError()}</Text> : null}
    <View class="relative min-h-0 flex-1">
      {body()}
      <View class="absolute right-3 top-0 bottom-0 z-10 w-2">
        {overview().markers.map(hunk => <Button accessibilityLabel={t("Change {index} of {total}", { index: hunk.index + 1, total: overview().count })}
          onPress={() => goToHunk(hunk.index)} class={"absolute right-px w-[5px] opacity-65 hover:opacity-100 " + (hunk.removed ? "bg-destructive" : "bg-success")}
          style={{ top: 4 + hunk.row / Math.max(1, overview().rows) * 88 + "%", height: 10 }} />)}
      </View>
    </View>
  </View>;
}
