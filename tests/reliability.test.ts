import { describe, expect, test } from "bun:test";
import { stepRetryPolicy, workflowConcurrencyLimit } from "../shared/reliability";

describe("runtime reliability policy", () => {
  test("uses safe retry defaults and clamps user configuration", () => {
    expect(stepRetryPolicy({})).toEqual({ retryAttempts: 2, retryBackoffMs: 250 });
    expect(stepRetryPolicy({ retryAttempts: 99, retryBackoffMs: 1 })).toEqual({
      retryAttempts: 5,
      retryBackoffMs: 100,
    });
    expect(stepRetryPolicy({ retryAttempts: 0, retryBackoffMs: 120_000 })).toEqual({
      retryAttempts: 0,
      retryBackoffMs: 60_000,
    });
  });

  test("keeps workflow concurrency within a bounded range", () => {
    expect(workflowConcurrencyLimit(undefined)).toBe(3);
    expect(workflowConcurrencyLimit(0)).toBe(1);
    expect(workflowConcurrencyLimit(100)).toBe(25);
  });
});
