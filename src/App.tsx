import {
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { Check, Loader2, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { catalogByType, STARTER_WORKFLOW } from "./catalog";
import { Inspector } from "./components/Inspector";
import { NodePalette } from "./components/NodePalette";
import { RunTranscript } from "./components/RunTranscript";
import { SidePanel, type PanelMode } from "./components/SidePanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { useConnections } from "./lib/connections";
import {
  approveRunRef,
  convexClient,
  getRunRef,
  getWorkflowRef,
  listConnectionsRef,
  retryRunRef,
  startRunRef,
  upsertWorkflowRef,
} from "./lib/convexClient";
import { runDemo } from "./lib/demoRunner";
import { mappingSourcesForNode } from "./lib/dataMapping";
import { validateWorkflowConnection } from "./lib/workflowConnections";
import { nodeIdsForRunScope, type RunScopeMode } from "../shared/executionGraph";
import type { Id } from "../convex/_generated/dataModel";
import type {
  LatestRunResult,
  PendingApproval,
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

function persistableNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const persisted = nodes.map((node) => {
    const { status: _status, ...data } = node.data;
    const isBoundary = data.nodeType === "daytonaSandbox";
    return {
      id: node.id,
      type: isBoundary ? "sandbox" as const : "workflow" as const,
      position: node.position,
      data,
      ...(node.parentId ? { parentId: node.parentId, extent: "parent" as const } : {}),
      ...(isBoundary ? {
        initialWidth: node.measured?.width ?? node.width ?? node.initialWidth ?? 560,
        initialHeight: node.measured?.height ?? node.height ?? node.initialHeight ?? 320,
      } : {}),
    };
  });
  return persisted.sort((left, right) =>
    Number(right.data.nodeType === "daytonaSandbox") - Number(left.data.nodeType === "daytonaSandbox"));
}

const DAYTONA_CHILD_TYPES = new Set<WorkflowNodeType>(["code", "shell", "git"]);
type EditorRunMode = Exclude<RunScopeMode, "resume">;

interface EditorState {
  name: string;
  description: string;
  enabled: boolean;
  selectedNodeId?: string;
  saved: boolean;
  running: boolean;
  latestResult?: LatestRunResult;
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  backendLoaded: boolean;
  panelMode: PanelMode;
}

type EditorAction =
  | { type: "patch"; patch: Partial<EditorState> }
  | { type: "setLatestResult"; value: SetStateAction<LatestRunResult | undefined> };

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "setLatestResult") {
    const latestResult = typeof action.value === "function" ? action.value(state.latestResult) : action.value;
    return { ...state, latestResult };
  }
  return { ...state, ...action.patch };
}

