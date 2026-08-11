"use node";

import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { decryptSecret } from "./secretCrypto";
import { hasRequiredScopes } from "./policies";
import { renderTemplate } from "./template";
import { markdownToGoogleDocs } from "../shared/googleDocsMarkdown";

type WorkflowNode = {
  data: { nodeType: string; config: Record<string, unknown> };
};

const GOOGLE_NODE_SCOPES: Record<string, string[]> = {
  gmailTrigger: ["https://www.googleapis.com/auth/gmail.readonly"],
  googleDoc: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
  ],
  gmailSend: ["https://www.googleapis.com/auth/gmail.send"],
  calendarEvent: ["https://www.googleapis.com/auth/calendar.events"],
  sheetsAppend: ["https://www.googleapis.com/auth/spreadsheets"],
  driveUpload: ["https://www.googleapis.com/auth/drive.file"],
};

async function markNeedsReauth(ctx: ActionCtx, ownerKey: string, externalId: string, scopes?: string[]) {
  await ctx.runMutation(internal.connections.setStatus, {
    ownerKey,
    externalId,
    status: "needs_reauth",
    ...(scopes ? { scopes } : {}),
  });
}

async function ensureDriveFolder(token: string, folderName: string): Promise<string> {
  const escapedName = folderName.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const search = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id,name)&spaces=drive&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!search.ok) throw new Error(`Google Drive could not locate the destination folder (${search.status}).`);
  const found = (await search.json()) as { files?: Array<{ id: string }> };
  const existing = found.files?.[0]?.id;
  if (existing) return existing;
  const createFolder = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createFolder.ok) throw new Error(`Google Drive could not create the destination folder (${createFolder.status}).`);
  const folder = (await createFolder.json()) as { id?: string };
  if (!folder.id) throw new Error("Google Drive did not return a folder ID.");
  return folder.id;
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function base64Encode(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlEncode(text: string) {
  return base64Encode(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export const executeLiveConnector = internalAction({
  args: {
    node: v.any(),
    input: v.any(),
    stepOutputs: v.any(),
    ownerKey: v.string(),
    ownerUserId: v.string(),
  },
  handler: async (ctx, { node, input, stepOutputs, ownerKey, ownerUserId }): Promise<unknown> => {
    const typedNode = node as WorkflowNode;
    const { nodeType, config } = typedNode.data;
    const connectionRef = String(config.connectionRef ?? "");
    if (!connectionRef) throw new Error("Choose a connected account before running this step.");
    const connection = await ctx.runQuery(internal.connections.getSecure, { ownerKey, externalId: connectionRef });
    if (!connection || connection.status !== "active") {
      throw new Error("This connection is unavailable. Open Connectors and reconnect it before running again.");
    }

    if (nodeType in GOOGLE_NODE_SCOPES) {
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
      const required = GOOGLE_NODE_SCOPES[nodeType] ?? [];
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

      if (nodeType === "gmailSend") {
        const to = renderTemplate(String(config.to ?? ""), input, stepOutputs).replace(/[\r\n]+/g, " ").trim();
        if (!to) throw new Error("Add a recipient email address before sending Gmail.");
        const subject = renderTemplate(String(config.subject ?? ""), input, stepOutputs).replace(/[\r\n]+/g, " ").trim();
        const body = renderTemplate(String(config.body ?? "{{input.content}}"), input, stepOutputs);
        const encodedSubject = /^[\x20-\x7e]*$/.test(subject)
          ? subject
          : `=?UTF-8?B?${base64Encode(subject)}?=`;
        const raw = base64UrlEncode(
          [`To: ${to}`, `Subject: ${encodedSubject}`, 'Content-Type: text/plain; charset="UTF-8"', "", body].join("\r\n"),
        );
        const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        if (sendResponse.status === 401 || sendResponse.status === 403) {
          await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
          throw new Error("Gmail rejected this grant. Reconnect Google Workspace and approve Gmail send access.");
        }
        if (!sendResponse.ok) throw new Error(`Gmail could not send the message (${sendResponse.status}).`);
        const sent = (await sendResponse.json()) as { id?: string };
        await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", scopes, lastUsedAt: Date.now() });
        return { ...inputRecord(input), delivery: { provider: "gmail", to, subject, status: "sent", messageId: sent.id } };
      }

      if (nodeType === "calendarEvent") {
        const calendarId = String(config.calendarId ?? "primary").trim() || "primary";
        const title = renderTemplate(String(config.title ?? "OpenWorkflow event"), input, stepOutputs);
        const description = renderTemplate(String(config.description ?? ""), input, stepOutputs);
        const startText = renderTemplate(String(config.startIso ?? ""), input, stepOutputs).trim();
        const start = startText ? new Date(startText) : new Date(Date.now() + 60 * 60 * 1000);
        if (Number.isNaN(start.getTime())) {
          throw new Error("Calendar start time must be an ISO timestamp such as 2026-08-11T15:00:00Z, or blank to schedule one hour from now.");
        }
        const durationMinutes = Math.min(24 * 60, Math.max(5, Number(config.durationMinutes ?? 30)));
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        const eventResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: title,
            description,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
          }),
        });
        if (eventResponse.status === 401 || eventResponse.status === 403) {
          await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
          throw new Error("Google Calendar rejected this grant. Reauthorize Google Workspace with Calendar event access.");
        }
        if (!eventResponse.ok) throw new Error(`Google Calendar could not create the event (${eventResponse.status}).`);
        const event = (await eventResponse.json()) as { id?: string; htmlLink?: string };
        await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", scopes, lastUsedAt: Date.now() });
        return {
          ...inputRecord(input),
          event: { title, start: start.toISOString(), end: end.toISOString(), eventUrl: event.htmlLink, eventId: event.id, status: "created" },
        };
      }

      if (nodeType === "sheetsAppend") {
        const spreadsheetId = renderTemplate(String(config.spreadsheetId ?? ""), input, stepOutputs).trim();
        if (!spreadsheetId) throw new Error("Add a spreadsheet ID before appending a row.");
        const range = String(config.range ?? "Sheet1!A:Z").trim() || "Sheet1!A:Z";
        const valuesText = renderTemplate(String(config.values ?? ""), input, stepOutputs).trim();
        if (!valuesText) throw new Error("Add the row values before appending to the sheet.");
        let row: unknown[];
        try {
          const parsed: unknown = JSON.parse(valuesText);
          row = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          row = valuesText.split(",").map((cell) => cell.trim());
        }
        const appendResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
          method: "POST",
          headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: [row] }),
        });
        if (appendResponse.status === 401 || appendResponse.status === 403) {
          await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
          throw new Error("Google Sheets rejected this grant. Reauthorize Google Workspace with Sheets write access.");
        }
        if (!appendResponse.ok) throw new Error(`Google Sheets could not append the row (${appendResponse.status}).`);
        const appended = (await appendResponse.json()) as { updates?: { updatedRange?: string } };
        await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", scopes, lastUsedAt: Date.now() });
        return {
          ...inputRecord(input),
          sheetAppend: { spreadsheetId, range: appended.updates?.updatedRange ?? range, cells: row.length, status: "appended" },
        };
      }

      if (nodeType === "driveUpload") {
        const fileName = renderTemplate(String(config.fileName ?? "openworkflow-result.txt"), input, stepOutputs).trim() || "openworkflow-result.txt";
        const templated = renderTemplate(String(config.content ?? ""), input, stepOutputs);
        const fileContent = templated || JSON.stringify(input, null, 2);
        const folderName = String(config.folder ?? "").trim();
        const parents = folderName ? [await ensureDriveFolder(oauth.token, folderName)] : undefined;
        const boundary = `openworkflow-${crypto.randomUUID()}`;
        const multipartBody = [
          `--${boundary}`,
          "Content-Type: application/json; charset=UTF-8",
          "",
          JSON.stringify({ name: fileName, ...(parents ? { parents } : {}) }),
          `--${boundary}`,
          "Content-Type: text/plain; charset=UTF-8",
          "",
          fileContent,
          `--${boundary}--`,
          "",
        ].join("\r\n");
        const uploadResponse = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
          method: "POST",
          headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
          body: multipartBody,
        });
        if (uploadResponse.status === 401 || uploadResponse.status === 403) {
          await markNeedsReauth(ctx, ownerKey, connectionRef, scopes);
          throw new Error("Google Drive rejected this grant. Reauthorize Google Workspace with Drive file access.");
        }
        if (!uploadResponse.ok) throw new Error(`Google Drive could not upload the file (${uploadResponse.status}).`);
        const file = (await uploadResponse.json()) as { id?: string; webViewLink?: string };
        if (!file.id) throw new Error("Google Drive did not return a file ID.");
        await ctx.runMutation(internal.connections.setStatus, { ownerKey, externalId: connectionRef, status: "active", scopes, lastUsedAt: Date.now() });
        return {
          ...inputRecord(input),
          file: {
            name: fileName,
            fileUrl: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
            fileId: file.id,
            ...(folderName ? { folder: folderName } : {}),
            status: "uploaded",
          },
        };
      }

      const content = typeof input === "object" && input && typeof (input as Record<string, unknown>).content === "string"
        ? String((input as Record<string, unknown>).content)
        : JSON.stringify(input, null, 2);
      const title = renderTemplate(String(config.title ?? "OpenWorkflow brief"), input, stepOutputs);
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
      const formatted = markdownToGoogleDocs(content);
      const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${document.documentId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${oauth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: formatted.requests }),
      });
      if (!updateResponse.ok) throw new Error(`Google Docs created the file but could not add the brief (${updateResponse.status}).`);
      const folderName = String(config.folder ?? "").trim();
      if (folderName) {
        const folderId = await ensureDriveFolder(oauth.token, folderName);
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
      return { ...(input && typeof input === "object" ? input as Record<string, unknown> : {}), documentTitle: title, documentUrl: `https://docs.google.com/document/d/${document.documentId}/edit` };
    }

    if (nodeType === "slack") {
      if (connection.provider !== "slack" || !connection.secretCiphertext || !connection.secretIv || !hasRequiredScopes(connection.scopes, ["chat:write"])) {
        await markNeedsReauth(ctx, ownerKey, connectionRef);
        throw new Error("Slack is missing chat:write or its token is unavailable. Reconnect the workspace.");
      }
      const token = decryptSecret(connection.secretCiphertext, connection.secretIv);
      const channel = String(config.channel ?? "");
      if (!channel || channel.startsWith("#")) throw new Error("Slack connected mode requires a channel ID such as C0123456789, not a #channel name.");
      const message = renderTemplate(String(config.message ?? "{{input.documentUrl}}"), input, stepOutputs);
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
