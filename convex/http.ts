import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/oauth/slack/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (!state) return new Response("Missing OAuth state.", { status: 400 });
    const redirect = await ctx.runAction(internal.connectionActions.finishSlackOAuth, {
      state,
      code: url.searchParams.get("code") ?? undefined,
      error: url.searchParams.get("error") ?? undefined,
    });
    return Response.redirect(redirect, 302);
  }),
});

http.route({
  pathPrefix: "/webhooks/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const slug = new URL(request.url).pathname.replace(/^\/webhooks\//, "");
    const workflow = await ctx.runQuery(internal.webhooks.resolve, { slug });
    if (!workflow) return Response.json({ error: "Active webhook workflow not found." }, { status: 404 });
    const provided = request.headers.get("x-openworkflow-secret");
    if (!provided || provided !== workflow.webhookSecret) return Response.json({ error: "Unauthorized." }, { status: 401 });
    let input: unknown = {};
    try { input = await request.json(); } catch { input = {}; }
    const runId = await ctx.runMutation(internal.runs.startForWebhook, { workflowId: workflow._id, input });
    return Response.json({ accepted: true, runId }, { status: 202 });
  }),
});

export default http;
