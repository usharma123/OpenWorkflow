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
    webhookSlug: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    lastScheduleMinuteByNode: v.optional(v.any()),
    version: v.optional(v.number()),
    currentVersionId: v.optional(v.id("workflowVersions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_external_id", ["ownerKey", "externalId"])
    .index("by_owner_updated_at", ["ownerKey", "updatedAt"])
    .index("by_webhook_slug_secret", ["webhookSlug", "webhookSecret"])
    .index("by_enabled", ["enabled"]),

  workflowVersions: defineTable({
    ownerKey: v.string(),
    workflowId: v.id("workflows"),
    version: v.number(),
    name: v.string(),
    description: v.string(),
    enabled: v.boolean(),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
    createdAt: v.number(),
  })
    .index("by_workflow_version", ["workflowId", "version"])
    .index("by_owner_created_at", ["ownerKey", "createdAt"]),

  workflowRuns: defineTable({
    ownerKey: v.optional(v.string()),
    ownerUserId: v.optional(v.string()),
    workflowId: v.id("workflows"),
    workflowEngineId: v.optional(vWorkflowId),
    workflowVersionId: v.optional(v.id("workflowVersions")),
    workflowVersion: v.optional(v.number()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    trigger: v.string(),
    runMode: v.optional(v.union(v.literal("full"), v.literal("single"), v.literal("through"))),
    scopeNodeId: v.optional(v.string()),
    input: v.any(),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_workflow", ["workflowId"])
    .index("by_status", ["status"])
    .index("by_owner_started_at", ["ownerKey", "startedAt"]),

  stepRuns: defineTable({
    ownerKey: v.optional(v.string()),
    runId: v.id("workflowRuns"),
    nodeId: v.string(),
    nodeLabel: v.string(),
    nodeType: v.string(),
    connectionRef: v.optional(v.string()),
    sandboxBoundaryId: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("waiting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    input: v.optional(v.any()),
    partialOutput: v.optional(v.string()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_run", ["runId"]),

  connections: defineTable({
    // Transitional optionals allow deployment over pre-auth POC rows. The
    // scheduled legacy cleanup removes rows that cannot be owner-isolated.
    ownerKey: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    externalId: v.string(),
    provider: v.union(
      v.literal("google"),
      v.literal("slack"),
      v.literal("microsoft"),
    ),
    displayName: v.string(),
    ownerLabel: v.string(),
    externalAccountId: v.optional(v.string()),
    scopes: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_reauth"), v.literal("disabled")),
    secretCiphertext: v.optional(v.string()),
    secretIv: v.optional(v.string()),
    secretVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    secretLocator: v.optional(v.string()),
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
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_expires_at", ["expiresAt"]),

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
    .index("by_created_at", ["createdAt"])
    .index("by_owner_created_at", ["ownerKey", "createdAt"]),
});
