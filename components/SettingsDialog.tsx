import { effect, Scroll, signal, Text, token, View } from "nsh";
import { Diagnostics } from "difflens/native";
import { diagnosticState, loadDiagnostics, errorMessage } from "../diagnostics";
import { Button, Dialog, Menu, MenuItem, Radio, RadioGroup, Tab, Tabs } from "nsh/base";
import { t, type Message } from "../i18n";
import {
  ACCENTS, LANGUAGES, LANGUAGE_NAMES, language, preferences, updatePreferences,
  type Accent, type Appearance, type Preferences,
} from "../preferences";
import { accentClasses } from "../appearance";
import { watchUiActivity } from "../ui-activity";
import { HintTarget } from "./Hint";
import { UpdateSettings } from "./UpdateSettings";

const accentNames: Record<Accent, Message> = { blue: "Blue", teal: "Teal", green: "Green", rose: "Rose", amber: "Amber" };
const appearances: { value: Appearance; label: Message }[] = [
  { value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" },
];

export function SettingsDialog(props: {
  error: string | null;
  section?: "updates" | null;
  onClose: () => void;
  onSaved: () => void;
  installing?: boolean;
  onInstallUpdate: () => Promise<string | null>;
}) {
  const savingPreference = signal(false);
  const saving = () => !!props.installing || savingPreference();
  const error = signal(props.error);
  const opening = signal(false);
  effect(() => { void loadDiagnostics(); });
  watchUiActivity(() => diagnosticState().kind === "loading" ? { kind: "source", label: t("Reading diagnostics…") } : null);
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
    if (state.kind === "loading") return <View />;
    if (state.kind === "failed") return <Text class="text-[11px] text-destructive">{t("Diagnostics unavailable: {error}", { error: state.error })}</Text>;
    const info = state.info;
    return <View testID="diagnostics-info" class="gap-2">
      <Text class="text-[12px] text-foreground">DiffLens {info.version} ({info.build}) · {info.architecture}</Text>
      {info.previousUncleanExit ? <View class="gap-1">
        <Text class="text-[11px] text-destructive">{t("Previous session did not close normally.")}</Text>
        <Text class="text-[11px] text-muted-foreground">{t("This can happen after a crash, force quit or power loss.")}</Text>
      </View> : null}
      <View class="flex-row flex-wrap gap-2">
        <Button testID="open-logs" disabled={opening()} onPress={() => { void openDiagnostic(() => Diagnostics.openLogs()); }} class="rounded px-2 py-1 hover:bg-muted active:bg-accent disabled:opacity-35">
          <Text class="text-[11px] text-foreground">{t("Open logs")}</Text>
        </Button>
        <Button testID="open-crash-reports" disabled={opening()} onPress={() => { void openDiagnostic(() => Diagnostics.openCrashReports()); }} class="rounded px-2 py-1 hover:bg-muted active:bg-accent disabled:opacity-35">
          <Text class="text-[11px] text-foreground">{t("Open crash reports")}</Text>
        </Button>
        {info.latestReport ? <Button testID="open-latest-report" disabled={opening()} onPress={() => { void openDiagnostic(() => Diagnostics.openLatestReport()); }} class="rounded px-2 py-1 hover:bg-muted active:bg-accent disabled:opacity-35">
          <Text class="text-[11px] text-foreground">{t("Open latest report")}</Text>
        </Button> : null}
      </View>
      <Text class="text-[11px] text-muted-foreground">{info.logDirectory}</Text>
      <Text class="text-[11px] text-muted-foreground">{t("Logs stay on this Mac. Nothing is uploaded.")}</Text>
      {info.crashReportError ? <Text class="text-[11px] text-destructive">{info.crashReportError}</Text> : null}
    </View>;
  };
  async function changePreference(update: Partial<Preferences>) {
    if (saving()) return;
    savingPreference.set(true);
    error.set(null);
    try {
      await updatePreferences(update);
      props.onSaved();
    } catch (cause) {
      error.set(
        t("Could not save settings: {error}", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      savingPreference.set(false);
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
      <View class="w-[440px] max-w-full gap-3 rounded-lg border border-border bg-background p-4 shadow-sm">
        <Text class="text-[15px] font-semibold text-foreground">
          {t("Settings")}
        </Text>
        <Scroll class="min-h-0" style={{ maxHeight: 440 }}>
          <View class="gap-3">
        <View class="gap-1.5">
          <Text class="text-[11px] font-semibold text-muted-foreground">{t("Appearance")}</Text>
          <Tabs class="flex-row gap-1 rounded bg-muted p-1">
            {appearances.map((option) => <Tab testID={"appearance-" + option.value}
              selected={preferences().appearance === option.value} disabled={saving()}
              onPress={() => { void changePreference({ appearance: option.value }); }}
              class="group h-7 min-w-0 flex-1 items-center justify-center rounded selected:bg-background disabled:opacity-40">
              <Text numberOfLines={1} class="text-[12px] text-muted-foreground group-selected:text-foreground">{t(option.label)}</Text>
            </Tab>)}
          </Tabs>
        </View>
        <View class="gap-1.5">
          <View class="flex-row items-center justify-between gap-2">
            <Text class="text-[11px] font-semibold text-muted-foreground">{t("Theme color")}</Text>
            <Text testID="current-accent" class={"text-[11px] " + accentClasses().text}>{t(accentNames[preferences().accent])}</Text>
          </View>
          <RadioGroup class="flex-row gap-2">
            {ACCENTS.map((color) => <HintTarget class="size-7" text={t(accentNames[color])}>
              <Radio testID={"accent-" + color} checked={preferences().accent === color} disabled={saving()}
                accessibilityLabel={t(accentNames[color])} onChange={() => { void changePreference({ accent: color }); }}
                class="size-7 items-center justify-center rounded-full border-2 border-transparent checked:border-foreground hover:opacity-80 disabled:opacity-40"
                style={{ backgroundColor: token(`theme-${color}`) }}>
                {preferences().accent === color ? <Text class="text-[12px]" style={{ color: token(`theme-${color}-foreground`) }}>✓</Text> : null}
              </Radio>
            </HintTarget>)}
          </RadioGroup>
        </View>
        <View class="flex-row items-center justify-between gap-3">
          <Text class="text-[11px] font-semibold text-muted-foreground">{t("Language")}</Text>
          <Menu popupClass="min-w-52 max-h-64 rounded-md border border-border bg-popover p-1" offset={4}
            trigger={<View testID="choose-language" role="button" focusable disabled={saving()}
              accessibilityLabel={t("Choose language") + " · " + LANGUAGE_NAMES[language()]}
              class="h-7 min-w-36 flex-row items-center justify-between gap-3 rounded bg-subtle-input px-2 hover:bg-accent disabled:opacity-40">
              <Text class="text-[12px] text-foreground">{LANGUAGE_NAMES[language()]}</Text>
              <Text class="text-[11px] text-muted-foreground">▾</Text>
            </View>}>
            {LANGUAGES.map((option) => <MenuItem testID={"language-" + option} disabled={saving()}
              onSelect={() => { void changePreference({ language: option }); }}
              class="h-7 flex-row items-center gap-2 rounded px-2 hover:bg-accent active:bg-accent">
              <Text class="w-4 text-[11px] text-foreground">{language() === option ? "✓" : ""}</Text>
              <Text class="text-[12px] text-foreground">{LANGUAGE_NAMES[option]}</Text>
            </MenuItem>)}
          </Menu>
        </View>
        <Text class="text-[11px] text-muted-foreground">{t("Changes apply immediately.")}</Text>
        <Text class="text-[11px] text-muted-foreground">
          {t("Your choice is saved on this device.")}
        </Text>
        <UpdateSettings focused={props.section === "updates"} onInstall={props.onInstallUpdate} />
        <View class="gap-2 border-t border-border pt-3">
          <Text class="text-[11px] font-semibold text-muted-foreground">{t("Diagnostics")}</Text>
          {diagnosticsContent()}
        </View>
        {error() ? (
          <Text class="text-[11px] text-destructive">{error()}</Text>
        ) : null}
          </View>
        </Scroll>
        <View class="flex-row justify-end">
          <Button
            testID="close-settings"
            disabled={saving()}
            onPress={props.onClose}
            class="h-7 justify-center rounded bg-secondary px-3 hover:bg-accent active:bg-accent"
          >
            <Text class="text-[12px] font-medium text-secondary-foreground">
              {t("Done")}
            </Text>
          </Button>
        </View>
      </View>
    </Dialog>
  );
}
