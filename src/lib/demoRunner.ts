import type { PendingApproval, RunLog, WorkflowDefinition, WorkflowNode, WorkflowRun } from "../types";
import {
  inputPacketsForNode,
  inputValueForPackets,
  mergeExecutionValues,
  packetForNodeOutput,
  nodeIdsForRunScope,
  terminalOutput,
  topologicalNodes,
  type ExecutionPacket,
  type RunScopeMode,
} from "../../shared/executionGraph";

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function renderTemplate(template: string, input: unknown, stepOutputs: Record<string, unknown>) {
  return template.replace(
    /\{\{\s*(input|steps\.([A-Za-z0-9_-]+))(?:\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*))?\s*\}\}/g,
    (_, root: string, nodeId?: string, path?: string) => {
      const source = root === "input" ? input : stepOutputs[nodeId ?? ""];
      const value = path?.split(".").reduce<unknown>((current, key) =>
        current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, key)
          ? (current as Record<string, unknown>)[key]
          : undefined, source) ?? (path ? undefined : source);
      return typeof value === "string" ? value : JSON.stringify(value ?? "") ?? "";
    },
  );
}

function valueAtPath(input: unknown, path: string) {
  return path.split(".").filter(Boolean).reduce<unknown>((current, key) =>
    current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, input);
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
  options: { runMode?: RunScopeMode; scopeNodeId?: string } = {},
): Promise<WorkflowRun> {
  const run: WorkflowRun = { id: crypto.randomUUID(), status: "running", startedAt: Date.now(), logs: [] };
  const log = (entry: Omit<RunLog, "id" | "timestamp">) => {
    const complete = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    run.logs.push(complete); onLog(complete);
  };
  const rootValue: unknown = { startedBy: "Editor user", date: new Date().toLocaleDateString() };
  const executableNodes = workflow.nodes.filter((node) => node.data.nodeType !== "daytonaSandbox");
  const outputs = new Map<string, ExecutionPacket>();
  const runMode = options.runMode ?? "full";
  const activeNodeIds = nodeIdsForRunScope(executableNodes, workflow.edges, runMode, options.scopeNodeId);
  if (runMode !== "full") {
    for (const node of executableNodes) {
      if (activeNodeIds.has(node.id)) continue;
      if (Object.prototype.hasOwnProperty.call(node.data.config, "pinnedOutput")) {
        outputs.set(node.id, packetForNodeOutput(node, node.data.config.pinnedOutput));
      }
    }
  }
  let activeNodeId: string | undefined;
  log({ level: "info", message: "Safe demo started", explanation: "Sample business data is used; no mailbox or Slack channel will be touched." });

  try {
    for (const node of topologicalNodes(executableNodes, workflow.edges).filter((candidate) => activeNodeIds.has(candidate.id))) {
      const { label, description, nodeType, config } = node.data;
      const incoming = inputPacketsForNode(node.id, workflow.edges, outputs);
      if (incoming.hasIncomingEdges && incoming.packets.length === 0) {
        if (runMode === "single") throw new Error(`Pin output on an upstream step before testing ${label} by itself.`);
        continue;
      }
      const value = inputValueForPackets(incoming.packets, rootValue);
      const stepOutputs = Object.fromEntries(
        [...outputs.entries()].map(([nodeId, packet]) => [nodeId, packet.value]),
      );
      let output: unknown = value;
      activeNodeId = node.id;
      onNodeStatus(node.id, "running");
      log({ level: "info", nodeId: node.id, message: label, explanation: description });
      await wait(360);
      if (nodeType === "gmailTrigger") {
        output = { messages: sampleMessages, count: sampleMessages.length, date: new Date().toLocaleDateString(), source: "sample" };
        log({ level: "success", nodeId: node.id, message: `${sampleMessages.length} sample emails collected`, explanation: "Live mode uses the named Google Workspace connection with Gmail read-only scope.", output });
      } else if (nodeType === "ai") {
        output = { content: "DECISIONS NEEDED\n• Finance: Approve revised Q3 hiring assumptions by Thursday.\n\nIMPORTANT UPDATES\n• Product: Beta launch remains on track; legal review is the final dependency.\n\nFOLLOW-UPS\n• Customer Success: Assign an executive sponsor for the Acme renewal call next week.", model: "openai/gpt-5.6-luna", source: "sample", date: new Date().toLocaleDateString() };
        log({ level: "success", nodeId: node.id, message: "Executive brief drafted", explanation: "The connected run uses GPT-5.6 Luna through OpenRouter; this browser demo returns a representative response.", output });
      } else if (nodeType === "googleDoc") {
        output = { ...(value as Record<string, unknown>), documentTitle: `Inbox brief — ${new Date().toLocaleDateString()}`, documentUrl: "https://docs.google.com/document/d/demo-openworkflow-inbox-brief/edit", documentMode: "demo" };
        log({ level: "success", nodeId: node.id, message: "Demo document prepared", explanation: "No real document was created. Connected mode creates it in the approved Google Drive location.", output });
      } else if (nodeType === "approval") {
        const decision = await requestApproval({ runId: run.id, nodeId: node.id, title: label, prompt: String(config.prompt ?? "Approve this result?"), input: value });
        if (!decision.approved) throw new Error(decision.note || "The reviewer rejected this result. Update the earlier step and run it again.");
        output = { ...(value as Record<string, unknown>), approval: { approved: true, note: decision.note, decidedAt: Date.now() } };
        log({ level: "success", nodeId: node.id, message: "Approved by reviewer", explanation: decision.note || "The approval decision is attached to the run audit trail.", output });
      } else if (nodeType === "slack") {
        output = { ...(value as Record<string, unknown>), delivery: { provider: "slack", channel: String(config.channel ?? "#leadership-updates"), status: "simulated", message: renderTemplate(String(config.message ?? "{{input.documentUrl}}"), value, stepOutputs) } };
        log({ level: "success", nodeId: node.id, message: "Slack post simulated", explanation: "The document link was not sent. Connected mode posts only after the approval step succeeds.", output });
      } else if (nodeType === "transform") {
        output = { value: renderTemplate(String(config.template ?? "{{input}}"), value, stepOutputs) };
        log({ level: "success", nodeId: node.id, message: `${label} completed`, output });
      } else if (nodeType === "forEach") {
        const path = String(config.path ?? "items");
        const selected = path ? valueAtPath(value, path) : value;
        if (!Array.isArray(selected)) throw new Error(`For each item expected an array at ${path || "the input"}.`);
        const items = selected.map((item) => renderTemplate(String(config.template ?? "{{input}}"), item, stepOutputs));
        output = { items, count: items.length };
        log({ level: "success", nodeId: node.id, message: `${items.length} items processed`, output });
      } else if (nodeType === "merge") {
        const mode = String(config.mode ?? "append") as "append" | "combine" | "first";
        if (!["append", "combine", "first"].includes(mode)) throw new Error("Merge mode is invalid.");
        output = mergeExecutionValues(value, mode);
        log({ level: "success", nodeId: node.id, message: `${label} completed`, output });
      } else if (nodeType === "condition") {
        const actual = valueAtPath(value, String(config.path ?? ""));
        const expected = config.value;
        const operator = String(config.operator ?? "equals");
        const passed = operator === "exists"
          ? actual !== undefined && actual !== null
          : operator === "contains"
            ? String(actual ?? "").includes(String(expected ?? ""))
            : operator === "greaterThan"
              ? Number(actual) > Number(expected)
              : String(actual ?? "") === String(expected ?? "");
        output = { passed, value: actual };
        log({ level: "success", nodeId: node.id, message: `${label}: ${passed}`, output });
      } else if (["code", "shell", "git"].includes(nodeType)) {
        output = { input: value, sandbox: { provider: "daytona", simulated: true }, operation: nodeType };
        log({ level: "success", nodeId: node.id, message: `${label} simulated`, explanation: "Connected runs execute this step inside its Daytona sandbox boundary.", output });
      } else {
        log({ level: "success", nodeId: node.id, message: `${label} completed`, output });
      }
      outputs.set(node.id, packetForNodeOutput(node, output));
      onNodeStatus(node.id, "success");
      activeNodeId = undefined;
    }
    const scopedNodes = executableNodes.filter((node) => activeNodeIds.has(node.id));
    const scopedEdges = workflow.edges.filter((edge) => activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target));
    run.status = "completed"; run.completedAt = Date.now(); run.output = terminalOutput(scopedNodes, scopedEdges, outputs);
    log({ level: "success", message: "Workflow completed", explanation: "Every step finished and the approval was recorded." });
    return run;
  } catch (error) {
    run.status = "failed"; run.completedAt = Date.now();
    if (activeNodeId) onNodeStatus(activeNodeId, "error");
    log({ level: "error", message: error instanceof Error ? error.message : "Workflow failed", explanation: "Open the step marked in red, review its setup, and try again." });
    throw error;
  }
}
