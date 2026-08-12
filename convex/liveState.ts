import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const LIVE_OUTPUT_CHARS = 8_000;
export const LIVE_AGENT_OUTPUT_CHARS = 1_000;
export const LIVE_AGENT_CONTENT_CHARS = 500;
export const LIVE_AGENT_OBJECTIVE_CHARS = 500;
export const LIVE_TRACE_ENTRIES = 12;
export const LIVE_UPDATE_INTERVAL_MS = 1_000;

export function compactLiveValue(value: unknown, maxChars = 4_000): unknown {
  if (typeof value === "string") {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n…[truncated]`;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length <= maxChars) return value;
    return { preview: `${serialized.slice(0, maxChars)}…`, truncated: true };
  } catch {
    return { preview: String(value).slice(0, maxChars), truncated: true };
  }
}

export async function getRunLiveState(ctx: MutationCtx, runId: Id<"workflowRuns">) {
  return ctx.db.query("runLiveStates").withIndex("by_run", (q) => q.eq("runId", runId)).unique();
}

export async function patchRunLiveState(
  ctx: MutationCtx,
  runId: Id<"workflowRuns">,
  patch: Partial<Omit<Doc<"runLiveStates">, "_id" | "_creationTime" | "runId">>,
) {
  const live = await getRunLiveState(ctx, runId);
  if (!live) return;
  await ctx.db.patch(live._id, { ...patch, updatedAt: Date.now() });
}

export async function getStepLiveState(ctx: MutationCtx, stepRunId: Id<"stepRuns">) {
  return ctx.db.query("stepLiveStates").withIndex("by_step", (q) => q.eq("stepRunId", stepRunId)).unique();
}

export async function patchStepLiveState(
  ctx: MutationCtx,
  stepRunId: Id<"stepRuns">,
  patch: Partial<Omit<Doc<"stepLiveStates">, "_id" | "_creationTime" | "stepRunId">>,
) {
  const live = await getStepLiveState(ctx, stepRunId);
  if (!live) return;
  await ctx.db.patch(live._id, { ...patch, updatedAt: Date.now() });
}

export async function getAgentTaskLiveState(ctx: MutationCtx, agentTaskId: Id<"agentTasks">) {
  return ctx.db.query("agentTaskLiveStates").withIndex("by_task", (q) => q.eq("agentTaskId", agentTaskId)).unique();
}

export async function patchAgentTaskLiveState(
  ctx: MutationCtx,
  agentTaskId: Id<"agentTasks">,
  patch: Partial<Omit<Doc<"agentTaskLiveStates">, "_id" | "_creationTime" | "agentTaskId">>,
) {
  const live = await getAgentTaskLiveState(ctx, agentTaskId);
  if (!live) return;
  await ctx.db.patch(live._id, { ...patch, updatedAt: Date.now() });
}
