import type { PendingApproval, RunLog, WorkflowDefinition, WorkflowNode, WorkflowRun } from "../types";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function orderedNodes(workflow: WorkflowDefinition): WorkflowNode[] {
  const incoming = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = workflow.nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      const next = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, next);
      if (next === 0) {
        const targetNode = workflow.nodes.find((candidate) => candidate.id === target);
        if (targetNode) queue.push(targetNode);
      }
    }
  }
  if (ordered.length !== workflow.nodes.length) throw new Error("This workflow has a loop. Disconnect one of the circular paths and try again.");
  return ordered;
}

function renderTemplate(template: string, input: unknown) {
  return template.replace(/\{\{\s*input(?:\.([\w.]+))?\s*\}\}/g, (_, path?: string) => {
    const value = path?.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, input) ?? input;
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
  });
}

const sampleMessages = [
  { from: "Maya Chen · Finance", subject: "Q3 forecast needs sign-off", snippet: "Please approve the revised hiring assumptions before Thursday.", receivedAt: "8:42 AM" },
  { from: "Jordan Lee · Product", subject: "Launch readiness update", snippet: "The beta is on track; legal review is the only remaining dependency.", receivedAt: "9:16 AM" },
  { from: "Sam Rivera · Customer Success", subject: "Acme renewal risk", snippet: "Acme asked for an executive sponsor before next week's renewal call.", receivedAt: "10:03 AM" },
];

export async function runDemo(
  workflow: WorkflowDefinition,
  onLog: (log: RunLog) => void,
  onNodeStatus: (nodeId: string, status: "running" | "success" | "error") => void,
  requestApproval: (request: PendingApproval) => Promise<{ approved: boolean; note?: string }>,
): Promise<WorkflowRun> {
  const run: WorkflowRun = { id: crypto.randomUUID(), status: "running", startedAt: Date.now(), logs: [] };
  const log = (entry: Omit<RunLog, "id" | "timestamp">) => {
    const complete = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    run.logs.push(complete); onLog(complete);
  };
  let value: unknown = { startedBy: "Editor user", date: new Date().toLocaleDateString() };
  let activeNodeId: string | undefined;
  log({ level: "info", message: "Safe demo started", explanation: "Sample business data is used; no mailbox or Slack channel will be touched." });

  try {
    for (const node of orderedNodes(workflow)) {
      activeNodeId = node.id;
      onNodeStatus(node.id, "running");
      log({ level: "info", nodeId: node.id, message: node.data.label, explanation: node.data.description });
      await wait(360);
      if (node.data.nodeType === "gmailTrigger") {
        value = { messages: sampleMessages, count: sampleMessages.length, date: new Date().toLocaleDateString(), source: "sample" };
        log({ level: "success", nodeId: node.id, message: `${sampleMessages.length} sample emails collected`, explanation: "Live mode uses the named Google Workspace connection with Gmail read-only scope.", output: value });
      } else if (node.data.nodeType === "ai") {
        value = { content: "DECISIONS NEEDED\n• Finance: Approve revised Q3 hiring assumptions by Thursday.\n\nIMPORTANT UPDATES\n• Product: Beta launch remains on track; legal review is the final dependency.\n\nFOLLOW-UPS\n• Customer Success: Assign an executive sponsor for the Acme renewal call next week.", model: "openai/gpt-5.6-luna", source: "sample", date: new Date().toLocaleDateString() };
        log({ level: "success", nodeId: node.id, message: "Executive brief drafted", explanation: "The connected run uses GPT-5.6 Luna through OpenRouter; this browser demo returns a representative response.", output: value });
      } else if (node.data.nodeType === "googleDoc") {
        value = { ...(value as Record<string, unknown>), documentTitle: `Inbox brief — ${new Date().toLocaleDateString()}`, documentUrl: "https://docs.google.com/document/d/demo-openworkflow-inbox-brief/edit", documentMode: "demo" };
        log({ level: "success", nodeId: node.id, message: "Demo document prepared", explanation: "No real document was created. Connected mode creates it in the approved Google Drive location.", output: value });
      } else if (node.data.nodeType === "approval") {
        const decision = await requestApproval({ runId: run.id, nodeId: node.id, title: node.data.label, prompt: String(node.data.config.prompt ?? "Approve this result?"), input: value });
        if (!decision.approved) throw new Error(decision.note || "The reviewer rejected this result. Update the earlier step and run it again.");
        value = { ...(value as Record<string, unknown>), approval: { approved: true, note: decision.note, decidedAt: Date.now() } };
        log({ level: "success", nodeId: node.id, message: "Approved by reviewer", explanation: decision.note || "The approval decision is attached to the run audit trail.", output: value });
      } else if (node.data.nodeType === "slack") {
        value = { ...(value as Record<string, unknown>), delivery: { provider: "slack", channel: String(node.data.config.channel ?? "#leadership-updates"), status: "simulated", message: renderTemplate(String(node.data.config.message ?? "{{input.documentUrl}}"), value) } };
        log({ level: "success", nodeId: node.id, message: "Slack post simulated", explanation: "The document link was not sent. Connected mode posts only after the approval step succeeds.", output: value });
      } else {
        log({ level: "success", nodeId: node.id, message: `${node.data.label} completed`, output: value });
      }
      onNodeStatus(node.id, "success");
      activeNodeId = undefined;
    }
    run.status = "completed"; run.completedAt = Date.now(); run.output = value;
    log({ level: "success", message: "Workflow completed", explanation: "Every step finished and the approval was recorded." });
    return run;
  } catch (error) {
    run.status = "failed"; run.completedAt = Date.now();
    if (activeNodeId) onNodeStatus(activeNodeId, "error");
    log({ level: "error", message: error instanceof Error ? error.message : "Workflow failed", explanation: "Open the step marked in red, review its setup, and try again." });
    throw error;
  }
}
