import type { Edge, Node } from "@xyflow/react";

export type WorkflowNodeType =
  | "manualTrigger"
  | "webhookTrigger"
  | "scheduleTrigger"
  | "gmailTrigger"
  | "gmailEventTrigger"
  | "calendarTrigger"
  | "driveTrigger"
  | "sheetsTrigger"
  | "ai"
  | "webSearch"
  | "googleDoc"
  | "gmailSend"
  | "calendarEvent"
  | "sheetsAppend"
  | "driveUpload"
  | "slack"
  | "http"
  | "condition"
  | "transform"
  | "forEach"
  | "merge"
  | "delay"
  | "approval"
  | "daytonaSandbox"
  | "code"
  | "shell"
  | "git"
  | "output";

export type NodeCategory = "Triggers" | "AI" | "Apps" | "Logic" | "Compute";

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  nodeType: WorkflowNodeType;
  config: Record<string, unknown>;
  status?: "idle" | "running" | "waiting" | "success" | "error";
}

export type WorkflowNode = Node<WorkflowNodeData, "workflow" | "sandbox">;
export type WorkflowEdge = Edge;

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrentRuns: number;
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
  explanation?: string;
}

export type RunPlanStepStatus = "pending" | "active" | "done" | "skipped";

export interface RunPlanStep {
  title: string;
  status: RunPlanStepStatus;
}

export interface RunStepPlan {
  steps: RunPlanStep[];
  status: "proposed" | "approved" | "rejected";
  note?: string;
}

/** One agent tool call, streamed while the step runs and persisted in its output. */
export interface RunToolTraceEntry {
  tool?: string;
  summary: string;
  ok: boolean;
  stepIndex?: number;
  stepStatus?: string;
}

export interface RunStepSummary {
  id: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: "running" | "waiting" | "completed" | "failed" | "skipped";
  startedAt: number;
  completedAt?: number;
  partialOutput?: string;
  partialToolTrace?: RunToolTraceEntry[];
  output?: unknown;
  error?: string;
  plan?: RunStepPlan;
}

export interface PendingApproval {
  runId?: string;
  backendRunId?: import("../convex/_generated/dataModel").Id<"workflowRuns">;
  nodeId: string;
  title: string;
  prompt: string;
  input?: unknown;
}

export interface PendingPlanReview {
  backendRunId?: import("../convex/_generated/dataModel").Id<"workflowRuns">;
  nodeId: string;
  title: string;
  steps: string[];
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
  steps?: RunStepSummary[];
}

export interface NodeCatalogItem {
  type: WorkflowNodeType;
  label: string;
  description: string;
  category: NodeCategory;
  defaultConfig: Record<string, unknown>;
  outcome: string;
  setup?: "none" | "connection";
  runtime?: "daytona";
  /** Hide from the primary palette; still executable for legacy graphs. */
  hidden?: boolean;
}
