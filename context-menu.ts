import { Clipboard } from "nsh";
import { AlertDialog } from "nsh/base";
import { errorMessage } from "./diagnostics";
import { t } from "./i18n";

export function copyText(text: string) {
  void Clipboard.writeText(text).catch((cause: unknown) => {
    void AlertDialog.show({
      title: t("Could not copy"), description: errorMessage(cause),
      actions: [{ id: "done", label: t("Done") }],
    });
  });
}
