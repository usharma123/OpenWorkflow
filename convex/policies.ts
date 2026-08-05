export function ownerKeyFor(userId: string, organizationId?: string) {
  return organizationId ? `org:${organizationId}` : `user:${userId}`;
}

export function hasRequiredScopes(granted: string[], required: string[]) {
  const normalized = new Set(granted.flatMap((scope) => scope.split(/[ ,]/)).filter(Boolean));
  return required.every((scope) => normalized.has(scope));
}

export function applyApprovalDecision(input: unknown, approval: { approved: boolean; note?: string }, decidedAt: number) {
  if (!approval.approved) throw new Error(approval.note || "Workflow was rejected.");
  return {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : { value: input }),
    approval: { ...approval, decidedAt },
  };
}

type WorkflowGraphNode = { id?: unknown };
type WorkflowGraphEdge = {
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
};

export function validateWorkflowGraph(nodes: WorkflowGraphNode[], edges: WorkflowGraphEdge[]) {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !node.id) throw new Error("Every workflow step must have an ID.");
    if (nodeIds.has(node.id)) throw new Error("Workflow step IDs must be unique.");
    nodeIds.add(node.id);
  }

  const connections = new Set<string>();
  const indegree = new Map([...nodeIds].map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string") {
      throw new Error("Every connection must have a source and target.");
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error("Every connection must point to existing workflow steps.");
    }
    if (edge.source === edge.target) throw new Error("A workflow step cannot connect to itself.");

    const connectionKey = JSON.stringify([
      edge.source,
      edge.target,
      edge.sourceHandle ?? null,
      edge.targetHandle ?? null,
    ]);
    if (connections.has(connectionKey)) throw new Error("Duplicate workflow connections are not allowed.");
    connections.add(connectionKey);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const pending = [...nodeIds].filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (pending.length) {
    const id = pending.shift()!;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const nextIndegree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) pending.push(target);
    }
  }
  if (visited !== nodeIds.size) throw new Error("Workflow graphs cannot contain loops.");
}
