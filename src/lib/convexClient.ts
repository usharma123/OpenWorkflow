import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { WorkflowDefinition } from "../types";

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();

export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : undefined;

export type StoredWorkflow = Omit<WorkflowDefinition, "id"> & {
  _id: string;
  _creationTime: number;
  externalId: string;
};

export interface StoredStepRun {
  _id: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: "running" | "waiting" | "completed" | "failed" | "skipped";
  startedAt: number;
  completedAt?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface StoredRun {
  _id: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  output?: unknown;
  error?: string;
  steps: StoredStepRun[];
}

export interface ConnectionMetadata {
  _id: string;
  externalId: string;
  provider: "google" | "slack" | "microsoft";
  displayName: string;
  ownerLabel: string;
  externalAccountId: string;
  scopes: string[];
  status: "active" | "needs_reauth" | "disabled";
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export const getWorkflowRef = makeFunctionReference<
  "query",
  { externalId: string },
  StoredWorkflow | null
>("workflows:getByExternalId");

export const upsertWorkflowRef = makeFunctionReference<
  "mutation",
  {
    externalId: string;
    name: string;
    description: string;
    enabled: boolean;
    nodes: WorkflowDefinition["nodes"];
    edges: WorkflowDefinition["edges"];
    updatedAt: number;
  },
  string
>("workflows:upsert");

export const startRunRef = makeFunctionReference<
  "mutation",
  { externalWorkflowId: string; input: unknown; trigger?: string },
  string
>("runs:startRun");

export const getRunRef = makeFunctionReference<"query", { runId: string }, StoredRun | null>("runs:get");

export const approveRunRef = makeFunctionReference<
  "mutation",
  { runId: string; nodeId: string; approved: boolean; note?: string },
  null
>("runs:approve");

export const listConnectionsRef = makeFunctionReference<"query", {}, ConnectionMetadata[]>("connections:list");
export const syncGoogleRef = makeFunctionReference<"action", {}, { count: number }>("connectionActions:syncGoogle");
export const disconnectGoogleRef = makeFunctionReference<"action", { externalId: string }, null>("connectionActions:disconnectGoogle");
export const startSlackOAuthRef = makeFunctionReference<"action", { returnUrl?: string }, string>("connectionActions:startSlackOAuth");
export const disconnectSlackRef = makeFunctionReference<"action", { externalId: string }, { revoked: boolean }>("connectionActions:disconnectSlack");
