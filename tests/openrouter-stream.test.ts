import { describe, expect, test } from "bun:test";
import { applyOpenRouterEvent, takeSseEvents } from "../convex/openrouterStream";

describe("OpenRouter streaming", () => {
  test("assembles content, citations, and usage across SSE events", () => {
    let state = { content: "", annotations: [] as unknown[], usage: undefined as unknown };
    state = applyOpenRouterEvent(state, 'data: {"choices":[{"delta":{"content":"Hello "}}]}');
    state = applyOpenRouterEvent(
      state,
      'data: {"choices":[{"delta":{"content":"world","annotations":[{"url":"https://example.com"}]}}]}',
    );
    state = applyOpenRouterEvent(state, 'data: {"choices":[],"usage":{"total_tokens":7}}');
    state = applyOpenRouterEvent(state, "data: [DONE]");

    expect(state).toEqual({
      content: "Hello world",
      annotations: [{ url: "https://example.com" }],
      usage: { total_tokens: 7 },
    });
  });

  test("keeps an incomplete event buffered across chunks", () => {
    const first = takeSseEvents('data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"cho');
    expect(first.events).toHaveLength(1);
    expect(first.rest).toBe('data: {"cho');

    const second = takeSseEvents(first.rest + 'ices":[{"delta":{"content":"B"}}]}\n\n');
    expect(second.events).toHaveLength(1);
    expect(second.rest).toBe("");
  });

  test("surfaces provider errors", () => {
    expect(() =>
      applyOpenRouterEvent(
        { content: "", annotations: [] },
        'data: {"error":{"message":"rate limited"}}',
      ),
    ).toThrow("rate limited");
  });
});
