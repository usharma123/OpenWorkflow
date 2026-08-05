import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const connections = await ctx.db.query("connections").collect();
    return connections.map(({ secretLocator: _secretLocator, ...metadata }) => metadata);
  },
});

export const upsertMetadata = mutation({
  args: {
    externalId: v.string(),
    provider: v.union(v.literal("google"), v.literal("slack"), v.literal("microsoft")),
    displayName: v.string(),
    ownerLabel: v.string(),
    scopes: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_reauth"), v.literal("disabled")),
    secretLocator: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("connections").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique();
    if (existing) { await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() }); return existing._id; }
    return ctx.db.insert("connections", { ...args, createdAt: Date.now(), updatedAt: Date.now() });
  },
});

export const auditForRun = query({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => ctx.db.query("auditLogs").withIndex("by_run", (q) => q.eq("runId", runId)).collect(),
});
