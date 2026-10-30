import { t } from "../i18n";
import { accentClasses } from "../appearance";
import { Text, View } from "nsh";
import { Button } from "nsh/base";
import type { SourceKind } from "../library";
import { LoadingStatus } from "./LoadingStatus";

export function WelcomePane(props: {
  busy: boolean;
  emptyDirectory: boolean;
  loadingMessage: string;
  onChoose: (kind: SourceKind) => void;
  onEnterPath: () => void;
}) {
  return (
    <View testID="welcome" class="flex-1 items-center justify-center gap-3 p-6">
      <View class="max-w-[380px] gap-1.5">
        <Text class="text-center text-[18px] font-semibold text-foreground">
          {props.emptyDirectory
            ? t("No Git repositories found")
            : t("Open a repository")}
        </Text>
        <Text class="text-center text-[12px] text-muted-foreground">
          {props.emptyDirectory
            ? t(
                "This directory is saved in your library. Choose another folder, or use Rescan after adding repositories to it.",
              )
            : t(
                "Choose a repository or scan a directory for nested repositories.",
              )}
        </Text>
      </View>
      <View class="flex-row gap-2">
        <Button
          disabled={props.busy}
          onPress={() => props.onChoose("repository")}
          class={"h-8 justify-center rounded-md px-3 active:opacity-80 disabled:opacity-40 " + accentClasses().fill}
        >
          <Text class={"text-[12px] font-medium " + accentClasses().foreground}>
            {t("Add repository…")}
          </Text>
        </Button>
        <Button
          disabled={props.busy}
          onPress={() => props.onChoose("directory")}
          class="rounded-md bg-secondary px-3 py-1.5 hover:bg-accent active:bg-accent disabled:opacity-35"
        >
          <Text class="text-[12px] font-medium text-foreground">
            {t("Add directory…")}
          </Text>
        </Button>
      </View>
      <Button
        disabled={props.busy}
        onPress={props.onEnterPath}
        class="rounded px-2 py-1 active:bg-muted disabled:opacity-40"
      >
        <Text class="text-[12px] text-muted-foreground">
          {t("Enter a path instead…")}
        </Text>
      </Button>
      {props.busy ? <LoadingStatus label={props.loadingMessage} /> : null}
    </View>
  );
}
