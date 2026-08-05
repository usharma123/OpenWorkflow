"use node";

import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { decryptSecret } from "./secretCrypto";
import { hasRequiredScopes } from "./policies";
import { renderTemplate } from "./template";

type WorkflowNode = {
  data: { nodeType: string; config: Record<string, unknown> };
};

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DOCS_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

async function markNeedsReauth(ctx: ActionCtx, ownerKey: string, externalId: string, scopes?: string[]) {
  await ctx.runMutation(internal.connections.setStatus, {
    ownerKey,
    externalId,
    status: "needs_reauth",
    ...(scopes ? { scopes } : {}),
  });
}

export const executeLiveConnector = internalAction({
  args: {
    node: v.any(),
    input: v.any(),
    ownerKey: v.string(),
    ownerUserId: v.string(),
  },
  handler: async (ctx, { node, input, ownerKey, ownerUserId }): Promise<unknown> => {
    const typedNode = node as WorkflowNode;
    const { nodeType, config } = typedNode.data;
    const connectionRef = String(config.connectionRef ?? "");
    if (!connectionRef) throw new Error("Choose a connected account before running this step.");
    const connection = await ctx.runQuery(internal.connections.getSecure, { ownerKey, externalId: connectionRef });
    if (!connection || connection.status !== "active") {
      throw new Error("This connection is unavailable. Open Connectors and reconnect it before running again.");
    }

    if (nodeType === "gmailTrigger" || nodeType === "googleDoc") {
      if (connection.provider !== "google" || connection.clerkUserId !== ownerUserId) {
        throw new Error("The selected Google connection does not belong to this workflow owner.");
      }
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) throw new Error("CLERK_SECRET_KEY is not configured in Convex.");
      const response = await createClerkClient({ secretKey }).users.getUserOauthAccessToken(ownerUserId, "google");
      const oauth = response.data.find((token) => token.externalAccountId === connection.externalAccountId);
      if (!oauth) {
        await markNeedsReauth(ctx, ownerKey, connectionRef);
        throw new Error("Google authorization expired or was removed. Reconnect Google Workspace and try again.");
      }
      const scopes = oauth.scopes ?? [];
      const required = nodeType === "gmailTrigger" ? [GMAIL_SCOPE] : DOCS_SCOPES;
      if (!hasRequiredScopes(scopes, required)) {
        await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
        throw new Error(`Google is missing required permission${required.length > 1 ? "s" : ""}: ${required.join(", ")}. Reauthorize the account from Connectors.`);
      }

      if (nodeType === "gmailTrigger") {
        const maxResults = Math.min(25, Math.max(1, Number(config.maxMessages ?? 5)));
        const query = encodeURIComponent(String(config.search ?? "is:unread newer_than:1d"));
        const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxResults}`, {
          headers: { Authorization: `Bearer ${oauth.token}` },
        });
        if (listResponse.status === 401 || listResponse.status === 403) {
          await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
          throw new Error("Gmail rejected this grant. Reconnect Google Workspace and approve Gmail read access.");
        }
        if (!listResponse.ok) throw new Error(`Gmail could not read the inbox (${listResponse.status}).`);
        const list = (await listResponse.json()) as { messages?: Array<{ id: string }> };
        const messages = await Promise.all((list.messages ?? []).map(async ({ id }) => {
          const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${oauth.token}` },
          });
          if (!messageResponse.ok) throw new Error(`Gmail could not read message metadata (${messageResponse.status}).`);
          const message = (await messageResponse.json()) as { snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
          const headers = Object.fromEntries((message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
          return { from: headers.from ?? "Unknown sender", subject: headers.subject ?? "(No subject)", receivedAt: headers.date, snippet: message.snippet ?? "" };
        }));
        await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", scopes, lastUsedAt: Date.now() });
        return { messages, count: messages.length, date: new Date().toLocaleDateString("en-US"), source: "gmail" };
      }

      const content = typeof input === "object" && input && typeof (input as Record<string, unknown>).content === "string"
        ? String((input as Record<string, unknown>).content)
        : JSON.stringify(input, null, 2);
      const title = renderTemplate(String(config.title ?? "OpenWorkflow brief"), input);
      const createResponse = await fetch("https://docs.googleapis.com/v1/documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (createResponse.status === 401 || createResponse.status === 403) {
        await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
        throw new Error("Google Docs rejected this grant. Reauthorize Google Workspace with Docs and Drive permissions.");
      }
      if (!createResponse.ok) throw new Error(`Google Docs could not create the document (${createResponse.status}).`);
      const document = (await createResponse.json()) as { documentId?: string };
      if (!document.documentId) throw new Error("Google Docs did not return a document ID.");
      const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${document.documentId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
      });
      if (!updateResponse.ok) throw new Error(`Google Docs created the file but could not add the brief (${updateResponse.status}).`);
      const folderName = String(config.folder ?? "").trim();
      if (folderName) {
        const escapedName = folderName.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
        const search = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id,name)&spaces=drive&pageSize=1`, {
          headers: { Authorization: `Bearer ${oauth.token}` },
        });
        if (!search.ok) throw new Error(`Google Drive could not locate the destination folder (${search.status}).`);
        const found = (await search.json()) as { files?: Array<{ id: string }> };
        let folderId = found.files?.[0]?.id;
        if (!folderId) {
          const createFolder = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
            method: "POST",
            headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
          });
          if (!createFolder.ok) throw new Error(`Google Drive could not create the destination folder (${createFolder.status}).`);
          const folder = (await createFolder.json()) as { id?: string };
          if (!folder.id) throw new Error("Google Drive did not return a folder ID.");
          folderId = folder.id;
        }
        const file = await fetch(`https://www.googleapis.com/drive/v3/files/${document.documentId}?fields=parents`, { headers: { Authorization: `Bearer ${oauth.token}` } });
        if (!file.ok) throw new Error(`Google Drive could not inspect the new document (${file.status}).`);
        const fileMetadata = (await file.json()) as { parents?: string[] };
        const move = await fetch(`https://www.googleapis.com/drive/v3/files/${document.documentId}?addParents=${encodeURIComponent(folderId)}&removeParents=${encodeURIComponent((fileMetadata.parents ?? []).join(","))}&fields=id,parents`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${oauth.token}` },
        });
        if (!move.ok) throw new Error(`Google Drive could not place the document in ${folderName} (${move.status}).`);
      }
      await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", scopes, lastUsedAt: Date.now() });
      return { ...(input && typeof input === "object" ? input as Record<string, unknown> : {}), documentTitle: title, documentUrl: `https://docs.google.com/document/d/${document.documentId}/edit`, documentMode: "live" };
    }

    if (nodeType === "slack") {
      if (connection.provider !== "slack" || !connection.secretCiphertext || !connection.secretIv || !hasRequiredScopes(connection.scopes, ["chat:write"])) {
        await markNeedsReauth(ctx, ownerKey, connectionRef);
        throw new Error("Slack is missing chat:write or its token is unavailable. Reconnect the workspace.");
      }
      const token = decryptSecret(connection.secretCiphertext, connection.secretIv);
      const channel = String(config.channel ?? "");
      if (!channel || channel.startsWith("#")) throw new Error("Slack connected mode requires a channel ID such as C0123456789, not a #channel name.");
      const message = renderTemplate(String(config.message ?? "{{input.documentUrl}}"), input);
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel, text: message, unfurl_links: false }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Slack could not post the approved link (${response.status}).`);
      const payload = (await response.json()) as { ok?: boolean; error?: string; ts?: string; channel?: string };
      if (!payload.ok) {
        if (["invalid_auth", "token_revoked", "account_inactive", "missing_scope"].includes(payload.error ?? "")) {
          await markNeedsReauth(ctx, ownerKey, connectionRef);
        }
        throw new Error(`Slack could not post the approved link: ${payload.error ?? response.status}.`);
      }
      await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", lastUsedAt: Date.now() });
      return { ...(input && typeof input === "object" ? input as Record<string, unknown> : {}), delivery: { provider: "slack", channel: payload.channel ?? channel, message, status: "sent", messageId: payload.ts } };
    }

    throw new Error(`Unsupported live connector: ${nodeType}`);
  },
});
