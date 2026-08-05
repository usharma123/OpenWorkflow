import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";

export default defineSchema({
  workflows: defineTable({
    externalId: v.string(),
    name: v.string(),
    description: v.string(),
    enabled: v.boolean(),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
    webhookSecret: v.optional(v.string()),
    lastScheduleMinuteByNode: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_enabled", ["enabled"]),

  workflowRuns: defineTable({
    workflowId: v.id("workflows"),
    workflowEngineId: v.optional(vWorkflowId),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    trigger: v.string(),
    input: v.any(),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_workflow", ["workflowId"])
    .index("by_status", ["status"]),

  stepRuns: defineTable({
    runId: v.id("workflowRuns"),
    nodeId: v.string(),
    nodeLabel: v.string(),
    nodeType: v.string(),
    connectionRef: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("waiting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_run", ["runId"]),

  connections: defineTable({
    externalId: v.string(),
    provider: v.union(
      v.literal("google"),
      v.literal("slack"),
      v.literal("microsoft"),
    ),
    displayName: v.string(),
    ownerLabel: v.string(),
    scopes: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_reauth"), v.literal("disabled")),
    secretLocator: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_provider", ["provider"]),

  auditLogs: defineTable({
    runId: v.optional(v.id("workflowRuns")),
    stepRunId: v.optional(v.id("stepRuns")),
    event: v.string(),
    provider: v.optional(v.string()),
    connectionRef: v.optional(v.string()),
    outcome: v.union(v.literal("started"), v.literal("succeeded"), v.literal("failed"), v.literal("approved"), v.literal("rejected")),
    actor: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_created_at", ["createdAt"]),
});
