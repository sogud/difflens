import { Text, View } from "nsh";
import { Editor } from "nsh/base";
import type { FilePreviewState } from "../ui-types";
import { CODE_FONT, CODE_FONT_SIZE, CODE_LINE_HEIGHT } from "../code-style";
import { t } from "../i18n";
import { LoadingStatus } from "./LoadingStatus";

export function FilePreviewPane(props: { state: FilePreviewState | null }) {
  const path = () => { const state = props.state; return !state ? "" : state.kind === "ready" ? state.file.path : state.path; };
  const body = () => {
    const state = props.state;
    if (!state) return <View class="flex-1 items-center justify-center p-4"><Text class="text-[12px] text-muted-foreground">{t("Select a file to preview.")}</Text></View>;
    if (state.kind === "loading") return <View class="flex-1 items-center justify-center"><LoadingStatus label={t("Loading file…")} /></View>;
    if (state.kind === "failed") return <View class="flex-1 items-center justify-center gap-2 p-4">
      <Text class="text-[12px] text-foreground">{t("Could not preview this file")}</Text>
      <Text class="text-[11px] text-destructive">{state.message}</Text>
    </View>;
    const file = state.file;
    if (file.kind !== "text") return <View testID="file-preview-unavailable" class="flex-1 items-center justify-center gap-2 p-4">
      <Text class="text-[12px] text-foreground">{t(file.kind === "binary" ? "Binary file · text preview unavailable" : "File is larger than the 2 MiB preview limit")}</Text>
      <Text class="text-[11px] text-muted-foreground">{t("{size} bytes", { size: file.sizeBytes })}</Text>
    </View>;
    return <Editor
      testID="file-preview-editor"
      accessibilityLabel={t("File preview")}
      value={file.content}
      language={file.path}
      readOnly
      lineNumbers
      softWrap={false}
      activeLine={false}
      scrollBeyondLastLine={false}
      fontFamily={CODE_FONT}
      fontSize={CODE_FONT_SIZE}
      lineHeight={CODE_LINE_HEIGHT}
      class="min-h-0 flex-1 bg-background text-foreground"
    />;
  };
  return <View testID="file-preview" class="min-h-0 flex-1">
    <View class="h-[34px] shrink-0 flex-row items-center gap-2 border-b border-border bg-background pl-3 pr-[140px]">
      <Text numberOfLines={1} class="shrink-0 text-[12px] font-semibold text-foreground">{path() ? path().slice(path().lastIndexOf("/") + 1) : t("File preview")}</Text>
      <Text numberOfLines={1} class="min-w-0 flex-1 text-[10px] text-muted-foreground">{path().includes("/") ? path().slice(0, path().lastIndexOf("/")) : ""}</Text>
      <Text class="text-[10px] text-muted-foreground">{t("Read-only")}</Text>
    </View>
    {body()}
  </View>;
}
