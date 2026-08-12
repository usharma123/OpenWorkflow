import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePrincipal } from "./auth";
import { validateWorkflowGraph } from "./policies";
import { ensureWorkflowVersion } from "./runs";
import { insertWorkflowVersionSummary, upsertWorkflowSummary } from "./summaries";

const GOOGLE_CONNECTOR_NODE_TYPES = [
  "gmailTrigger", "gmailEventTrigger", "calendarTrigger", "driveTrigger", "sheetsTrigger",
  "googleDoc", "gmailSend", "calendarEvent", "sheetsAppend", "driveUpload",
];

const CONNECTOR_PROVIDER_BY_NODE_TYPE: Record<string, "google" | "slack"> = Object.fromEntries([
  ...GOOGLE_CONNECTOR_NODE_TYPES.map((type) => [type, "google" as const]),
  ["slack", "slack" as const],
]);

type ConnectionRecord = {
  externalId: string;
  provider: "google" | "slack" | "microsoft";
  status: "active" | "needs_reauth" | "disabled";
};

function bindActiveConnections(nodes: any[], connections: ConnectionRecord[]) {
  const activeByProvider = new Map<"google" | "slack", ConnectionRecord[]>();
  for (const connection of connections) {
    if (connection.status !== "active" || connection.provider === "microsoft") continue;
    activeByProvider.set(connection.provider, [
      ...(activeByProvider.get(connection.provider) ?? []),
      connection,
    ]);
  }
  return nodes.map((node) => {
    const provider = CONNECTOR_PROVIDER_BY_NODE_TYPE[String(node?.data?.nodeType ?? "")];
    if (!provider) return node;
    const config = { ...(node.data.config ?? {}) };
    delete config.executionMode;
    const choices = activeByProvider.get(provider) ?? [];
    const currentRef = typeof config.connectionRef === "string" ? config.connectionRef : "";
    if (!choices.some((connection) => connection.externalId === currentRef) && choices[0]) {
      config.connectionRef = choices[0].externalId;
    }
    return { ...node, data: { ...node.data, config } };
  });
}

const workflowArgs = {
  externalId: v.string(),
  name: v.string(),
  description: v.string(),
  enabled: v.boolean(),
  maxConcurrentRuns: v.number(),
  nodes: v.array(v.any()),
  edges: v.array(v.any()),
  updatedAt: v.number(),
};

function definitionChanged(
  current: { name: string; description: string; enabled: boolean; maxConcurrentRuns?: number; nodes: unknown[]; edges: unknown[] },
  next: { name: string; description: string; enabled: boolean; maxConcurrentRuns: number; nodes: unknown[]; edges: unknown[] },
) {
  return JSON.stringify({
    name: current.name,
    description: current.description,
    enabled: current.enabled,
    maxConcurrentRuns: current.maxConcurrentRuns ?? 3,
    nodes: current.nodes,
    edges: current.edges,
  }) !== JSON.stringify({
    name: next.name,
    description: next.description,
    enabled: next.enabled,
    maxConcurrentRuns: next.maxConcurrentRuns,
    nodes: next.nodes,
    edges: next.edges,
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx);
    const summaries = await ctx.db
      .query("workflowSummaries")
      .withIndex("by_owner_updated_at", (q) => q.eq("ownerKey", principal.ownerKey))
      .order("desc")
      .collect();
    return summaries.map((summary) => ({
      _id: summary.workflowId,
      externalId: summary.externalId,
      name: summary.name,
      enabled: summary.enabled,
      nodeCount: summary.nodeCount,
      version: summary.version,
      updatedAt: summary.updatedAt,
    }));
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

export const listVersions = query({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db
      .query("workflowSummaries")
      .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId))
      .unique();
    if (!workflow) throw new Error("Workflow not found.");
    const versions = await ctx.db
      .query("workflowVersionSummaries")
      .withIndex("by_workflow_version", (q) => q.eq("workflowId", workflow.workflowId))
      .order("desc")
      .take(50);
    return {
      currentVersionId: workflow.currentVersionId,
      currentVersion: workflow.version ?? 1,
      publishedVersionId: workflow.publishedVersionId,
      publishedVersion: workflow.publishedVersion,
      versions: versions.map((version) => ({
        _id: version.workflowVersionId,
        version: version.version,
        createdAt: version.createdAt,
      })),
    };
  },
});

