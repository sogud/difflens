import type { RepositoryTab } from "./ui-types";

export type HistorySearchField = "message" | "author" | "id";
export interface HistoryNavigation {
  query: string;
  field: HistorySearchField;
  tipId: string | null;
  offset: number;
  index: number;
  branch: string;
}
export interface WorkingSelection { path: string; staged: boolean }
export interface RepositorySession {
  tab: RepositoryTab;
  commitMessage: string;
  branchName: string;
  workingFile: WorkingSelection | null;
  previewPath: string | null;
  commitId: string | null;
  commitFilePath: string | null;
  history: HistoryNavigation;
  updatedAt: number;
}
export type RepositorySessions = Record<string, RepositorySession>;
export const SESSION_STORAGE_KEY = "difflens.repository-sessions.v1";
const MAX_SESSIONS = 20;

export function freshHistory(branch = ""): HistoryNavigation {
  return { query: "", field: "message", tipId: null, offset: 0, index: 0, branch };
}
export function freshSession(): RepositorySession {
  return { tab: "changes", commitMessage: "", branchName: "", workingFile: null, previewPath: null, commitId: null, commitFilePath: null, history: freshHistory(), updatedAt: 0 };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 8192);
}
function commitId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value));
}
function navigation(value: unknown): value is HistoryNavigation {
  return record(value) && typeof value.query === "string" && value.query.length <= 512 &&
    (value.field === "message" || value.field === "author" || value.field === "id") && commitId(value.tipId) &&
    typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= 0xffffffff &&
    typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0 && value.index < 50 &&
    typeof value.branch === "string" && value.branch.length <= 1024;
}
function session(value: unknown): value is RepositorySession {
  if (!record(value) || !["changes", "files", "history"].includes(String(value.tab))) return false;
  if (typeof value.commitMessage !== "string" || value.commitMessage.length > 65536 ||
      typeof value.branchName !== "string" || value.branchName.length > 1024 ||
      !nullableText(value.previewPath) || !nullableText(value.commitFilePath) || !commitId(value.commitId) ||
      !navigation(value.history) || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return false;
  return value.workingFile === null || (record(value.workingFile) && typeof value.workingFile.path === "string" &&
    value.workingFile.path.length <= 8192 && typeof value.workingFile.staged === "boolean");
}

export function readRepositorySessions(serialized: string | null): RepositorySessions {
  if (serialized === null) return {};
  const value: unknown = JSON.parse(serialized);
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error("The saved reading state is invalid.");
  }
  const result: RepositorySessions = {};
  for (const entry of value.entries.slice(0, MAX_SESSIONS)) {
    if (!record(entry) || typeof entry.path !== "string" || !entry.path.startsWith("/") ||
        entry.path.length > 8192 || !session(entry.session)) {
      throw new Error("The saved reading state is invalid.");
    }
    result[entry.path] = entry.session;
  }
  return result;
}

export function rememberSession(sessions: RepositorySessions, path: string, value: RepositorySession): void {
  sessions[path] = { ...value, updatedAt: Date.now() };
  const paths = Object.keys(sessions).sort((a, b) => sessions[b].updatedAt - sessions[a].updatedAt);
  for (const old of paths.slice(MAX_SESSIONS)) delete sessions[old];
}

export function serializeRepositorySessions(sessions: RepositorySessions): string {
  const paths = Object.keys(sessions).sort((a, b) => sessions[b].updatedAt - sessions[a].updatedAt);
  for (const path of paths.slice(0, MAX_SESSIONS)) {
    if (!session(sessions[path])) throw new Error("Reading state is too large or invalid to save.");
  }
  return JSON.stringify({ version: 1, entries: paths.slice(0, MAX_SESSIONS).map((path) => ({ path, session: sessions[path] })) });
}
