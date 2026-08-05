export function connectionError(error: unknown, fallback: string): string {
  const data = error && typeof error === "object" && "data" in error
    ? (error as { data?: unknown }).data
    : undefined;
  const code = data && typeof data === "object" && "code" in data
    ? (data as { code?: unknown }).code
    : undefined;
  if (code === "CONNECTION_SLACK_NOT_CONFIGURED") {
    return "Slack is not configured yet. An administrator needs to add the Slack app credentials and encryption key.";
  }
  if (code === "CONNECTION_GOOGLE_AUTHORIZATION_FAILED") {
    return "Google needs to be reauthorized with Gmail, Docs, and Drive access.";
  }
  if (!(error instanceof Error)) return fallback;
  return error.message.match(/Uncaught Error:\s*([^\n]+)/)?.[1] ?? error.message;
}
