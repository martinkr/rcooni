/**
 * server.ts — rcooni's two listeners, one process, one store.
 *
 *   :3121/mcp        streamable-HTTP MCP endpoint exposing the single WRITE tool, create_issue.
 *                    Mirrors Kamori's :3111/mcp exactly — same protocol, same transport — so the
 *                    harness registers rcooni the same way it registers Kamori. The difference is
 *                    consequence, not connection: this tool changes external state.
 *   :3120/issues/:id the human audit view (see view.ts) + /healthz readiness probe.
 *
 * IMPORTANT: rcooni does NOT enforce the approval gate. The two-layer gate from the spec
 * (a PreToolUse hook that denies unvalidated tickets + a canUseTool / human prompt) lives in the
 * CALLER — Claude Code's settings or the Agent SDK driver — not in this server. That is the
 * chapter's point: the server just offers the capability; the consequence control belongs to the
 * harness that decides whether to invoke it. See README.md.
 */
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createIssue, getIssue } from "./store.js";
import { renderIssue, renderNotFound } from "./view.js";

const MCP_PORT = Number(process.env.MCP_PORT ?? 3121);
const VIEW_PORT = Number(process.env.VIEW_PORT ?? 3120);

// --- The MCP server: one tool -----------------------------------------------------------------
// A fresh McpServer per request keeps the transport stateless (no session store) — the simplest
// correct shape for a service whose only job is to accept a single write and report the result.
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "rcooni", version: "0.1.0" });

  server.registerTool(
    "create_issue",
    {
      title: "Create issue",
      description:
        "WRITE — files EXACTLY ONE issue into the rcooni tracker and returns its id and audit URL. " +
        "This crosses external state (the consequence ladder's external-state rung): prefer stopping " +
        "for human approval before calling it, and on retry reuse idempotency_key so you never double-file.",
      inputSchema: {
        title: z.string().describe("The issue title — the ticket's level-1 title."),
        body: z.string().describe("The full issue body in Markdown — the validated bug ticket."),
        idempotency_key: z
          .string()
          .optional()
          .describe("Reuse on retry to avoid double-filing; a matching key returns the existing issue unchanged."),
      },
    },
    async ({ title, body, idempotency_key }) => {
      const issue = createIssue({ title, body, idempotency_key });
      // Return only the audit-relevant fields — the observation the workflow acts on.
      const result = { id: issue.id, url: issue.url, status: issue.status, created_at: issue.created_at };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

// --- Listener 1 (:3121): the MCP transport ----------------------------------------------------
const mcpApp = express();
mcpApp.use(express.json());

mcpApp.post("/mcp", async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Stateless mode has no server-initiated SSE stream and no session to terminate.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
mcpApp.get("/mcp", methodNotAllowed);
mcpApp.delete("/mcp", methodNotAllowed);

mcpApp.listen(MCP_PORT, () => console.log(`[rcooni] MCP endpoint on http://localhost:${MCP_PORT}/mcp`));

// --- Listener 2 (:3120): the human audit view + health ----------------------------------------
const viewApp = express();

viewApp.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

viewApp.get("/issues/:id", (req, res) => {
  const issue = getIssue(req.params.id);
  if (!issue) {
    res.status(404).type("html").send(renderNotFound(req.params.id));
    return;
  }
  res.type("html").send(renderIssue(issue));
});

viewApp.listen(VIEW_PORT, () => console.log(`[rcooni] audit view on http://localhost:${VIEW_PORT}/issues/:id`));
