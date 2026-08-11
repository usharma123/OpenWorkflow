import type { RunStepSummary, WorkflowEdge, WorkflowNode, WorkflowNodeType } from "../types";

export interface MappingField {
  path: string;
  label: string;
  preview: string;
}

export interface MappingSource {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  output: unknown;
  fields: MappingField[];
  pinned?: boolean;
}

export interface MappingTarget {
  key: string;
  label: string;
  multiline: boolean;
}

const targetsByType: Partial<Record<WorkflowNodeType, MappingTarget[]>> = {
  ai: [{ key: "prompt", label: "Instructions", multiline: true }],
  googleDoc: [{ key: "title", label: "Document title", multiline: false }],
  slack: [{ key: "message", label: "Message", multiline: true }],
  http: [
    { key: "url", label: "HTTPS URL", multiline: false },
    { key: "headers", label: "Headers", multiline: true },
    { key: "body", label: "Body", multiline: true },
  ],
  transform: [{ key: "template", label: "Template", multiline: true }],
};

const unsafePathKeys = new Set(["__proto__", "prototype", "constructor"]);
const safePathKey = /^[A-Za-z0-9_-]+$/;

export function mappingTargetsFor(nodeType: WorkflowNodeType): MappingTarget[] {
  return targetsByType[nodeType] ?? [];
}

export function upstreamNodeIds(nodeId: string, edges: WorkflowEdge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }

  const upstream = new Set<string>();
  const pending = [...(incoming.get(nodeId) ?? [])];
  while (pending.length) {
    const source = pending.pop()!;
    if (upstream.has(source)) continue;
    upstream.add(source);
    pending.push(...(incoming.get(source) ?? []));
  }
  return upstream;
}

function previewValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const count = Object.keys(value).length;
    return `${count} field${count === 1 ? "" : "s"}`;
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const text = typeof value === "string" ? value : String(value);
  return text.length > 72 ? `${text.slice(0, 69)}…` : text;
}

export function flattenMappingFields(output: unknown, limit = 80): MappingField[] {
  const fields: MappingField[] = [];
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number) => {
    if (fields.length >= limit) return;
    fields.push({
      path,
      label: path || "Entire output",
      preview: previewValue(value),
    });
    if (!value || typeof value !== "object" || depth >= 6 || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      if (value.length) visit(value[0], path ? `${path}.0` : "0", depth + 1);
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (unsafePathKeys.has(key) || !safePathKey.test(key)) continue;
      visit(child, path ? `${path}.${key}` : key, depth + 1);
      if (fields.length >= limit) return;
    }
  };

  visit(output, "", 0);
  return fields;
}

export function mappingSourcesForNode(
  nodeId: string,
  edges: WorkflowEdge[],
  steps: RunStepSummary[] = [],
  nodes: WorkflowNode[] = [],
): MappingSource[] {
  const upstream = upstreamNodeIds(nodeId, edges);
  const latestByNode = new Map<string, RunStepSummary>();
  for (const step of steps) {
    if (upstream.has(step.nodeId) && step.status === "completed" && step.output !== undefined) {
      latestByNode.set(step.nodeId, step);
    }
  }

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const sources = new Map<string, MappingSource>();
  for (const step of latestByNode.values()) {
    sources.set(step.nodeId, {
      nodeId: step.nodeId,
      nodeLabel: step.nodeLabel,
      nodeType: step.nodeType,
      output: step.output,
      fields: flattenMappingFields(step.output),
    });
  }
  for (const node of nodes) {
    if (!upstream.has(node.id) || !Object.prototype.hasOwnProperty.call(node.data.config, "pinnedOutput")) continue;
    const output = node.data.config.pinnedOutput;
    sources.set(node.id, {
      nodeId: node.id,
      nodeLabel: node.data.label,
      nodeType: node.data.nodeType,
      output,
      fields: flattenMappingFields(output),
      pinned: true,
    });
  }
  return [...sources.values()].sort(
    (left, right) => (nodeOrder.get(left.nodeId) ?? 0) - (nodeOrder.get(right.nodeId) ?? 0),
  );
}

export function mappingExpression(nodeId: string, path: string): string {
  return `{{ steps.${nodeId}${path ? `.${path}` : ""} }}`;
}

export function appendMappingExpression(current: string, expression: string, multiline: boolean): string {
  if (!current) return expression;
  return `${current}${multiline ? "\n" : " "}${expression}`;
}
