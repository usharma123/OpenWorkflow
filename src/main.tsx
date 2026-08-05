import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { AuthenticateWithRedirectCallback, ClerkProvider, useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useConvexAuth, useQuery } from "convex/react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./App";
import { AppShell, PageFrame } from "./AppShell";
import { WorkflowMark } from "./components/WorkflowMark";
import { ConnectionsProvider } from "./lib/connections";
import { convexClient, listWorkflowsRef } from "./lib/convexClient";
import { ConnectionsRoute } from "./routes/ConnectionsRoute";
import { RunsRoute } from "./routes/RunsRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { SetupScreen, hasSeenSetup } from "./routes/SetupScreen";
import { SignInScreen } from "./routes/SignInScreen";
import { WorkflowsRoute } from "./routes/WorkflowsRoute";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();

function SetupRequired() {
  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="auth-brand">
          <WorkflowMark size={20} />
          <span>OpenWorkflow</span>
        </div>
        <h1>Configuration required</h1>
        <p>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and <code>VITE_CONVEX_URL</code>, then restart
          the dev server.
        </p>
        <p className="auth-fine">
          No authentication or connector access is attempted until both values are configured.
        </p>
      </div>
    </main>
  );
}

function Loading({ message }: { message: string }) {
  return (
    <main className="auth">
      <div className="auth-loading">
        <Loader2 className="spin" size={16} /> {message}
      </div>
    </main>
  );
}

function AuthedRoutes() {
  return (
    <ConnectionsProvider>
      <Routes>
        <Route path="/setup" element={<SetupScreen />} />
        <Route element={<AppShell />}>
          <Route
            path="/workflow/:workflowId"
            element={
              <WorkflowEditor />
            }
          />
          <Route path="/workflow" element={<WorkflowLanding />} />
          <Route
            path="/workflows"
            element={
              <PageFrame title="Workflows">
                <WorkflowsRoute />
              </PageFrame>
            }
          />
          <Route
            path="/runs"
            element={
              <PageFrame title="Runs">
                <RunsRoute />
              </PageFrame>
            }
          />
          <Route
            path="/connections"
            element={
              <PageFrame title="Connections">
                <ConnectionsRoute />
              </PageFrame>
            }
          />
          <Route
            path="/settings"
            element={
              <PageFrame title="Settings">
                <SettingsRoute />
              </PageFrame>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to={hasSeenSetup() ? "/workflow" : "/setup"} replace />} />
      </Routes>
    </ConnectionsProvider>
  );
}

function WorkflowEditor() {
  const { workflowId } = useParams<{ workflowId: string }>();
  return (
    <ReactFlowProvider key={workflowId}>
      <App />
    </ReactFlowProvider>
  );
}

function WorkflowLanding() {
  const workflows = useQuery(listWorkflowsRef, {});
  if (workflows === undefined) return <Loading message="Loading workflows…" />;
  const first = workflows[0];
  return first ? (
    <Navigate to={`/workflow/${encodeURIComponent(first.externalId)}`} replace />
  ) : (
    <Navigate to="/workflows" replace />
  );
}

function AppGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (!isLoaded || isLoading) return <Loading message="Establishing a secure session…" />;
  if (!isSignedIn) return <SignInScreen />;
  if (!isAuthenticated) {
    return (
      <main className="auth">
        <div className="auth-panel">
          <h1>Session could not be validated</h1>
          <p>Convex rejected this Clerk session. Check the Clerk Convex integration and issuer domain.</p>
        </div>
      </main>
    );
  }
  return <AuthedRoutes />;
}

function Root() {
  if (!clerkKey || !convexClient) return <SetupRequired />;

  return (
    <BrowserRouter>
      <ClerkProvider
        publishableKey={clerkKey}
        signInFallbackRedirectUrl="/setup"
        signUpFallbackRedirectUrl="/setup"
      >
        <Routes>
          <Route
            path="/sso-callback"
            element={
              <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/setup"
                signUpFallbackRedirectUrl="/setup"
              />
            }
          />
          <Route
            path="*"
            element={
              <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
                <AppGate />
              </ConvexProviderWithClerk>
            }
          />
        </Routes>
      </ClerkProvider>
    </BrowserRouter>
  );
}

declare global {
  // Vite can re-evaluate this module during development without replacing the document.
  // Reusing the root prevents duplicate React and Clerk provider trees after a hot update.
  var __openWorkflowRoot: ReturnType<typeof createRoot> | undefined;
}

const root = globalThis.__openWorkflowRoot ?? createRoot(document.getElementById("root")!);
globalThis.__openWorkflowRoot = root;

root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
