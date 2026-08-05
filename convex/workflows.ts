import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePrincipal } from "./auth";

const workflowArgs = {
  externalId: v.string(),
  name: v.string(),
  description: v.string(),
  enabled: v.boolean(),
  nodes: v.array(v.any()),
  edges: v.array(v.any()),
  updatedAt: v.number(),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx);
    return ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey))
      .order("desc")
      .collect();
  },
});

export const getByExternalId = query({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const principal = await requirePrincipal(ctx);
    return ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId),
      )
      .unique();
  },
});

export const upsert = mutation({
  args: workflowArgs,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx);
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", principal.ownerKey).eq("externalId", args.externalId),
      )
      .unique();
    const ownership = {
      ownerKey: principal.ownerKey,
      ownerUserId: principal.userId,
      organizationId: principal.organizationId,
    };
    const hasWebhook = args.nodes.some((node) => node?.data?.nodeType === "webhookTrigger");
    const webhookSecret = hasWebhook ? existing?.webhookSecret ?? crypto.randomUUID().replaceAll("-", "") : undefined;
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, ...ownership, webhookSecret });
      return existing._id;
    }
    return ctx.db.insert("workflows", { ...args, ...ownership, webhookSecret, createdAt: Date.now() });
  },
});

export const remove = mutation({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const runs = await ctx.db.query("workflowRuns").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).collect();
    for (const run of runs) {
      const steps = await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
      for (const step of steps) await ctx.db.delete(step._id);
      await ctx.db.delete(run._id);
    }
    await ctx.db.delete(workflowId);
  },
});
