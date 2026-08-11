export type ExecutableGraphNode = {
  id: string;
  data: { nodeType: string };
};

export type ExecutableGraphEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type ExecutionPacket = {
  id: string;
  nodeId: string;
  port: string;
  value: unknown;
};

export type MergedExecutionInput = {
  items: unknown[];
  sources: Array<{ packetId: string; nodeId: string; port: string }>;
};

export type RunScopeMode = "full" | "single" | "through" | "resume";

export function nodeIdsForRunScope(
  nodes: ExecutableGraphNode[],
  edges: ExecutableGraphEdge[],
  mode: RunScopeMode,
  scopeNodeId?: string,
): Set<string> {
  if (mode === "full") return new Set(nodes.map((node) => node.id));
  if (!scopeNodeId || !nodes.some((node) => node.id === scopeNodeId)) {
    throw new Error("The step selected for this test run no longer exists.");
  }
  if (mode === "single") return new Set([scopeNodeId]);

  if (mode === "resume") {
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    }
    const included = new Set([scopeNodeId]);
    const pending = [...(outgoing.get(scopeNodeId) ?? [])];
    while (pending.length) {
      const nodeId = pending.pop()!;
      if (included.has(nodeId)) continue;
      included.add(nodeId);
      pending.push(...(outgoing.get(nodeId) ?? []));
    }
    return included;
  }

  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }
  const included = new Set([scopeNodeId]);
  const pending = [...(incoming.get(scopeNodeId) ?? [])];
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (included.has(nodeId)) continue;
    included.add(nodeId);
    pending.push(...(incoming.get(nodeId) ?? []));
  }
  return included;
}

export function topologicalNodes<NodeType extends ExecutableGraphNode>(
  nodes: NodeType[],
  edges: ExecutableGraphEdge[],
): NodeType[] {
  return topologicalBatches(nodes, edges).flat();
}

/**
 * Return dependency-safe execution waves. Nodes in the same wave have no
 * dependency on one another and can therefore be dispatched concurrently.
 * Input order is preserved inside each wave so workflow replay stays stable.
 */
export function topologicalBatches<NodeType extends ExecutableGraphNode>(
  nodes: NodeType[],
  edges: ExecutableGraphEdge[],
): NodeType[][] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  let wave = nodes.filter((node) => indegree.get(node.id) === 0);
  const batches: NodeType[][] = [];
  let visited = 0;
  while (wave.length) {
    batches.push(wave);
    visited += wave.length;
    const nextIds = new Set<string>();
    for (const node of wave) {
      for (const target of outgoing.get(node.id) ?? []) {
        const count = (indegree.get(target) ?? 1) - 1;
        indegree.set(target, count);
        if (count === 0) nextIds.add(target);
      }
    }
    wave = nodes.filter((node) => nextIds.has(node.id) && nodesById.has(node.id));
  }

  if (visited !== nodes.length) throw new Error("Workflow graphs cannot contain loops.");
  return batches;
}

function edgeCarriesPacket(edge: ExecutableGraphEdge, packet: ExecutionPacket) {
  if (packet.port === "error") return edge.sourceHandle === "error";
  return edge.sourceHandle !== "error" && (!edge.sourceHandle || edge.sourceHandle === packet.port);
}

export function inputPacketsForNode(
  nodeId: string,
  edges: ExecutableGraphEdge[],
  outputs: ReadonlyMap<string, ExecutionPacket>,
): { hasIncomingEdges: boolean; packets: ExecutionPacket[] } {
  const incoming = edges.filter((edge) => edge.target === nodeId);
  const packets = incoming.flatMap((edge) => {
    const packet = outputs.get(edge.source);
    return packet && edgeCarriesPacket(edge, packet) ? [packet] : [];
  });
  return { hasIncomingEdges: incoming.length > 0, packets };
}

export function inputValueForPackets(packets: ExecutionPacket[], rootValue: unknown): unknown {
  if (packets.length === 0) return rootValue;
  if (packets.length === 1) return packets[0].value;
  return {
    items: packets.map((packet) => packet.value),
    sources: packets.map((packet) => ({
      packetId: packet.id,
      nodeId: packet.nodeId,
      port: packet.port,
    })),
  } satisfies MergedExecutionInput;
}

export function packetForNodeOutput(
  node: ExecutableGraphNode,
  value: unknown,
  portOverride?: string,
): ExecutionPacket {
  const port = portOverride ?? (node.data.nodeType === "condition"
    ? String(Boolean((value as { passed?: boolean } | null)?.passed))
    : "default");
  return {
    id: `${node.id}:${port}:0`,
    nodeId: node.id,
    port,
    value,
  };
}

export type MergeMode = "append" | "combine" | "first";

export function mergeExecutionValues(input: unknown, mode: MergeMode): unknown {
  const values = input && typeof input === "object" && Array.isArray((input as { items?: unknown[] }).items)
    ? (input as { items: unknown[] }).items
    : [input];
  if (mode === "first") return values[0];
  if (mode === "combine") {
    const combined: Record<string, unknown> = {};
    for (const value of values) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(combined, value);
      }
    }
    return combined;
  }
  const items = values.flatMap((value) => Array.isArray(value) ? value : [value]);
  return { items, count: items.length };
}

export function terminalOutput(
  nodes: ExecutableGraphNode[],
  edges: ExecutableGraphEdge[],
  outputs: ReadonlyMap<string, ExecutionPacket>,
): unknown {
  const explicitOutputs = nodes.reduce<ExecutionPacket[]>((packets, node) => {
    if (node.data.nodeType === "output") {
      const packet = outputs.get(node.id);
      if (packet) packets.push(packet);
    }
    return packets;
  }, []);
  const terminalPackets = explicitOutputs.length
    ? explicitOutputs
    : nodes.flatMap((node) => {
        const packet = outputs.get(node.id);
        if (!packet) return [];
        const hasExecutedDownstream = edges.some(
          (edge) => edge.source === node.id && edgeCarriesPacket(edge, packet) && outputs.has(edge.target),
        );
        return hasExecutedDownstream ? [] : [packet];
      });

  if (terminalPackets.length === 0) return undefined;
  if (terminalPackets.length === 1) return terminalPackets[0].value;
  return {
    outputs: terminalPackets.map((packet) => ({
      nodeId: packet.nodeId,
      port: packet.port,
      value: packet.value,
    })),
  };
}
