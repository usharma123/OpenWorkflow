import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requirePrincipal } from "./auth";

const provider = v.union(v.literal("google"), v.literal("slack"), v.literal("microsoft"));
const status = v.union(v.literal("active"), v.literal("needs_reauth"), v.literal("disabled"));

function publicConnection(connection: Doc<"connections">) {
  if (!connection.ownerKey || !connection.clerkUserId || !connection.externalAccountId) return null;
  return {
    _id: connection._id,
    _creationTime: connection._creationTime,
    externalId: connection.externalId,
    provider: connection.provider,
    displayName: connection.displayName,
    ownerLabel: connection.ownerLabel,
    externalAccountId: connection.externalAccountId,
    scopes: connection.scopes,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastUsedAt: connection.lastUsedAt,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx);
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) => q.eq("ownerKey", principal.ownerKey))
      .collect();
    const visible = [];
    for (const connection of connections) {
      if (connection.provider === "google" && connection.clerkUserId !== principal.userId) continue;
      const value = publicConnection(connection);
      if (value) visible.push(value);
    }
    return visible;
  },
});
export const auditForRun = query({
  args: { runId: v.id("workflowRuns") },
  handler: async (ctx, { runId }) => {
    const principal = await requirePrincipal(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.ownerKey !== principal.ownerKey) throw new Error("Run not found.");
    return ctx.db.query("auditLogs").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
  },
});

export const getSecure = internalQuery({
  args: { ownerKey: v.string(), externalId: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("connections")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("externalId", args.externalId),
      )
      .unique(),
});

export const listForOwnerProvider = internalQuery({
  args: { ownerKey: v.string(), provider },
  handler: async (ctx, args) =>
    ctx.db
      .query("connections")
      .withIndex("by_owner_provider", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("provider", args.provider),
      )
      .collect(),
});

export const upsertGoogle = internalMutation({
  args: {
    ownerKey: v.string(),
    clerkUserId: v.string(),
    organizationId: v.optional(v.string()),
    externalId: v.string(),
    externalAccountId: v.string(),
    displayName: v.string(),
    ownerLabel: v.string(),
    scopes: v.array(v.string()),
    status,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("externalId", args.externalId),
      )
      .unique();
    const value = { ...args, provider: "google" as const, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("connections", { ...value, createdAt: Date.now() });
  },
});

export const upsertSlack = internalMutation({
  args: {
    ownerKey: v.string(),
    clerkUserId: v.string(),
    organizationId: v.optional(v.string()),
    externalId: v.string(),
    externalAccountId: v.string(),
    displayName: v.string(),
    ownerLabel: v.string(),
    scopes: v.array(v.string()),
    secretCiphertext: v.string(),
    secretIv: v.string(),
    secretVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("externalId", args.externalId),
      )
      .unique();
    const value = { ...args, provider: "slack" as const, status: "active" as const, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("connections", { ...value, createdAt: Date.now() });
  },
});

export const setStatus = internalMutation({
  args: {
    ownerKey: v.string(),
    externalId: v.string(),
    status,
    clearSecret: v.optional(v.boolean()),
    scopes: v.optional(v.array(v.string())),
    lastUsedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("connections")
      .withIndex("by_owner_external_id", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("externalId", args.externalId),
      )
      .unique();
    if (!connection) return;
    await ctx.db.patch(connection._id, {
      status: args.status,
      ...(args.scopes ? { scopes: args.scopes } : {}),
      ...(args.lastUsedAt ? { lastUsedAt: args.lastUsedAt } : {}),
      ...(args.clearSecret
        ? { secretCiphertext: undefined, secretIv: undefined, secretVersion: undefined }
        : {}),
      updatedAt: Date.now(),
    });
  },
});

export const storeOauthState = internalMutation({
  args: {
    stateHash: v.string(),
    ownerKey: v.string(),
    clerkUserId: v.string(),
    organizationId: v.optional(v.string()),
    returnUrl: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("oauthStates", {
      ...args,
      provider: "slack",
      createdAt: Date.now(),
    }),
});

export const consumeOauthState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, { stateHash }) => {
    const state = await ctx.db
      .query("oauthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", stateHash))
      .unique();
    if (!state) return null;
    await ctx.db.delete(state._id);
    if (state.expiresAt < Date.now()) return null;
    return state;
  },
});

export const cleanupExpiredOauthStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("oauthStates")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now()))
      .collect();
    await Promise.all(expired.map((state) => ctx.db.delete(state._id)));
    return expired.length;
  },
});

export const cleanupLegacyConnections = internalMutation({
  args: {},
  handler: async (ctx) => {
    const connections = await ctx.db.query("connections").collect();
    const operations = connections.map((connection) => {
      if (!connection.ownerKey || !connection.clerkUserId || !connection.externalAccountId) {
        return ctx.db.delete(connection._id);
      }
      if (connection.secretLocator !== undefined) {
        return ctx.db.patch(connection._id, { secretLocator: undefined });
      }
      return Promise.resolve();
    });
    await Promise.all(operations);
    const removed = connections.filter(
      (connection) => !connection.ownerKey || !connection.clerkUserId || !connection.externalAccountId,
    ).length;
    return removed;
  },
});