export const publish = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId))
      .unique();
    if (!workflow) throw new Error("Workflow not found.");
    const version = await ensureWorkflowVersion(ctx, workflow);
    const connectorRequirements = new Map<string, { provider: "google" | "slack" | "microsoft"; label: string }>();
    let publishedWebhookSlug: string | undefined;
    for (const node of version.nodes) {
      const nodeType = String(node?.data?.nodeType ?? "");
      const config = node?.data?.config as Record<string, unknown> | undefined;
      if (nodeType === "webhookTrigger" && typeof config?.slug === "string" && config.slug.trim()) {
        publishedWebhookSlug = config.slug.trim();
      }
      const provider = CONNECTOR_PROVIDER_BY_NODE_TYPE[nodeType];
      if (provider) {
        if (typeof config?.connectionRef !== "string" || !config.connectionRef) {
          throw new Error(`${node?.data?.label ?? nodeType} needs an active connected account before publishing.`);
        }
        connectorRequirements.set(config.connectionRef, {
          provider,
          label: String(node?.data?.label ?? nodeType),
        });
      }
    }
    const connections = await Promise.all([...connectorRequirements].map(async ([externalId, requirement]) => ({
      externalId,
      requirement,
      connection: await ctx.db
        .query("connections")
        .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId))
        .unique(),
    })));
    const connectionOwners = new Set<string>();
    for (const { connection, requirement } of connections) {
      if (!connection || connection.provider !== requirement.provider || connection.status !== "active") {
        throw new Error(`Reconnect the account used by ${requirement.label} before publishing.`);
      }
      if (requirement.provider === "google") {
        if (!connection.clerkUserId) {
          throw new Error("Reconnect every Google account used by this draft before publishing.");
        }
        connectionOwners.add(connection.clerkUserId);
      }
    }
    if (connectionOwners.size > 1) throw new Error("Published Google steps must use accounts connected by one user.");
    const webhookSecret = publishedWebhookSlug
      ? workflow.webhookSecret ?? crypto.randomUUID().replaceAll("-", "")
      : workflow.webhookSecret;
    const updatedAt = Date.now();
    await ctx.db.patch(workflow._id, {
      publishedVersionId: version._id,
      publishedVersion: version.version,
      publishedWebhookSlug,
      webhookSecret,
      publishedOwnerUserId: connectionOwners.values().next().value ?? workflow.ownerUserId,
      updatedAt,
    });
    await upsertWorkflowSummary(ctx, {
      ...workflow,
      publishedVersionId: version._id,
      publishedVersion: version.version,
      updatedAt,
    });
    return version.version;
  },
});

export const rollback = mutation({
  args: { externalId: v.string(), versionId: v.id("workflowVersions") },
  handler: async (ctx, { externalId, versionId }) => {
    const principal = await requirePrincipal(ctx);
    const [workflow, target] = await Promise.all([
      ctx.db
        .query("workflows")
        .withIndex("by_owner_external_id", (q) => q.eq("ownerKey", principal.ownerKey).eq("externalId", externalId))
        .unique(),
      ctx.db.get(versionId),
    ]);
    if (!workflow || !target || workflow.ownerKey !== principal.ownerKey || target.workflowId !== workflow._id) {
      throw new Error("Workflow version not found.");
    }
    const version = (workflow.version ?? 0) + 1;
    const now = Date.now();
    const currentVersionId = await ctx.db.insert("workflowVersions", {
      ownerKey: principal.ownerKey,
      workflowId: workflow._id,
      version,
      name: target.name,
      description: target.description,
      enabled: workflow.enabled,
      nodes: target.nodes,
      edges: target.edges,
      createdAt: now,
    });
    await insertWorkflowVersionSummary(ctx, {
      ownerKey: principal.ownerKey,
      workflowId: workflow._id,
      workflowVersionId: currentVersionId,
      version,
      createdAt: now,
    });
    await ctx.db.patch(workflow._id, {
      name: target.name,
      description: target.description,
      nodes: target.nodes,
      edges: target.edges,
      version,
      currentVersionId,
      updatedAt: now,
    });
    await upsertWorkflowSummary(ctx, {
      ...workflow,
      name: target.name,
      nodes: target.nodes,
      version,
      currentVersionId,
      updatedAt: now,
    });
    return { version, currentVersionId };
  },
});

