import { describe, expect, test } from "bun:test";
import { sheetRowChanges } from "../convex/googleTriggerPolicy";

describe("Google trigger polling", () => {
  test("baselines existing rows and emits only appended rows", () => {
    const initial = sheetRowChanges([
      ["Name", "Amount"],
      ["Acme", 10],
    ], []);
    expect(initial.events).toHaveLength(1);

    const next = sheetRowChanges([
      ["Name", "Amount"],
      ["Acme", 10],
      ["Beta", 20],
    ], initial.fingerprints);
    expect(next.events).toEqual([{
      key: expect.any(String),
      rowNumber: 3,
      row: { Name: "Beta", Amount: 20 },
      values: ["Beta", 20],
    }]);
  });

  test("distinguishes identical values appended on different rows", () => {
    const values = [["Name"], ["Same"], ["Same"]];
    const result = sheetRowChanges(values, []);
    expect(new Set(result.fingerprints).size).toBe(2);
  });
});
