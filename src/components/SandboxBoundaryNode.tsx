import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "../types";
import { NodeMark } from "./icons";

export function SandboxBoundaryNode({ data, selected }: NodeProps<WorkflowNode>) {
  const language = String(data.config.language ?? "typescript");
  const networkMode = String(data.config.networkMode ?? "blocked");
  const status = data.status ?? "idle";

  return (
    <div className={`sandbox-boundary ${selected ? "is-selected" : ""} status-${status}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={460}
        minHeight={260}
        color="var(--ink-8)"
        lineClassName="sandbox-resize-line"
        handleClassName="sandbox-resize-handle"
      />
      <div className="sandbox-boundary-head">
        <span className="sandbox-boundary-mark">
          <NodeMark type="daytonaSandbox" size={15} />
        </span>
        <span>
          <strong>{data.label}</strong>
          <small>Daytona · {language} · {networkMode === "blocked" ? "network blocked" : "allowlisted network"}</small>
        </span>
      </div>
      <div className="sandbox-boundary-hint">Drop Code, Shell, or Git steps here. They share one ephemeral filesystem per run.</div>
    </div>
  );
}
