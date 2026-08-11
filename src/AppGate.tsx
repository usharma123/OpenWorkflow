import { lazy, Suspense } from "react";
import { useConvexAuth } from "convex/react";
import { AppLoading } from "./components/AppLoading";

const AuthedApp = lazy(() => import("./AuthedApp"));

export function AppGate() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) return <AppLoading message="Validating workspace access…" />;
  if (!isAuthenticated) {
    return (
      <main className="auth auth-single">
        <div className="auth-panel">
          <h1>Session could not be validated</h1>
          <p>Convex rejected this Clerk session. Check the Clerk Convex integration and issuer domain.</p>
        </div>
      </main>
    );
  }
  return (
    <Suspense fallback={<AppLoading message="Opening workspace…" />}>
      <AuthedApp />
    </Suspense>
  );
}
