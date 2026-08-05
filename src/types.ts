import type { Edge, Node } from "@xyflow/react";

export type WorkflowNodeType =
  | "manualTrigger"
  | "webhookTrigger"
  | "scheduleTrigger"
  | "ai"
  | "http"
  | "condition"
  | "transform"
  | "delay"
  | "approval"
  | "output";

export type NodeCategory = "Triggers" | "AI" | "Logic" | "Actions";

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  nodeType: WorkflowNodeType;
  config: Record<string, unknown>;
  status?: "idle" | "running" | "success" | "error";
}

export type WorkflowNode = Node<WorkflowNodeData, "workflow">;
export type WorkflowEdge = Edge;

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  updatedAt: number;
}

export interface RunLog {
  id: string;
  nodeId?: string;
  level: "info" | "success" | "error";
  message: string;
  timestamp: number;
  output?: unknown;
}

export interface WorkflowRun {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "waiting";
  startedAt: number;
  completedAt?: number;
  output?: unknown;
  error?: string;
  logs: RunLog[];
}

export interface LatestRunResult {
  id?: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  output?: unknown;
  error?: string;
}

export interface NodeCatalogItem {
  type: WorkflowNodeType;
  label: string;
  description: string;
  category: NodeCategory;
  accent: string;
  defaultConfig: Record<string, unknown>;
}