export const upsert = mutation({
  args: workflowArgs,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx);
    const ownerConnections = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) => q.eq("ownerKey", principal.ownerKey))
      .collect();
    const normalizedArgs = { ...args, nodes: bindActiveConnections(args.nodes, ownerConnections) };
    validateWorkflowGraph(normalizedArgs.nodes, normalizedArgs.edges);
    if (!Number.isInteger(args.maxConcurrentRuns) || args.maxConcurrentRuns < 1 || args.maxConcurrentRuns > 25) {
      throw new Error("Concurrent run limit must be between 1 and 25.");
    }
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", principal.ownerKey).eq("externalId", args.externalId),
      )
      .unique();
    const googleConnectionRefs = new Set<string>();
    const webhookSlugs = new Set<string>();
    for (const node of normalizedArgs.nodes) {
      const nodeType = node?.data?.nodeType;
      const config = node?.data?.config;
      if (
        GOOGLE_CONNECTOR_NODE_TYPES.includes(String(nodeType)) &&
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
    const webhookSecret = hasWebhook || existing?.publishedVersionId
      ? existing?.webhookSecret ?? crypto.randomUUID().replaceAll("-", "")
      : undefined;
    if (existing) {
      const changed = definitionChanged(existing, normalizedArgs);
      const version = existing.currentVersionId && !changed
        ? existing.version ?? 1
        : (existing.version ?? 0) + 1;
      let currentVersionId = existing.currentVersionId;
      await ctx.db.patch(existing._id, { ...normalizedArgs, ...ownership, webhookSlug, webhookSecret, version });
      if (!existing.currentVersionId || changed) {
        const createdAt = Date.now();
        currentVersionId = await ctx.db.insert("workflowVersions", {
          ownerKey: principal.ownerKey,
          workflowId: existing._id,
          version,
          name: normalizedArgs.name,
          description: normalizedArgs.description,
          enabled: normalizedArgs.enabled,
          nodes: normalizedArgs.nodes,
          edges: normalizedArgs.edges,
          createdAt,
        });
        await ctx.db.patch(existing._id, { currentVersionId });
        await insertWorkflowVersionSummary(ctx, {
          ownerKey: principal.ownerKey,
          workflowId: existing._id,
          workflowVersionId: currentVersionId,
          version,
          createdAt,
        });
      }
      await upsertWorkflowSummary(ctx, {
        ...existing,
        ...normalizedArgs,
        ...ownership,
        version,
        currentVersionId,
      });
      return existing._id;
    }
    const createdAt = Date.now();
    const workflowId = await ctx.db.insert("workflows", {
      ...normalizedArgs,
      ...ownership,
      webhookSlug,
      webhookSecret,
      version: 1,
      createdAt,
    });
    const currentVersionId = await ctx.db.insert("workflowVersions", {
      ownerKey: principal.ownerKey,
      workflowId,
      version: 1,
      name: normalizedArgs.name,
      description: normalizedArgs.description,
      enabled: normalizedArgs.enabled,
      nodes: normalizedArgs.nodes,
      edges: normalizedArgs.edges,
      createdAt,
    });
    await ctx.db.patch(workflowId, { currentVersionId });
    await insertWorkflowVersionSummary(ctx, {
      ownerKey: principal.ownerKey,
      workflowId,
      workflowVersionId: currentVersionId,
      version: 1,
      createdAt,
    });
    await upsertWorkflowSummary(ctx, {
      _id: workflowId,
      ownerKey: principal.ownerKey,
      externalId: normalizedArgs.externalId,
      name: normalizedArgs.name,
      enabled: normalizedArgs.enabled,
      nodes: normalizedArgs.nodes,
      version: 1,
      currentVersionId,
      publishedVersionId: undefined,
      publishedVersion: undefined,
      createdAt,
      updatedAt: normalizedArgs.updatedAt,
    });
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
    await insertWorkflowVersionSummary(ctx, {
      ownerKey: principal.ownerKey,
      workflowId,
      workflowVersionId: currentVersionId,
      version,
      createdAt: now,
    });
    await upsertWorkflowSummary(ctx, { ...workflow, name: trimmed, version, currentVersionId, updatedAt: now });
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
      maxConcurrentRuns: source.maxConcurrentRuns ?? 3,
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
    await insertWorkflowVersionSummary(ctx, {
      ownerKey: principal.ownerKey,
      workflowId: duplicatedWorkflowId,
      workflowVersionId: currentVersionId,
      version: 1,
      createdAt: now,
    });
    await upsertWorkflowSummary(ctx, {
      _id: duplicatedWorkflowId,
      ownerKey: principal.ownerKey,
      externalId,
      name: trimmed,
      enabled: false,
      nodes: source.nodes,
      version: 1,
      currentVersionId,
      publishedVersionId: undefined,
      publishedVersion: undefined,
      createdAt: now,
      updatedAt: now,
    });
    return duplicatedWorkflowId;
  },
});

