import { cleanup } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  compactLiveValue,
  LIVE_AGENT_OUTPUT_CHARS,
  LIVE_AGENT_CONTENT_CHARS,
  LIVE_AGENT_OBJECTIVE_CHARS,
  LIVE_OUTPUT_CHARS,
  LIVE_TRACE_ENTRIES,
} from "./liveState";
import { insertWorkflowVersionSummary, upsertWorkflowSummary } from "./summaries";

/** Idempotently creates the small metadata rows used by workflow list queries. */
export const backfillWorkflowSummaries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workflows = await ctx.db.query("workflows").take(500);
    const versions = await ctx.db.query("workflowVersions").take(2_000);
    for (const workflow of workflows) await upsertWorkflowSummary(ctx, workflow);
    for (const version of versions) {
      await insertWorkflowVersionSummary(ctx, {
        ownerKey: version.ownerKey,
        workflowId: version.workflowId,
        workflowVersionId: version._id,
        version: version.version,
        createdAt: version.createdAt,
      });
    }
    return { workflows: workflows.length, versions: versions.length };
  },
});

/** Idempotently snapshots existing archival runs into bounded reactive rows. */
export const backfillRunLiveStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [workflows, runs, steps, agentTasks] = await Promise.all([
      ctx.db.query("workflows").take(500),
      ctx.db.query("workflowRuns").take(500),
      ctx.db.query("stepRuns").take(2_000),
      ctx.db.query("agentTasks").take(2_000),
    ]);
    const workflowsById = new Map(workflows.map((workflow) => [String(workflow._id), workflow]));
    let runCount = 0;
    let stepCount = 0;
    let agentCount = 0;

    for (const run of runs) {
      const workflow = workflowsById.get(String(run.workflowId));
      if (!workflow || !run.ownerKey) continue;
      const existing = await ctx.db.query("runLiveStates").withIndex("by_run", (q) => q.eq("runId", run._id)).unique();
      const value = {
        ownerKey: run.ownerKey,
        workflowId: run.workflowId,
        externalWorkflowId: workflow.externalId,
        runId: run._id,
        status: run.status,
        trigger: run.trigger,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        error: run.error?.slice(0, 1_000),
        updatedAt: run.completedAt ?? run.startedAt,
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("runLiveStates", value);
      runCount += 1;
    }

    for (const step of steps) {
      if (!step.ownerKey) continue;
      const existing = await ctx.db.query("stepLiveStates").withIndex("by_step", (q) => q.eq("stepRunId", step._id)).unique();
      const value = {
        ownerKey: step.ownerKey,
        runId: step.runId,
        stepRunId: step._id,
        nodeId: step.nodeId,
        nodeLabel: step.nodeLabel,
        nodeType: step.nodeType,
        status: step.status,
        input: step.status === "waiting" ? compactLiveValue(step.input) : undefined,
        partialOutput: step.status === "running" || step.status === "failed"
          ? step.partialOutput?.slice(-LIVE_OUTPUT_CHARS)
          : undefined,
        partialToolTrace: step.status === "running" || step.status === "failed"
          ? step.partialToolTrace?.slice(-LIVE_TRACE_ENTRIES)
          : undefined,
        error: step.error?.slice(0, 1_000),
        plan: step.plan,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        updatedAt: step.completedAt ?? step.startedAt,
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("stepLiveStates", value);
      stepCount += 1;
    }

    for (const task of agentTasks) {
      const existing = await ctx.db.query("agentTaskLiveStates").withIndex("by_task", (q) => q.eq("agentTaskId", task._id)).unique();
      const value = {
        ownerKey: task.ownerKey,
        runId: task.runId,
        stepRunId: task.stepRunId,
        agentTaskId: task._id,
        name: task.name,
        objective: task.objective.slice(0, LIVE_AGENT_OBJECTIVE_CHARS),
        status: task.status,
        attempt: task.attempt,
        partialOutput: task.status === "running" ? task.partialOutput?.slice(-LIVE_AGENT_OUTPUT_CHARS) : undefined,
        toolTrace: task.status === "running" ? task.toolTrace?.slice(-LIVE_TRACE_ENTRIES) : undefined,
        content: task.status === "completed" ? task.content?.slice(0, LIVE_AGENT_CONTENT_CHARS) : undefined,
        citations: undefined,
        error: task.error?.slice(0, 1_000),
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        updatedAt: task.completedAt ?? task.startedAt,
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("agentTaskLiveStates", value);
      agentCount += 1;
    }

    return { runs: runCount, steps: stepCount, agentTasks: agentCount };
  },
});

export const completedWorkflowHistories = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [completed, failed] = await Promise.all([
      ctx.db.query("workflowRuns").withIndex("by_status_engine_cleaned", (q) =>
        q.eq("status", "completed").eq("engineHistoryCleanedAt", undefined)).take(100),
      ctx.db.query("workflowRuns").withIndex("by_status_engine_cleaned", (q) =>
        q.eq("status", "failed").eq("engineHistoryCleanedAt", undefined)).take(100),
    ]);
    return [...completed, ...failed].flatMap((run) =>
      run.workflowEngineId && !run.engineHistoryCleanedAt
        ? [{ runId: run._id, workflowEngineId: run.workflowEngineId }]
        : []);
  },
});

export const markWorkflowHistoryCleaned = internalMutation({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run && (run.status === "completed" || run.status === "failed")) {
      await ctx.db.patch(runId, { engineHistoryCleanedAt: Date.now() });
    }
  },
});

/** Removes only redundant durable-workflow journals for terminal application
 * runs. The application-owned run, step, agent, and audit records are kept. */
export const cleanupCompletedWorkflowHistory = internalAction({
  args: {},
  handler: async (ctx): Promise<{ attempted: number; cleaned: number }> => {
    const histories = await ctx.runQuery(internal.migrations.completedWorkflowHistories, {}) as Array<{
      runId: Id<"workflowRuns">;
      workflowEngineId: string;
    }>;
    let cleaned = 0;
    for (const history of histories) {
      const removed = await cleanup(ctx, components.workflow, history.workflowEngineId as never);
      await ctx.runMutation(internal.migrations.markWorkflowHistoryCleaned, { runId: history.runId });
      if (removed) cleaned += 1;
    }
    return { attempted: histories.length, cleaned };
  },
});
