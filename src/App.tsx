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
  HelpCircle,
  History,
  PlugZap,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserButton, useReverification, useUser } from "@clerk/react";
import { catalogByType } from "./catalog";
import { Inspector } from "./components/Inspector";
import { NodePalette } from "./components/NodePalette";
import { OutputPanel } from "./components/OutputPanel";
import { ResourceHub, type HubTab } from "./components/ResourceHub";
import { RunPanel } from "./components/RunPanel";
import { WorkflowNodeComponent } from "./components/WorkflowNode";
import {
  convexClient,
  approveRunRef,
  disconnectGoogleRef,
  disconnectSlackRef,
  getRunRef,
  getWorkflowRef,
  listConnectionsRef,
  startSlackOAuthRef,
  startRunRef,
  syncGoogleRef,
  upsertWorkflowRef,
  type ConnectionMetadata,
} from "./lib/convexClient";
import { runDemo } from "./lib/demoRunner";
import { loadWorkflow, resetWorkflow, saveWorkflow } from "./lib/storage";
import type { LatestRunResult, PendingApproval, RunLog, WorkflowNode, WorkflowNodeType } from "./types";

const nodeTypes = { workflow: WorkflowNodeComponent };
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

function connectionError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  if (message.includes("Slack OAuth is not configured by the administrator")) {
    return "Slack OAuth is not configured yet. Ask an administrator to add the Slack app credentials and encryption key.";
  }
  if (message.includes("Google") && (message.includes("scope") || message.includes("reauthor"))) {
    return "Google needs to be reauthorized with Gmail, Docs, and Drive access. Open Connectors and reconnect the account.";
  }
  const serverMessage = message.match(/Uncaught Error:\s*([^\n]+)/)?.[1];
  return serverMessage ?? message;
}

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
  const { user } = useUser();
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
  const [hubTab, setHubTab] = useState<HubTab>();
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [backendLoaded, setBackendLoaded] = useState(!convexClient);
  const [connections, setConnections] = useState<ConnectionMetadata[]>([]);
  const [connectionBusy, setConnectionBusy] = useState<string>();
  const reactFlow = useReactFlow<WorkflowNode>();
  const saveTimer = useRef<number | undefined>(undefined);
  const hydratedOnce = useRef(false);
  const demoApprovalResolver = useRef<((decision: { approved: boolean; note?: string }) => void) | undefined>(undefined);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  const createGoogleAccount = useReverification(
    (args: Parameters<NonNullable<typeof user>["createExternalAccount"]>[0]) => user!.createExternalAccount(args),
  );

  const refreshConnections = useCallback(async () => {
    if (!convexClient) return;
    setConnections(await convexClient.query(listConnectionsRef, {}));
  }, []);

  useEffect(() => {
    void refreshConnections().catch(() => undefined);
  }, [refreshConnections]);

  useEffect(() => {
    if (!convexClient) return;
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    const status = params.get("status");
    if (!integration) return;
    const detail = params.get("detail");
    window.history.replaceState({}, "", window.location.pathname);
    if (integration === "google" && status === "connected") {
      setConnectionBusy("google");
      void convexClient.action(syncGoogleRef, {}).then(refreshConnections).then(() => setNotice("Google Workspace connected")).catch((error) => setNotice(connectionError(error, "Google connection could not be synchronized"))).finally(() => setConnectionBusy(undefined));
    } else if (integration === "slack" && status === "connected") {
      void refreshConnections().then(() => setNotice("Slack workspace connected"));
    } else {
      setNotice(detail || `${integration === "slack" ? "Slack" : "Google"} connection was not completed`);
    }
  }, [refreshConnections]);

  const connectGoogle = async () => {
    if (!user) return;
    setConnectionBusy("google");
    try {
      const redirectUrl = `${window.location.origin}/sso-callback`;
      const existing = user.externalAccounts.find((account) => account.provider === "google");
      const account = existing
        ? await existing.reauthorize({ additionalScopes: GOOGLE_SCOPES, redirectUrl, oidcPrompt: "consent" })
        : await createGoogleAccount({ strategy: "oauth_google", additionalScopes: GOOGLE_SCOPES, redirectUrl, oidcPrompt: "consent" });
      const verificationUrl = account?.verification?.externalVerificationRedirectURL;
      if (!verificationUrl) throw new Error("Clerk did not return a Google authorization URL.");
      window.location.assign(verificationUrl.href);
    } catch (error) {
      setConnectionBusy(undefined);
      setNotice(connectionError(error, "Could not start Google authorization"));
    }
  };

  const disconnectGoogle = async (externalId: string) => {
    if (!convexClient) return;
    setConnectionBusy(externalId);
    try {
      await convexClient.action(disconnectGoogleRef, { externalId });
      await refreshConnections();
      setNotice("Google Workspace disconnected");
    } catch (error) {
      setNotice(connectionError(error, "Could not disconnect Google"));
    } finally {
      setConnectionBusy(undefined);
    }
  };

  const connectSlack = async () => {
    if (!convexClient) return;
    setConnectionBusy("slack");
    try {
      const authorizeUrl = await convexClient.action(startSlackOAuthRef, { returnUrl: window.location.href });
      window.location.assign(authorizeUrl);
    } catch (error) {
      setConnectionBusy(undefined);
      setNotice(connectionError(error, "Could not start Slack authorization"));
    }
  };

  const disconnectSlack = async (externalId: string) => {
    if (!convexClient) return;
    setConnectionBusy(externalId);
    try {
      const result = await convexClient.action(disconnectSlackRef, { externalId });
      await refreshConnections();
      setNotice(result.revoked ? "Slack workspace disconnected and token revoked" : "Slack disconnected locally; an administrator should verify remote revocation");
    } catch (error) {
      setNotice(connectionError(error, "Could not disconnect Slack"));
    } finally {
      setConnectionBusy(undefined);
    }
  };

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
    setPendingApproval(undefined);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
    try {
      const unready = nodes.find((node) => {
        const provider = node.data.nodeType === "slack" ? "slack" : ["gmailTrigger", "googleDoc"].includes(node.data.nodeType) ? "google" : undefined;
        if (!provider || node.data.config.executionMode !== "live") return false;
        const ref = String(node.data.config.connectionRef ?? "");
        return !connections.some((connection) => connection.provider === provider && connection.externalId === ref && connection.status === "active");
      });
      if (unready) {
        setHubTab("connectors");
        throw new Error(`${unready.data.label} needs an active connected account. Connect or reauthorize it first.`);
      }
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
          input: { requestedBy: "Editor user", date: new Date().toLocaleDateString() },
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
              setLatestResult({ id: runId, status: run.status, output: run.output, error: run.error, steps: run.steps.map((step) => ({ id: step._id, ...step })) });
              setLogs([
                { id: `started-${runId}`, level: "info", message: `Run ${run.status}.`, timestamp: run.startedAt },
                ...run.steps.map((step) => ({
                  id: step._id,
                  nodeId: step.nodeId,
                  level: step.status === "failed" ? "error" as const : step.status === "completed" ? "success" as const : "info" as const,
                  message: step.status === "waiting" ? `${step.nodeLabel} needs a decision` : `${step.nodeLabel} ${step.status}`,
                  timestamp: step.completedAt ?? step.startedAt,
                  output: step.output,
                  explanation: step.error ?? (step.status === "waiting" ? "Review the generated document, then approve or reject below." : step.status === "completed" ? "This result is recorded in the run history." : "OpenWorkflow is working on this step."),
                })),
              ]);
              const waiting = [...run.steps].reverse().find((step) => step.status === "waiting");
              if (waiting) {
                const workflowNode = nodes.find((node) => node.id === waiting.nodeId);
                setPendingApproval({ runId, nodeId: waiting.nodeId, title: waiting.nodeLabel, prompt: String(workflowNode?.data.config.prompt ?? "Approve this result?"), input: waiting.input });
              } else setPendingApproval(undefined);
              setNodes((current) =>
                current.map((node) => {
                  const latest = [...run.steps].reverse().find((step) => step.nodeId === node.id);
                  const status = latest?.status === "completed" ? "success" : latest?.status === "failed" ? "error" : latest?.status === "waiting" ? "waiting" : latest ? "running" : "idle";
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
          (request) => new Promise((resolve) => {
            demoApprovalResolver.current = resolve;
            setPendingApproval(request);
          }),
        );
        setLatestResult({ id: demoRun.id, status: demoRun.status, output: demoRun.output, error: demoRun.error });
      }
    } catch (error) {
      void refreshConnections().catch(() => undefined);
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
      setPendingApproval(undefined);
      demoApprovalResolver.current = undefined;
    }
  };

  const decideApproval = async (approved: boolean, note?: string) => {
    if (!pendingApproval || approvalBusy) return;
    setApprovalBusy(true);
    try {
      if (convexClient && pendingApproval.runId) {
        await convexClient.mutation(approveRunRef, { runId: pendingApproval.runId, nodeId: pendingApproval.nodeId, approved, ...(note?.trim() ? { note: note.trim() } : {}) });
      } else if (demoApprovalResolver.current) {
        demoApprovalResolver.current({ approved, ...(note?.trim() ? { note: note.trim() } : {}) });
        demoApprovalResolver.current = undefined;
      }
      setPendingApproval(undefined);
      setNotice(approved ? "Approved — the workflow is continuing" : "Rejected — the run will stop safely");
      window.setTimeout(() => setNotice(undefined), 2400);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record the decision");
    } finally {
      setApprovalBusy(false);
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

  const useInboxTemplate = () => {
    restoreStarter();
    setHubTab(undefined);
    setNotice("Daily inbox brief template loaded");
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
          <button className="quiet-button" onClick={() => setHubTab("connectors")}><PlugZap size={15} /> Connectors</button>
          <button className="icon-button help-button" onClick={() => setHubTab("help")} title="Help"><HelpCircle size={17} /></button>
          <UserButton userProfileProps={{ additionalOAuthScopes: { google: GOOGLE_SCOPES } }} />
          <label className="enable-control">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span>{enabled ? "Active" : "Draft"}</span>
          </label>
          <button className="run-button" onClick={runWorkflow} disabled={running}><Play size={15} fill="currentColor" /> {running ? "Running…" : "Run workflow"}<ChevronDown size={14} /></button>
        </div>
      </header>

      <div className="workspace">
        <NodePalette onAdd={addNode} onOpenLibrary={() => setHubTab("templates")} />
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
          <div className="canvas-hint"><Sparkles size={14} /> Each step receives the result from the step before it</div>
          {runPanelOpen && <RunPanel logs={logs} running={running} pendingApproval={pendingApproval} approvalBusy={approvalBusy} onApproval={(approved, note) => void decideApproval(approved, note)} onClose={() => setRunPanelOpen(false)} />}
        </section>
        {selectedNode ? (
          <Inspector
            node={selectedNode}
            onChange={updateSelectedNode}
            onClose={() => setSelectedNodeId(undefined)}
            onDelete={deleteSelectedNode}
            onDuplicate={duplicateSelectedNode}
            connections={connections}
            onOpenConnectors={() => setHubTab("connectors")}
          />
        ) : latestResult ? (
          <OutputPanel result={latestResult} onClose={() => setLatestResult(undefined)} />
        ) : (
          <aside className="empty-inspector panel">
            <div className="empty-symbol"><Workflow size={25} /></div>
            <strong>Select a step</strong>
            <p>Choose a card to see what it accomplishes and set it up in plain language.</p>
            <button onClick={restoreStarter}><RotateCcw size={14} /> Restore starter</button>
          </aside>
        )}
      </div>
      {notice && <div className="toast"><Check size={15} /> {notice}</div>}
      {hubTab && <ResourceHub initialTab={hubTab} onClose={() => setHubTab(undefined)} onUseInboxTemplate={useInboxTemplate} connections={connections} connectionBusy={connectionBusy} onConnectGoogle={() => void connectGoogle()} onDisconnectGoogle={(externalId) => void disconnectGoogle(externalId)} onConnectSlack={() => void connectSlack()} onDisconnectSlack={(externalId) => void disconnectSlack(externalId)} />}
    </main>
  );
}
