import { sendEvent, start } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requirePrincipal } from "./auth";

export async function ensureWorkflowVersion(ctx: MutationCtx, definition: Doc<"workflows">) {
  if (definition.currentVersionId) {
    const current = await ctx.db.get(definition.currentVersionId);
    if (current && current.workflowId === definition._id) return current;
  }
  const version = definition.version ?? 1;
  const workflowVersionId = await ctx.db.insert("workflowVersions", {
    ownerKey: definition.ownerKey!,
    workflowId: definition._id,
    version,
    name: definition.name,
    description: definition.description,
    enabled: definition.enabled,
    nodes: definition.nodes,
    edges: definition.edges,
    createdAt: Date.now(),
  });
  await ctx.db.patch(definition._id, { currentVersionId: workflowVersionId, version });
  return (await ctx.db.get(workflowVersionId))!;
}

export async function createPinnedRun(
  ctx: MutationCtx,
  definition: Doc<"workflows">,
  trigger: string,
  input: unknown,
) {
  if (!definition.ownerKey || !definition.ownerUserId) throw new Error("Workflow ownership is invalid.");
  const version = await ensureWorkflowVersion(ctx, definition);
  const runId = await ctx.db.insert("workflowRuns", {
    workflowId: definition._id,
    workflowVersionId: version._id,
    workflowVersion: version.version,
    ownerKey: definition.ownerKey,
    ownerUserId: definition.ownerUserId,
    status: "queued",
    trigger,
    input,
    startedAt: Date.now(),
  });
  const workflowEngineId = await start(ctx, internal.executor.executeWorkflow, { runId });
  await ctx.db.patch(runId, { workflowEngineId });
  return runId;
}

export const listForWorkflow = query({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const runs = await ctx.db.query("workflowRuns").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).order("desc").take(25);
    const ownedRuns = runs.reduce<typeof runs>((owned, run) => {
      if (run.ownerKey === principal.ownerKey) owned.push(run);
      return owned;
    }, []);
    return Promise.all(ownedRuns.map(async (run) => ({
      ...run,
      steps: await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
    })));
  },
});

export const get = query({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => {
    const principal = await requirePrincipal(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.ownerKey !== principal.ownerKey) return null;
    const steps = await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    return { ...run, steps: steps.filter((step) => step.ownerKey === principal.ownerKey) };
  },
});

export const startRun = mutation({
  args: { externalWorkflowId: v.string(), input: v.any(), trigger: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx);
    const definition = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey).eq("externalId", args.externalWorkflowId))
      .unique();
    if (!definition) throw new Error("Save the workflow before running it.");
    return createPinnedRun(
      ctx,
      { ...definition, ownerUserId: principal.userId },
      args.trigger ?? "manual",
      args.input,
    );
  },
});

export const startForWebhook = internalMutation({
  args: { workflowId: v.id("workflows"), input: v.any() },
  handler: async (ctx, { workflowId, input }) => {
    const definition = await ctx.db.get(workflowId);
    if (!definition) throw new Error("Workflow not found.");
    return createPinnedRun(ctx, definition, "webhook", input);
  },
});

export const approve = mutation({
  args: { runId: v.id("workflowRuns"), nodeId: v.string(), approved: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerKey !== principal.ownerKey) throw new Error("Run not found.");
    if (!run.workflowEngineId || run.status !== "waiting") throw new Error("This run is not waiting for an approval.");
    const waitingStep = (await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect())
      .find((step) => step.nodeId === args.nodeId && step.status === "waiting" && step.ownerKey === principal.ownerKey);
    if (!waitingStep) throw new Error("This approval is no longer pending.");
    await sendEvent(ctx, components.workflow, {
      name: `approval:${args.nodeId}`,
      workflowId: run.workflowEngineId,
      value: { approved: args.approved, note: args.note },
      validator: v.object({ approved: v.boolean(), note: v.optional(v.string()) }),
    });
    await ctx.db.insert("auditLogs", {
      ownerKey: principal.ownerKey,
      actorUserId: principal.userId,
      runId: args.runId,
      stepRunId: waitingStep._id,
      event: "approval.decision",
      outcome: args.approved ? "approved" : "rejected",
      actor: principal.userId,
      detail: args.note?.slice(0, 300),
      createdAt: Date.now(),
    });
    return null;
  },
});
