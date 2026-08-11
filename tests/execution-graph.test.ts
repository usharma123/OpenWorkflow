import { describe, expect, test } from "bun:test";
import {
  inputPacketsForNode,
  inputValueForPackets,
  packetForNodeOutput,
  nodeIdsForRunScope,
  terminalOutput,
  topologicalNodes,
  type ExecutionPacket,
} from "../shared/executionGraph";

const node = (id: string, nodeType = "transform") => ({ id, data: { nodeType } });

describe("port-aware workflow execution", () => {
  test("scopes a test run to one step or all of its ancestors", () => {
    const nodes = [node("a"), node("b"), node("c"), node("other")];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
    expect([...nodeIdsForRunScope(nodes, edges, "single", "c")]).toEqual(["c"]);
    expect([...nodeIdsForRunScope(nodes, edges, "through", "c")].sort()).toEqual(["a", "b", "c"]);
    expect(() => nodeIdsForRunScope(nodes, edges, "single", "missing")).toThrow("no longer exists");
  });
  test("keeps sibling branches on the output of their common parent", () => {
    const edges = [
      { source: "root", target: "left" },
      { source: "root", target: "right" },
    ];
    const root = packetForNodeOutput(node("root"), { parent: true });
    const outputs = new Map<string, ExecutionPacket>([["root", root]]);

    expect(inputValueForPackets(inputPacketsForNode("left", edges, outputs).packets, null)).toEqual({ parent: true });
    expect(inputValueForPackets(inputPacketsForNode("right", edges, outputs).packets, null)).toEqual({ parent: true });
  });

  test("routes condition packets only through the selected output port", () => {
    const edges = [
      { source: "condition", sourceHandle: "true", target: "yes" },
      { source: "condition", sourceHandle: "false", target: "no" },
    ];
    const packet = packetForNodeOutput(node("condition", "condition"), { passed: true });
    const outputs = new Map<string, ExecutionPacket>([["condition", packet]]);

    expect(inputPacketsForNode("yes", edges, outputs).packets).toHaveLength(1);
    expect(inputPacketsForNode("no", edges, outputs).packets).toHaveLength(0);
  });

  test("preserves both inputs and their provenance at a join", () => {
    const edges = [
      { source: "left", target: "join" },
      { source: "right", target: "join" },
    ];
    const outputs = new Map<string, ExecutionPacket>([
      ["left", packetForNodeOutput(node("left"), { side: "left" })],
      ["right", packetForNodeOutput(node("right"), { side: "right" })],
    ]);

    expect(inputValueForPackets(inputPacketsForNode("join", edges, outputs).packets, null)).toEqual({
      items: [{ side: "left" }, { side: "right" }],
      sources: [
        { packetId: "left:default:0", nodeId: "left", port: "default" },
        { packetId: "right:default:0", nodeId: "right", port: "default" },
      ],
    });
  });

  test("returns all executed terminal outputs instead of the last topological value", () => {
    const nodes = [node("root"), node("left"), node("right")];
    const edges = [
      { source: "root", target: "left" },
      { source: "root", target: "right" },
    ];
    const outputs = new Map<string, ExecutionPacket>([
      ["root", packetForNodeOutput(nodes[0], "root")],
      ["left", packetForNodeOutput(nodes[1], "left value")],
      ["right", packetForNodeOutput(nodes[2], "right value")],
    ]);

    expect(terminalOutput(nodes, edges, outputs)).toEqual({
      outputs: [
        { nodeId: "left", port: "default", value: "left value" },
        { nodeId: "right", port: "default", value: "right value" },
      ],
    });
  });

  test("rejects cycles", () => {
    expect(() => topologicalNodes([node("a"), node("b")], [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ])).toThrow("loops");
  });
});
