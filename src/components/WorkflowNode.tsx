import { Handle, Position, type NodeProps } from "@xyflow/react";
import { LoaderCircle } from "lucide-react";
import { catalogByType } from "../catalog";
import type { WorkflowNode } from "../types";
import { NODE_ICONS } from "./icons";

export function WorkflowNodeComponent({ data, selected }: NodeProps<WorkflowNode>) {
  const item = catalogByType[data.nodeType];
  const Icon = NODE_ICONS[data.nodeType];
  const isTrigger = data.nodeType.endsWith("Trigger");
  const isOutput = data.nodeType === "output";
  const isCondition = data.nodeType === "condition";

  return (
    <div
      className={`workflow-node ${selected ? "selected" : ""} ${data.status ?? "idle"}`}
      style={{ "--node-accent": item.accent } as React.CSSProperties}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <div className="node-icon">
        {data.status === "running" ? <LoaderCircle className="spin" size={17} /> : <Icon size={17} />}
      </div>
      <div className="node-copy">
        <strong>{data.label}</strong>
        <span>{data.description}</span>
      </div>
      {data.status === "success" && <span className="node-status-dot" aria-label="Completed" />}
      {!isOutput && !isCondition && <Handle type="source" position={Position.Right} />}
      {isCondition && (
        <>
          <span className="branch-label true">true</span>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "35%" }} />
          <span className="branch-label false">false</span>
          <Handle id="false" type="source" position={Position.Right} style={{ top: "70%" }} />
        </>
      )}
    </div>
  );
}
