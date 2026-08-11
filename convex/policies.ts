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

type WorkflowGraphNode = {
  id?: unknown;
  type?: unknown;
  parentId?: unknown;
  position?: { x?: unknown; y?: unknown };
  data?: { nodeType?: unknown; label?: unknown; description?: unknown; config?: unknown };
};
type WorkflowGraphEdge = {
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
};

export function validateWorkflowGraph(nodes: WorkflowGraphNode[], edges: WorkflowGraphEdge[]) {
  const nodeIds = new Set<string>();
  const nodesById = new Map<string, WorkflowGraphNode>();
  const allowedTypes = new Set([
    "manualTrigger", "webhookTrigger", "scheduleTrigger", "gmailTrigger", "gmailEventTrigger",
    "calendarTrigger", "driveTrigger", "sheetsTrigger", "ai", "webSearch", "googleDoc",
    "gmailSend", "calendarEvent", "sheetsAppend", "driveUpload",
    "slack", "http", "condition", "transform", "forEach", "merge", "delay", "approval", "daytonaSandbox",
    "code", "shell", "git", "output",
  ]);
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !node.id) throw new Error("Every workflow step must have an ID.");
    if (nodeIds.has(node.id)) throw new Error("Workflow step IDs must be unique.");
    nodeIds.add(node.id);
    nodesById.set(node.id, node);
    if (node.data) {
      const { config, label, nodeType } = node.data;
      if (typeof nodeType !== "string" || !allowedTypes.has(nodeType)) {
        throw new Error("Every workflow step must use a supported type.");
      }
      if (typeof label !== "string" || !label.trim()) {
        throw new Error("Every workflow step must have a name.");
      }
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Every workflow step must have a configuration object.");
      }
      if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
        throw new Error("Every workflow step must have a valid canvas position.");
      }
    }
  }

  for (const node of nodes) {
    if (!node.data || typeof node.data.nodeType !== "string") continue;
    const { config: rawConfig, label, nodeType } = node.data;
    const isSandboxStep = ["code", "shell", "git"].includes(nodeType);
    if (isSandboxStep) {
      if (typeof node.parentId !== "string" || nodesById.get(node.parentId)?.data?.nodeType !== "daytonaSandbox") {
        throw new Error(`${label} must be placed inside a Daytona sandbox boundary.`);
      }
    } else if (node.parentId !== undefined) {
      throw new Error("Only Daytona Code, Shell, and Git steps can be placed inside a sandbox boundary.");
    }
    if (nodeType === "daytonaSandbox") {
      const config = rawConfig as Record<string, unknown>;
      const mode = String(config.networkMode ?? "blocked");
      if (!new Set(["blocked", "allowlist"]).has(mode)) throw new Error("Daytona network mode is invalid.");
      if (mode === "allowlist") {
        const domains = String(config.allowedDomains ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        if (domains.length === 0) throw new Error("Add at least one allowed domain or block sandbox networking.");
        if (domains.some((domain) => domain.includes("://") || domain.includes("/") || !/^(\*\.)?[a-z0-9.-]+$/i.test(domain))) {
          throw new Error("Daytona allowed domains must be comma-separated hostnames without URLs or paths.");
        }
      }
    }
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
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (sourceNode?.data?.nodeType === "daytonaSandbox" || targetNode?.data?.nodeType === "daytonaSandbox") {
      throw new Error("Connect the steps inside a Daytona boundary, not the boundary itself.");
    }
    if (sourceNode?.data?.nodeType === "condition" && !["true", "false"].includes(String(edge.sourceHandle))) {
      throw new Error("Condition connections must use the true or false output port.");
    }
    if (edge.sourceHandle === "error") {
      const config = sourceNode?.data?.config as Record<string, unknown> | undefined;
      if (config?.errorOutput !== true) throw new Error("Enable the error output before connecting a recovery branch.");
    } else if (edge.sourceHandle && sourceNode?.data?.nodeType !== "condition") {
      throw new Error("That workflow step does not provide the selected output port.");
    }

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
