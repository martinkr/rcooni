/**
 * Unit tests for the audit view. The body is attacker-controlled (it's whatever was filed), so the
 * one property that matters is HTML escaping — the page must never reflect raw markup.
 */
import { describe, expect, it } from "vitest";
import { renderIssue, renderNotFound } from "../src/view";
import type { Issue } from "../src/store";

const issue: Issue = {
  id: "ISSUE-1",
  title: "Title <x>",
  body: "line1\n<script>alert(1)</script>",
  status: "open",
  idempotency_key: null,
  url: "http://test.local/issues/ISSUE-1",
  created_at: "2026-08-19T00:00:00.000Z",
};

describe("renderIssue", () => {
  const html = renderIssue(issue);

  it("shows the id, status, and created_at", () => {
    expect(html).toContain("ISSUE-1");
    expect(html).toContain("open");
    expect(html).toContain("2026-08-19T00:00:00.000Z");
  });

  it("escapes HTML in the title and body (no raw markup reflected)", () => {
    expect(html).toContain("Title &lt;x&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("renderNotFound", () => {
  it("names the missing id and escapes it", () => {
    const html = renderNotFound("<b>ISSUE-9</b>");
    expect(html).toContain("No such issue");
    expect(html).toContain("&lt;b&gt;ISSUE-9&lt;/b&gt;");
    expect(html).not.toContain("<b>ISSUE-9</b>");
  });
});
