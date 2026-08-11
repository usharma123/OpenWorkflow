export function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

export function stepRetryPolicy(config: Record<string, unknown>) {
  return {
    retryAttempts: boundedInteger(config.retryAttempts, 2, 0, 5),
    retryBackoffMs: boundedInteger(config.retryBackoffMs, 250, 100, 60_000),
  };
}

export function workflowConcurrencyLimit(value: unknown) {
  return boundedInteger(value, 3, 1, 25);
}
