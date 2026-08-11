import {
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { Check, History, Loader2, Play, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { catalogByType, STARTER_WORKFLOW } from "./catalog";
import { BuildChat } from "./components/BuildChat";
import { Inspector } from "./components/Inspector";
import { NodePalette } from "./components/NodePalette";
import { RunTranscript } from "./components/RunTranscript";
import { SidePanel, type PanelMode } from "./components/SidePanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { useConnections } from "./lib/connections";
import {
  approveRunRef,
  convexClient,
  decidePlanRef,
  getRunRef,
  getWorkflowRef,
  listWorkflowVersionsRef,
  listConnectionsRef,
  latestRunRef,
  markBuildChatAppliedRef,
  retryRunRef,
  rollbackWorkflowRef,
  startRunRef,
  publishWorkflowRef,
  upsertWorkflowRef,
  type BuildChatMessage,
  type StoredRun,
} from "./lib/convexClient";
import { materializeProposal } from "./lib/buildProposal";
import { bindDefaultConnections, connectorProviderForNode } from "./lib/connectionBinding";
import { mappingSourcesForNode } from "./lib/dataMapping";
import { validateWorkflowConnection } from "./lib/workflowConnections";
import { persistableNodes, workflowDraftFingerprint } from "./lib/workflowPersistence";
import { nodeIdsForRunScope, type RunScopeMode } from "../shared/executionGraph";
import type { Id } from "../convex/_generated/dataModel";
import type {
  LatestRunResult,
  PendingApproval,
  PendingPlanReview,
  RuntimeAgentSummary,
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

const DAYTONA_CHILD_TYPES = new Set<WorkflowNodeType>(["code", "shell", "git"]);
type EditorRunMode = Exclude<RunScopeMode, "resume">;

interface EditorState {
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrentRuns: number;
  selectedNodeId?: string;
  saved: boolean;
  running: boolean;
  latestResult?: LatestRunResult;
  pendingApproval?: PendingApproval;
  approvalBusy: boolean;
  pendingPlanReview?: PendingPlanReview;
  planBusy: boolean;
  backendLoaded: boolean;
  panelMode: PanelMode;
  versions: Array<{ _id: Id<"workflowVersions">; version: number; createdAt: number }>;
  currentVersion: number;
  publishedVersion?: number;
  rollbackVersionId?: Id<"workflowVersions">;
  versionBusy: boolean;
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
    maxConcurrentRuns: initial.maxConcurrentRuns,
    saved: true,
    running: false,
    approvalBusy: false,
    planBusy: false,
    backendLoaded: false,
    panelMode: "run",
    versions: [],
    currentVersion: 1,
    versionBusy: false,
  });
  const {
    name,
    description,
    enabled,
    maxConcurrentRuns,
    selectedNodeId,
    saved,
    running,
    latestResult,
    pendingApproval,
    approvalBusy,
    pendingPlanReview,
    planBusy,
    backendLoaded,
    panelMode,
    versions,
    currentVersion,
    publishedVersion,
    rollbackVersionId,
    versionBusy,
  } = editor;
  const patchEditor = useCallback((patch: Partial<EditorState>) => dispatch({ type: "patch", patch }), []);
  const setLatestResult = useCallback(
    (value: SetStateAction<LatestRunResult | undefined>) => dispatch({ type: "setLatestResult", value }),
    [],
  );

  const reactFlow = useReactFlow<WorkflowNode>();
  const saveTimer = useRef<number | undefined>(undefined);
  const hydratedOnce = useRef(false);
  const latestRunHydrated = useRef(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const skipInitialSave = useRef(true);
  const persistedNodes = useMemo(() => persistableNodes(nodes), [nodes]);
  const draftSnapshot = useMemo(
    () => ({
      name,
      description,
      enabled,
      maxConcurrentRuns,
      nodes: persistedNodes,
      edges,
    }),
    [description, edges, enabled, maxConcurrentRuns, name, persistedNodes],
  );
  const draftFingerprint = useMemo(() => workflowDraftFingerprint(draftSnapshot), [draftSnapshot]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const mappingSources = useMemo(
    () => selectedNodeId ? mappingSourcesForNode(selectedNodeId, edges, latestResult?.steps, nodes) : [],
    [edges, latestResult?.steps, nodes, selectedNodeId],
  );
  const latestSelectedStep = selectedNodeId
    ? [...(latestResult?.steps ?? [])].reverse().find((step) => step.nodeId === selectedNodeId)
    : undefined;

  const refreshVersions = useCallback(async () => {
    if (!convexClient) return;
    const state = await convexClient.query(listWorkflowVersionsRef, { externalId: initial.id });
    const rollbackCandidate = state.versions.find((version) => version.version !== state.currentVersion)?._id;
    patchEditor({
      versions: state.versions,
      currentVersion: state.currentVersion,
      publishedVersion: state.publishedVersion,
      rollbackVersionId: rollbackCandidate,
    });
  }, [initial.id, patchEditor]);

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
          maxConcurrentRuns: remote.maxConcurrentRuns ?? 3,
          backendLoaded: true,
        });
        setNodes(persistableNodes(remote.nodes as WorkflowNode[]));
        setEdges(remote.edges);
        void refreshVersions();
      })
      .catch((error) =>
        setNotice({
          message: error instanceof Error ? error.message : "Could not load this workflow",
          tone: "error",
        }),
      )
  }, [initial.id, navigate, patchEditor, refreshVersions, setEdges, setNodes, setNotice]);

  useEffect(() => {
    if (!backendLoaded) return;
    setNodes((current) => bindDefaultConnections(current, connections));
  }, [backendLoaded, connections, setNodes]);

  useEffect(() => {
    if (!backendLoaded) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    patchEditor({ saved: false });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const snapshot = JSON.parse(draftFingerprint) as typeof draftSnapshot;
      const definition = {
        ...initial,
        ...snapshot,
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
          maxConcurrentRuns: definition.maxConcurrentRuns,
          nodes: definition.nodes,
          edges: definition.edges,
          updatedAt: definition.updatedAt,
        })
        .then(() => {
          patchEditor({ saved: true });
          void refreshVersions();
        })
        .catch((error) =>
          setNotice({
            message: error instanceof Error ? `Save failed: ${error.message}` : "Save failed",
            tone: "error",
          }),
        );
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [backendLoaded, draftFingerprint, initial, patchEditor, refreshVersions, setNotice]);

  const publishCurrentVersion = async () => {
    if (!convexClient || !saved || versionBusy) return;
    patchEditor({ versionBusy: true });
    try {
      const published = await convexClient.mutation(publishWorkflowRef, { externalId: initial.id });
      await refreshVersions();
      setNotice({ message: `Version ${published} published for active triggers`, tone: "info" });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Could not publish workflow", tone: "error" });
    } finally {
      patchEditor({ versionBusy: false });
    }
  };

  const rollbackToVersion = async () => {
    if (!convexClient || !rollbackVersionId || versionBusy) return;
    patchEditor({ versionBusy: true });
    try {
      const restored = await convexClient.mutation(rollbackWorkflowRef, {
        externalId: initial.id,
        versionId: rollbackVersionId,
      });
      const remote = await convexClient.query(getWorkflowRef, { externalId: initial.id });
      if (!remote) throw new Error("Workflow not found after rollback.");
      patchEditor({ name: remote.name, description: remote.description, enabled: remote.enabled, saved: true });
      setNodes(persistableNodes(remote.nodes as WorkflowNode[]));
      setEdges(remote.edges);
      await refreshVersions();
      setNotice({ message: `Restored as draft version ${restored.version}. Publish when ready.`, tone: "info" });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Could not restore workflow version", tone: "error" });
    } finally {
      patchEditor({ versionBusy: false });
    }
  };

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
      const [boundNode] = bindDefaultConnections([node], connections);
      setNodes((current) => [...current, boundNode]);
      patchEditor({ selectedNodeId: boundNode.id, panelMode: "step" });
    },
    [connections, nodes, patchEditor, reactFlow, setNodes],
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

  // Merge config updates against the *current* node state so rapid successive
  // edits (e.g. toggling switches quickly) never clobber each other with a
  // stale render-time snapshot.
  const patchSelectedNodeConfig = useCallback(
    (updates: Record<string, unknown>, removeKeys?: string[]) => {
      const nodeId = selectedNodeId;
      if (!nodeId) return;
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const config = { ...node.data.config, ...updates };
          for (const key of removeKeys ?? []) delete config[key];
          return { ...node, data: { ...node.data, config } };
        }),
      );
    },
    [selectedNodeId, setNodes],
  );

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

  const applyBackendRun = useCallback((
    run: StoredRun,
    runId: Id<"workflowRuns">,
  ) => {
    setLatestResult({
      id: runId,
      status: run.status,
      output: run.output,
      error: run.error,
      steps: run.steps.map((step) => ({ id: step._id, ...step })),
    });

    const waiting = [...run.steps].reverse().find((step) => step.status === "waiting");
    if (waiting && waiting.plan?.status === "proposed") {
      patchEditor({
        pendingApproval: undefined,
        pendingPlanReview: {
          backendRunId: runId,
          nodeId: waiting.nodeId,
          title: waiting.nodeLabel,
          steps: waiting.plan.steps.map((planStep) => planStep.title),
        },
      });
    } else if (waiting) {
      const workflowNode = nodesRef.current.find((node) => node.id === waiting.nodeId);
      patchEditor({ pendingPlanReview: undefined, pendingApproval: {
        backendRunId: runId,
        nodeId: waiting.nodeId,
        title: waiting.nodeLabel,
        prompt: String(workflowNode?.data.config.prompt ?? "Approve this result?"),
        input: waiting.input,
      } });
    } else patchEditor({ pendingApproval: undefined, pendingPlanReview: undefined });

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
  }, [patchEditor, setLatestResult, setNodes]);

  const observeBackendRun = useCallback((
    client: NonNullable<typeof convexClient>,
    runId: Id<"workflowRuns">,
  ) => new Promise<void>((resolve, reject) => {
    const watch = client.watchQuery(getRunRef, { runId });
    let unsubscribe = () => {};
    unsubscribe = watch.onUpdate(() => {
      try {
        const run = watch.localQueryResult();
        if (!run) return;
        applyBackendRun(run, runId);

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
  }), [applyBackendRun]);

  useEffect(() => {
    if (!backendLoaded || !convexClient || latestRunHydrated.current) return;
    latestRunHydrated.current = true;
    let disposed = false;
    const client = convexClient;
    void client.query(latestRunRef, { externalWorkflowId: initial.id }).then((run) => {
      if (disposed || !run) return;
      applyBackendRun(run, run._id);
      if (run.status !== "queued" && run.status !== "running" && run.status !== "waiting") return;
      patchEditor({ running: true, panelMode: "run" });
      void observeBackendRun(client, run._id)
        .catch((error) => {
          if (disposed) return;
          setLatestResult((current) => ({
            ...current,
            status: "failed",
            error: error instanceof Error ? error.message : "Workflow failed.",
          }));
        })
        .finally(() => {
          if (!disposed) patchEditor({ running: false });
        });
    }).catch((error) => {
      if (!disposed) {
        setNotice({
          message: error instanceof Error ? error.message : "Could not restore the latest run",
          tone: "error",
        });
      }
    });
    return () => { disposed = true; };
  }, [applyBackendRun, backendLoaded, initial.id, observeBackendRun, patchEditor, setLatestResult, setNotice]);

  const runWorkflow = async (runMode: EditorRunMode = "full", scopeNodeId?: string) => {
    if (running) return;
    patchEditor({
      running: true,
      panelMode: "run",
      selectedNodeId: undefined,
      latestResult: { status: "queued" },
      pendingApproval: undefined,
      pendingPlanReview: undefined,
    });
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));

    try {
      if (!convexClient) {
        throw new Error("Workflow execution is unavailable because VITE_CONVEX_URL is not configured.");
      }
      const client = convexClient;
      const currentConnections = await client.query(listConnectionsRef, {});
      const preparedNodes = bindDefaultConnections(nodes, currentConnections);
      if (preparedNodes !== nodes) setNodes(preparedNodes);

      // Fail before doing any work if a connector step has no usable account.
      const activeNodeIds = nodeIdsForRunScope(preparedNodes, edges, runMode, scopeNodeId);
      const unready = preparedNodes.find((node) => {
        if (!activeNodeIds.has(node.id)) return false;
        const provider = connectorProviderForNode(node.data.nodeType);
        if (!provider) return false;
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

      // A run consumes the last saved builder definition. Persist only when
      // the user actually edited the draft or connection binding changed;
      // execution status and runtime-agent updates never create versions.
      if (!saved || preparedNodes !== nodes) {
        window.clearTimeout(saveTimer.current);
        await client.mutation(upsertWorkflowRef, {
          externalId: initial.id,
          name,
          description,
          enabled,
          maxConcurrentRuns,
          nodes: persistableNodes(preparedNodes),
          edges,
          updatedAt: Date.now(),
        });
        patchEditor({ saved: true });
        await refreshVersions();
      }
      const runId = await client.mutation(startRunRef, {
        externalWorkflowId: initial.id,
        input: { requestedBy: "Editor user", date: new Date().toLocaleDateString() },
        trigger: "manual",
        runMode,
        ...(scopeNodeId ? { scopeNodeId } : {}),
      });
      setLatestResult({ id: runId, status: "queued" });

      await observeBackendRun(client, runId);
    } catch (error) {
      void refreshConnections().catch(() => undefined);
      setLatestResult((current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "Workflow failed.",
      }));
    } finally {
      patchEditor({ running: false, pendingApproval: undefined, pendingPlanReview: undefined });
    }
  };

  const retryFailedRun = async () => {
    if (running || !convexClient || !latestResult?.id) return;
    patchEditor({ running: true, panelMode: "run", pendingApproval: undefined, pendingPlanReview: undefined });
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
      patchEditor({ running: false, pendingApproval: undefined, pendingPlanReview: undefined });
    }
  };

  const decidePlanReview = async (approved: boolean, steps?: string[], note?: string) => {
    if (!pendingPlanReview || planBusy) return;
    patchEditor({ planBusy: true });
    try {
      if (convexClient && pendingPlanReview.backendRunId) {
        await convexClient.mutation(decidePlanRef, {
          runId: pendingPlanReview.backendRunId,
          nodeId: pendingPlanReview.nodeId,
          approved,
          ...(steps?.length ? { steps } : {}),
          ...(note?.trim() ? { note: note.trim() } : {}),
        });
      }
      patchEditor({ pendingPlanReview: undefined });
      setNotice({
        message: approved ? "Plan approved — the agent is executing it" : "Plan rejected — the run stops here",
        tone: "info",
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not record the plan decision",
        tone: "error",
      });
    } finally {
      patchEditor({ planBusy: false });
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

  const buildChatGraph = () => ({
    name,
    description,
    nodes: persistableNodes(nodes),
    edges,
  });

  const applyBuildProposal = (message: BuildChatMessage) => {
    if (!message.proposal) return;
    try {
      const materialized = materializeProposal(message.proposal);
      setNodes(bindDefaultConnections(materialized.nodes, connections));
      setEdges(materialized.edges);
      patchEditor({
        selectedNodeId: undefined,
        ...(materialized.name ? { name: materialized.name } : {}),
        ...(materialized.description ? { description: materialized.description } : {}),
      });
      if (convexClient) {
        void convexClient
          .mutation(markBuildChatAppliedRef, { messageId: message._id })
          .catch(() => undefined);
      }
      setNotice({
        message: `Applied ${materialized.nodes.length} steps to the canvas`,
        tone: "info",
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not apply that proposal",
        tone: "error",
      });
    }
  };

  const restoreStarter = () => {
    const starter = structuredClone(STARTER_WORKFLOW);
    patchEditor({
      name: starter.name,
      description: starter.description,
      enabled: starter.enabled,
      maxConcurrentRuns: starter.maxConcurrentRuns,
      selectedNodeId: undefined,
    });
    setNodes(starter.nodes);
    setEdges(starter.edges);
    setNotice({ message: "Starter workflow restored", tone: "info" });
  };

  return {
    workflowExternalId: initial.id,
    name,
    enabled,
    maxConcurrentRuns,
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
    versions,
    currentVersion,
    publishedVersion,
    rollbackVersionId,
    versionBusy,
    selectedNode,
    connections,
    mappingSources,
    latestSelectedStep,
    latestResult,
    pendingApproval,
    approvalBusy,
    pendingPlanReview,
    planBusy,
    addNode,
    restoreStarter,
    runWorkflow,
    retryFailedRun,
    updateSelectedNode,
    patchSelectedNodeConfig,
    deleteSelectedNode,
    duplicateSelectedNode,
    decideApproval,
    decidePlanReview,
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
    setMaxConcurrentRuns: (maxConcurrentRuns: number) => patchEditor({ maxConcurrentRuns }),
    setPanelMode: (panelMode: PanelMode) => patchEditor({ panelMode }),
    setRollbackVersionId: (rollbackVersionId: Id<"workflowVersions">) => patchEditor({ rollbackVersionId }),
    publishCurrentVersion,
    rollbackToVersion,
    buildChatGraph,
    applyBuildProposal,
  };
}

function WorkflowEditorView({
  workflowExternalId,
  name,
  enabled,
  maxConcurrentRuns,
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
  versions,
  currentVersion,
  publishedVersion,
  rollbackVersionId,
  versionBusy,
  selectedNode,
  connections,
  mappingSources,
  latestSelectedStep,
  latestResult,
  pendingApproval,
  approvalBusy,
  pendingPlanReview,
  planBusy,
  addNode,
  restoreStarter,
  runWorkflow,
  retryFailedRun,
  updateSelectedNode,
  patchSelectedNodeConfig,
  deleteSelectedNode,
  duplicateSelectedNode,
  decideApproval,
  decidePlanReview,
  pinSelectedOutput,
  unpinSelectedOutput,
  openConnectors,
  setName,
  setEnabled,
  setMaxConcurrentRuns,
  setPanelMode,
  setRollbackVersionId,
  publishCurrentVersion,
  rollbackToVersion,
  buildChatGraph,
  applyBuildProposal,
}: ReturnType<typeof useWorkflowEditorController>) {
  const canvasNodes = useMemo(() => {
    const latestAgentsByNode = new Map<string, RuntimeAgentSummary[]>();
    for (const step of latestResult?.steps ?? []) {
      if (step.agents?.length) latestAgentsByNode.set(step.nodeId, step.agents);
    }
    return nodes.map((node) => {
      const runtimeAgents = latestAgentsByNode.get(node.id);
      return runtimeAgents?.length
        ? { ...node, data: { ...node.data, runtimeAgents } }
        : node.data.runtimeAgents
          ? { ...node, data: { ...node.data, runtimeAgents: undefined } }
          : node;
    });
  }, [latestResult?.steps, nodes]);

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
          <span className={`version-status ${publishedVersion === currentVersion ? "is-published" : ""}`}>
            v{currentVersion} · {publishedVersion === currentVersion ? "Published" : "Draft"}
          </span>
          <button
            className="btn"
            onClick={() => void publishCurrentVersion()}
            disabled={!saved || versionBusy || publishedVersion === currentVersion}
            title="Publish this draft for schedules, webhooks, and Google event triggers"
          >
            {versionBusy ? <Loader2 className="spin" size={13} /> : <Upload size={13} />} Publish
          </button>
          {versions.length > 1 && (
            <div className="version-rollback">
              <History size={13} aria-hidden="true" />
              <select
                aria-label="Version to restore"
                value={rollbackVersionId ?? ""}
                onChange={(event) => setRollbackVersionId(event.target.value as Id<"workflowVersions">)}
              >
                {versions.map((version) => version.version === currentVersion ? null : (
                  <option key={version._id} value={version._id}>v{version.version}</option>
                ))}
              </select>
              <button className="btn btn-ghost" disabled={!rollbackVersionId || versionBusy} onClick={() => void rollbackToVersion()}>
                Restore
              </button>
            </div>
          )}
          <button className="btn btn-ghost" onClick={restoreStarter} title="Restore the starter workflow">
            <RotateCcw size={14} /> Reset
          </button>
          <label className="switch-inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>{enabled ? "Active" : "Inactive"}</span>
          </label>
          <label className="run-limit" title="Maximum queued, running, or waiting runs for this workflow">
            <span>Parallel runs</span>
            <input
              type="number"
              min={1}
              max={25}
              value={maxConcurrentRuns}
              onChange={(event) => setMaxConcurrentRuns(Math.min(25, Math.max(1, Number(event.target.value) || 1)))}
            />
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
          nodes={canvasNodes}
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
                onPatchConfig={patchSelectedNodeConfig}
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
              pendingPlanReview={pendingPlanReview}
              planBusy={planBusy}
              onPlanDecision={(approved, steps, note) => void decidePlanReview(approved, steps, note)}
              onRun={() => void runWorkflow()}
              onRetry={() => void retryFailedRun()}
              running={running}
            />
          }
          chat={
            <BuildChat
              workflowExternalId={workflowExternalId}
              getGraph={buildChatGraph}
              onApply={applyBuildProposal}
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
