import type { WorkflowNode, WorkflowNodeType } from "../types";

export type ConnectorProvider = "google" | "slack";

export interface ConnectionChoice {
  externalId: string;
  provider: ConnectorProvider | "microsoft";
  status: "active" | "needs_reauth" | "disabled";
}

const GOOGLE_NODE_TYPES = new Set<WorkflowNodeType>([
  "gmailTrigger",
  "gmailEventTrigger",
  "calendarTrigger",
  "driveTrigger",
  "sheetsTrigger",
  "googleDoc",
  "gmailSend",
  "calendarEvent",
  "sheetsAppend",
  "driveUpload",
]);

export function connectorProviderForNode(type: WorkflowNodeType): ConnectorProvider | undefined {
  if (GOOGLE_NODE_TYPES.has(type)) return "google";
  if (type === "slack") return "slack";
  return undefined;
}

/**
 * Connector steps always run live. Keep an explicit valid account choice, or
 * adopt the first active compatible account so a freshly connected workspace
 * works without configuring every node by hand.
 */
export function bindDefaultConnections(
  nodes: WorkflowNode[],
  connections: ConnectionChoice[],
): WorkflowNode[] {
  const active = new Map<ConnectorProvider, ConnectionChoice[]>();
  for (const connection of connections) {
    if (connection.status !== "active" || connection.provider === "microsoft") continue;
    active.set(connection.provider, [...(active.get(connection.provider) ?? []), connection]);
  }

  let changed = false;
  const bound = nodes.map((node) => {
    const provider = connectorProviderForNode(node.data.nodeType);
    if (!provider) return node;

    const config = { ...node.data.config };
    if (Object.prototype.hasOwnProperty.call(config, "executionMode")) {
      delete config.executionMode;
      changed = true;
    }

    const choices = active.get(provider) ?? [];
    const currentRef = typeof config.connectionRef === "string" ? config.connectionRef : "";
    const currentIsActive = choices.some((connection) => connection.externalId === currentRef);
    const connectionRef = currentIsActive ? currentRef : choices[0]?.externalId;
    if (connectionRef && connectionRef !== currentRef) {
      config.connectionRef = connectionRef;
      changed = true;
    }

    if (config === node.data.config) return node;
    const configChanged = JSON.stringify(config) !== JSON.stringify(node.data.config);
    if (!configChanged) return node;
    changed = true;
    return { ...node, data: { ...node.data, config } };
  });

  return changed ? bound : nodes;
}
