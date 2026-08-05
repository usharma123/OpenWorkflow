import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
  pathPrefix: "/webhooks/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const slug = new URL(request.url).pathname.replace(/^\/webhooks\//, "");
    const workflows = await ctx.runQuery(api.workflows.list, {});
    const workflow = workflows.find((candidate) =>
      candidate.nodes.some(
        (node) => node?.data?.nodeType === "webhookTrigger" && node?.data?.config?.slug === slug,
      ),
    );
    if (!workflow || !workflow.enabled) {
      return Response.json({ error: "Active webhook workflow not found." }, { status: 404 });
    }

    if (workflow.webhookSecret) {
      const provided = request.headers.get("x-openworkflow-secret");
      if (provided !== workflow.webhookSecret) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      }
    }

    let input: unknown = {};
    try {
      input = await request.json();
    } catch {
      input = {};
    }
    const runId = await ctx.runMutation(api.runs.startRun, {
      externalWorkflowId: workflow.externalId,
      input,
      trigger: "webhook",
    });
    return Response.json({ accepted: true, runId }, { status: 202 });
  }),
});

export default http;
