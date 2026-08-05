import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import {
  Check,
  ChevronDown,
  Cloud,
  History,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { catalogByType } from "./catalog";
import { Inspector } from "./components/Inspector";
import { NodePalette } from "./components/NodePalette";
import { OutputPanel } from "./components/OutputPanel";
import { RunPanel } from "./components/RunPanel";
import { WorkflowNodeComponent } from "./components/WorkflowNode";
import {
  convexClient,
  getRunRef,
  getWorkflowRef,
  startRunRef,
  upsertWorkflowRef,
} from "./lib/convexClient";
import { runDemo } from "./lib/demoRunner";
import { loadWorkflow, resetWorkflow, saveWorkflow } from "./lib/storage";
import type { LatestRunResult, RunLog, WorkflowNode, WorkflowNodeType } from "./types";

const nodeTypes = { workflow: WorkflowNodeComponent };

function persistableNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    const { status: _status, ...data } = node.data;
    return {
      id: node.id,
      type: "workflow",
      position: node.position,
      data,
    };
  });
}

export default function App() {
  const initial = useMemo(() => loadWorkflow(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [saved, setSaved] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [latestResult, setLatestResult] = useState<LatestRunResult>();
  const [notice, setNotice] = useState<string>();
  const [backendLoaded, setBackendLoaded] = useState(!convexClient);
  const reactFlow = useReactFlow<WorkflowNode>();
  const saveTimer = useRef<number | undefined>(undefined);
  const hydratedOnce = useRef(false);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    if (!convexClient || hydratedOnce.current) return;
    hydratedOnce.current = true;
    void convexClient
      .query(getWorkflowRef, { externalId: initial.id })
      .then((remote) => {
        if (!remote) return;
        setName(remote.name);
        setEnabled(remote.enabled);
        setNodes(remote.nodes);
        setEdges(remote.edges);
      })
      .catch((error) => {
        setNotice(error instanceof Error ? `Convex: ${error.message}` : "Could not load from Convex");
      })
      .finally(() => setBackendLoaded(true));
  }, [initial.id, setEdges, setNodes]);

  useEffect(() => {
    if (!backendLoaded) return;
    setSaved(false);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const definition = {
        ...initial,
        name,
        enabled,
        nodes: persistableNodes(nodes),
        edges,
        updatedAt: Date.now(),
      };
      saveWorkflow(definition);
      if (convexClient) {
        void convexClient
          .mutation(upsertWorkflowRef, {
            externalId: definition.id,
            name: definition.name,
            description: definition.description,
            enabled: definition.enabled,
            nodes: definition.nodes,
            edges: definition.edges,
            updatedAt: definition.updatedAt,
          })
          .then(() => setSaved(true))
          .catch((error) => {
            setNotice(error instanceof Error ? `Save failed: ${error.message}` : "Convex save failed");
          });
      } else {
        setSaved(true);
      }
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [backendLoaded, edges, enabled, initial, name, nodes]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge({ ...connection, animated: true }, current)),
    [setEdges],
  );

  const addNode = useCallback(
    (type: WorkflowNodeType, position?: { x: number; y: number }) => {
      const item = catalogByType[type];
      const node: WorkflowNode = {
        id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
        type: "workflow",
        position: position ?? reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
        data: {
          label: item.label,
          description: item.description,
          nodeType: type,
          config: structuredClone(item.defaultConfig),
        },
      };
      setNodes((current) => [...current, node]);
      setSelectedNodeId(node.id);
    },
    [reactFlow, setNodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/openworkflow-node") as WorkflowNodeType;
      if (!type || !catalogByType[type]) return;
      addNode(type, reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNode, reactFlow],
  );

  const updateSelectedNode = (updated: WorkflowNode) =>
    setNodes((current) => current.map((node) => (node.id === updated.id ? updated : node)));

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId(undefined);
  };

  const duplicateSelectedNode = () => {
    if (!selectedNode) return;
    const duplicate: WorkflowNode = {
      ...structuredClone(selectedNode),
      id: `${selectedNode.data.nodeType}-${crypto.randomUUID().slice(0, 8)}`,
      position: { x: selectedNode.position.x + 36, y: selectedNode.position.y + 84 },
      selected: false,
    };
    setNodes((current) => [...current, duplicate]);
    setSelectedNodeId(duplicate.id);
  };

  const runWorkflow = async () => {
    if (running) return;
    setRunning(true);
    setLogs([]);
    setRunPanelOpen(true);
    setSelectedNodeId(undefined);
    setLatestResult({ status: "queued" });
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
    try {
      if (convexClient) {
        const client = convexClient;
        const updatedAt = Date.now();
        await client.mutation(upsertWorkflowRef, {
          externalId: initial.id,
          name,
          description: initial.description,
          enabled,
          nodes: persistableNodes(nodes),
          edges,
          updatedAt,
        });
        const runId = await client.mutation(startRunRef, {
          externalWorkflowId: initial.id,
          input: { topic: "OpenWorkflow proof of concept" },
          trigger: "manual",
        });
        setLatestResult({ id: runId, status: "queued" });
        setLogs([{ id: `queued-${runId}`, level: "info", message: "Run accepted by Convex.", timestamp: Date.now() }]);

        await new Promise<void>((resolve, reject) => {
          const watch = client.watchQuery(getRunRef, { runId });
          let unsubscribe = () => {};
          unsubscribe = watch.onUpdate(() => {
            try {
              const run = watch.localQueryResult();
              if (!run) return;
              setLatestResult({ id: runId, status: run.status, output: run.output, error: run.error });
              setLogs([
                { id: `started-${runId}`, level: "info", message: `Run ${run.status}.`, timestamp: run.startedAt },
                ...run.steps.map((step) => ({
                  id: step._id,
                  nodeId: step.nodeId,
                  level: step.status === "failed" ? "error" as const : step.status === "completed" ? "success" as const : "info" as const,
                  message: `${step.nodeLabel}: ${step.status}`,
                  timestamp: step.completedAt ?? step.startedAt,
                  output: step.output,
                })),
              ]);
              setNodes((current) =>
                current.map((node) => {
                  const latest = [...run.steps].reverse().find((step) => step.nodeId === node.id);
                  const status = latest?.status === "completed" ? "success" : latest?.status === "failed" ? "error" : latest ? "running" : "idle";
                  return { ...node, data: { ...node.data, status } };
                }),
              );
              if (run.status === "completed" || run.status === "failed") {
                unsubscribe();
                if (run.status === "failed") reject(new Error(run.error ?? "Workflow failed."));
                else resolve();
              }
            } catch (error) {
              unsubscribe();
              reject(error);
            }
          });
        });
      } else {
        const demoRun = await runDemo(
          { ...initial, name, enabled, nodes, edges, updatedAt: Date.now() },
          (log) => setLogs((current) => [...current, log]),
          (nodeId, status) =>
            setNodes((current) =>
              current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, status } } : node)),
          ),
        );
        setLatestResult({ id: demoRun.id, status: demoRun.status, output: demoRun.output, error: demoRun.error });
      }
    } catch (error) {
      setLatestResult((current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "Workflow failed.",
      }));
      setLogs((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          level: "error",
          message: error instanceof Error ? error.message : "Workflow failed.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const restoreStarter = () => {
    const starter = resetWorkflow();
    setName(starter.name);
    setEnabled(starter.enabled);
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setSelectedNodeId(undefined);
    setLogs([]);
    setNotice("Starter workflow restored");
    window.setTimeout(() => setNotice(undefined), 2200);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Workflow size={19} /></span>
          <span>OpenWorkflow</span>
          <span className="poc-badge">POC</span>
        </div>
        <div className="workflow-title">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Workflow name" />
          <span>{saved ? <><Check size={13} /> {convexClient ? "Saved to Convex" : "Saved locally"}</> : <><Save size={13} /> Saving…</>}</span>
        </div>
        <div className="top-actions">
          <div className="history-actions">
            <button className="icon-button" disabled title="Undo"><Undo2 size={16} /></button>
            <button className="icon-button" disabled title="Redo"><Redo2 size={16} /></button>
          </div>
          <button className="quiet-button" onClick={() => setRunPanelOpen(true)}><History size={15} /> Runs</button>
          <label className="enable-control">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span>{enabled ? "Active" : "Draft"}</span>
          </label>
          <button className="run-button" onClick={runWorkflow} disabled={running}><Play size={15} fill="currentColor" /> {running ? "Running…" : "Run workflow"}<ChevronDown size={14} /></button>
        </div>
      </header>

      <div className="workspace">
        <NodePalette onAdd={addNode} />
        <section className="canvas-wrap" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(undefined)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.28 }}
            minZoom={0.35}
            maxZoom={1.6}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#2b303c" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => catalogByType[(node as WorkflowNode).data.nodeType].accent}
              maskColor="rgba(8, 10, 15, .78)"
            />
            <div className="canvas-status">
              <Cloud size={14} />
              {convexClient ? "Convex connected" : "Local demo mode"}
            </div>
          </ReactFlow>
          <div className="canvas-hint"><Sparkles size={14} /> Drag blocks onto the canvas and connect them</div>
          {runPanelOpen && <RunPanel logs={logs} running={running} onClose={() => setRunPanelOpen(false)} />}
        </section>
        {selectedNode ? (
          <Inspector
            node={selectedNode}
            onChange={updateSelectedNode}
            onClose={() => setSelectedNodeId(undefined)}
            onDelete={deleteSelectedNode}
            onDuplicate={duplicateSelectedNode}
          />
        ) : latestResult ? (
          <OutputPanel result={latestResult} onClose={() => setLatestResult(undefined)} />
        ) : (
          <aside className="empty-inspector panel">
            <div className="empty-symbol"><Workflow size={25} /></div>
            <strong>Select a block</strong>
            <p>Choose a block on the canvas to configure its inputs and behavior.</p>
            <button onClick={restoreStarter}><RotateCcw size={14} /> Restore starter</button>
          </aside>
        )}
      </div>
      {notice && <div className="toast"><Check size={15} /> {notice}</div>}
    </main>
  );
}
