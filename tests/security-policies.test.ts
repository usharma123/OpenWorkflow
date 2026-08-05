import { describe, expect, test } from "bun:test";
import { applyApprovalDecision, hasRequiredScopes, ownerKeyFor } from "../convex/policies";

describe("tenant ownership", () => {
  test("users without an active organization have distinct boundaries", () => {
    expect(ownerKeyFor("user_a")).not.toBe(ownerKeyFor("user_b"));
  });

  test("active organizations are isolated from each other", () => {
    expect(ownerKeyFor("user_a", "org_a")).toBe("org:org_a");
    expect(ownerKeyFor("user_a", "org_a")).not.toBe(ownerKeyFor("user_a", "org_b"));
  });
});

describe("connector scopes", () => {
  test("requires every Google scope", () => {
    const required = ["gmail.readonly", "documents", "drive.file"];
    expect(hasRequiredScopes(["gmail.readonly", "documents"], required)).toBe(false);
    expect(hasRequiredScopes(required, required)).toBe(true);
  });

  test("accepts comma- and space-delimited provider scope values", () => {
    expect(hasRequiredScopes(["chat:write,channels:read"], ["chat:write"])).toBe(true);
    expect(hasRequiredScopes(["chat:write channels:read"], ["chat:write"])).toBe(true);
  });
});

describe("approval gate", () => {
  test("rejection fails closed", () => {
    expect(() => applyApprovalDecision({ documentUrl: "https://example.test" }, { approved: false, note: "Needs changes" }, 1)).toThrow("Needs changes");
  });

  test("approval records the decision before downstream delivery", () => {
    expect(applyApprovalDecision({ documentUrl: "https://example.test" }, { approved: true }, 123)).toEqual({
      documentUrl: "https://example.test",
      approval: { approved: true, decidedAt: 123 },
    });
  });
});
