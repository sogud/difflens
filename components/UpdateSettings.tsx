import { effect, openUrl, setAccessibilityFocus, signal, Text, View, type YNode } from "nsh";
import { Button, Progress, Switch } from "nsh/base";
import { t } from "../i18n";
import { preferences, updatePreferences } from "../preferences";
import {
  checkForUpdates, downloadUpdate, refreshUpdateStatus, updateStatus,
} from "../update-controller";
import { SettingsRow } from "./SettingsRow";

export function UpdateSettings(props: {
  focused?: boolean;
  onInstall: () => Promise<string | null>;
}) {
  const preferenceError = signal<string | null>(null);
  const installError = signal<string | null>(null);
  const changing = signal(false);
  const installing = signal(false);
  let checkTarget: YNode | undefined;

  effect(() => { refreshUpdateStatus(); });
  effect(() => {
    if (props.focused && checkTarget !== undefined) setAccessibilityFocus(checkTarget);
  });

  const phase = () => updateStatus().phase;
  const busy = () => installing() || phase() === "checking" || phase() === "downloading" || phase() === "installing";
  const percent = () => {
    const status = updateStatus();
    if (status.totalBytes <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((status.receivedBytes / status.totalBytes) * 100)));
  };
  const channelLabel = () => {
    const channel = updateStatus().channel;
    return channel === "beta" ? t("Beta") : channel;
  };
  const versionLabel = () => {
    const status = updateStatus();
    if (!status.currentVersion) return "—";
    return status.currentBuild > 0 ? `${status.currentVersion} (${status.currentBuild})` : status.currentVersion;
  };
  const privateBetaHelp = () => updateStatus().channel === "beta";

  async function setAutomatic(checked: boolean) {
    if (changing()) return;
    changing.set(true);
    preferenceError.set(null);
    try {
      await updatePreferences({ automaticUpdates: checked });
      if (checked) void checkForUpdates();
    } catch (cause) {
      preferenceError.set(t("Could not save settings: {error}", {
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    } finally {
      changing.set(false);
    }
  }

  async function startInstall() {
    if (phase() !== "ready" || installing()) return;
    installing.set(true);
    installError.set(null);
    try {
      const issue = await props.onInstall();
      if (issue) installError.set(issue);
    } finally {
      installing.set(false);
    }
  }

  function openReleasePage() {
    const url = updateStatus().releaseUrl;
    if (!url || !/^https?:\/\//i.test(url)) return;
    try {
      void openUrl(url).catch(() => undefined);
    } catch {
      // An unopenable release link leaves the app's other update actions usable.
    }
  }

  return (
    <View testID="update-settings" class="gap-1.5 pt-1">
      <Text class="text-[11px] font-semibold text-muted-foreground">{t("Updates")}</Text>
      <SettingsRow label={t("Current version")}>
        <View class="flex-row items-center gap-1">
          <Text testID="update-current-version" class="text-[11px] text-foreground">{versionLabel()}</Text>
          <Text testID="update-channel" accessibilityLabel={t("Channel") + " " + channelLabel()} class="text-[11px] text-muted-foreground">{"· " + channelLabel()}</Text>
        </View>
      </SettingsRow>
      {!updateStatus().supported ? (
        <Text class="text-[11px] text-muted-foreground">{t("Automatic updates are not available in this build.")}</Text>
      ) : null}
      <SettingsRow label={t("Automatically check for updates")}>
        <View class="items-end">
        <Switch
          testID="automatic-updates"
          checked={preferences().automaticUpdates}
          disabled={changing() || !updateStatus().supported || busy()}
          accessibilityLabel={t("Automatically check for updates")}
          onChange={(checked) => { void setAutomatic(checked); }}
          class="shrink-0"
          trackClass="h-4 w-7 rounded-full bg-muted checked:bg-accent disabled:opacity-40"
          thumbClass="size-3 rounded-full bg-background checked:translate-x-3.5"
        />
        </View>
      </SettingsRow>
      {(() => {
        const status = updateStatus();
        switch (status.phase) {
          case "checking":
            return <Text class="text-[11px] text-muted-foreground">{t("Checking for updates…")}</Text>;
          case "current":
            return <Text class="text-[11px] text-muted-foreground">{t("Up to date")}</Text>;
          case "available":
            return (
              <Text class="text-[11px] text-foreground">
                {t("Version {version} (build {build}) is available.", {
                  version: status.version ?? "—",
                  build: status.build ?? 0,
                })}
              </Text>
            );
          case "downloading":
            return (
              <View class="gap-1">
                <Text class="text-[11px] text-foreground">{t("Downloading update…")}</Text>
                <Progress
                  value={percent()}
                  indeterminate={updateStatus().totalBytes <= 0}
                  accessibilityLabel={t("Download progress")}
                  class="h-1.5 w-full"
                  trackClass="h-1.5 w-full rounded bg-muted"
                  indicatorClass="h-1.5 rounded bg-accent"
                />
                <Text class="text-[11px] text-muted-foreground">{percent()}%</Text>
              </View>
            );
          case "ready":
            return (
              <View class="gap-1">
                <Text class="text-[11px] text-foreground">{t("Update ready")}</Text>
                <Text class="text-[11px] text-muted-foreground">
                  {t("DiffLens will close and reopen to finish installing the update.")}
                </Text>
              </View>
            );
          case "installing":
            return <Text class="text-[11px] text-foreground">{t("Installing update…")}</Text>;
          case "recovered":
          case "failed":
            return (
              <View class="gap-1">
                <Text testID="update-error" class="text-[11px] text-destructive">
                  {t("Update failed: {error}", { error: status.error ?? "—" })}
                </Text>
                {privateBetaHelp() ? (
                  <Text class="text-[11px] text-muted-foreground">
                    {t("Private Beta updates require the GitHub CLI to be signed in with access to this repository.")}
                  </Text>
                ) : null}
              </View>
            );
          default:
            return null;
        }
      })()}
      <View class="flex-row flex-wrap items-center gap-1">
        {phase() === "available" ? (
          <Button
            testID="download-update"
            disabled={!updateStatus().supported}
            onPress={() => { void downloadUpdate(); }}
            class="h-6 justify-center rounded px-1.5 hover:bg-muted active:bg-accent disabled:opacity-35"
          >
            <Text class="text-[11px] font-medium text-foreground">{t("Download update")}</Text>
          </Button>
        ) : null}
        {phase() === "ready" ? (
          <Button
            testID="restart-and-install"
            disabled={installing()}
            onPress={() => { void startInstall(); }}
            class="h-6 justify-center rounded px-1.5 hover:bg-muted active:bg-accent disabled:opacity-35"
          >
            <Text class="text-[11px] font-medium text-foreground">{t("Restart and install")}</Text>
          </Button>
        ) : null}
        {phase() !== "available" && phase() !== "ready" ? (
          <Button
            testID="check-updates"
            ref={(node) => { checkTarget = node; }}
            disabled={!updateStatus().supported || busy()}
            onPress={() => { void checkForUpdates(); }}
            class="h-6 justify-center rounded px-1.5 hover:bg-muted active:bg-accent disabled:opacity-35"
          >
            <Text class="text-[11px] font-medium text-foreground">
              {t(phase() === "checking" ? "Checking for updates…" : "Check for updates")}
            </Text>
          </Button>
        ) : null}
        {updateStatus().releaseUrl ? (
          <Button
            testID="open-release-page"
            role="link"
            accessibilityLabel={t("Open release page")}
            onPress={openReleasePage}
            class="h-6 justify-center rounded px-1.5 hover:opacity-80"
          >
            <Text class="text-[11px] text-primary">{t("Open release page")}</Text>
          </Button>
        ) : null}
      </View>
      {preferenceError() ? <Text class="text-[11px] text-destructive">{preferenceError()}</Text> : null}
      {installError() ? <Text testID="update-install-error" class="text-[11px] text-destructive">{installError()}</Text> : null}
    </View>
  );
}
