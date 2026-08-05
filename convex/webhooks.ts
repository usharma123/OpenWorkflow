import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const resolve = internalQuery({
  args: { slug: v.string(), secret: v.string() },
  handler: async (ctx, { slug, secret }) => {
    const workflow = await ctx.db
      .query("workflows")
      .withIndex("by_webhook_slug_secret", (q) =>
        q.eq("webhookSlug", slug).eq("webhookSecret", secret),
      )
      .unique();
    if (!workflow?.enabled || !workflow.ownerKey || !workflow.ownerUserId) return null;
    const hasMatchingTrigger = workflow.nodes.some(
      (node) => node?.data?.nodeType === "webhookTrigger" && node?.data?.config?.slug?.trim() === slug,
    );
    return hasMatchingTrigger ? workflow : null;
  },
});
