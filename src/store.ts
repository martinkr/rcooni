/**
 * store.ts — the entire persistence layer for rcooni.
 *
 * One entity (Issue), one JSON file. No database, no ORM — the store is small enough to read
 * whole and print in a chapter. Every read and write of the file lives here; nothing else in
 * the service touches disk. Mirrors Kamori's "one owned store" posture, but rcooni's store is
 * WRITTEN (create_issue), where Kamori's is only read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Issue {
  id: string; // human-readable, incrementing: ISSUE-1, ISSUE-2, ...
  title: string;
  body: string; // full Markdown (the validated bug ticket)
  status: "open"; // barebones surface: no transitions
  idempotency_key: string | null; // de-dupe key; null when the caller supplied none
  url: string; // the audit trail: where a human opens the filed issue
  created_at: string; // server-stamped ISO-8601
}

// Everything is overridable by env so the same image runs in Docker (/app/data, port 3120)
// or locally. PUBLIC_BASE_URL is what gets baked into each issue's `url` — the audit link.
const DATA_DIR = process.env.DATA_DIR ?? "/app/data";
const STORE_PATH = join(DATA_DIR, "issues.json");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3120").replace(/\/+$/, "");

function readStore(): Issue[] {
  if (!existsSync(STORE_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(parsed) ? (parsed as Issue[]) : [];
  } catch {
    // A corrupt store is a bug worth surfacing, but never a reason to crash the write path;
    // treat it as empty and let the next write rewrite a valid file.
    return [];
  }
}

function writeStore(issues: Issue[]): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(issues, null, 2) + "\n");
}

function nextId(issues: Issue[]): string {
  const max = issues.reduce((m, issue) => {
    const n = Number(issue.id.replace(/^ISSUE-/, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `ISSUE-${max + 1}`;
}

export function getIssue(id: string): Issue | undefined {
  return readStore().find((issue) => issue.id === id);
}

export interface CreateInput {
  title: string;
  body: string;
  idempotency_key?: string | null;
}

/**
 * Create EXACTLY ONE issue, or — when an idempotency_key matches an existing one — return that
 * issue unchanged. This is the only mutation in the whole service. The idempotency check makes a
 * retry safe: filing "ISSUE-N" twice with the same key never produces a duplicate.
 */
export function createIssue(input: CreateInput): Issue {
  const issues = readStore();
  const key = input.idempotency_key ?? null;

  if (key) {
    const existing = issues.find((issue) => issue.idempotency_key === key);
    if (existing) return existing; // de-dupe: same key => same issue, no second write
  }

  const id = nextId(issues);
  const issue: Issue = {
    id,
    title: input.title,
    body: input.body,
    status: "open",
    idempotency_key: key,
    url: `${PUBLIC_BASE_URL}/issues/${id}`,
    created_at: new Date().toISOString(),
  };
  issues.push(issue);
  writeStore(issues);
  return issue;
}
