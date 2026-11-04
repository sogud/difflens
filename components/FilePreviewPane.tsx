import { effect, signal, Text, untracked, View } from "nsh";
import { Editor } from "nsh/base";
import type { FilePreviewState } from "../ui-types";
import { CODE_FONT, CODE_FONT_SIZE, CODE_LINE_HEIGHT } from "../code-style";
import { t } from "../i18n";
import { ReviewHeader, type ReviewFocus } from "./ReviewHeader";

type ReadyPreview = Extract<FilePreviewState, { kind: "ready" }>;

export function FilePreviewPane(props: { state: FilePreviewState | null; focus?: ReviewFocus }) {
  const displayed = signal<ReadyPreview | null>(null);
  const visited = signal(false);
  effect(() => {
    const next = props.state;
    untracked(() => {
      if (next?.kind === "ready") {
        displayed.set(next);
        if (next.file.kind === "text") visited.set(true);
      } else if (next?.kind === "loading" && next.cachedFile) {
        displayed.set({ kind: "ready", file: next.cachedFile });
        if (next.cachedFile.kind === "text") visited.set(true);
      } else if (!next || next.kind === "failed") displayed.set(null);
    });
  });
  const path = () => {
    const state = props.state;
    if (state?.kind === "loading" && displayed()) return displayed()!.file.path;
    return !state ? "" : state.kind === "ready" ? state.file.path : state.path;
  };
  const textual = () => displayed()?.file.kind === "text";
  return <View testID="file-preview" class="min-h-0 flex-1">
    <ReviewHeader focus={props.focus}>
      <Text numberOfLines={1} class="min-w-0 text-[12px] font-semibold text-foreground">{path() ? path().slice(path().lastIndexOf("/") + 1) : t("File preview")}</Text>
      <Text numberOfLines={1} class="max-w-56 min-w-0 text-[10px] text-muted-foreground">{path().includes("/") ? path().slice(0, path().lastIndexOf("/")) : ""}</Text>
      <Text class="text-[10px] text-muted-foreground">{t("Read-only")}</Text>
    </ReviewHeader>
    <View class={textual() ? "min-h-0 flex-1" : "hidden"}>
      {visited() ? <Editor testID="file-preview-editor" accessibilityLabel={t("File preview")} value={textual() ? displayed()!.file.content : ""}
        language={displayed()?.file.path ?? ""} readOnly lineNumbers softWrap={false} activeLine={false} scrollBeyondLastLine={false}
        fontFamily={CODE_FONT} fontSize={CODE_FONT_SIZE} lineHeight={CODE_LINE_HEIGHT} class="min-h-0 flex-1 bg-background text-foreground" /> : null}
    </View>
    {!props.state ? <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("Select a file to preview.")}</Text></View>
      : props.state.kind === "failed" ? <View class="flex-1 items-center justify-center gap-2 p-4">
        <Text class="text-[12px] text-foreground">{t("Could not preview this file")}</Text>
        <Text class="text-[11px] text-destructive">{props.state.message}</Text>
      </View> : props.state.kind === "ready" && props.state.file.kind !== "text" ? <View testID="file-preview-unavailable" class="flex-1 items-center justify-center gap-2 p-4">
        <Text class="text-[12px] text-foreground">{t(props.state.file.kind === "binary" ? "Binary file · text preview unavailable" : "File is larger than the 2 MiB preview limit")}</Text>
        <Text class="text-[11px] text-muted-foreground">{t("{size} bytes", { size: props.state.file.sizeBytes })}</Text>
      </View> : null}
  </View>;
}
