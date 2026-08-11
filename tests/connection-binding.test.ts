import { describe, expect, test } from "bun:test";
import { bindDefaultConnections, connectorProviderForNode } from "../src/lib/connectionBinding";
import type { WorkflowNode } from "../src/types";

function node(nodeType: WorkflowNode["data"]["nodeType"], config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: `${nodeType}-1`,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: { label: nodeType, description: "", nodeType, config },
  };
}

describe("connector account binding", () => {
  test("maps connector nodes to their account provider", () => {
    expect(connectorProviderForNode("googleDoc")).toBe("google");
    expect(connectorProviderForNode("gmailTrigger")).toBe("google");
    expect(connectorProviderForNode("slack")).toBe("slack");
    expect(connectorProviderForNode("ai")).toBeUndefined();
  });

  test("binds the first active compatible account and removes legacy demo mode", () => {
    const [result] = bindDefaultConnections(
      [node("googleDoc", { executionMode: "demo", connectionRef: "" })],
      [
        { externalId: "google:disabled", provider: "google", status: "disabled" },
        { externalId: "google:active", provider: "google", status: "active" },
      ],
    );
    expect(result.data.config).toEqual({ connectionRef: "google:active" });
  });

  test("preserves an explicit active account selection", () => {
    const original = node("googleDoc", { connectionRef: "google:second" });
    const [result] = bindDefaultConnections([original], [
      { externalId: "google:first", provider: "google", status: "active" },
      { externalId: "google:second", provider: "google", status: "active" },
    ]);
    expect(result).toBe(original);
  });

  test("does not bind a connection from the wrong provider", () => {
    const original = node("slack", { connectionRef: "" });
    const [result] = bindDefaultConnections([original], [
      { externalId: "google:active", provider: "google", status: "active" },
    ]);
    expect(result.data.config.connectionRef).toBe("");
  });
});
