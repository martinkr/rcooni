/**
 * API tests: exercise each endpoint contract against a real running server (ports 4120/4121).
 * These check the interface shape — status codes, the single MCP tool, its result payload, and
 * input rejection — not the end-to-end workflow (that's e2e.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectClient, startRcooni, toolJson, type RcooniHandle } from "./helpers/server";

let rc: RcooniHandle;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "rcooni-api-"));
  rc = await startRcooni({ viewPort: 4120, mcpPort: 4121, dataDir });
});
afterAll(async () => {
  await rc.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("HTTP view endpoints", () => {
  it("GET /healthz -> 200 {status:ok}", async () => {
    const res = await fetch(`${rc.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /issues/:id for an unknown id -> 404 HTML", async () => {
    const res = await fetch(`${rc.baseUrl}/issues/ISSUE-404`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("No such issue");
  });
});

describe("MCP endpoint", () => {
  it("GET /mcp -> 405 (stateless: no server-initiated stream)", async () => {
    const res = await fetch(rc.mcpUrl, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("exposes exactly one tool: create_issue", async () => {
    const client = await connectClient(rc.mcpUrl);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(["create_issue"]);
    await client.close();
  });

  it("create_issue returns id/url/status/created_at with url on the configured base", async () => {
    const client = await connectClient(rc.mcpUrl);
    const payload = toolJson(await client.callTool({ name: "create_issue", arguments: { title: "A", body: "B" } }));
    await client.close();

    expect(payload.id).toMatch(/^ISSUE-\d+$/);
    expect(payload.status).toBe("open");
    expect(payload.created_at).toEqual(expect.any(String));
    expect(payload.url).toBe(`${rc.baseUrl}/issues/${payload.id}`);
  });

  it("rejects create_issue when a required field is missing", async () => {
    const client = await connectClient(rc.mcpUrl);
    // A schema failure may surface either as a thrown error or as an isError result — accept both,
    // but require that one of them happened (the write must not silently succeed).
    let rejected = false;
    try {
      const res = await client.callTool({ name: "create_issue", arguments: { title: "no body" } as any });
      rejected = (res as { isError?: boolean }).isError === true;
    } catch {
      rejected = true;
    }
    await client.close();
    expect(rejected).toBe(true);
  });
});
