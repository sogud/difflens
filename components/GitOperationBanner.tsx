import { Text, View } from "nsh";
import { Button } from "nsh/base";
import type { GitContext } from "difflens/native";
import { t } from "../i18n";
import { workflowRequest, type RequestWorkflow } from "../git-workflows";

export function GitOperationBanner(props: { context: GitContext | null; disabled: boolean; onRequest: RequestWorkflow }) {
  const visible = () => !!props.context?.operation || (props.context?.conflicts.length ?? 0) > 0;
  return <View>{visible() ? <View testID="git-operation-banner" class="gap-1.5 rounded bg-muted p-2">
    <Text class="text-[12px] font-medium text-foreground">{t("Git operation paused") + (props.context?.operation ? " · " + props.context.operation : "")}</Text>
    <Text class="text-[11px] text-muted-foreground">{t("Resolve conflicts, stage the resolved files, then continue.")}</Text>
    <Text class="text-[11px] text-warning">{t("Conflicts · {count}", {count:props.context?.conflicts.length ?? 0})}</Text>
    {props.context?.operation ? <View class="flex-row flex-wrap gap-1">
      <Button testID="git-continue" disabled={props.disabled || !!props.context?.conflicts.length} onPress={()=>props.onRequest(workflowRequest("continue"))} class="h-7 justify-center rounded px-2 hover:bg-accent disabled:opacity-40"><Text class="text-[11px] text-foreground">{t("Continue…")}</Text></Button>
      {props.context.operation !== "merge" ? <Button testID="git-skip" disabled={props.disabled} onPress={()=>props.onRequest(workflowRequest("skip"))} class="h-7 justify-center rounded px-2 hover:bg-accent"><Text class="text-[11px] text-foreground">{t("Skip commit…")}</Text></Button> : null}
      <Button testID="git-abort" disabled={props.disabled} onPress={()=>props.onRequest(workflowRequest("abort"))} class="h-7 justify-center rounded px-2 hover:bg-accent"><Text class="text-[11px] text-destructive">{t("Abort…")}</Text></Button>
    </View> : null}
  </View> : null}</View>;
}
