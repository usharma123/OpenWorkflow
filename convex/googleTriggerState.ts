import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { createPinnedRun } from "./runs";

const triggerTypes = new Set(["gmailEventTrigger", "calendarTrigger", "driveTrigger", "sheetsTrigger"]);

export const listEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const workflows = await ctx.db.query("workflows").withIndex("by_enabled", (q) => q.eq("enabled", true)).take(100);
    const candidates = await Promise.all(workflows.map(async (workflow) => {
      const triggerOwnerUserId = workflow.publishedVersionId
        ? workflow.publishedOwnerUserId ?? workflow.ownerUserId
        : workflow.ownerUserId;
      if (!workflow.ownerKey || !triggerOwnerUserId) return [];
      const published = workflow.publishedVersionId ? await ctx.db.get(workflow.publishedVersionId) : null;
      const nodes = published?.workflowId === workflow._id ? published.nodes : workflow.nodes;
      const states = (workflow.googleTriggerState ?? {}) as Record<string, unknown>;
      return (nodes as Array<{ id: string; data: { nodeType: string; config: Record<string, unknown> } }>).flatMap((node) => {
        if (!triggerTypes.has(node.data.nodeType)) return [];
        const connectionRef = String(node.data.config.connectionRef ?? "");
        if (!connectionRef) return [];
        return [{
          workflowId: workflow._id,
          ownerKey: workflow.ownerKey!,
          ownerUserId: triggerOwnerUserId,
          nodeId: node.id,
          nodeType: node.data.nodeType,
          config: node.data.config,
          connectionRef,
          state: states[node.id],
        }];
      });
    }));
    return candidates.flat();
  },
});

export const checkpoint = internalMutation({
  args: { workflowId: v.id("workflows"), nodeId: v.string(), state: v.any() },
  handler: async (ctx, { workflowId, nodeId, state }) => {
    const workflow = await ctx.db.get(workflowId);
    if (!workflow) return;
    const current = (workflow.googleTriggerState ?? {}) as Record<string, unknown>;
    await ctx.db.patch(workflowId, { googleTriggerState: { ...current, [nodeId]: state } });
  },
});

export const claimAndStart = internalMutation({
  args: {
    workflowId: v.id("workflows"),
    nodeId: v.string(),
    nodeType: v.string(),
    dedupeKey: v.string(),
    input: v.any(),
    state: v.any(),
  },
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow?.enabled || !workflow.ownerKey) return null;
    const current = (workflow.googleTriggerState ?? {}) as Record<string, unknown>;
    await ctx.db.patch(workflow._id, { googleTriggerState: { ...current, [args.nodeId]: args.state } });
    const existing = await ctx.db.query("triggerEvents").withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", args.dedupeKey)).unique();
    if (existing) return null;
    await ctx.db.insert("triggerEvents", {
      ownerKey: workflow.ownerKey,
      workflowId: workflow._id,
      nodeId: args.nodeId,
      dedupeKey: args.dedupeKey,
      createdAt: Date.now(),
    });
    return createPinnedRun(ctx, workflow, `google:${args.nodeType}`, {
      ...args.input,
      triggerNodeId: args.nodeId,
      triggerType: args.nodeType,
    }, { runMode: "resume", scopeNodeId: args.nodeId, usePublished: true });
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60_000;
    const events = await ctx.db.query("triggerEvents").withIndex("by_created_at", (q) => q.lt("createdAt", cutoff)).take(500);
    await Promise.all(events.map((event) => ctx.db.delete(event._id)));
    return events.length;
  },
});
