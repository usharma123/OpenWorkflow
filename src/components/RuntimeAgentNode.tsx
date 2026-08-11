import { Bot } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "../types";

export function RuntimeAgentNode({ data }: NodeProps<WorkflowNode>) {
  const agent = data.runtimeAgents?.[0];
  const status = agent?.status ?? "queued";
  const live = status === "queued" || status === "running";
  return (
    <div className={`runtime-agent-node${status === "failed" ? " is-failed" : ""}`}>
      <Bot size={15} aria-hidden="true" />
      <span>
        <strong>{data.label}</strong>
        <small>{data.description}</small>
      </span>
      <em>
        <span className={`dot ${live ? "dot-running" : status === "failed" ? "dot-failed" : "dot-done"}`} />
        {status}
      </em>
    </div>
  );
}
