"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { clampSearchResultCount, parseExaSearchResponse, type WebSearchResult } from "../shared/webSearch";

export const search = internalAction({
  args: {
    query: v.string(),
    numResults: v.number(),
    includeText: v.boolean(),
  },
  returns: v.object({
    query: v.string(),
    results: v.array(v.object({
      title: v.string(),
      url: v.string(),
      snippet: v.string(),
      publishedDate: v.optional(v.string()),
    })),
    count: v.number(),
    source: v.string(),
  }),
  handler: async (_ctx, { query, numResults, includeText }): Promise<{
    query: string;
    results: WebSearchResult[];
    count: number;
    source: string;
  }> => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) throw new Error("EXA_API_KEY is not configured in Convex.");
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: clampSearchResultCount(numResults),
        ...(includeText ? { contents: { text: { maxCharacters: 1500 } } } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("Exa rejected the configured EXA_API_KEY. Update the key in Convex and retry.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Web search failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : "."}`);
    }
    const results = parseExaSearchResponse(await response.json());
    return { query, results, count: results.length, source: "exa" };
  },
});
