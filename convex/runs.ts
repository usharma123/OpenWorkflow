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
  options: { runMode?: "full" | "single" | "through" | "resume"; scopeNodeId?: string } = {},
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
    runMode: options.runMode ?? "full",
    scopeNodeId: options.scopeNodeId,
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
  args: {
    externalWorkflowId: v.string(),
    input: v.any(),
    trigger: v.optional(v.string()),
    runMode: v.optional(v.union(v.literal("full"), v.literal("single"), v.literal("through"))),
    scopeNodeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx);
    const definition = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey).eq("externalId", args.externalWorkflowId))
      .unique();
    if (!definition) throw new Error("Save the workflow before running it.");
    const runMode = args.runMode ?? "full";
    if (runMode !== "full") {
      const scopedNode = (definition.nodes as Array<{ id?: string; data?: { nodeType?: string } }>).find(
        (node) => node.id === args.scopeNodeId,
      );
      if (!scopedNode || scopedNode.data?.nodeType === "daytonaSandbox") {
        throw new Error("Choose an executable step for this test run.");
      }
    }
    return createPinnedRun(
      ctx,
      { ...definition, ownerUserId: principal.userId },
      args.trigger ?? "manual",
      args.input,
      { runMode, scopeNodeId: args.scopeNodeId },
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

export const retry = mutation({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => {
    const principal = await requirePrincipal(ctx);
    const previous = await ctx.db.get(runId);
    if (!previous || previous.ownerKey !== principal.ownerKey) throw new Error("Run not found.");
    if (previous.status !== "failed") throw new Error("Only a failed run can be retried.");
    const definition = await ctx.db.get(previous.workflowId);
    if (!definition || definition.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const steps = await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    const failedStep = [...steps].reverse().find((step) => step.status === "failed");
    if (!failedStep) throw new Error("The failed step could not be identified.");
    const version = previous.workflowVersionId ? await ctx.db.get(previous.workflowVersionId) : await ensureWorkflowVersion(ctx, definition);
    if (!version || version.workflowId !== definition._id) throw new Error("The workflow version for this run is unavailable.");
    const seedOutputs = Object.fromEntries(
      steps
        .filter((step) => step.status === "completed" && step.output !== undefined)
        .map((step) => [step.nodeId, step.output]),
    );
    const retryRunId = await ctx.db.insert("workflowRuns", {
      workflowId: definition._id,
      workflowVersionId: version._id,
      workflowVersion: version.version,
      ownerKey: principal.ownerKey,
      ownerUserId: principal.userId,
      status: "queued",
      trigger: "retry",
      runMode: "resume",
      scopeNodeId: failedStep.nodeId,
      retryOfRunId: runId,
      seedOutputs,
      input: previous.input,
      startedAt: Date.now(),
    });
    const workflowEngineId = await start(ctx, internal.executor.executeWorkflow, { runId: retryRunId });
    await ctx.db.patch(retryRunId, { workflowEngineId });
    await ctx.db.insert("auditLogs", {
      ownerKey: principal.ownerKey,
      actorUserId: principal.userId,
      runId: retryRunId,
      event: "run.retry",
      outcome: "started",
      actor: principal.userId,
      detail: `Retry of ${runId} from ${failedStep.nodeLabel}`,
      createdAt: Date.now(),
    });
    return retryRunId;
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
