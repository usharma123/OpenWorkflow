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
import { memo, useCallback, useMemo } from "react";
import type { WorkflowNode } from "../types";
import { RuntimeAgentNode } from "./RuntimeAgentNode";
import { WorkflowNodeComponent } from "./WorkflowNode";
import { SandboxBoundaryNode } from "./SandboxBoundaryNode";

const nodeTypes = {
  workflow: WorkflowNodeComponent,
  sandbox: SandboxBoundaryNode,
  runtimeAgent: RuntimeAgentNode,
};

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
  const { renderedNodes, renderedEdges } = useMemo(() => {
    const runtimeNodes: WorkflowNode[] = [];
    const runtimeEdges: Edge[] = [];
    for (const parent of nodes) {
      const agents = parent.data.runtimeAgents ?? [];
      agents.forEach((agent, index) => {
        const runtimeId = `runtime-agent:${agent.id}`;
        runtimeNodes.push({
          id: runtimeId,
          type: "runtimeAgent",
          position: {
            x: parent.position.x + 250,
            y: parent.position.y + (index - (agents.length - 1) / 2) * 52,
          },
          draggable: false,
          selectable: false,
          deletable: false,
          connectable: false,
          data: {
            label: agent.name,
            description: agent.objective,
            nodeType: "ai",
            config: {},
            status:
              agent.status === "completed"
                ? "success"
                : agent.status === "failed"
                  ? "error"
                  : "running",
            runtimeAgents: [agent],
          },
        });
        runtimeEdges.push({
          id: `runtime-edge:${parent.id}:${agent.id}`,
          source: parent.id,
          target: runtimeId,
          animated: agent.status === "queued" || agent.status === "running",
          selectable: false,
          deletable: false,
          style: { stroke: "#6d8cff", strokeDasharray: "4 4" },
        });
      });
    }
    return { renderedNodes: [...nodes, ...runtimeNodes], renderedEdges: [...edges, ...runtimeEdges] };
  }, [edges, nodes]);
  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) =>
      onNodesChange(changes.filter((change) => {
        const id = "id" in change ? change.id : "item" in change ? change.item.id : "";
        return !id.startsWith("runtime-agent:");
      })),
    [onNodesChange],
  );

  return (
    <section className="canvas" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        edgesReconnectable
        connectionRadius={36}
        reconnectRadius={36}
        onNodeClick={(_, node) => {
          if (node.type !== "runtimeAgent") onSelectNode(node.id);
        }}
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
