import { t } from "../i18n";
import { computed, Text, View } from "nsh";
import { CodeDiff } from "difflens/native";
import { CODE_FONT, CODE_FONT_SIZE, CODE_LINE_HEIGHT } from "../code-style";
import type { DiffState } from "../ui-types";
import { LoadingStatus } from "./LoadingStatus";

export function DiffPane(props: { diff: DiffState }) {
  const header = computed(() => {
    if (props.diff.kind === "idle") {
      return t("Diff");
    }
    const label = props.diff.staged ? t("Staged") : t("Working tree");
    return label + " · " + props.diff.filePath;
  });

  const body = computed(() => {
    if (props.diff.kind === "idle") {
      return (
        <View class="flex-1 items-center justify-center p-4">
          <Text class="text-[12px] text-muted-foreground">
            {t("Select a changed file to inspect its diff.")}
          </Text>
        </View>
      );
    }
    if (props.diff.kind === "loading") {
      return (
        <View class="flex-1 items-center justify-center p-4">
          <LoadingStatus label={t("Loading diff…")} />
        </View>
      );
    }
    if (props.diff.kind === "failed") {
      return (
        <View class="flex-1 items-center justify-center gap-1.5 p-4">
          <Text class="text-[12px] font-medium text-destructive">
            {t("Could not load diff")}
          </Text>
          <Text class="max-w-80 text-center text-[11px] text-muted-foreground">
            {props.diff.message}
          </Text>
        </View>
      );
    }
    if (props.diff.patch.length === 0 || !props.diff.patch.includes("\n@@")) {
      return (
        <View class="flex-1 items-center justify-center p-4">
          <Text class="text-[12px] text-muted-foreground">
            {t("No textual diff is available for this file.")}
          </Text>
        </View>
      );
    }
    return (
      <CodeDiff
        testID="review-diff"
        patch={props.diff.patch}
        fontFamily={CODE_FONT}
        fontSize={CODE_FONT_SIZE}
        lineHeight={CODE_LINE_HEIGHT}
        class="min-h-0 flex-1 bg-background text-foreground"
      />
    );
  });

  return (
    <View class="min-h-0 flex-1 flex-col">
      <View class="h-7 justify-center border-b border-border px-2">
        <Text
          numberOfLines={1}
          class="font-mono text-[11px] text-muted-foreground"
        >
          {header()}
        </Text>
      </View>
      <View class="min-h-0 flex-1">{body()}</View>
    </View>
  );
}
