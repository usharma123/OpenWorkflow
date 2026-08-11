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

  test("resolves explicit outputs from earlier steps", () => {
    const outputs = {
      "gmail-a1b2": { messages: [{ subject: "Budget review" }], count: 1 },
    };
    expect(renderTemplate("Subject: {{ steps.gmail-a1b2.messages.0.subject }}", {}, outputs))
      .toBe("Subject: Budget review");
    expect(renderTemplate("{{ steps.gmail-a1b2.count }}", {}, outputs)).toBe("1");
    expect(renderTemplate("{{ steps.unknown.value }}", {}, outputs)).toBe('""');
  });

  test("does not traverse prototype keys", () => {
    expect(valueAtPath({}, "constructor.name")).toBeUndefined();
    expect(renderTemplate("{{ input.__proto__.polluted }}", {})).toBe('""');
  });
});
