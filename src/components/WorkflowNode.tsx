import { Handle, Position, type NodeProps } from "@xyflow/react";
import { catalogByType } from "../catalog";
import type { WorkflowNode } from "../types";
import { NodeMark } from "./icons";

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  waiting: "Waiting for you",
  success: "Done",
  error: "Failed",
};

export function WorkflowNodeComponent({ data, selected, parentId }: NodeProps<WorkflowNode>) {
  const item = catalogByType[data.nodeType];
  const isTrigger = data.nodeType.endsWith("Trigger");
  const isOutput = data.nodeType === "output";
  const isCondition = data.nodeType === "condition";
  const hasErrorOutput = !isCondition && !isOutput && !isTrigger && data.config.errorOutput === true;
  const status = data.status ?? "idle";

  const usesCompute =
    data.nodeType === "ai" &&
    (data.config.useCompute === true ||
      (data.config.useCompute !== false && typeof data.config.mode === "string" && Boolean(data.config.mode)));
  const agentBadge = usesCompute ? "Compute" : "";

  return (
    <div
      className={`wf-node ${selected ? "is-selected" : ""} ${isCondition ? "is-condition" : ""} ${hasErrorOutput ? "has-error-output" : ""} status-${status}`}
      data-cat={item.category}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          aria-label={`Connect into ${data.label}`}
          title="Drop a connection here"
        />
      )}

      <span className="wf-node-mark">
        <NodeMark type={data.nodeType} size={17} />
      </span>

      <div className="wf-node-body">
        <strong>{data.label}</strong>
        <span className="wf-node-description">{data.description}</span>
        <div className="wf-node-foot">
          {agentBadge && <span className="wf-node-runtime">{agentBadge}</span>}
          {data.runtimeAgents && data.runtimeAgents.length > 0 && (
            <span className="wf-node-runtime">
              {data.runtimeAgents.length} spawned
            </span>
          )}
          {item.runtime === "daytona" && parentId && <span className="wf-node-runtime">Secure compute</span>}
          {status !== "idle" && (
            <span className={`wf-node-status ${status}`}>
              <span
                className={`dot ${
                  status === "running"
                    ? "dot-running"
                    : status === "waiting"
                      ? "dot-waiting"
                      : status === "error"
                        ? "dot-failed"
                        : "dot-done"
                }`}
              />
              {STATUS_LABEL[status]}
            </span>
          )}
        </div>
      </div>

      {!isOutput && !isCondition && (
        <Handle
          type="source"
          position={Position.Right}
          style={hasErrorOutput ? { top: "34%" } : undefined}
          aria-label={`Connect from ${data.label}`}
          title="Drag to another step"
        />
      )}
      {hasErrorOutput && (
        <>
          <span className="wf-branch is-error">error</span>
          <Handle
            id="error"
            type="source"
            position={Position.Right}
            style={{ top: "72%" }}
            aria-label={`Connect error branch from ${data.label}`}
            title="Drag the recovery branch"
          />
        </>
      )}
      {isCondition && (
        <>
          <span className="wf-branch is-true">true</span>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "34%" }}
            aria-label={`Connect true branch from ${data.label}`}
            title="Drag the true branch"
          />
          <span className="wf-branch is-false">false</span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "72%" }}
            aria-label={`Connect false branch from ${data.label}`}
            title="Drag the false branch"
          />
        </>
      )}
    </div>
  );
}
