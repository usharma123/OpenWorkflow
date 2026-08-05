import {
  Background,
  BackgroundVariant,
  Controls,
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

const nodeTypes = { workflow: WorkflowNodeComponent };

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
        fitViewOptions={{ padding: 0.26 }}
        minZoom={0.35}
        maxZoom={1.6}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1f1f23" />
        <Controls showInteractive={false} />
        <MiniMap nodeColor="#3a3a42" maskColor="rgba(10, 10, 11, .8)" pannable />
      </ReactFlow>
      <div className="canvas-note">Each step receives the result from the step before it</div>
    </section>
  );
});
