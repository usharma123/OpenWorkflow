import { describe, expect, test } from "bun:test";
import { renderTemplate, valueAtPath } from "../convex/template";

describe("workflow templates", () => {
  test("reads nested values consistently", () => {
    const input = { document: { title: "Daily brief" } };
    expect(valueAtPath(input, "document.title")).toBe("Daily brief");
    expect(renderTemplate("Created {{ input.document.title }}", input)).toBe("Created Daily brief");
  });

  test("serializes non-string values", () => {
    expect(renderTemplate("{{input.count}}", { count: 3 })).toBe("3");
    expect(renderTemplate("{{input.missing}}", {})).toBe('""');
  });
});
