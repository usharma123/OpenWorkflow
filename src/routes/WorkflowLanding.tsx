import { useQuery } from "convex/react";
import { Navigate } from "react-router-dom";
import { AppLoading } from "../components/AppLoading";
import { listWorkflowsRef } from "../lib/convexClient";

export default function WorkflowLanding() {
  const workflows = useQuery(listWorkflowsRef, {});
  if (workflows === undefined) return <AppLoading message="Loading workflows…" />;
  const first = workflows[0];
  return first ? (
    <Navigate to={`/workflow/${encodeURIComponent(first.externalId)}`} replace />
  ) : (
    <Navigate to="/workflows" replace />
  );
}
