import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const resolve = internalQuery({
  args: { slug: v.string(), secret: v.string() },
  handler: async (ctx, { slug, secret }) => {
    const publishedWorkflow = await ctx.db
      .query("workflows")
      .withIndex("by_published_webhook_slug_secret", (q) =>
        q.eq("publishedWebhookSlug", slug).eq("webhookSecret", secret),
      )
      .unique();
    const workflow = publishedWorkflow ?? await ctx.db
      .query("workflows")
      .withIndex("by_webhook_slug_secret", (q) =>
        q.eq("webhookSlug", slug).eq("webhookSecret", secret),
      )
      .unique();
    if (!workflow?.enabled || !workflow.ownerKey || !workflow.ownerUserId) return null;
    const published = workflow.publishedVersionId ? await ctx.db.get(workflow.publishedVersionId) : null;
    const nodes = published?.workflowId === workflow._id ? published.nodes : workflow.nodes;
    const hasMatchingTrigger = nodes.some(
      (node) => node?.data?.nodeType === "webhookTrigger" && node?.data?.config?.slug?.trim() === slug,
    );
    return hasMatchingTrigger ? workflow : null;
  },
});
