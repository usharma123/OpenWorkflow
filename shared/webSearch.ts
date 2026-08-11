import { boundedInteger } from "./reliability";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export function clampSearchResultCount(value: unknown) {
  return boundedInteger(value, 5, 1, 10);
}

const SNIPPET_LIMIT = 500;

/*
 * Exa returns { results: [{ title, url, text?, publishedDate?, ... }] }.
 * Reduce it to the small, stable shape workflow steps can template against.
 */
export function parseExaSearchResponse(payload: unknown): WebSearchResult[] {
  if (!payload || typeof payload !== "object") return [];
  const rawResults = (payload as Record<string, unknown>).results;
  if (!Array.isArray(rawResults)) return [];
  const results: WebSearchResult[] = [];
  for (const raw of rawResults) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    if (!url) continue;
    const text = typeof record.text === "string" ? record.text : "";
    const summary = typeof record.summary === "string" ? record.summary : "";
    const snippet = (summary || text).trim().slice(0, SNIPPET_LIMIT);
    results.push({
      title: typeof record.title === "string" && record.title ? record.title : url,
      url,
      snippet,
      ...(typeof record.publishedDate === "string" && record.publishedDate
        ? { publishedDate: record.publishedDate }
        : {}),
    });
  }
  return results;
}
