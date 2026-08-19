/**
 * E2E tests: drive the whole workflow the way an agent + human would, against a real server
 * (ports 4130/4131). File via MCP, open the returned audit URL, retry idempotently, and confirm a
 * filed issue survives a server restart on the same data dir.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectClient, startRcooni, toolJson, type RcooniHandle } from "./helpers/server";

const ports = { viewPort: 4130, mcpPort: 4131 };
let dataDir: string;
let rc: RcooniHandle;

const body =
  "# Task text vanishes after reload\n\n## Summary\nTasks disappear.\n\n## Expected behavior\n" +
  "Completed tasks persist.\n\n## Evidence\ntrace trc_51y8un: storage_read read_key=tasks raw_count=0\n\n" +
  "## Open questions\nWhy does the read key differ from the write key?\n";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "rcooni-e2e-"));
  rc = await startRcooni({ ...ports, dataDir });
});
afterAll(async () => {
  await rc.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("file -> audit trail", () => {
  it("files an issue and the returned url renders its body", async () => {
    const client = await connectClient(rc.mcpUrl);
    const { id, url } = toolJson(
      await client.callTool({ name: "create_issue", arguments: { title: "Task text vanishes after reload", body } }),
    );
    await client.close();

    expect(url).toBe(`${rc.baseUrl}/issues/${id}`);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Task text vanishes after reload");
    expect(html).toContain("trc_51y8un"); // the evidence made it into the filed body
  });
});

describe("idempotent retry", () => {
  it("a repeated key never double-files; a new key files a new issue", async () => {
    const client = await connectClient(rc.mcpUrl);
    const first = toolJson(await client.callTool({ name: "create_issue", arguments: { title: "x", body, idempotency_key: "e2e-key" } }));
    const retry = toolJson(await client.callTool({ name: "create_issue", arguments: { title: "x", body, idempotency_key: "e2e-key" } }));
    const fresh = toolJson(await client.callTool({ name: "create_issue", arguments: { title: "x", body, idempotency_key: "e2e-key-2" } }));
    await client.close();

    expect(retry.id).toBe(first.id);
    expect(fresh.id).not.toBe(first.id);
  });
});

describe("persistence across restart", () => {
  it("a filed issue survives a server restart on the same data dir", async () => {
    const client = await connectClient(rc.mcpUrl);
    const { id, url } = toolJson(
      await client.callTool({ name: "create_issue", arguments: { title: "Persist me", body } }),
    );
    await client.close();

    await rc.stop();
    await delay(300); // let the port free before rebinding
    rc = await startRcooni({ ...ports, dataDir });

    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Persist me");
    expect(url).toContain(id);
  });
});
