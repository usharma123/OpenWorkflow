import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePrincipal } from "./auth";
import { validateWorkflowGraph } from "./policies";

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
    validateWorkflowGraph(args.nodes, args.edges);
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", principal.ownerKey).eq("externalId", args.externalId),
      )
      .unique();
    const googleConnectionRefs = new Set<string>();
    const webhookSlugs = new Set<string>();
    for (const node of args.nodes) {
      const nodeType = node?.data?.nodeType;
      const config = node?.data?.config;
      if (
        (nodeType === "gmailTrigger" || nodeType === "googleDoc") &&
        config?.executionMode === "live" &&
        typeof config.connectionRef === "string" &&
        config.connectionRef
      ) {
        googleConnectionRefs.add(config.connectionRef);
      }
      if (nodeType === "webhookTrigger" && typeof config?.slug === "string" && config.slug.trim()) {
        webhookSlugs.add(config.slug.trim());
      }
    }
    if (webhookSlugs.size > 1) throw new Error("A workflow can expose only one webhook URL.");
    const googleOwners = new Set<string>();
    for (const externalId of googleConnectionRefs) {
      const connection = await ctx.db
        .query("connections")
        .withIndex("by_owner_external_id", (q) =>
          q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId),
        )
        .unique();
      if (!connection || connection.provider !== "google" || !connection.clerkUserId) {
        throw new Error("A selected Google connection is unavailable. Reconnect it before saving.");
      }
      googleOwners.add(connection.clerkUserId);
    }
    if (googleOwners.size > 1) {
      throw new Error("All live Google steps in a workflow must use accounts connected by the same user.");
    }
    const ownership = {
      ownerKey: principal.ownerKey,
      ownerUserId: googleOwners.values().next().value ?? existing?.ownerUserId ?? principal.userId,
      organizationId: principal.organizationId,
    };
    const webhookSlug = webhookSlugs.values().next().value;
    const hasWebhook = Boolean(webhookSlug);
    const webhookSecret = hasWebhook ? existing?.webhookSecret ?? crypto.randomUUID().replaceAll("-", "") : undefined;
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, ...ownership, webhookSlug, webhookSecret });
      return existing._id;
    }
    return ctx.db.insert("workflows", { ...args, ...ownership, webhookSlug, webhookSecret, createdAt: Date.now() });
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

export const backfillWebhookSlugs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workflows = await ctx.db.query("workflows").collect();
    let updated = 0;
    for (const workflow of workflows) {
      const slug = workflow.nodes
        .find((node) => node?.data?.nodeType === "webhookTrigger")
        ?.data?.config?.slug;
      const webhookSlug = typeof slug === "string" && slug.trim() ? slug.trim() : undefined;
      if (workflow.webhookSlug !== webhookSlug) {
        await ctx.db.patch(workflow._id, { webhookSlug });
        updated += 1;
      }
    }
    return updated;
  },
});
