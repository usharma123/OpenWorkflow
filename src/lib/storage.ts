import { STARTER_WORKFLOW } from "../catalog";
import type { WorkflowDefinition } from "../types";

const STORAGE_KEY = "openworkflow:workflow:business-v2";

export function loadWorkflow(): WorkflowDefinition {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as WorkflowDefinition;
  } catch {
    // A corrupt local draft should never prevent the editor from opening.
  }
  return structuredClone(STARTER_WORKFLOW);
}

export function saveWorkflow(workflow: WorkflowDefinition) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflow));
}

export function resetWorkflow() {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(STARTER_WORKFLOW);
}
