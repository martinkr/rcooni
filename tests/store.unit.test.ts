/**
 * Unit tests for the store — the only stateful part of rcooni.
 *
 * store.ts reads DATA_DIR and PUBLIC_BASE_URL at module load, so we set them BEFORE the dynamic
 * import below. readStore/writeStore hit the file on every call (no in-memory cache), so clearing
 * issues.json between tests is enough to isolate them.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "rcooni-store-"));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_BASE_URL = "http://test.local/"; // trailing slash on purpose (should be stripped)

const storePath = join(dataDir, "issues.json");
const { createIssue, getIssue } = await import("../src/store");

const ticket = { title: "T", body: "B" };
const count = (): number => JSON.parse(readFileSync(storePath, "utf8")).length;

beforeEach(() => {
  if (existsSync(storePath)) rmSync(storePath);
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("createIssue", () => {
  it("assigns incrementing human-readable ids", () => {
    expect(createIssue(ticket).id).toBe("ISSUE-1");
    expect(createIssue(ticket).id).toBe("ISSUE-2");
  });

  it("stamps status, url (base slash stripped), and a valid ISO created_at", () => {
    const issue = createIssue(ticket);
    expect(issue.status).toBe("open");
    expect(issue.url).toBe("http://test.local/issues/ISSUE-1");
    expect(new Date(issue.created_at).toISOString()).toBe(issue.created_at);
  });

  it("persists to disk and is retrievable via getIssue", () => {
    createIssue(ticket);
    expect(existsSync(storePath)).toBe(true);
    expect(getIssue("ISSUE-1")?.title).toBe("T");
  });

  it("computes the next id from the max existing id, not the array length", () => {
    writeFileSync(
      storePath,
      JSON.stringify([
        { id: "ISSUE-5", title: "x", body: "y", status: "open", idempotency_key: null, url: "", created_at: "" },
      ]),
    );
    expect(createIssue(ticket).id).toBe("ISSUE-6");
  });
});

describe("idempotency", () => {
  it("returns the same issue for a repeated key and writes no duplicate", () => {
    const a = createIssue({ ...ticket, idempotency_key: "k1" });
    const b = createIssue({ ...ticket, idempotency_key: "k1" });
    expect(b.id).toBe(a.id);
    expect(count()).toBe(1);
  });

  it("creates distinct issues for distinct keys", () => {
    createIssue({ ...ticket, idempotency_key: "k1" });
    createIssue({ ...ticket, idempotency_key: "k2" });
    expect(count()).toBe(2);
  });

  it("always creates a new issue when no key is supplied", () => {
    createIssue(ticket);
    createIssue(ticket);
    expect(count()).toBe(2);
  });
});

describe("getIssue", () => {
  it("returns undefined for an unknown id", () => {
    expect(getIssue("ISSUE-999")).toBeUndefined();
  });
});

describe("resilience", () => {
  it("treats a corrupt store as empty and can still write a fresh issue", () => {
    writeFileSync(storePath, "{ not valid json");
    expect(getIssue("ISSUE-1")).toBeUndefined();
    expect(createIssue(ticket).id).toBe("ISSUE-1");
  });
});
