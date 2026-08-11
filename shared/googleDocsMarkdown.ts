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

export type GoogleDocsRequest = Record<string, unknown>;
export interface GoogleDocsMarkdown { text: string; requests: GoogleDocsRequest[] }

type TextSpan = {
  start: number;
  end: number;
  style: Record<string, unknown>;
  fields: string;
};
type ParagraphSpan = TextSpan;
type BulletSpan = {
  start: number;
  end: number;
  preset: "BULLET_DISC_CIRCLE_SQUARE" | "NUMBERED_DECIMAL_ALPHA_ROMAN";
};

class DocsMarkdownBuilder {
  text = "";
  readonly textSpans: TextSpan[] = [];
  readonly paragraphSpans: ParagraphSpan[] = [];
  readonly bulletSpans: BulletSpan[] = [];

  append(value: string) { this.text += value; }
  ensureNewline() { if (!this.text.endsWith("\n")) this.append("\n"); }

  addTextStyle(start: number, end: number, style: Record<string, unknown>, fields: string) {
    if (end > start) this.textSpans.push({ start, end, style, fields });
  }

  renderInline(node: MarkdownNode) {
    const start = this.text.length;
    switch (node.type) {
      case "text":
        this.append(node.value ?? "");
        return;
      case "inlineCode":
        this.append(node.value ?? "");
        this.addTextStyle(start, this.text.length, {
          weightedFontFamily: { fontFamily: "Roboto Mono" },
          backgroundColor: { color: { rgbColor: { red: 0.94, green: 0.95, blue: 0.97 } } },
        }, "weightedFontFamily,backgroundColor");
        return;
      case "break":
        this.append("\n");
        return;
      case "image": {
        this.append(node.alt?.trim() || "Image");
        if (node.url) this.addTextStyle(start, this.text.length, { link: { url: node.url } }, "link");
        return;
      }
    }

    for (const child of node.children ?? []) this.renderInline(child);
    const end = this.text.length;
    if (node.type === "strong") this.addTextStyle(start, end, { bold: true }, "bold");
    if (node.type === "emphasis") this.addTextStyle(start, end, { italic: true }, "italic");
    if (node.type === "delete") this.addTextStyle(start, end, { strikethrough: true }, "strikethrough");
    if (node.type === "link" && node.url) this.addTextStyle(start, end, { link: { url: node.url } }, "link");
  }

  renderParagraph(node: MarkdownNode) {
    for (const child of node.children ?? []) this.renderInline(child);
    this.ensureNewline();
  }

  renderListItem(node: MarkdownNode, ordered: boolean) {
    const start = this.text.length;
    const children = node.children ?? [];
    const firstParagraph = children.find((child) => child.type === "paragraph");
    if (node.checked !== null && node.checked !== undefined) this.append(node.checked ? "☑ " : "☐ ");
    if (firstParagraph) this.renderParagraph(firstParagraph);
    else this.ensureNewline();
    const end = this.text.length;
    if (node.checked === null || node.checked === undefined) {
      this.bulletSpans.push({
        start,
        end,
        preset: ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
      });
    }
    for (const child of children) if (child !== firstParagraph) this.renderBlock(child);
  }

  renderTable(node: MarkdownNode) {
    (node.children ?? []).forEach((row, rowIndex) => {
      const rowStart = this.text.length;
      (row.children ?? []).forEach((cell, cellIndex) => {
        if (cellIndex > 0) this.append("\t");
        for (const child of cell.children ?? []) this.renderInline(child);
      });
      this.ensureNewline();
      if (rowIndex === 0) this.addTextStyle(rowStart, this.text.length - 1, { bold: true }, "bold");
    });
  }

  renderBlock(node: MarkdownNode) {
    const start = this.text.length;
    switch (node.type) {
      case "heading": {
        for (const child of node.children ?? []) this.renderInline(child);
        this.ensureNewline();
        const depth = Math.min(6, Math.max(1, node.depth ?? 1));
        this.paragraphSpans.push({
          start,
          end: this.text.length,
          style: {
            namedStyleType: `HEADING_${depth}`,
            spaceAbove: { magnitude: 12, unit: "PT" },
            spaceBelow: { magnitude: 6, unit: "PT" },
          },
          fields: "namedStyleType,spaceAbove,spaceBelow",
        });
        return;
      }
      case "paragraph":
        this.renderParagraph(node);
        return;
      case "list":
        for (const child of node.children ?? []) this.renderListItem(child, node.ordered === true);
        return;
      case "blockquote":
        for (const child of node.children ?? []) this.renderBlock(child);
        this.addTextStyle(start, this.text.length, {
          italic: true,
          foregroundColor: { color: { rgbColor: { red: 0.3, green: 0.33, blue: 0.38 } } },
        }, "italic,foregroundColor");
        this.paragraphSpans.push({
          start,
          end: this.text.length,
          style: {
            indentStart: { magnitude: 18, unit: "PT" },
            spaceAbove: { magnitude: 6, unit: "PT" },
            spaceBelow: { magnitude: 6, unit: "PT" },
          },
          fields: "indentStart,spaceAbove,spaceBelow",
        });
        return;
      case "code":
        this.append(node.value ?? "");
        this.ensureNewline();
        this.addTextStyle(start, this.text.length, {
          weightedFontFamily: { fontFamily: "Roboto Mono" },
          backgroundColor: { color: { rgbColor: { red: 0.94, green: 0.95, blue: 0.97 } } },
        }, "weightedFontFamily,backgroundColor");
        return;
      case "thematicBreak":
        this.append("────────────────────────────────\n");
        this.addTextStyle(start, this.text.length - 1, {
          foregroundColor: { color: { rgbColor: { red: 0.72, green: 0.74, blue: 0.78 } } },
        }, "foregroundColor");
        return;
      case "table":
        this.renderTable(node);
        return;
      case "html":
        this.append((node.value ?? "").replace(/<[^>]*>/g, ""));
        this.ensureNewline();
        return;
      default:
        for (const child of node.children ?? []) this.renderBlock(child);
    }
  }
}

export function markdownToGoogleDocs(markdown: string): GoogleDocsMarkdown {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  const builder = new DocsMarkdownBuilder();
  for (const child of tree.children ?? []) builder.renderBlock(child);
  const text = builder.text.trimEnd() + "\n";
  const endIndex = 1 + text.length;
  const requests: GoogleDocsRequest[] = [
    { insertText: { location: { index: 1 }, text } },
    {
      updateTextStyle: {
        range: { startIndex: 1, endIndex },
        textStyle: {
          weightedFontFamily: { fontFamily: "Arial" },
          fontSize: { magnitude: 11, unit: "PT" },
        },
        fields: "weightedFontFamily,fontSize",
      },
    },
    ...builder.paragraphSpans.map((span) => ({
      updateParagraphStyle: {
        range: { startIndex: 1 + span.start, endIndex: Math.min(endIndex, 1 + span.end) },
        paragraphStyle: span.style,
        fields: span.fields,
      },
    })),
    ...builder.textSpans.map((span) => ({
      updateTextStyle: {
        range: { startIndex: 1 + span.start, endIndex: Math.min(endIndex, 1 + span.end) },
        textStyle: span.style,
        fields: span.fields,
      },
    })),
    ...builder.bulletSpans.map((span) => ({
      createParagraphBullets: {
        range: { startIndex: 1 + span.start, endIndex: Math.min(endIndex, 1 + span.end) },
        bulletPreset: span.preset,
      },
    })),
  ];
  return { text, requests };
}
