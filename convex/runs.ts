import { sendEvent, start } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

export const listForWorkflow = query({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) => {
    const runs = await ctx.db
      .query("workflowRuns")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .order("desc")
      .take(25);
    return Promise.all(
      runs.map(async (run) => ({
        ...run,
        steps: await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      })),
    );
  },
});

export const get = query({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const steps = await ctx.db
      .query("stepRuns")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    return { ...run, steps };
  },
});

export const startRun = mutation({
  args: { externalWorkflowId: v.string(), input: v.any(), trigger: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string> => {
    const definition = await ctx.db
      .query("workflows")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalWorkflowId))
      .unique();
    if (!definition) throw new Error("Save the workflow before running it.");

    const runId = await ctx.db.insert("workflowRuns", {
      workflowId: definition._id,
      status: "queued",
      trigger: args.trigger ?? "manual",
      input: args.input,
      startedAt: Date.now(),
    });
    const workflowEngineId = await start(ctx, internal.executor.executeWorkflow, { runId });
    await ctx.db.patch(runId, { workflowEngineId });
    return runId;
  },
});

export const approve = mutation({
  args: {
    runId: v.id("workflowRuns"),
    nodeId: v.string(),
    approved: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.workflowEngineId) throw new Error("This run is not waiting for an approval.");
    await sendEvent(ctx, components.workflow, {
      name: `approval:${args.nodeId}`,
      workflowId: run.workflowEngineId,
      value: { approved: args.approved, note: args.note },
      validator: v.object({ approved: v.boolean(), note: v.optional(v.string()) }),
    });
  },
});
