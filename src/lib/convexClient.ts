import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();

export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : undefined;

export const listWorkflowsRef = api.workflows.list;
export const listRunsRef = api.runs.listForWorkflow;
export const getWorkflowRef = api.workflows.getByExternalId;
export const upsertWorkflowRef = api.workflows.upsert;
export const listWorkflowVersionsRef = api.workflows.listVersions;
export const publishWorkflowRef = api.workflows.publish;
export const rollbackWorkflowRef = api.workflows.rollback;
export const renameWorkflowRef = api.workflows.rename;
export const duplicateWorkflowRef = api.workflows.duplicate;
export const removeWorkflowRef = api.workflows.remove;
export const startRunRef = api.runs.startRun;
export const retryRunRef = api.runs.retry;
export const getRunRef = api.runs.get;
export const approveRunRef = api.runs.approve;
export const decidePlanRef = api.runs.decidePlan;
export const listConnectionsRef = api.connections.list;
export const listBuildChatMessagesRef = api.workflowChat.listMessages;
export const sendBuildChatMessageRef = api.workflowChat.send;
export const markBuildChatAppliedRef = api.workflowChat.markApplied;
export const syncGoogleRef = api.connectionActions.syncGoogle;
export const disconnectGoogleRef = api.connectionActions.disconnectGoogle;
export const startSlackOAuthRef = api.connectionActions.startSlackOAuth;
export const disconnectSlackRef = api.connectionActions.disconnectSlack;

export type StoredWorkflow = NonNullable<FunctionReturnType<typeof getWorkflowRef>>;
export type StoredRun = NonNullable<FunctionReturnType<typeof getRunRef>>;
export type StoredStepRun = StoredRun["steps"][number];
export type ConnectionMetadata = FunctionReturnType<typeof listConnectionsRef>[number];
export type BuildChatMessage = FunctionReturnType<typeof listBuildChatMessagesRef>[number];
