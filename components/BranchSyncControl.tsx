import { Text, View } from "nsh";
import { Button } from "nsh/base";
import type { RepositoryDetails } from "difflens/native";
import { branchSyncLabel, canPushBranch, type PushFeedback } from "../git-sync";
import { t } from "../i18n";
import { HintTarget } from "./Hint";
import { Icon } from "./Icon";

export function BranchSyncControl(props: {
  details: RepositoryDetails;
  feedback: PushFeedback;
  disabled: boolean;
  onPush: () => void;
  onRefresh: () => void;
}) {
  const feedback = () => {
    const value = props.feedback;
    return value.kind !== "idle" && value.root === props.details.path && value.branch === props.details.branchName ? value : null;
  };
  const needsRefresh = () => {
    const value = feedback();
    return value?.kind === "confirmed" && !!value.refreshError;
  };
  const status = () => {
    const value = feedback();
    if (value?.kind === "running") return t("Pushing changes");
    if (value?.kind === "unconfirmed") return t("Push not confirmed");
    if (needsRefresh()) return t("Push succeeded; refresh status");
    if (props.details.hasUpstream && (props.details.ahead > 0 || props.details.behind > 0)) return branchSyncLabel(props.details);
    if (value?.kind === "confirmed") return t("Push confirmed");
    return branchSyncLabel(props.details);
  };
  const hint = () => {
    const value = feedback();
    if (value?.kind === "unconfirmed") return status() + "\n" + value.error;
    if (value?.kind === "confirmed" && value.refreshError) return t("Push confirmed, but status refresh failed: {error}", { error: value.refreshError });
    if (!props.details.branchName || !props.details.hasCommits || !props.details.remoteNames.length || !props.details.hasUpstream) return status();
    return status() + (props.details.upstream ? " · " + props.details.upstream : "") + "\n" + t("Compared with the local upstream record; fetch to refresh remote information.");
  };
  const actionLabel = () => needsRefresh() ? t("Refresh") : !props.details.hasUpstream && canPushBranch(props.details) ? t("Publish branch") : t("Push");
  const tone = () => feedback()?.kind === "unconfirmed" || needsRefresh() ? "text-warning" : feedback()?.kind === "confirmed" && props.details.ahead === 0 && props.details.behind === 0 ? "text-success" : props.details.ahead > 0 ? "text-primary" : "text-muted-foreground";
  return <HintTarget text={hint()} class="min-w-0 flex-1">
    <View class="min-w-0 flex-row items-center gap-1">
      <Text testID="branch-sync-status" numberOfLines={1} class={"min-w-0 flex-1 text-[10px] " + tone()}>{status()}</Text>
      <Button testID="push-branch" accessibilityLabel={actionLabel() + " · " + status()}
        disabled={props.disabled || (!needsRefresh() && !canPushBranch(props.details))}
        onPress={() => { if (needsRefresh()) props.onRefresh(); else props.onPush(); }}
        class="h-6 shrink-0 flex-row items-center gap-1 rounded px-1.5 hover:bg-muted active:bg-accent disabled:opacity-35">
        <Icon name={needsRefresh() ? "refresh" : "push"} size={13} muted />
        <Text class="text-[11px] text-foreground">{actionLabel()}</Text>
      </Button>
    </View>
  </HintTarget>;
}
