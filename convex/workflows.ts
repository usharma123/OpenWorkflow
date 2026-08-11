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

function definitionChanged(
  current: { name: string; description: string; enabled: boolean; nodes: unknown[]; edges: unknown[] },
  next: { name: string; description: string; enabled: boolean; nodes: unknown[]; edges: unknown[] },
) {
  return JSON.stringify({
    name: current.name,
    description: current.description,
    enabled: current.enabled,
    nodes: current.nodes,
    edges: current.edges,
  }) !== JSON.stringify({
    name: next.name,
    description: next.description,
    enabled: next.enabled,
    nodes: next.nodes,
    edges: next.edges,
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx);
    return ctx.db
      .query("workflows")
      .withIndex("by_owner_updated_at", (q) => q.eq("ownerKey", principal.ownerKey))
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
    const googleConnections = await Promise.all([...googleConnectionRefs].map((externalId) =>
      ctx.db
        .query("connections")
        .withIndex("by_owner_external_id", (q) =>
          q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId),
        )
        .unique(),
    ));
    const googleOwners = new Set<string>();
    for (const connection of googleConnections) {
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
      const changed = definitionChanged(existing, args);
      const version = existing.currentVersionId && !changed
        ? existing.version ?? 1
        : (existing.version ?? 0) + 1;
      await ctx.db.patch(existing._id, { ...args, ...ownership, webhookSlug, webhookSecret, version });
      if (!existing.currentVersionId || changed) {
        const currentVersionId = await ctx.db.insert("workflowVersions", {
          ownerKey: principal.ownerKey,
          workflowId: existing._id,
          version,
          name: args.name,
          description: args.description,
          enabled: args.enabled,
          nodes: args.nodes,
          edges: args.edges,
          createdAt: Date.now(),
        });
        await ctx.db.patch(existing._id, { currentVersionId });
      }
      return existing._id;
    }
    const workflowId = await ctx.db.insert("workflows", {
      ...args,
      ...ownership,
      webhookSlug,
      webhookSecret,
      version: 1,
      createdAt: Date.now(),
    });
    const currentVersionId = await ctx.db.insert("workflowVersions", {
      ownerKey: principal.ownerKey,
      workflowId,
      version: 1,
      name: args.name,
      description: args.description,
      enabled: args.enabled,
      nodes: args.nodes,
      edges: args.edges,
      createdAt: Date.now(),
    });
    await ctx.db.patch(workflowId, { currentVersionId });
    return workflowId;
  },
});

export const rename = mutation({
  args: { workflowId: v.id("workflows"), name: v.string() },
  handler: async (ctx, { workflowId, name }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Workflow names cannot be empty.");
    if (trimmed.length > 120) throw new Error("Workflow names must be 120 characters or fewer.");
    if (trimmed === workflow.name) return;
    const now = Date.now();
    const version = (workflow.version ?? 0) + 1;
    const currentVersionId = await ctx.db.insert("workflowVersions", {
      ownerKey: principal.ownerKey,
      workflowId,
      version,
      name: trimmed,
      description: workflow.description,
      enabled: workflow.enabled,
      nodes: workflow.nodes,
      edges: workflow.edges,
      createdAt: now,
    });
    await ctx.db.patch(workflowId, { name: trimmed, version, currentVersionId, updatedAt: now });
  },
});

export const duplicate = mutation({
  args: { workflowId: v.id("workflows"), externalId: v.string(), name: v.string() },
  handler: async (ctx, { workflowId, externalId, name }) => {
    const principal = await requirePrincipal(ctx);
    const source = await ctx.db.get(workflowId);
    if (!source || source.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId),
      )
      .unique();
    if (existing) throw new Error("A workflow with this ID already exists.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Workflow names cannot be empty.");
    if (trimmed.length > 120) throw new Error("Workflow names must be 120 characters or fewer.");
    const now = Date.now();
    const duplicatedWorkflowId = await ctx.db.insert("workflows", {
      ownerKey: principal.ownerKey,
      ownerUserId: source.ownerUserId ?? principal.userId,
      organizationId: principal.organizationId,
      externalId,
      name: trimmed,
      description: source.description,
      enabled: false,
      nodes: source.nodes,
      edges: source.edges,
      webhookSlug: source.webhookSlug,
      webhookSecret: source.webhookSlug ? crypto.randomUUID().replaceAll("-", "") : undefined,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const currentVersionId = await ctx.db.insert("workflowVersions", {
      ownerKey: principal.ownerKey,
      workflowId: duplicatedWorkflowId,
      version: 1,
      name: trimmed,
      description: source.description,
      enabled: false,
      nodes: source.nodes,
      edges: source.edges,
      createdAt: now,
    });
    await ctx.db.patch(duplicatedWorkflowId, { currentVersionId });
    return duplicatedWorkflowId;
  },
});

export const remove = mutation({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const [runs, versions] = await Promise.all([
      ctx.db.query("workflowRuns").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).collect(),
      ctx.db
        .query("workflowVersions")
        .withIndex("by_workflow_version", (q) => q.eq("workflowId", workflowId))
        .collect(),
    ]);
    await Promise.all(runs.map(async (run) => {
      const [steps, auditLogs] = await Promise.all([
        ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("auditLogs").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ]);
      await Promise.all([
        ...steps.map((step) => ctx.db.delete(step._id)),
        ...auditLogs.map((auditLog) => ctx.db.delete(auditLog._id)),
      ]);
      await ctx.db.delete(run._id);
    }));
    await Promise.all(versions.map((version) => ctx.db.delete(version._id)));
    await ctx.db.delete(workflowId);
  },
});

export const backfillWebhookSlugs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workflows = await ctx.db.query("workflows").collect();
    const updates: Array<Promise<void>> = [];
    for (const workflow of workflows) {
      const slug = workflow.nodes
        .find((node) => node?.data?.nodeType === "webhookTrigger")
        ?.data?.config?.slug;
      const webhookSlug = typeof slug === "string" && slug.trim() ? slug.trim() : undefined;
      if (workflow.webhookSlug !== webhookSlug) {
        updates.push(ctx.db.patch(workflow._id, { webhookSlug }));
      }
    }
    await Promise.all(updates);
    return updates.length;
  },
});