function useWorkflowEditorController() {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const { connections, setNotice, refresh: refreshConnections } = useConnections();

  const initial = useMemo(
    () => ({ ...structuredClone(STARTER_WORKFLOW), id: workflowId ?? STARTER_WORKFLOW.id }),
    [workflowId],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [editor, dispatch] = useReducer(editorReducer, {
    name: initial.name,
    description: initial.description,
    enabled: initial.enabled,
    saved: true,
    running: false,
    approvalBusy: false,
    backendLoaded: false,
    panelMode: "run",
  });
  const {
    name,
    description,
    enabled,
    selectedNodeId,
    saved,
    running,
    latestResult,
    pendingApproval,
    approvalBusy,
    backendLoaded,
    panelMode,
  } = editor;
  const patchEditor = useCallback((patch: Partial<EditorState>) => dispatch({ type: "patch", patch }), []);
  const setLatestResult = useCallback(
    (value: SetStateAction<LatestRunResult | undefined>) => dispatch({ type: "setLatestResult", value }),
    [],
  );

  const reactFlow = useReactFlow<WorkflowNode>();
  const saveTimer = useRef<number | undefined>(undefined);
  const hydratedOnce = useRef(false);
  const skipInitialSave = useRef(true);
  const demoApprovalResolver = useRef<((decision: { approved: boolean; note?: string }) => void) | undefined>(
    undefined,
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const mappingSources = useMemo(
    () => selectedNodeId ? mappingSourcesForNode(selectedNodeId, edges, latestResult?.steps, nodes) : [],
    [edges, latestResult?.steps, nodes, selectedNodeId],
  );
  const latestSelectedStep = selectedNodeId
    ? [...(latestResult?.steps ?? [])].reverse().find((step) => step.nodeId === selectedNodeId)
    : undefined;

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
        patchEditor({
          name: remote.name,
          description: remote.description,
          enabled: remote.enabled,
          backendLoaded: true,
        });
        setNodes(persistableNodes(remote.nodes as WorkflowNode[]));
        setEdges(remote.edges);
      })
      .catch((error) =>
        setNotice({
          message: error instanceof Error ? error.message : "Could not load this workflow",
          tone: "error",
        }),
      )
  }, [initial.id, navigate, patchEditor, setEdges, setNodes, setNotice]);

  useEffect(() => {
    if (!backendLoaded) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    patchEditor({ saved: false });
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
        patchEditor({ saved: true });
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
        .then(() => patchEditor({ saved: true }))
        .catch((error) =>
          setNotice({
            message: error instanceof Error ? `Save failed: ${error.message}` : "Save failed",
            tone: "error",
          }),
        );
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [backendLoaded, description, edges, enabled, initial, name, nodes, patchEditor, setNotice]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const problem = validateWorkflowConnection(connection, edges);
      if (problem) {
        setNotice({ message: problem, tone: "error" });
        return;
      }
      setEdges((current) => addEdge(connection, current));
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
      const fallbackPosition = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const desiredPosition = position ?? fallbackPosition;
      if (type === "daytonaSandbox") {
        const boundary: WorkflowNode = {
          id: `daytonaSandbox-${crypto.randomUUID().slice(0, 8)}`,
          type: "sandbox",
          position: desiredPosition,
          initialWidth: 560,
          initialHeight: 320,
          data: {
            label: item.label,
            description: item.description,
            nodeType: type,
            config: structuredClone(item.defaultConfig),
          },
        };
        setNodes((current) => [...current, boundary]);
        patchEditor({ selectedNodeId: boundary.id, panelMode: "step" });
        return;
      }

      if (DAYTONA_CHILD_TYPES.has(type)) {
        const boundaries = nodes.filter((node) => node.data.nodeType === "daytonaSandbox" && !node.parentId);
        const containingBoundary = boundaries.find((boundary) => {
          const width = boundary.measured?.width ?? boundary.width ?? boundary.initialWidth ?? 560;
          const height = boundary.measured?.height ?? boundary.height ?? boundary.initialHeight ?? 320;
          return desiredPosition.x >= boundary.position.x && desiredPosition.x <= boundary.position.x + width &&
            desiredPosition.y >= boundary.position.y && desiredPosition.y <= boundary.position.y + height;
        });
        const boundary = containingBoundary ?? (!position ? boundaries[0] : undefined);
        const boundaryId = boundary?.id ?? `daytonaSandbox-${crypto.randomUUID().slice(0, 8)}`;
        const newBoundary: WorkflowNode | undefined = boundary ? undefined : {
          id: boundaryId,
          type: "sandbox",
          position: { x: desiredPosition.x - 70, y: desiredPosition.y - 90 },
          initialWidth: 560,
          initialHeight: 320,
          data: {
            label: catalogByType.daytonaSandbox.label,
            description: catalogByType.daytonaSandbox.description,
            nodeType: "daytonaSandbox",
            config: structuredClone(catalogByType.daytonaSandbox.defaultConfig),
          },
        };
        const parentPosition = boundary?.position ?? newBoundary!.position;
        const siblingCount = nodes.filter((node) => node.parentId === boundaryId).length;
        const childPosition = containingBoundary || newBoundary
          ? { x: desiredPosition.x - parentPosition.x, y: desiredPosition.y - parentPosition.y }
          : { x: 50 + (siblingCount % 2) * 245, y: 90 + Math.floor(siblingCount / 2) * 105 };
        const child: WorkflowNode = {
          id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
          type: "workflow",
          parentId: boundaryId,
          extent: "parent",
          position: childPosition,
          data: {
            label: item.label,
            description: item.description,
            nodeType: type,
            config: structuredClone(item.defaultConfig),
          },
        };
        setNodes((current) => [...current, ...(newBoundary ? [newBoundary] : []), child]);
        patchEditor({ selectedNodeId: child.id, panelMode: "step" });
        return;
      }
      const node: WorkflowNode = {
        id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
        type: "workflow",
        position: desiredPosition,
        data: {
          label: item.label,
          description: item.description,
          nodeType: type,
          config: structuredClone(item.defaultConfig),
        },
      };
      setNodes((current) => [...current, node]);
      patchEditor({ selectedNodeId: node.id, panelMode: "step" });
    },
    [nodes, patchEditor, reactFlow, setNodes],
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

  const selectNode = useCallback((id: string) => {
    patchEditor({ selectedNodeId: id, panelMode: "step" });
  }, [patchEditor]);

  const clearSelection = useCallback(() => {
    patchEditor({ selectedNodeId: undefined, panelMode: "run" });
  }, [patchEditor]);

  const updateSelectedNode = (updated: WorkflowNode) =>
    setNodes((current) => current.map((node) => (node.id === updated.id ? updated : node)));

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    const removedIds = nodes.reduce(
      (ids, node) => {
        if (node.parentId === selectedNodeId) ids.add(node.id);
        return ids;
      },
      new Set([selectedNodeId]),
    );
    setNodes((current) => current.filter((node) => !removedIds.has(node.id)));
    setEdges((current) =>
      current.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
    );
    patchEditor({ selectedNodeId: undefined, panelMode: "run" });
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
    patchEditor({ selectedNodeId: duplicate.id });
  };

  const observeBackendRun = async (
    client: NonNullable<typeof convexClient>,
    runId: Id<"workflowRuns">,
  ) => new Promise<void>((resolve, reject) => {
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
          patchEditor({ pendingApproval: {
            backendRunId: runId,
            nodeId: waiting.nodeId,
            title: waiting.nodeLabel,
            prompt: String(workflowNode?.data.config.prompt ?? "Approve this result?"),
            input: waiting.input,
          } });
        } else patchEditor({ pendingApproval: undefined });

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
            return node.data.status === status
              ? node
              : { ...node, data: { ...node.data, status } };
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

  const runWorkflow = async (runMode: EditorRunMode = "full", scopeNodeId?: string) => {
    if (running) return;
    patchEditor({
      running: true,
      panelMode: "run",
      selectedNodeId: undefined,
      latestResult: { status: "queued" },
      pendingApproval: undefined,
    });
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));

    try {
      const currentConnections = convexClient
        ? await convexClient.query(listConnectionsRef, {})
        : connections;

      // Fail before doing any work if a live step has no usable account.
      const activeNodeIds = nodeIdsForRunScope(nodes, edges, runMode, scopeNodeId);
      const unready = nodes.find((node) => {
        if (!activeNodeIds.has(node.id)) return false;
        const provider =
          node.data.nodeType === "slack"
            ? "slack"
            : ["gmailTrigger", "gmailEventTrigger", "calendarTrigger", "driveTrigger", "sheetsTrigger", "googleDoc"].includes(node.data.nodeType)
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
          runMode,
          ...(scopeNodeId ? { scopeNodeId } : {}),
        });
        setLatestResult({ id: runId, status: "queued" });

        await observeBackendRun(client, runId);
      } else {
        const demoRun = await runDemo(
          { ...initial, name, description, enabled, nodes, edges, updatedAt: Date.now() },
          () => undefined,
          (nodeId, status) =>
            setNodes((current) =>
              current.map((node) =>
                node.id === nodeId ? { ...node, data: { ...node.data, status } } : node,
              ),
            ),
          (request) =>
            new Promise((resolve) => {
              demoApprovalResolver.current = resolve;
              patchEditor({ pendingApproval: request });
            }),
          { runMode, scopeNodeId },
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
      patchEditor({ running: false, pendingApproval: undefined });
      demoApprovalResolver.current = undefined;
    }
  };

  const retryFailedRun = async () => {
    if (running || !convexClient || !latestResult?.id) return;
    patchEditor({ running: true, panelMode: "run", pendingApproval: undefined });
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
    try {
      const runId = await convexClient.mutation(retryRunRef, {
        runId: latestResult.id as Id<"workflowRuns">,
      });
      setLatestResult({ id: runId, status: "queued" });
      await observeBackendRun(convexClient, runId);
    } catch (error) {
      setLatestResult((current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "Retry failed.",
      }));
    } finally {
      patchEditor({ running: false, pendingApproval: undefined });
    }
  };

  const decideApproval = async (approved: boolean, note?: string) => {
    if (!pendingApproval || approvalBusy) return;
    patchEditor({ approvalBusy: true });
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
      patchEditor({ pendingApproval: undefined });
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
      patchEditor({ approvalBusy: false });
    }
  };

  const restoreStarter = () => {
    const starter = structuredClone(STARTER_WORKFLOW);
    patchEditor({
      name: starter.name,
      description: starter.description,
      enabled: starter.enabled,
      selectedNodeId: undefined,
    });
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setNotice({ message: "Starter workflow restored", tone: "info" });
  };

  return {
    name,
    enabled,
    saved,
    running,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onReconnect,
    selectNode,
    clearSelection,
    onDrop,
    panelMode,
    selectedNode,
    connections,
    mappingSources,
    latestSelectedStep,
    latestResult,
    pendingApproval,
    approvalBusy,
    addNode,
    restoreStarter,
    runWorkflow,
    retryFailedRun,
    updateSelectedNode,
    deleteSelectedNode,
    duplicateSelectedNode,
    decideApproval,
    pinSelectedOutput: (output: unknown) => {
      if (!selectedNode) return;
      updateSelectedNode({
        ...selectedNode,
        data: {
          ...selectedNode.data,
          config: { ...selectedNode.data.config, pinnedOutput: output, pinnedAt: Date.now() },
        },
      });
      setNotice({ message: `${selectedNode.data.label} output pinned for testing`, tone: "info" });
    },
    unpinSelectedOutput: () => {
      if (!selectedNode) return;
      const { pinnedOutput: _pinnedOutput, pinnedAt: _pinnedAt, ...config } = selectedNode.data.config;
      updateSelectedNode({ ...selectedNode, data: { ...selectedNode.data, config } });
      setNotice({ message: `${selectedNode.data.label} sample output unpinned`, tone: "info" });
    },
    openConnectors: () => navigate("/connections"),
    setName: (name: string) => patchEditor({ name }),
    setEnabled: (enabled: boolean) => patchEditor({ enabled }),
    setPanelMode: (panelMode: PanelMode) => patchEditor({ panelMode }),
  };
}

