"use node";

import { createClerkClient } from "@clerk/backend";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { hasRequiredScopes } from "./policies";
import { sheetRowChanges } from "./googleTriggerPolicy";

type Candidate = {
  workflowId: import("./_generated/dataModel").Id<"workflows">;
  ownerKey: string;
  ownerUserId: string;
  nodeId: string;
  nodeType: string;
  config: Record<string, unknown>;
  connectionRef: string;
  state?: unknown;
};

type TriggerEvent = { key: string; input: Record<string, unknown> };

const requiredScopes: Record<string, string[]> = {
  gmailEventTrigger: ["https://www.googleapis.com/auth/gmail.readonly"],
  calendarTrigger: ["https://www.googleapis.com/auth/calendar.readonly"],
  driveTrigger: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
  sheetsTrigger: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
};

function clerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not configured in Convex.");
  return createClerkClient({ secretKey });
}

function stateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function googleJson(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google trigger request failed (${response.status}).`);
  return await response.json() as Record<string, unknown>;
}

async function gmailEvents(candidate: Candidate, token: string, cursor: number): Promise<TriggerEvent[]> {
  const query = `${String(candidate.config.query ?? "is:unread")} after:${Math.floor(cursor / 1000)}`.trim();
  const list = await googleJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
    token,
  );
  const messages = Array.isArray(list.messages) ? list.messages as Array<{ id?: string }> : [];
  const messageIds = messages.flatMap((item) => item.id ? [item.id] : []);
  const events = await Promise.all(messageIds.reverse().map(async (id): Promise<TriggerEvent> => {
    const message = await googleJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      token,
    );
    const payload = stateRecord(message.payload);
    const headers = Array.isArray(payload.headers) ? payload.headers as Array<{ name?: string; value?: string }> : [];
    const metadata = Object.fromEntries(headers.map((header) => [String(header.name ?? "").toLowerCase(), header.value ?? ""]));
    return {
      key: id,
      input: {
        messages: [{
          id,
          threadId: message.threadId,
          from: metadata.from,
          to: metadata.to,
          subject: metadata.subject || "(No subject)",
          receivedAt: metadata.date,
        }],
        count: 1,
      },
    };
  }));
  return events;
}

async function calendarEvents(candidate: Candidate, token: string, cursor: number): Promise<TriggerEvent[]> {
  const calendarId = String(candidate.config.calendarId ?? "primary");
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("updatedMin", new Date(cursor).toISOString());
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("maxResults", "50");
  const payload = await googleJson(url.toString(), token);
  const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];
  return items.flatMap((event) => {
    const id = typeof event.id === "string" ? event.id : "";
    const updated = typeof event.updated === "string" ? event.updated : "";
    if (!id || !updated || Date.parse(updated) <= cursor || event.status === "cancelled") return [];
    return [{
      key: `${id}:${updated}`,
      input: {
        event: {
          id,
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          attendees: event.attendees,
          htmlLink: event.htmlLink,
          updated,
        },
      },
    }];
  });
}

async function driveEvents(candidate: Candidate, token: string, cursor: number): Promise<TriggerEvent[]> {
  const folderId = String(candidate.config.folderId ?? "").trim();
  const query = [`modifiedTime > '${new Date(cursor).toISOString()}'`, "trashed = false"];
  if (folderId) query.push(`'${folderId.replaceAll("'", "\\'")}' in parents`);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query.join(" and "));
  url.searchParams.set("orderBy", "modifiedTime");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,createdTime,webViewLink,parents,owners(displayName,emailAddress))");
  const payload = await googleJson(url.toString(), token);
  const files = Array.isArray(payload.files) ? payload.files as Array<Record<string, unknown>> : [];
  return files.flatMap((file) => {
    const id = typeof file.id === "string" ? file.id : "";
    const modifiedTime = typeof file.modifiedTime === "string" ? file.modifiedTime : "";
    if (!id || !modifiedTime) return [];
    return [{ key: `${id}:${modifiedTime}`, input: { file } }];
  });
}

async function sheetEvents(
  candidate: Candidate,
  token: string,
  previousFingerprints: string[],
): Promise<{ events: TriggerEvent[]; fingerprints: string[] }> {
  const spreadsheetId = String(candidate.config.spreadsheetId ?? "").trim();
  if (!spreadsheetId) throw new Error("The Sheets trigger needs a spreadsheet ID.");
  const range = String(candidate.config.range ?? "Sheet1!A:Z");
  const payload = await googleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    token,
  );
  const values = Array.isArray(payload.values) ? payload.values as unknown[][] : [];
  const changes = sheetRowChanges(values, previousFingerprints);
  const events = changes.events.map((event) => ({
      key: event.key,
      input: {
        spreadsheetId,
        range,
        rowNumber: event.rowNumber,
        row: event.row,
        values: event.values,
      },
    }));
  return { events, fingerprints: changes.fingerprints };
}

async function pollCandidate(ctx: ActionCtx, candidate: Candidate) {
  const state = stateRecord(candidate.state);
  const now = Date.now();
  const connection = await ctx.runQuery(internal.connections.getSecure, {
    ownerKey: candidate.ownerKey,
    externalId: candidate.connectionRef,
  });
  if (!connection || connection.provider !== "google" || connection.clerkUserId !== candidate.ownerUserId || connection.status !== "active") {
    return;
  }
  const response = await clerkClient().users.getUserOauthAccessToken(candidate.ownerUserId, "google");
  const oauth = response.data.find((token) => token.externalAccountId === connection.externalAccountId);
  const scopes = oauth?.scopes ?? [];
  if (!oauth || !hasRequiredScopes(scopes, requiredScopes[candidate.nodeType] ?? [])) {
    await ctx.runMutation(internal.connections.setStatus, {
      ownerKey: candidate.ownerKey,
      externalId: candidate.connectionRef,
      status: "needs_reauth",
      scopes,
    });
    return;
  }

  if (!state.initialized) {
    if (candidate.nodeType === "sheetsTrigger") {
      const baseline = await sheetEvents(candidate, oauth.token, []);
      await ctx.runMutation(internal.googleTriggerState.checkpoint, {
        workflowId: candidate.workflowId,
        nodeId: candidate.nodeId,
        state: { initialized: true, cursor: now, fingerprints: baseline.fingerprints, checkedAt: now },
      });
    } else {
      await ctx.runMutation(internal.googleTriggerState.checkpoint, {
        workflowId: candidate.workflowId,
        nodeId: candidate.nodeId,
        state: { initialized: true, cursor: now, checkedAt: now },
      });
    }
    return;
  }

  const cursor = typeof state.cursor === "number" ? state.cursor : now - 60_000;
  let events: TriggerEvent[] = [];
  let fingerprints = Array.isArray(state.fingerprints) ? state.fingerprints.filter((value): value is string => typeof value === "string") : [];
  if (candidate.nodeType === "gmailEventTrigger") events = await gmailEvents(candidate, oauth.token, cursor);
  if (candidate.nodeType === "calendarTrigger") events = await calendarEvents(candidate, oauth.token, cursor);
  if (candidate.nodeType === "driveTrigger") events = await driveEvents(candidate, oauth.token, cursor);
  if (candidate.nodeType === "sheetsTrigger") {
    const result = await sheetEvents(candidate, oauth.token, fingerprints);
    events = result.events;
    fingerprints = result.fingerprints;
  }
  const nextState = { initialized: true, cursor: now, fingerprints, checkedAt: now };
  if (!events.length) {
    await ctx.runMutation(internal.googleTriggerState.checkpoint, {
      workflowId: candidate.workflowId,
      nodeId: candidate.nodeId,
      state: nextState,
    });
    return;
  }
  await Promise.all(events.slice(0, 20).map((event) =>
    ctx.runMutation(internal.googleTriggerState.claimAndStart, {
      workflowId: candidate.workflowId,
      nodeId: candidate.nodeId,
      nodeType: candidate.nodeType,
      dedupeKey: `${candidate.workflowId}:${candidate.nodeId}:${event.key}`,
      input: event.input,
      state: nextState,
    }),
  ));
}

async function pollCandidateSafely(ctx: ActionCtx, candidate: Candidate): Promise<boolean> {
  try {
    await pollCandidate(ctx, candidate);
    return true;
  } catch (error) {
    const previous = stateRecord(candidate.state);
    await ctx.runMutation(internal.googleTriggerState.checkpoint, {
      workflowId: candidate.workflowId,
      nodeId: candidate.nodeId,
      state: {
        ...previous,
        lastError: error instanceof Error ? error.message.slice(0, 300) : "Google trigger polling failed.",
        checkedAt: Date.now(),
      },
    });
    return false;
  }
}

async function pollCandidateBatch(ctx: ActionCtx, candidates: Candidate[], start = 0): Promise<number> {
  const batch = candidates.slice(start, start + 4);
  if (batch.length === 0) return 0;
  const results = await Promise.all(batch.map((candidate) => pollCandidateSafely(ctx, candidate)));
  const checked = results.filter(Boolean).length;
  return checked + await pollCandidateBatch(ctx, candidates, start + batch.length);
}

export const poll = internalAction({
  args: {},
  handler: async (ctx) => {
    const candidates = await ctx.runQuery(internal.googleTriggerState.listEnabled, {}) as Candidate[];
    const checked = await pollCandidateBatch(ctx, candidates);
    return { checked };
  },
});
