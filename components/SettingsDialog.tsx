import { effect, signal, Text, View } from "nsh";
import { Diagnostics } from "difflens/native";
import { diagnosticState, loadDiagnostics, errorMessage } from "../diagnostics";
import { Button, Dialog, Tab, Tabs } from "nsh/base";
import { language, setLanguage, t, type Language } from "../i18n";

export function SettingsDialog(props: {
  error: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saving = signal(false);
  const error = signal(props.error);
  const opening = signal(false);
  effect(() => { void loadDiagnostics(); });
  async function openDiagnostic(action: () => Promise<void>) {
    if (opening()) return;
    opening.set(true);
    error.set(null);
    try { await action(); }
    catch (cause) { error.set(errorMessage(cause)); }
    finally { opening.set(false); }
  }
  const diagnosticsContent = () => {
    const state = diagnosticState();
    if (state.kind === "loading") return <Text class="text-[11px] text-muted-foreground">{t("Reading diagnostics…")}</Text>;
    if (state.kind === "failed") return <Text class="text-[11px] text-destructive">{t("Diagnostics unavailable: {error}", { error: state.error })}</Text>;
    const info = state.info;
    return <View testID="diagnostics-info" class="gap-2">
      <Text class="text-[12px] text-foreground">DiffLens {info.version} ({info.build}) · {info.architecture}</Text>
      {info.previousUncleanExit ? <View class="gap-1">
        <Text class="text-[11px] text-destructive">{t("Previous session did not close normally.")}</Text>
        <Text class="text-[11px] text-muted-foreground">{t("This can happen after a crash, force quit or power loss.")}</Text>
      </View> : null}
      <View class="flex-row flex-wrap gap-2">
        <Button testID="open-logs" disabled={opening()} onPress={() => { void openDiagnostic(() => Diagnostics.openLogs()); }} class="rounded border border-border px-2 py-1 disabled:opacity-40">
          <Text class="text-[11px] text-foreground">{t("Open logs")}</Text>
        </Button>
        <Button testID="open-crash-reports" disabled={opening()} onPress={() => { void openDiagnostic(() => Diagnostics.openCrashReports()); }} class="rounded border border-border px-2 py-1 disabled:opacity-40">
          <Text class="text-[11px] text-foreground">{t("Open crash reports")}</Text>
        </Button>
        {info.latestReport ? <Button testID="open-latest-report" disabled={opening()} onPress={() => { void openDiagnostic(() => Diagnostics.openLatestReport()); }} class="rounded border border-border px-2 py-1 disabled:opacity-40">
          <Text class="text-[11px] text-foreground">{t("Open latest report")}</Text>
        </Button> : null}
      </View>
      <Text class="text-[11px] text-muted-foreground">{info.logDirectory}</Text>
      <Text class="text-[11px] text-muted-foreground">{t("Logs stay on this Mac. Nothing is uploaded.")}</Text>
      {info.crashReportError ? <Text class="text-[11px] text-destructive">{info.crashReportError}</Text> : null}
    </View>;
  };
  async function changeLanguage(next: Language) {
    if (saving()) return;
    saving.set(true);
    error.set(null);
    try {
      await setLanguage(next);
      props.onSaved();
    } catch (cause) {
      error.set(
        t("Could not save settings: {error}", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      saving.set(false);
    }
  }
  return (
    <Dialog
      testID="settings-dialog"
      animation="fade"
      closeOnBackdropPress={false}
      closeOnEscape={!saving()}
      onOpenChange={(open) => {
        if (!open && !saving()) props.onClose();
      }}
      backdropClass="bg-black/30"
      class="flex-1 items-center justify-center p-4"
    >
      <View class="w-[400px] max-w-full gap-3 rounded-lg border border-border bg-background p-4 shadow-sm">
        <Text class="text-[15px] font-semibold text-foreground">
          {t("Settings")}
        </Text>
        <Text class="text-[11px] font-semibold text-muted-foreground">
          {t("General")}
        </Text>
        <View class="flex-row items-center gap-3">
          <Text class="min-w-0 flex-1 text-[12px] text-foreground">
            {t("Language")}
          </Text>
          <Tabs class="flex-row gap-1 rounded bg-muted p-1">
            {(["zh", "en"] satisfies Language[]).map((option) => (
              <Tab
                testID={"language-" + option}
                selected={language() === option}
                disabled={saving()}
                onPress={() => {
                  void changeLanguage(option);
                }}
                class="group items-center rounded px-3 py-1 selected:bg-background disabled:opacity-40"
              >
                <Text class="text-[12px] text-muted-foreground group-selected:text-foreground">
                  {option === "zh" ? "简体中文" : "English"}
                </Text>
              </Tab>
            ))}
          </Tabs>
        </View>
        <Text class="text-[11px] text-muted-foreground">
          {t("Language changes apply immediately.")}
        </Text>
        <Text class="text-[11px] text-muted-foreground">
          {t("Your choice is saved on this device.")}
        </Text>
        <View class="gap-2 border-t border-border pt-3">
          <Text class="text-[11px] font-semibold text-muted-foreground">{t("Diagnostics")}</Text>
          {diagnosticsContent()}
        </View>
        {error() ? (
          <Text class="text-[11px] text-destructive">{error()}</Text>
        ) : null}
        <View class="flex-row justify-end">
          <Button
            testID="close-settings"
            disabled={saving()}
            onPress={props.onClose}
            class="rounded bg-primary px-3 py-1 active:opacity-80"
          >
            <Text class="text-[12px] font-medium text-primary-foreground">
              {t("Done")}
            </Text>
          </Button>
        </View>
      </View>
    </Dialog>
  );
}
