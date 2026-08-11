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
  const status = data.status ?? "idle";
  const isDemo = item.setup === "connection" && data.config.executionMode !== "live";

  return (
    <div
      className={`wf-node ${selected ? "is-selected" : ""} ${isCondition ? "is-condition" : ""} status-${status}`}
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
          {item.runtime === "daytona" && parentId && <span className="wf-node-runtime">Daytona</span>}
          {isDemo && <span className="wf-node-demo">Demo</span>}
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
          aria-label={`Connect from ${data.label}`}
          title="Drag to another step"
        />
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
