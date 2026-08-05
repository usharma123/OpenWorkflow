import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { Check, Loader2, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { catalogByType, STARTER_WORKFLOW } from "./catalog";
import { Inspector } from "./components/Inspector";
import { NodePalette } from "./components/NodePalette";
import { RunTranscript } from "./components/RunTranscript";
import { SidePanel, type PanelMode } from "./components/SidePanel";
import { WorkflowNodeComponent } from "./components/WorkflowNode";
import { useConnections } from "./lib/connections";
import {
  approveRunRef,
  convexClient,
  getRunRef,
  getWorkflowRef,
  listConnectionsRef,
  startRunRef,
  upsertWorkflowRef,
} from "./lib/convexClient";
import { runDemo } from "./lib/demoRunner";
import { validateWorkflowConnection } from "./lib/workflowConnections";
import type {
  LatestRunResult,
  PendingApproval,
  RunLog,
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

const nodeTypes = { workflow: WorkflowNodeComponent };

function persistableNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    const { status: _status, ...data } = node.data;
    return { id: node.id, type: "workflow" as const, position: node.position, data };
  });
}

export default function App() {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const { connections, setNotice, refresh: refreshConnections } = useConnections();

  const initial = useMemo(
    () => ({ ...structuredClone(STARTER_WORKFLOW), id: workflowId ?? STARTER_WORKFLOW.id }),
    [workflowId],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [saved, setSaved] = useState(true);
  const [running, setRunning] = useState(false);
  const [, setLogs] = useState<RunLog[]>([]);
  const [latestResult, setLatestResult] = useState<LatestRunResult>();
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [backendLoaded, setBackendLoaded] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("run");

  const reactFlow = useReactFlow<WorkflowNode>();
  const saveTimer = useRef<number | undefined>(undefined);
  const hydratedOnce = useRef(false);
  const skipInitialSave = useRef(true);
  const demoApprovalResolver = useRef<((decision: { approved: boolean; note?: string }) => void) | undefined>(
    undefined,
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => {
    if (!convexClient || hydratedOnce.current) return;
    hydratedOnce.current = true;
    void convexClient
      .query(getWorkflowRef, { externalId: initial.id })
      .then((remote) => {
        if (!remote) {
          setNotice({ message: "That workflow no longer exists.", tone: "error" });
          navigate("/workflows", { replace: true });
          return;
        }
        setName(remote.name);
        setDescription(remote.description);
        setEnabled(remote.enabled);
        setNodes(remote.nodes);
        setEdges(remote.edges);
        setBackendLoaded(true);
      })
      .catch((error) =>
        setNotice({
          message: error instanceof Error ? error.message : "Could not load this workflow",
          tone: "error",
        }),
      )
  }, [initial.id, navigate, setEdges, setNodes, setNotice]);

  useEffect(() => {
    if (!backendLoaded) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    setSaved(false);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const definition = {
        ...initial,
        name,
        description,
        enabled,
        nodes: persistableNodes(nodes),
        edges,
        updatedAt: Date.now(),
      };
      if (!convexClient) {
        setSaved(true);
        return;
      }
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
        .catch((error) =>
          setNotice({
            message: error instanceof Error ? `Save failed: ${error.message}` : "Save failed",
            tone: "error",
          }),
        );
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [backendLoaded, description, edges, enabled, initial, name, nodes, setNotice]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const problem = validateWorkflowConnection(connection, edges);
      if (problem) {
        setNotice({ message: problem, tone: "error" });
        return;
      }
      setEdges((current) => addEdge({ ...connection, animated: true }, current));
    },
    [edges, setEdges, setNotice],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      const problem = validateWorkflowConnection(connection, edges, oldEdge.id);
      if (problem) {
        setNotice({ message: problem, tone: "error" });
        return;
      }
      setEdges((current) => reconnectEdge(oldEdge, connection, current));
    },
    [edges, setEdges, setNotice],
  );

  const addNode = useCallback(
    (type: WorkflowNodeType, position?: { x: number; y: number }) => {
      const item = catalogByType[type];
      const node: WorkflowNode = {
        id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
        type: "workflow",
        position:
          position ??
          reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
        data: {
          label: item.label,
          description: item.description,
          nodeType: type,
          config: structuredClone(item.defaultConfig),
        },
      };
      setNodes((current) => [...current, node]);
      setSelectedNodeId(node.id);
      setPanelMode("step");
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

  const selectNode = (id: string) => {
    setSelectedNodeId(id);
    setPanelMode("step");
  };

  const updateSelectedNode = (updated: WorkflowNode) =>
    setNodes((current) => current.map((node) => (node.id === updated.id ? updated : node)));

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
    );
    setSelectedNodeId(undefined);
    setPanelMode("run");
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
    setPanelMode("run");
    setSelectedNodeId(undefined);
    setLatestResult({ status: "queued" });
    setPendingApproval(undefined);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));

    try {
      const currentConnections = convexClient
        ? await convexClient.query(listConnectionsRef, {})
        : connections;

      // Fail before doing any work if a live step has no usable account.
      const unready = nodes.find((node) => {
        const provider =
          node.data.nodeType === "slack"
            ? "slack"
            : ["gmailTrigger", "googleDoc"].includes(node.data.nodeType)
              ? "google"
              : undefined;
        if (!provider || node.data.config.executionMode !== "live") return false;
        const ref = String(node.data.config.connectionRef ?? "");
        return !currentConnections.some(
          (connection) =>
            connection.provider === provider &&
            connection.externalId === ref &&
            connection.status === "active",
        );
      });
      if (unready) {
        navigate("/connections");
        throw new Error(`${unready.data.label} needs an active connected account.`);
      }

      if (convexClient) {
        const client = convexClient;
        const updatedAt = Date.now();
        await client.mutation(upsertWorkflowRef, {
          externalId: initial.id,
          name,
          description,
          enabled,
          nodes: persistableNodes(nodes),
          edges,
          updatedAt,
        });
        const runId = await client.mutation(startRunRef, {
          externalWorkflowId: initial.id,
          input: { requestedBy: "Editor user", date: new Date().toLocaleDateString() },
          trigger: "manual",
        });
        setLatestResult({ id: runId, status: "queued" });

        await new Promise<void>((resolve, reject) => {
          const watch = client.watchQuery(getRunRef, { runId });
          let unsubscribe = () => {};
          unsubscribe = watch.onUpdate(() => {
            try {
              const run = watch.localQueryResult();
              if (!run) return;
              setLatestResult({
                id: runId,
                status: run.status,
                output: run.output,
                error: run.error,
                steps: run.steps.map((step) => ({ id: step._id, ...step })),
              });

              const waiting = [...run.steps].reverse().find((step) => step.status === "waiting");
              if (waiting) {
                const workflowNode = nodes.find((node) => node.id === waiting.nodeId);
                setPendingApproval({
                  backendRunId: runId,
                  nodeId: waiting.nodeId,
                  title: waiting.nodeLabel,
                  prompt: String(workflowNode?.data.config.prompt ?? "Approve this result?"),
                  input: waiting.input,
                });
              } else setPendingApproval(undefined);

              setNodes((current) =>
                current.map((node) => {
                  const latest = [...run.steps].reverse().find((step) => step.nodeId === node.id);
                  const status =
                    latest?.status === "completed"
                      ? "success"
                      : latest?.status === "failed"
                        ? "error"
                        : latest?.status === "waiting"
                          ? "waiting"
                          : latest
                            ? "running"
                            : "idle";
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
          { ...initial, name, description, enabled, nodes, edges, updatedAt: Date.now() },
          (log) => setLogs((current) => [...current, log]),
          (nodeId, status) =>
            setNodes((current) =>
              current.map((node) =>
                node.id === nodeId ? { ...node, data: { ...node.data, status } } : node,
              ),
            ),
          (request) =>
            new Promise((resolve) => {
              demoApprovalResolver.current = resolve;
              setPendingApproval(request);
            }),
        );
        setLatestResult({
          id: demoRun.id,
          status: demoRun.status,
          output: demoRun.output,
          error: demoRun.error,
        });
      }
    } catch (error) {
      void refreshConnections().catch(() => undefined);
      setLatestResult((current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "Workflow failed.",
      }));
    } finally {
      setRunning(false);
      setPendingApproval(undefined);
      demoApprovalResolver.current = undefined;
    }
  };

  const decideApproval = async (approved: boolean, note?: string) => {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    try {
      if (convexClient && pendingApproval.backendRunId) {
        await convexClient.mutation(approveRunRef, {
          runId: pendingApproval.backendRunId,
          nodeId: pendingApproval.nodeId,
          approved,
          ...(note?.trim() ? { note: note.trim() } : {}),
        });
      } else if (demoApprovalResolver.current) {
        demoApprovalResolver.current({ approved, ...(note?.trim() ? { note: note.trim() } : {}) });
        demoApprovalResolver.current = undefined;
      }
      setPendingApproval(undefined);
      setNotice({
        message: approved ? "Approved — the workflow is continuing" : "Rejected — the run stops here",
        tone: "info",
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not record the decision",
        tone: "error",
      });
    } finally {
      setApprovalBusy(false);
    }
  };

  const restoreStarter = () => {
    const starter = structuredClone(STARTER_WORKFLOW);
    setName(starter.name);
    setDescription(starter.description);
    setEnabled(starter.enabled);
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setSelectedNodeId(undefined);
    setNotice({ message: "Starter workflow restored", tone: "info" });
  };

  return (
    <div className="route">
      <header className="topbar">
        <div className="topbar-title">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Workflow name" />
          <span className="save-state">
            {saved ? (
              <>
                <Check size={12} /> Saved
              </>
            ) : (
              <>
                <Loader2 className="spin" size={12} /> Saving
              </>
            )}
          </span>
        </div>

        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={restoreStarter} title="Restore the starter workflow">
            <RotateCcw size={14} /> Reset
          </button>
          <label className="switch-inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>{enabled ? "Active" : "Draft"}</span>
          </label>
          <button className="btn btn-primary" onClick={() => void runWorkflow()} disabled={running}>
            {running ? <Loader2 className="spin" size={14} /> : <Play size={14} fill="currentColor" />}
            {running ? "Running" : "Run workflow"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <NodePalette onAdd={addNode} />

        <section
          className="canvas"
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
        >
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
            onNodeClick={(_, node) => selectNode(node.id)}
            onPaneClick={() => {
              setSelectedNodeId(undefined);
              setPanelMode("run");
            }}
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

        <SidePanel
          mode={panelMode}
          onModeChange={setPanelMode}
          stepLabel="Step"
          runBadge={running ? <span className="dot dot-running" /> : undefined}
          step={
            selectedNode ? (
              <Inspector
                node={selectedNode}
                onChange={updateSelectedNode}
                onDelete={deleteSelectedNode}
                onDuplicate={duplicateSelectedNode}
                connections={connections}
                onOpenConnectors={() => navigate("/connections")}
              />
            ) : (
              <div className="tx-empty">
                <p className="t-heading">No step selected</p>
                <p className="t-small t-muted">
                  Choose a card on the canvas to rename it, change what it does, or pick the account
                  it uses.
                </p>
              </div>
            )
          }
          run={
            <RunTranscript
              result={latestResult}
              pendingApproval={pendingApproval}
              approvalBusy={approvalBusy}
              onApproval={(approved, note) => void decideApproval(approved, note)}
              onRun={() => void runWorkflow()}
              running={running}
            />
          }
        />
      </div>
    </div>
  );
}
