import { computed, Text, View, type YNode } from "nsh";
import { Button, Input } from "nsh/base";
import { t } from "../i18n";
import { accentClasses } from "../appearance";
import { Hint } from "./Hint";

export function CommitComposer(props: {
  repositoryPath: string;
  message: string;
  stagedCount: number;
  disabled: boolean;
  canCommit: boolean;
  onChange: (value: string) => void;
  onCommit: (repositoryPath: string) => void;
  onReady: (node: YNode, repositoryPath: string) => void;
}) {
  const reason = computed(() => {
    if (props.canCommit) return null;
    if (props.disabled) return t("Another operation is still running.");
    if (props.stagedCount === 0) return t("Stage files before committing.");
    if (!props.message.trim()) return t("Enter a commit message.");
    return null;
  });
  const hint = computed(() => t("Commit staged") + " (⌘↵)" + (reason() ? "\n" + reason() : ""));
  return <View testID="commit-composer" class="min-h-0 flex-1 gap-1.5 border-b border-border bg-surface-muted p-2">
    <Input ref={node => props.onReady(node, props.repositoryPath)} testID="commit-message" value={props.message} onChange={props.onChange}
      multiline submitBehavior="newline" disabled={props.disabled} placeholder={t("Commit message")} accessibilityLabel={t("Commit message")}
      class={"min-h-0 flex-1 rounded bg-subtle-input px-2 py-1.5 text-[12px] text-foreground focus:bg-background " + accentClasses().focus} />
    <View tooltip={<Hint text={hint()} />}>
      <Button testID="commit-staged" disabled={!props.canCommit} onPress={() => props.onCommit(props.repositoryPath)}
        accessibilityLabel={t("Commit staged") + (reason() ? " · " + reason() : "")}
        class={"h-7 w-full flex-row items-center justify-center gap-2 rounded disabled:opacity-35 " + accentClasses().fill}>
        <Text class={"text-[12px] " + accentClasses().foreground}>{t("Commit")}</Text>
        {props.stagedCount > 0 ? <Text class={"text-[11px] " + accentClasses().foreground}>{props.stagedCount}</Text> : null}
      </Button>
    </View>
  </View>;
}
