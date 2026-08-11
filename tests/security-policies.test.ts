import { describe, expect, test } from "bun:test";
import { applyApprovalDecision, hasRequiredScopes, ownerKeyFor, validateWorkflowGraph } from "../convex/policies";
import { GOOGLE_SCOPES, hasRequiredGoogleScopes } from "../src/lib/googleAuth";

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

  test("reuses an existing Clerk Google grant only when every required scope is present", () => {
    expect(hasRequiredGoogleScopes(GOOGLE_SCOPES.join(" "))).toBe(true);
    expect(hasRequiredGoogleScopes(GOOGLE_SCOPES.slice(0, 2).join(" "))).toBe(false);
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

describe("saved workflow graph validation", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];

  test("accepts a valid directed acyclic graph", () => {
    expect(() => validateWorkflowGraph(nodes, [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
    ])).not.toThrow();
  });

  test("rejects dangling, duplicate, and cyclic connections", () => {
    expect(() => validateWorkflowGraph(nodes, [{ source: "a", target: "missing" }])).toThrow("existing workflow steps");
    expect(() => validateWorkflowGraph(nodes, [
      { source: "a", target: "b" },
      { source: "a", target: "b" },
    ])).toThrow("Duplicate");
    expect(() => validateWorkflowGraph(nodes, [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" },
    ])).toThrow("loops");
  });

  test("requires sandbox operations to live inside a Daytona boundary", () => {
    const position = { x: 0, y: 0 };
    const config = {};
    const code = {
      id: "code",
      type: "workflow",
      position,
      data: { nodeType: "code", label: "Code", description: "", config },
    };
    expect(() => validateWorkflowGraph([code], [])).toThrow("inside a Daytona");
    expect(() => validateWorkflowGraph([
      {
        id: "sandbox",
        type: "sandbox",
        position,
        data: { nodeType: "daytonaSandbox", label: "Sandbox", description: "", config: { networkMode: "blocked" } },
      },
      { ...code, parentId: "sandbox" },
    ], [])).not.toThrow();
  });

  test("rejects unsafe Daytona domain allowlists", () => {
    expect(() => validateWorkflowGraph([{
      id: "sandbox",
      type: "sandbox",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "daytonaSandbox",
        label: "Sandbox",
        description: "",
        config: { networkMode: "allowlist", allowedDomains: "https://example.com/path" },
      },
    }], [])).toThrow("hostnames");
  });

  test("requires error outputs to be enabled before a recovery branch is connected", () => {
    const makeNode = (id: string, errorOutput: boolean) => ({
      id,
      type: "workflow",
      position: { x: 0, y: 0 },
      data: { nodeType: "http", label: id, description: "", config: { errorOutput } },
    });
    const target = {
      id: "recovery",
      type: "workflow",
      position: { x: 100, y: 0 },
      data: { nodeType: "transform", label: "Recovery", description: "", config: {} },
    };
    expect(() => validateWorkflowGraph([makeNode("request", false), target], [
      { source: "request", sourceHandle: "error", target: "recovery" },
    ])).toThrow("Enable the error output");
    expect(() => validateWorkflowGraph([makeNode("request", true), target], [
      { source: "request", sourceHandle: "error", target: "recovery" },
    ])).not.toThrow();
  });
});