export const remove = mutation({
  args: { workflowId: v.id("workflows") },
  handler: async (ctx, { workflowId }) => {
    const principal = await requirePrincipal(ctx);
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.ownerKey !== principal.ownerKey) throw new Error("Workflow not found.");
    const [runs, versions, triggerEvents, runClaims, summary, versionSummaries] = await Promise.all([
      ctx.db.query("workflowRuns").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).collect(),
      ctx.db
        .query("workflowVersions")
        .withIndex("by_workflow_version", (q) => q.eq("workflowId", workflowId))
        .collect(),
      ctx.db.query("triggerEvents").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).collect(),
      ctx.db.query("runClaims").withIndex("by_workflow_key", (q) => q.eq("workflowId", workflowId)).collect(),
      ctx.db.query("workflowSummaries").withIndex("by_workflow", (q) => q.eq("workflowId", workflowId)).unique(),
      ctx.db.query("workflowVersionSummaries").withIndex("by_workflow_version", (q) => q.eq("workflowId", workflowId)).collect(),
    ]);
    await Promise.all(runs.map(async (run) => {
      const [steps, agentTasks, auditLogs, runLive, stepLive, agentLive] = await Promise.all([
        ctx.db.query("stepRuns").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("agentTasks").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("auditLogs").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("runLiveStates").withIndex("by_run", (q) => q.eq("runId", run._id)).unique(),
        ctx.db.query("stepLiveStates").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
        ctx.db.query("agentTaskLiveStates").withIndex("by_run", (q) => q.eq("runId", run._id)).collect(),
      ]);
      await Promise.all([
        ...steps.map((step) => ctx.db.delete(step._id)),
        ...agentTasks.map((task) => ctx.db.delete(task._id)),
        ...auditLogs.map((auditLog) => ctx.db.delete(auditLog._id)),
        ...stepLive.map((step) => ctx.db.delete(step._id)),
        ...agentLive.map((task) => ctx.db.delete(task._id)),
        ...(runLive ? [ctx.db.delete(runLive._id)] : []),
      ]);
      await ctx.db.delete(run._id);
    }));
    await Promise.all(versions.map((version) => ctx.db.delete(version._id)));
    await Promise.all(versionSummaries.map((version) => ctx.db.delete(version._id)));
    await Promise.all(triggerEvents.map((event) => ctx.db.delete(event._id)));
    await Promise.all(runClaims.map((claim) => ctx.db.delete(claim._id)));
    if (summary) await ctx.db.delete(summary._id);
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
