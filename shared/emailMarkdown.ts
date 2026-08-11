import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  depth?: number;
  ordered?: boolean;
  checked?: boolean | null;
  children?: MarkdownNode[];
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? escapeHtml(url) : undefined;
  } catch {
    return undefined;
  }
}

function renderInline(node: MarkdownNode): string {
  const children = () => (node.children ?? []).map(renderInline).join("");
  switch (node.type) {
    case "text":
      return escapeHtml(node.value ?? "");
    case "inlineCode":
      return `<code style="background:#f1f3f5;border-radius:3px;padding:1px 4px;font-family:monospace">${escapeHtml(node.value ?? "")}</code>`;
    case "break":
      return "<br>";
    case "strong":
      return `<strong>${children()}</strong>`;
    case "emphasis":
      return `<em>${children()}</em>`;
    case "delete":
      return `<del>${children()}</del>`;
    case "link": {
      const href = safeLink(node.url);
      return href ? `<a href="${href}" style="color:#2563eb">${children()}</a>` : children();
    }
    case "image": {
      const href = safeLink(node.url);
      const label = escapeHtml(node.alt?.trim() || "Image");
      return href ? `<a href="${href}" style="color:#2563eb">${label}</a>` : label;
    }
    default:
      return children();
  }
}

function renderTable(node: MarkdownNode): string {
  const rows = node.children ?? [];
  const rendered = rows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? "th" : "td";
    const cells = (row.children ?? []).map((cell) =>
      `<${tag} style="border:1px solid #d1d5db;padding:6px 8px;text-align:left">${(cell.children ?? []).map(renderInline).join("")}</${tag}>`,
    ).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table style="border-collapse:collapse;margin:12px 0">${rendered}</table>`;
}

function renderBlock(node: MarkdownNode): string {
  const inlineChildren = () => (node.children ?? []).map(renderInline).join("");
  const blockChildren = () => (node.children ?? []).map(renderBlock).join("");
  switch (node.type) {
    case "root":
      return blockChildren();
    case "heading": {
      const depth = Math.min(6, Math.max(1, node.depth ?? 1));
      return `<h${depth} style="margin:18px 0 8px">${inlineChildren()}</h${depth}>`;
    }
    case "paragraph":
      return `<p style="margin:0 0 12px;line-height:1.55">${inlineChildren()}</p>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      return `<${tag} style="margin:0 0 12px;padding-left:24px">${blockChildren()}</${tag}>`;
    }
    case "listItem": {
      const checkbox = node.checked === true ? "☑ " : node.checked === false ? "☐ " : "";
      return `<li style="margin:4px 0">${checkbox}${blockChildren()}</li>`;
    }
    case "blockquote":
      return `<blockquote style="border-left:3px solid #d1d5db;color:#4b5563;margin:12px 0;padding-left:12px">${blockChildren()}</blockquote>`;
    case "code":
      return `<pre style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;overflow:auto;padding:12px"><code>${escapeHtml(node.value ?? "")}</code></pre>`;
    case "thematicBreak":
      return '<hr style="border:0;border-top:1px solid #d1d5db;margin:18px 0">';
    case "table":
      return renderTable(node);
    case "html":
      return `<p style="margin:0 0 12px;line-height:1.55">${escapeHtml(node.value ?? "")}</p>`;
    default:
      return blockChildren();
  }
}

/** Render trusted workflow Markdown as escaped, email-safe HTML. */
export function markdownToEmailHtml(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  return [
    '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;font-size:14px;line-height:1.5">',
    renderBlock(tree),
    "</body></html>",
  ].join("");
}

/**
 * Older generated Gmail steps used {{input}}, which serializes a rich agent
 * result as JSON. Prefer its human-readable content field when it is present.
 */
export function preferEmailContentTemplate(template: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return template;
  if (typeof (input as Record<string, unknown>).content !== "string") return template;
  return template.replace(/\{\{\s*input\s*\}\}/g, "{{input.content}}");
}

export function buildGmailMessage(options: {
  to: string;
  encodedSubject: string;
  markdown: string;
  boundary: string;
}): string {
  const { to, encodedSubject, markdown, boundary } = options;
  const html = markdownToEmailHtml(markdown);
  return [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    markdown,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
