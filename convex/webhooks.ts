import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const resolve = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const workflows = await ctx.db.query("workflows").withIndex("by_enabled", (q) => q.eq("enabled", true)).collect();
    const matches = workflows.filter((workflow) =>
      workflow.ownerKey &&
      workflow.ownerUserId &&
      workflow.webhookSecret &&
      workflow.nodes.some((node) => node?.data?.nodeType === "webhookTrigger" && node?.data?.config?.slug === slug),
    );
    return matches.length === 1 ? matches[0] : null;
  },
});

