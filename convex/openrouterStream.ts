export interface OpenRouterStreamState {
  content: string;
  annotations: unknown[];
  usage?: unknown;
}

interface OpenRouterStreamPayload {
  error?: { message?: string };
  choices?: Array<{
    delta?: { content?: string; annotations?: unknown[] };
    message?: { content?: string; annotations?: unknown[] };
  }>;
  usage?: unknown;
}

export function applyOpenRouterEvent(
  state: OpenRouterStreamState,
  event: string,
): OpenRouterStreamState {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return state;

  let payload: OpenRouterStreamPayload;
  try {
    payload = JSON.parse(data) as OpenRouterStreamPayload;
  } catch {
    throw new Error("OpenRouter returned an invalid streaming response.");
  }

  if (payload.error) throw new Error(payload.error.message ?? "OpenRouter streaming failed.");

  const choice = payload.choices?.[0];
  const delta = choice?.delta ?? choice?.message;
  const content = typeof delta?.content === "string" ? delta.content : "";
  const annotations = Array.isArray(delta?.annotations) ? delta.annotations : [];

  return {
    content: state.content + content,
    annotations: annotations.length ? annotations : state.annotations,
    usage: payload.usage ?? state.usage,
  };
}

export function takeSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const parts = normalized.split("\n\n");
  return { events: parts.slice(0, -1), rest: parts[parts.length - 1] ?? "" };
}
