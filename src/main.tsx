import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppRoot } from "./AppRoot";

declare global {
  var __openWorkflowRoot: ReturnType<typeof createRoot> | undefined;
}

const root = globalThis.__openWorkflowRoot ?? createRoot(document.getElementById("root")!);
globalThis.__openWorkflowRoot = root;

root.render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
