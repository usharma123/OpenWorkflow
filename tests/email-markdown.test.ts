import { describe, expect, test } from "bun:test";
import {
  buildGmailMessage,
  markdownToEmailHtml,
  preferEmailContentTemplate,
} from "../shared/emailMarkdown";

describe("Gmail message formatting", () => {
  test("upgrades legacy whole-input templates when readable content exists", () => {
    const input = { content: "# Brief", citations: [{ url: "https://example.com" }] };
    expect(preferEmailContentTemplate("Approved:\n\n{{input}}", input))
      .toBe("Approved:\n\n{{input.content}}");
    expect(preferEmailContentTemplate("Count: {{input.count}}", input))
      .toBe("Count: {{input.count}}");
    expect(preferEmailContentTemplate("Raw: {{input}}", { count: 2 }))
      .toBe("Raw: {{input}}");
  });

  test("renders common Markdown and escapes embedded HTML", () => {
    const html = markdownToEmailHtml([
      "## Microsoft briefing",
      "",
      "A **strong** quarter with [primary sources](https://example.com/report).",
      "",
      "- Azure growth",
      "- AI investment",
      "",
      "<script>alert('no')</script>",
    ].join("\n"));

    expect(html).toContain("<h2");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain("<ul");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("builds multipart email with plain-text and HTML alternatives", () => {
    const message = buildGmailMessage({
      to: "reader@example.com",
      encodedSubject: "Stock briefing",
      markdown: "## Brief\n\n**Revenue:** $81.3B",
      boundary: "test-boundary",
    });

    expect(message).toContain('Content-Type: multipart/alternative; boundary="test-boundary"');
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(message).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(message).toContain("## Brief");
    expect(message).toContain("<h2");
    expect(message).toContain("--test-boundary--");
  });
});
