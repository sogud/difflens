import { effect, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Diagnostics } from "difflens/native";
import { errorMessage } from "../diagnostics";
import { t } from "../i18n";
import { accentClasses } from "../appearance";

/** Keeps an unexpected UI error visible and records its stack for diagnosis. */
export function FailurePane(props: { error: unknown; reset: () => void }) {
  const failure = signal<string | null>(null);
  effect(() => {
    const message = props.error instanceof Error
      ? props.error.stack || props.error.message
      : String(props.error);
    void Diagnostics.recordUiError(message).catch((cause: unknown) => {
      failure.set(errorMessage(cause));
    });
  });
  return (
    <View class="flex-1 items-center justify-center bg-background p-6">
      <View class="max-w-[480px] gap-3">
        <Text class="text-[15px] font-semibold text-foreground">{t("DiffLens encountered an error")}</Text>
        <Text class="text-[12px] text-muted-foreground">{t("Your repositories are still on disk. Open the logs to inspect this error.")}</Text>
        <Text class="text-[11px] text-destructive">{errorMessage(props.error)}</Text>
        {failure() ? <Text class="text-[11px] text-destructive">{failure()}</Text> : null}
        <View class="flex-row gap-2">
          <Button testID="retry-app" onPress={props.reset} class={"h-7 justify-center rounded px-3 " + accentClasses().fill}>
            <Text class={"text-[12px] " + accentClasses().foreground}>{t("Reload interface")}</Text>
          </Button>
          <Button testID="failure-open-logs" onPress={() => {
            void Diagnostics.openLogs().catch((cause: unknown) => failure.set(errorMessage(cause)));
          }} class="rounded px-3 py-1 hover:bg-muted active:bg-accent">
            <Text class="text-[12px] text-foreground">{t("Open logs")}</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}
