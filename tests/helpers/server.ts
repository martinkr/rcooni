/**
 * Test harness: spawn rcooni as a real subprocess (via tsx) on given ports + data dir, wait for
 * its health probe, and drive it as a real MCP client. Used by the API and E2E suites so they
 * exercise the actual HTTP + MCP transport rather than importing internals.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverEntry = resolve(projectRoot, "src/server.ts");

export interface StartOptions {
  viewPort: number;
  mcpPort: number;
  dataDir: string;
}

export interface RcooniHandle {
  baseUrl: string; // http://localhost:<viewPort>
  mcpUrl: string; // http://localhost:<mcpPort>/mcp
  stop: () => Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startRcooni(opts: StartOptions): Promise<RcooniHandle> {
  const baseUrl = `http://localhost:${opts.viewPort}`;
  const mcpUrl = `http://localhost:${opts.mcpPort}/mcp`;

  // `node --import tsx src/server.ts` runs the TypeScript entry directly, no build step.
  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      VIEW_PORT: String(opts.viewPort),
      MCP_PORT: String(opts.mcpPort),
      DATA_DIR: opts.dataDir,
      PUBLIC_BASE_URL: baseUrl,
    },
    stdio: "pipe",
  });
  // Surface server errors only when debugging; otherwise keep test output clean.
  child.stderr?.on("data", (d) => {
    if (process.env.RCOONI_TEST_DEBUG) console.error(`[rcooni] ${String(d).trim()}`);
  });

  await waitForHealth(baseUrl, 15_000);
  return { baseUrl, mcpUrl, stop: () => stopChild(child) };
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await delay(150);
  }
  throw new Error(`rcooni did not become healthy at ${baseUrl} within ${timeoutMs}ms`);
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
    child.once("exit", () => resolveStop());
    child.kill("SIGTERM");
    const hardKill = setTimeout(() => child.kill("SIGKILL"), 3_000);
    hardKill.unref();
  });
}

export async function connectClient(mcpUrl: string): Promise<Client> {
  const client = new Client({ name: "rcooni-tests", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  return client;
}

/** create_issue returns its result as a single JSON text block; parse it. */
export function toolJson(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return JSON.parse(content[0].text ?? "null");
}
