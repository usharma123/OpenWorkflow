import { useUser, useReverification } from "@clerk/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  convexClient,
  disconnectGoogleRef,
  disconnectSlackRef,
  listConnectionsRef,
  startSlackOAuthRef,
  syncGoogleRef,
  type ConnectionMetadata,
} from "./convexClient";
import { GOOGLE_SCOPES, hasRequiredGoogleScopes } from "./googleAuth";

const GOOGLE_PENDING_KEY = "openworkflow.googleConnectionPending";

export interface Notice {
  message: string;
  tone: "info" | "error";
}

interface ConnectionsValue {
  connections: ConnectionMetadata[];
  google: ConnectionMetadata[];
  slack: ConnectionMetadata[];
  busy?: string;
  notice?: Notice;
  setNotice: (notice: Notice | undefined) => void;
  refresh: () => Promise<void>;
  connectGoogle: () => Promise<void>;
  disconnectGoogle: (externalId: string) => Promise<void>;
  connectSlack: () => Promise<void>;
  disconnectSlack: (externalId: string) => Promise<void>;
}

const ConnectionsContext = createContext<ConnectionsValue | undefined>(undefined);

export function connectionError(error: unknown, fallback: string): string {
  const data = error && typeof error === "object" && "data" in error ? (error as { data?: unknown }).data : undefined;
  const code = data && typeof data === "object" && "code" in data ? (data as { code?: unknown }).code : undefined;
  if (code === "CONNECTION_SLACK_NOT_CONFIGURED") {
    return "Slack is not configured yet. An administrator needs to add the Slack app credentials and encryption key.";
  }
  if (code === "CONNECTION_GOOGLE_AUTHORIZATION_FAILED") {
    return "Google needs to be reauthorized with Gmail, Docs, and Drive access.";
  }
  if (!(error instanceof Error)) return fallback;
  return error.message.match(/Uncaught Error:\s*([^\n]+)/)?.[1] ?? error.message;
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [connections, setConnections] = useState<ConnectionMetadata[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNoticeState] = useState<Notice>();

  const setNotice = useCallback((next: Notice | undefined) => {
    setNoticeState(next);
  }, []);

  // Notices are transient; failures linger a little longer than confirmations.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNoticeState(undefined), notice.tone === "error" ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = useCallback(async () => {
    if (!convexClient) return;
    setConnections(await convexClient.query(listConnectionsRef, {}));
  }, []);

  const createGoogleAccount = useReverification(
    (args: Parameters<NonNullable<typeof user>["createExternalAccount"]>[0]) => user!.createExternalAccount(args),
  );

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  // Handles the return leg of both OAuth flows.
  useEffect(() => {
    if (!convexClient) return;
    const params = new URLSearchParams(window.location.search);
    const integration = params.get("integration");
    const status = params.get("status");
    const googlePending = window.sessionStorage.getItem(GOOGLE_PENDING_KEY) === "true";
    if (!integration && !googlePending) return;
    const detail = params.get("detail");
    window.history.replaceState({}, "", window.location.pathname);

    if ((integration === "google" && status === "connected") || (!integration && googlePending)) {
      setBusy("google");
      void convexClient
        .action(syncGoogleRef, {})
        .then(async (result) => {
          await refresh();
          setNotice(
            result.count > 0
              ? { message: "Google Workspace connected", tone: "info" }
              : { message: "Google did not return an account. Try connecting again.", tone: "error" },
          );
        })
        .catch((error) =>
          setNotice({ message: connectionError(error, "Google could not be synchronized"), tone: "error" }),
        )
        .finally(() => {
          window.sessionStorage.removeItem(GOOGLE_PENDING_KEY);
          setBusy(undefined);
        });
    } else if (integration === "slack" && status === "connected") {
      void refresh().then(() => setNotice({ message: "Slack workspace connected", tone: "info" }));
    } else {
      setNotice({
        message: detail || `${integration === "slack" ? "Slack" : "Google"} was not connected`,
        tone: "error",
      });
    }
  }, [refresh, setNotice]);

  const connectGoogle = useCallback(async () => {
    if (!user || !convexClient) return;
    setBusy("google");
    try {
      const existing = user.externalAccounts.find((account) => account.provider === "google");
      if (existing && hasRequiredGoogleScopes(existing.approvedScopes)) {
        const result = await convexClient.action(syncGoogleRef, {});
        await refresh();
        setNotice(
          result.count > 0
            ? { message: "Google Workspace connected", tone: "info" }
            : { message: "Google did not return an account. Try again.", tone: "error" },
        );
        setBusy(undefined);
        return;
      }

      const redirectUrl = existing ? window.location.href : `${window.location.origin}/sso-callback`;
      const account = existing
        ? await existing.reauthorize({ additionalScopes: GOOGLE_SCOPES, redirectUrl, oidcPrompt: "consent" })
        : await createGoogleAccount({
            strategy: "oauth_google",
            additionalScopes: GOOGLE_SCOPES,
            redirectUrl,
            oidcPrompt: "consent",
          });
      const verificationUrl = account?.verification?.externalVerificationRedirectURL;
      if (!verificationUrl) throw new Error("Clerk did not return a Google authorization URL.");
      window.sessionStorage.setItem(GOOGLE_PENDING_KEY, "true");
      window.location.assign(verificationUrl.href);
    } catch (error) {
      window.sessionStorage.removeItem(GOOGLE_PENDING_KEY);
      setBusy(undefined);
      setNotice({ message: connectionError(error, "Could not start Google authorization"), tone: "error" });
    }
  }, [createGoogleAccount, refresh, setNotice, user]);

  const disconnectGoogle = useCallback(
    async (externalId: string) => {
      if (!convexClient) return;
      setBusy(externalId);
      try {
        await convexClient.action(disconnectGoogleRef, { externalId });
        await refresh();
        setNotice({ message: "Google disconnected. Your sign-in still works.", tone: "info" });
      } catch (error) {
        setNotice({ message: connectionError(error, "Could not disconnect Google"), tone: "error" });
      } finally {
        setBusy(undefined);
      }
    },
    [refresh, setNotice],
  );

  const connectSlack = useCallback(async () => {
    if (!convexClient) return;
    setBusy("slack");
    try {
      const authorizeUrl = await convexClient.action(startSlackOAuthRef, { returnUrl: window.location.href });
      window.location.assign(authorizeUrl);
    } catch (error) {
      setBusy(undefined);
      setNotice({ message: connectionError(error, "Could not start Slack authorization"), tone: "error" });
    }
  }, [setNotice]);

  const disconnectSlack = useCallback(
    async (externalId: string) => {
      if (!convexClient) return;
      setBusy(externalId);
      try {
        const result = await convexClient.action(disconnectSlackRef, { externalId });
        await refresh();
        setNotice({
          message: result.revoked
            ? "Slack disconnected and its token revoked"
            : "Slack disconnected locally; verify remote revocation",
          tone: "info",
        });
      } catch (error) {
        setNotice({ message: connectionError(error, "Could not disconnect Slack"), tone: "error" });
      } finally {
        setBusy(undefined);
      }
    },
    [refresh, setNotice],
  );

  const value = useMemo<ConnectionsValue>(
    () => ({
      connections,
      google: connections.filter((c) => c.provider === "google" && c.status !== "disabled"),
      slack: connections.filter((c) => c.provider === "slack" && c.status !== "disabled"),
      busy,
      notice,
      setNotice,
      refresh,
      connectGoogle,
      disconnectGoogle,
      connectSlack,
      disconnectSlack,
    }),
    [busy, connectGoogle, connectSlack, connections, disconnectGoogle, disconnectSlack, notice, refresh, setNotice],
  );

  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

export function useConnections(): ConnectionsValue {
  const value = useContext(ConnectionsContext);
  if (!value) throw new Error("useConnections must be used inside ConnectionsProvider.");
  return value;
}
