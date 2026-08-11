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
    maxConcurrentRuns: v.optional(v.number()),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
    webhookSlug: v.optional(v.string()),
    publishedWebhookSlug: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    lastScheduleMinuteByNode: v.optional(v.any()),
    googleTriggerState: v.optional(v.any()),
    version: v.optional(v.number()),
    currentVersionId: v.optional(v.id("workflowVersions")),
    publishedVersionId: v.optional(v.id("workflowVersions")),
    publishedVersion: v.optional(v.number()),
    publishedOwnerUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_external_id", ["ownerKey", "externalId"])
    .index("by_owner_updated_at", ["ownerKey", "updatedAt"])
    .index("by_webhook_slug_secret", ["webhookSlug", "webhookSecret"])
    .index("by_published_webhook_slug_secret", ["publishedWebhookSlug", "webhookSecret"])
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
    idempotencyKey: v.optional(v.string()),
    runMode: v.optional(v.union(v.literal("full"), v.literal("single"), v.literal("through"), v.literal("resume"))),
    scopeNodeId: v.optional(v.string()),
    retryOfRunId: v.optional(v.id("workflowRuns")),
    seedOutputs: v.optional(v.any()),
    input: v.any(),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_workflow", ["workflowId"])
    .index("by_workflow_status", ["workflowId", "status"])
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
    partialToolTrace: v.optional(
      v.array(
        v.object({
          tool: v.string(),
          summary: v.string(),
          ok: v.boolean(),
          stepIndex: v.optional(v.number()),
          stepStatus: v.optional(v.string()),
        }),
      ),
    ),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    plan: v.optional(
      v.object({
        steps: v.array(
          v.object({
            title: v.string(),
            status: v.union(
              v.literal("pending"),
              v.literal("active"),
              v.literal("done"),
              v.literal("skipped"),
            ),
          }),
        ),
        status: v.union(v.literal("proposed"), v.literal("approved"), v.literal("rejected")),
        note: v.optional(v.string()),
      }),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_run", ["runId"]),

  /** Durable runtime children spawned by an AI step. These are execution state,
   * not workflow-definition nodes, so the editor can visualize them live
   * without accidentally saving them into the authored graph. */
  agentTasks: defineTable({
    ownerKey: v.string(),
    runId: v.id("workflowRuns"),
    stepRunId: v.id("stepRuns"),
    taskKey: v.string(),
    name: v.string(),
    objective: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attempt: v.number(),
    partialOutput: v.optional(v.string()),
    toolTrace: v.optional(
      v.array(v.object({
        tool: v.string(),
        summary: v.string(),
        ok: v.boolean(),
      })),
    ),
    content: v.optional(v.string()),
    citations: v.optional(v.array(v.object({ title: v.string(), url: v.string() }))),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_step", ["stepRunId"]),

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

  triggerEvents: defineTable({
    ownerKey: v.string(),
    workflowId: v.id("workflows"),
    nodeId: v.string(),
    dedupeKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_workflow", ["workflowId"])
    .index("by_created_at", ["createdAt"]),

  buildChatMessages: defineTable({
    ownerKey: v.string(),
    workflowExternalId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    proposal: v.optional(
      v.object({
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        nodes: v.array(v.any()),
        edges: v.array(v.any()),
      }),
    ),
    questions: v.optional(
      v.array(
        v.object({
          id: v.string(),
          prompt: v.string(),
          allowMultiple: v.optional(v.boolean()),
          options: v.array(v.object({ id: v.string(), label: v.string() })),
        }),
      ),
    ),
    appliedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_owner_workflow", ["ownerKey", "workflowExternalId"]),

  runClaims: defineTable({
    workflowId: v.id("workflows"),
    idempotencyKey: v.string(),
    runId: v.id("workflowRuns"),
    createdAt: v.number(),
  })
    .index("by_workflow_key", ["workflowId", "idempotencyKey"])
    .index("by_created_at", ["createdAt"]),
});
