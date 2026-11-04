import { t } from "../i18n";
import { computed, effect, signal, Text, untracked, View } from "nsh";
import { CodeDiff, type CodeDiffRef } from "difflens/native";
import { Button } from "nsh/base";
import { CODE_FONT, CODE_FONT_SIZE, CODE_LINE_HEIGHT } from "../code-style";
import type { DiffState } from "../ui-types";
import { IconButton } from "./IconButton";
import { preferences, updatePreferences } from "../preferences";
import { errorMessage } from "../diagnostics";
import { ReviewHeader, type ReviewFocus } from "./ReviewHeader";

type DisplayedDiff = Extract<DiffState, { kind: "ready" }> & { title?: string };

export function DiffPane(props: { diff: DiffState; title?: string; focus?: ReviewFocus }) {
  let view: CodeDiffRef | undefined;
  const displayed = signal<DisplayedDiff | null>(null);
  const visited = signal(false);
  const activeHunk = signal<number | null>(null);
  const preferenceError = signal<string | null>(null);
  const pending = () => props.diff.kind === "loading";
  effect(() => {
    const next = props.diff;
    const title = props.title;
    untracked(() => {
      if (next.kind === "ready") {
        const previous = displayed();
        if (!previous || previous.filePath !== next.filePath || previous.staged !== next.staged || previous.patch !== next.patch || previous.title !== title) {
          displayed.set({ ...next, title });
          if (!previous || previous.filePath !== next.filePath || previous.staged !== next.staged || previous.patch !== next.patch) activeHunk.set(null);
        }
        if (next.patch.includes("\n@@")) visited.set(true);
      } else if (next.kind === "loading" && next.cachedPatch !== undefined) {
        displayed.set({ kind: "ready", filePath: next.filePath, staged: next.staged, patch: next.cachedPatch, title });
        activeHunk.set(null);
        if (next.cachedPatch.includes("\n@@")) visited.set(true);
      } else if (next.kind === "idle" || next.kind === "failed") {
        displayed.set(null);
        activeHunk.set(null);
      }
    });
  });
  function toggleLayout() {
    preferenceError.set(null);
    void updatePreferences({ diffLayout: preferences().diffLayout === "split" ? "unified" : "split" }).catch(cause => {
      preferenceError.set(t("Could not save settings: {error}", { error: errorMessage(cause) }));
    });
  }
  const headerData = computed(() => pending() && displayed() ? displayed()! : props.diff);
  const header = computed(() => {
    const current = headerData();
    const title = pending() && displayed() ? displayed()!.title : props.title;
    if (title) return title;
    return current.kind === "idle" ? t("Diff") : t(current.staged ? "Staged" : "Working tree") + " · " + current.filePath;
  });
  const fileInfo = computed(() => {
    const current = headerData();
    if (props.title || current.kind === "idle") return null;
    const separator = current.filePath.lastIndexOf("/");
    return { name: current.filePath.slice(separator + 1), directory: separator >= 0 ? current.filePath.slice(0, separator) : "" };
  });
  const patch = computed(() => displayed()?.patch ?? "");
  const overview = computed(() => {
    let added = 0;
    let deleted = 0;
    let rows = 0;
    const hunks: { index: number; row: number; removed: boolean }[] = [];
    const currentPatch = patch();
    if (currentPatch) {
      let inHunk = false;
      for (const line of currentPatch.split("\n")) {
        if (line.startsWith("diff --git ")) inHunk = false;
        if (line.startsWith("@@")) {
          hunks.push({ index: hunks.length, row: rows, removed: false });
          inHunk = true;
          rows += 1;
        } else if (inHunk) {
          if (line.startsWith("+")) added += 1;
          if (line.startsWith("-")) { deleted += 1; hunks[hunks.length - 1].removed = true; }
          if (/^[ +\-]/.test(line)) rows += 1;
        }
      }
    }
    const stride = Math.max(1, Math.ceil(hunks.length / 48));
    return { added, deleted, rows, count: hunks.length, markers: hunks.filter((_, index) => index % stride === 0 || index === hunks.length - 1) };
  });
  async function moveHunk(direction: "previous" | "next") {
    if (pending()) return;
    const snapshot = displayed();
    const index = direction === "next" ? await view?.nextHunk() : await view?.previousHunk();
    if (displayed() === snapshot && !pending() && index != null) activeHunk.set(index);
  }
  function goToHunk(index: number) { if (!pending()) { view?.goToHunk(index); activeHunk.set(index); } }
  const textual = () => !!displayed()?.patch.includes("\n@@");
  return <View class="min-h-0 flex-1 flex-col">
    <ReviewHeader label={header()} focus={props.focus} actions={<>
      <IconButton testID="toggle-diff-layout" icon={preferences().diffLayout === "split" ? "diffSplit" : "diffUnified"} compact disabled={pending()}
        label={t(preferences().diffLayout === "split" ? "Switch to unified diff" : "Switch to side-by-side diff")} onPress={toggleLayout} />
      <IconButton icon="chevronUp" compact label={t("Previous change")} disabled={pending() || overview().count === 0} onPress={() => { void moveHunk("previous"); }} />
      <Text class="font-mono text-[10px] text-muted-foreground">{(overview().count ? (activeHunk() ?? 0) + 1 : 0) + " / " + overview().count}</Text>
      <IconButton icon="chevronDown" compact label={t("Next change")} disabled={pending() || overview().count === 0} onPress={() => { void moveHunk("next"); }} />
    </>}>
      {fileInfo() ? <>
        <Text numberOfLines={1} class="max-w-64 min-w-0 text-[12px] font-semibold text-foreground">{fileInfo()?.name}</Text>
        <Text numberOfLines={1} class="max-w-48 min-w-0 text-[10px] text-muted-foreground">{fileInfo()?.directory}</Text>
      </> : <Text numberOfLines={1} class="min-w-0 text-[12px] font-medium text-foreground">{header()}</Text>}
      {overview().count > 0 ? <>
        <Text class="font-mono text-[10px] text-success">{"+" + overview().added}</Text>
        <Text class="font-mono text-[10px] text-destructive">{"−" + overview().deleted}</Text>
      </> : null}
    </ReviewHeader>
    {preferenceError() ? <Text class="px-3 py-1 text-[11px] text-destructive">{preferenceError()}</Text> : null}
    <View class="relative min-h-0 flex-1">
      <View class={textual() ? "min-h-0 flex-1" : "hidden"}>
        {visited() ? <CodeDiff ref={reference => { view = reference; }} testID="review-diff" patch={displayed()?.patch ?? ""} layout={preferences().diffLayout}
          fontFamily={CODE_FONT} fontSize={CODE_FONT_SIZE} lineHeight={CODE_LINE_HEIGHT} class="min-h-0 flex-1 bg-background text-foreground" /> : null}
      </View>
      {props.diff.kind === "failed" ? <View class="flex-1 items-center justify-center gap-1.5 p-4">
        <Text class="text-[12px] text-destructive">{t("Could not load diff")}</Text>
        <Text class="max-w-80 text-center text-[11px] text-muted-foreground">{props.diff.message}</Text>
      </View> : props.diff.kind === "idle" ? <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("Select a changed file to inspect its diff.")}</Text></View>
        : !pending() && !textual() ? <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("No textual diff is available for this file.")}</Text></View> : null}
      <View class="absolute right-3 top-0 bottom-0 z-10 w-2">
        {overview().markers.map(hunk => <Button disabled={pending()} accessibilityLabel={t("Change {index} of {total}", { index: hunk.index + 1, total: overview().count })}
          onPress={() => goToHunk(hunk.index)} class={"absolute right-px w-[5px] opacity-65 hover:opacity-100 " + (hunk.removed ? "bg-destructive" : "bg-success")}
          style={{ top: `${4 + hunk.row / Math.max(1, overview().rows) * 88}%`, height: 10 }} />)}
      </View>
    </View>
  </View>;
}
