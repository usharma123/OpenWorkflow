import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { memo } from "react";
import type { WorkflowNode } from "../types";
import { WorkflowNodeComponent } from "./WorkflowNode";
import { SandboxBoundaryNode } from "./SandboxBoundaryNode";

const nodeTypes = { workflow: WorkflowNodeComponent, sandbox: SandboxBoundaryNode };

/* Solid bezier with an arrowhead: direction of flow readable without motion. */
const defaultEdgeOptions = {
  type: "default",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#6e6e78" },
};

interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onReconnect: (edge: Edge, connection: Connection) => void;
  onSelectNode: (id: string) => void;
  onPaneClick: () => void;
  onDrop: (event: React.DragEvent) => void;
}

export const WorkflowCanvas = memo(function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onReconnect,
  onSelectNode,
  onPaneClick,
  onDrop,
}: WorkflowCanvasProps) {
  return (
    <section className="canvas" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        edgesReconnectable
        connectionRadius={36}
        reconnectRadius={36}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={onPaneClick}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.55 }}
        minZoom={0.35}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1f1f23" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          bgColor="#0e0e10"
          nodeColor="#2a2a30"
          nodeStrokeColor="#3a3a42"
          nodeBorderRadius={3}
          maskColor="rgba(10, 10, 11, .72)"
          pannable
          zoomable
        />
      </ReactFlow>
    </section>
  );
});
