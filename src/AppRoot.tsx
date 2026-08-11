import { AuthenticateWithRedirectCallback, ClerkProvider, useAuth } from "@clerk/react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLoading } from "./components/AppLoading";
import { WorkflowMark } from "./components/WorkflowMark";
import { SignInScreen } from "./routes/SignInScreen";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();
const AuthenticatedRoot = lazy(() => import("./AuthenticatedRoot"));

function ClerkGate() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AppLoading message="Establishing a secure session…" />;
  if (!isSignedIn) return <SignInScreen />;
  return (
    <Suspense fallback={<AppLoading message="Opening workspace…" />}>
      <AuthenticatedRoot />
    </Suspense>
  );
}

export function AppRoot() {
  if (!clerkKey || !convexUrl) {
    return (
      <main className="auth auth-single">
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
            element={<ClerkGate />}
          />
        </Routes>
      </ClerkProvider>
    </BrowserRouter>
  );
}
