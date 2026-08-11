const MAX_AGENT_CONTENT_CHARS = 32_000;
const MAX_AGENT_CITATIONS = 20;
const MAX_CITATION_TITLE_CHARS = 300;
const MAX_CITATION_URL_CHARS = 1_000;
const MAX_AGENT_ARTIFACTS = 4;
const MAX_ARTIFACT_CONTENT_CHARS = 12_000;
const MAX_PASSTHROUGH_CHARS = 20_000;

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Agent tasks and trace rows remain available in their dedicated tables. The
 * workflow graph only needs the bounded research result that feeds the next
 * node; carrying full child transcripts here multiplies them at joins.
 */
export function compactAgentOutput(input: unknown, result: unknown): unknown {
  if (!plainRecord(result)) return result;
  const {
    subagents: _subagents,
    toolTrace: _toolTrace,
    content,
    citations,
    artifacts,
    ...metadata
  } = result;
  const passthrough = plainRecord(input) && serializedLength(input) <= MAX_PASSTHROUGH_CHARS
    ? input
    : {};
  const compactCitations = Array.isArray(citations)
    ? citations.slice(0, MAX_AGENT_CITATIONS).flatMap((citation) => {
        if (!plainRecord(citation)) return [];
        const url = String(citation.url ?? "").slice(0, MAX_CITATION_URL_CHARS);
        if (!url) return [];
        return [{
          title: String(citation.title ?? url).slice(0, MAX_CITATION_TITLE_CHARS),
          url,
        }];
      })
    : undefined;
  const compactArtifacts = Array.isArray(artifacts)
    ? artifacts.slice(0, MAX_AGENT_ARTIFACTS).flatMap((artifact) => {
        if (!plainRecord(artifact)) return [];
        return [{
          ...artifact,
          ...(typeof artifact.content === "string"
            ? { content: artifact.content.slice(0, MAX_ARTIFACT_CONTENT_CHARS) }
            : {}),
        }];
      })
    : undefined;
  return {
    ...passthrough,
    ...metadata,
    ...(typeof content === "string" ? { content: content.slice(0, MAX_AGENT_CONTENT_CHARS) } : {}),
    ...(compactCitations ? { citations: compactCitations } : {}),
    ...(compactArtifacts ? { artifacts: compactArtifacts } : {}),
  };
}

/** Find explicit {{steps.node-id...}} references without shipping every prior output. */
export function referencedStepIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(/\{\{\s*steps\.([A-Za-z0-9_-]+)/g)) ids.add(match[1]);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (plainRecord(candidate)) {
      for (const item of Object.values(candidate)) visit(item);
    }
  };
  visit(value);
  return [...ids];
}
