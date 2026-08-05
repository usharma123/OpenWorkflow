import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell, PageFrame } from "./AppShell";
import { AppLoading } from "./components/AppLoading";
import { ConnectionsProvider } from "./lib/connections";
import { hasSeenSetup } from "./lib/setup";

const ConnectionsRoute = lazy(() =>
  import("./routes/ConnectionsRoute").then((module) => ({ default: module.ConnectionsRoute })),
);
const RunsRoute = lazy(() =>
  import("./routes/RunsRoute").then((module) => ({ default: module.RunsRoute })),
);
const SettingsRoute = lazy(() =>
  import("./routes/SettingsRoute").then((module) => ({ default: module.SettingsRoute })),
);
const SetupScreen = lazy(() =>
  import("./routes/SetupScreen").then((module) => ({ default: module.SetupScreen })),
);
const WorkflowEditorRoute = lazy(() => import("./routes/WorkflowEditorRoute"));
const WorkflowLanding = lazy(() => import("./routes/WorkflowLanding"));
const WorkflowsRoute = lazy(() =>
  import("./routes/WorkflowsRoute").then((module) => ({ default: module.WorkflowsRoute })),
);

export default function AuthedApp() {
  return (
    <ConnectionsProvider>
      <Suspense fallback={<AppLoading message="Loading…" />}>
        <Routes>
          <Route path="/setup" element={<SetupScreen />} />
          <Route element={<AppShell />}>
            <Route path="/workflow/:workflowId" element={<WorkflowEditorRoute />} />
            <Route path="/workflow" element={<WorkflowLanding />} />
            <Route
              path="/workflows"
              element={<PageFrame title="Workflows"><WorkflowsRoute /></PageFrame>}
            />
            <Route path="/runs" element={<PageFrame title="Runs"><RunsRoute /></PageFrame>} />
            <Route
              path="/connections"
              element={<PageFrame title="Connections"><ConnectionsRoute /></PageFrame>}
            />
            <Route
              path="/settings"
              element={<PageFrame title="Settings"><SettingsRoute /></PageFrame>}
            />
          </Route>
          <Route path="*" element={<Navigate to={hasSeenSetup() ? "/workflow" : "/setup"} replace />} />
        </Routes>
      </Suspense>
    </ConnectionsProvider>
  );
}
