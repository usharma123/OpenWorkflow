import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
  handler: async (ctx) => ctx.db.query("workflows").order("desc").collect(),
});

export const getByExternalId = query({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) =>
    ctx.db.query("workflows").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique(),
});

export const upsert = mutation({
  args: workflowArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return ctx.db.insert("workflows", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) => {
    const runs = await ctx.db.query("workflowRuns").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).collect();
    for (const run of runs) {
      const steps = await ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
      for (const step of steps) await ctx.db.delete(step._id);
      await ctx.db.delete(run._id);
    }
    await ctx.db.delete(workflowId);
  },
});
