/**
 * view.ts — the human-facing audit page.
 *
 * This is the "audit trail" end of the action contract: after the agent files an issue and the
 * tool returns a `url`, a human opens that URL here to see exactly what was filed. Deliberately
 * minimal — no markdown renderer, no client JS. The body is shown verbatim in a <pre> so what you
 * read is byte-for-byte what was stored.
 */
import type { Issue } from "./store.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; }
  .meta { color: #888; font-size: 13px; margin-bottom: 1.5rem; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #2d7d46; color: #fff; font-size: 12px; }
  pre { white-space: pre-wrap; word-wrap: break-word; background: rgba(128,128,128,0.12); padding: 1rem; border-radius: 8px; }
`;

export function renderIssue(issue: Issue): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(issue.id)} — ${escapeHtml(issue.title)}</title>
<style>${STYLE}</style>
<h1>${escapeHtml(issue.title)}</h1>
<p class="meta">
  <strong>${escapeHtml(issue.id)}</strong> ·
  <span class="badge">${escapeHtml(issue.status)}</span> ·
  filed ${escapeHtml(issue.created_at)}
</p>
<pre>${escapeHtml(issue.body)}</pre>`;
}

export function renderNotFound(id: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Not found — ${escapeHtml(id)}</title>
<style>${STYLE}</style>
<h1>No such issue</h1>
<p class="meta">There is no issue <strong>${escapeHtml(id)}</strong> in this tracker.</p>`;
}