function WorkflowEditorView({
  name,
  enabled,
  saved,
  running,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onReconnect,
  selectNode,
  clearSelection,
  onDrop,
  panelMode,
  selectedNode,
  connections,
  mappingSources,
  latestSelectedStep,
  latestResult,
  pendingApproval,
  approvalBusy,
  addNode,
  restoreStarter,
  runWorkflow,
  retryFailedRun,
  updateSelectedNode,
  deleteSelectedNode,
  duplicateSelectedNode,
  decideApproval,
  pinSelectedOutput,
  unpinSelectedOutput,
  openConnectors,
  setName,
  setEnabled,
  setPanelMode,
}: ReturnType<typeof useWorkflowEditorController>) {
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

        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onSelectNode={selectNode}
          onPaneClick={clearSelection}
          onDrop={onDrop}
        />

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
                onOpenConnectors={openConnectors}
                mappingSources={mappingSources}
                latestStep={latestSelectedStep}
                running={running}
                onRunStep={(mode) => void runWorkflow(mode, selectedNode.id)}
                onPinOutput={pinSelectedOutput}
                onUnpinOutput={unpinSelectedOutput}
              />
            ) : (
              <div className="tx-empty">
                <p className="t-heading">No step selected</p>
                <p className="t-small t-muted">Pick a step on the canvas to edit it.</p>
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
              onRetry={() => void retryFailedRun()}
              running={running}
            />
          }
        />
      </div>
    </div>
  );
}

export default function App() {
  return <WorkflowEditorView {...useWorkflowEditorController()} />;
}
