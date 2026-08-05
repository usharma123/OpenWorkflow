import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";

export default defineSchema({
  workflows: defineTable({
    ownerKey: v.optional(v.string()),
    ownerUserId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
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
    .index("by_owner_external_id", ["ownerKey", "externalId"])
    .index("by_enabled", ["enabled"]),

  workflowRuns: defineTable({
    ownerKey: v.optional(v.string()),
    ownerUserId: v.optional(v.string()),
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
    ownerKey: v.optional(v.string()),
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
    ownerKey: v.string(),
    clerkUserId: v.string(),
    organizationId: v.optional(v.string()),
    externalId: v.string(),
    provider: v.union(
      v.literal("google"),
      v.literal("slack"),
      v.literal("microsoft"),
    ),
    displayName: v.string(),
    ownerLabel: v.string(),
    externalAccountId: v.string(),
    scopes: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_reauth"), v.literal("disabled")),
    secretCiphertext: v.optional(v.string()),
    secretIv: v.optional(v.string()),
    secretVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_owner_external_id", ["ownerKey", "externalId"])
    .index("by_owner_provider", ["ownerKey", "provider"]),

  oauthStates: defineTable({
    stateHash: v.string(),
    provider: v.literal("slack"),
    ownerKey: v.string(),
    clerkUserId: v.string(),
    organizationId: v.optional(v.string()),
    returnUrl: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_state_hash", ["stateHash"]),

  auditLogs: defineTable({
    ownerKey: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
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
