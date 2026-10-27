import { signal } from "nsh";
import { Diagnostics, type DiagnosticsInfo } from "difflens/native";

export type DiagnosticState =
  | { kind: "loading" }
  | { kind: "ready"; info: DiagnosticsInfo }
  | { kind: "failed"; error: string };

export const diagnosticState = signal<DiagnosticState>({ kind: "loading" });

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function loadDiagnostics() {
  try {
    const info = await Diagnostics.initialize(process.dataDir);
    diagnosticState.set({ kind: "ready", info });
  } catch (cause) {
    diagnosticState.set({ kind: "failed", error: errorMessage(cause) });
  }
}
