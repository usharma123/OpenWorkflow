import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type WorkflowSummarySource = Pick<
  Doc<"workflows">,
  "_id" | "ownerKey" | "externalId" | "name" | "enabled" | "nodes" | "version" |
  "currentVersionId" | "publishedVersionId" | "publishedVersion" | "createdAt" | "updatedAt"
>;

export async function upsertWorkflowSummary(ctx: MutationCtx, workflow: WorkflowSummarySource) {
  if (!workflow.ownerKey) return;
  const existing = await ctx.db
    .query("workflowSummaries")
    .withIndex("by_workflow", (q) => q.eq("workflowId", workflow._id))
    .unique();
  const value = {
    ownerKey: workflow.ownerKey,
    workflowId: workflow._id,
    externalId: workflow.externalId,
    name: workflow.name,
    enabled: workflow.enabled,
    nodeCount: workflow.nodes.length,
    version: workflow.version ?? 1,
    currentVersionId: workflow.currentVersionId,
    publishedVersionId: workflow.publishedVersionId,
    publishedVersion: workflow.publishedVersion,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("workflowSummaries", value);
}

export async function insertWorkflowVersionSummary(
  ctx: MutationCtx,
  value: {
    ownerKey: string;
    workflowId: Id<"workflows">;
    workflowVersionId: Id<"workflowVersions">;
    version: number;
    createdAt: number;
  },
) {
  const existing = await ctx.db
    .query("workflowVersionSummaries")
    .withIndex("by_version_id", (q) => q.eq("workflowVersionId", value.workflowVersionId))
    .unique();
  if (!existing) await ctx.db.insert("workflowVersionSummaries", value);
}
