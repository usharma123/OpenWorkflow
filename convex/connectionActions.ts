"use node";

import { createClerkClient } from "@clerk/backend";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { requirePrincipal } from "./auth";
import { decryptSecret, encryptSecret, hashValue, randomState } from "./secretCrypto";
import { hasRequiredScopes } from "./policies";

const GOOGLE_PROVIDER = "google" as const;
const GOOGLE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

const connectionFailure = (code: string, message: string) => new ConvexError({ code, message });

function clerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not configured in Convex.");
  return createClerkClient({ secretKey });
}

function safeReturnUrl(candidate?: string) {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL is not configured in Convex.");
  if (!URL.canParse(appUrl)) throw new Error("APP_URL is not a valid URL.");
  const allowed = new URL(appUrl);
  if (candidate && !URL.canParse(candidate, allowed)) throw new Error("OAuth return URL is invalid.");
  const requested = candidate ? new URL(candidate, allowed) : allowed;
  if (requested.origin !== allowed.origin) throw new Error("OAuth return URL must use the configured app origin.");
  requested.search = "";
  requested.hash = "";
  return requested.toString();
}

function callbackUrl(returnUrl: string, status: string, detail?: string) {
  const url = new URL(returnUrl);
  url.searchParams.set("integration", "slack");
  url.searchParams.set("status", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 160));
  return url.toString();
}

export const syncGoogle = action({
  args: {},
  handler: async (ctx) => {
    const principal = await requirePrincipal(ctx);
    let response;
    try {
      response = await clerkClient().users.getUserOauthAccessToken(principal.userId, GOOGLE_PROVIDER);
    } catch {
      throw connectionFailure(
        "CONNECTION_GOOGLE_AUTHORIZATION_FAILED",
        "Google authorization could not be loaded. Reauthorize Google Workspace and try again.",
      );
    }
    const tokens = response.data;
    await Promise.all(tokens.map((token) => {
      const scopes = token.scopes ?? [];
      return ctx.runMutation(internal.connections.upsertGoogle, {
        ownerKey: principal.ownerKey,
        clerkUserId: principal.userId,
        organizationId: principal.organizationId,
        externalId: `google:${token.externalAccountId}`,
        externalAccountId: token.externalAccountId,
        displayName: "Google Workspace",
        ownerLabel: token.label || "Connected Google account",
        scopes,
        status: hasRequiredScopes(scopes, GOOGLE_REQUIRED_SCOPES) ? "active" : "needs_reauth",
      });
    }));
    return { count: tokens.length };
  },
});

export const disconnectGoogle = action({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const principal = await requirePrincipal(ctx);
    const connection = await ctx.runQuery(internal.connections.getSecure, {
      ownerKey: principal.ownerKey,
      externalId,
    });
    if (!connection || connection.provider !== "google" || connection.clerkUserId !== principal.userId) {
      throw new Error("Google connection not found.");
    }
    // Disabling the connector must not delete the Clerk external account: it
    // may be the user's only sign-in identity. Reauthorization can reactivate
    // this local connector without risking account lockout.
    await ctx.runMutation(internal.connections.setStatus, {
      ownerKey: principal.ownerKey,
      externalId,
      status: "disabled",
    });
    return { identityPreserved: true };
  },
});

export const startSlackOAuth = action({
  args: { returnUrl: v.optional(v.string()) },
  handler: async (ctx, { returnUrl }) => {
    const principal = await requirePrincipal(ctx);
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      throw connectionFailure(
        "CONNECTION_SLACK_NOT_CONFIGURED",
        "Slack OAuth is not configured by the administrator.",
      );
    }
    const state = randomState();
    const safeUrl = safeReturnUrl(returnUrl);
    await ctx.runMutation(internal.connections.storeOauthState, {
      stateHash: hashValue(state),
      ownerKey: principal.ownerKey,
      clerkUserId: principal.userId,
      organizationId: principal.organizationId,
      returnUrl: safeUrl,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("scope", "chat:write");
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    return authorize.toString();
  },
});

export const finishSlackOAuth = internalAction({
  args: { state: v.string(), code: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string> => {
    const state = await ctx.runMutation(internal.connections.consumeOauthState, { stateHash: hashValue(args.state) });
    const fallback = process.env.APP_URL;
    if (!state) {
      return fallback
        ? callbackUrl(fallback, "error", "OAuth state expired or was already used.")
        : `/?integration=slack&status=error&detail=${encodeURIComponent("OAuth state expired or was already used.")}`;
    }
    if (args.error || !args.code) return callbackUrl(state.returnUrl, "denied", args.error ?? "Authorization was not completed.");

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return callbackUrl(state.returnUrl, "error", "Slack OAuth is not configured.");
    }
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: args.code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return callbackUrl(state.returnUrl, "error", `Slack token exchange failed (${response.status}).`);
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      scope?: string;
      bot_user_id?: string;
      team?: { id?: string; name?: string };
      enterprise?: { id?: string; name?: string };
    };
    const workspaceId = payload.team?.id ?? payload.enterprise?.id;
    if (!payload.ok || !payload.access_token || !workspaceId) {
      return callbackUrl(state.returnUrl, "error", payload.error ?? `Slack token exchange failed (${response.status}).`);
    }
    const encrypted = encryptSecret(payload.access_token);
    await ctx.runMutation(internal.connections.upsertSlack, {
      ownerKey: state.ownerKey,
      clerkUserId: state.clerkUserId,
      organizationId: state.organizationId,
      externalId: `slack:${workspaceId}`,
      externalAccountId: workspaceId,
      displayName: "Slack workspace",
      ownerLabel: payload.team?.name ?? payload.enterprise?.name ?? workspaceId,
      scopes: (payload.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean),
      ...encrypted,
    });
    return callbackUrl(state.returnUrl, "connected");
  },
});

export const disconnectSlack = action({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const principal = await requirePrincipal(ctx);
    const connection = await ctx.runQuery(internal.connections.getSecure, {
      ownerKey: principal.ownerKey,
      externalId,
    });
    if (!connection || connection.provider !== "slack") throw new Error("Slack connection not found.");
    let revoked = false;
    if (connection.secretCiphertext && connection.secretIv) {
      try {
        const token = decryptSecret(connection.secretCiphertext, connection.secretIv);
        const response = await fetch("https://slack.com/api/auth.revoke", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const payload = (await response.json()) as { ok?: boolean };
          revoked = Boolean(payload.ok);
        }
      } catch {
        revoked = false;
      }
    }
    await ctx.runMutation(internal.connections.setStatus, {
      ownerKey: principal.ownerKey,
      externalId,
      status: "disabled",
      clearSecret: true,
    });
    return { revoked };
  },
});
