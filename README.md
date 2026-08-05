# OpenWorkflow

OpenWorkflow is a focused, n8n-style agent workflow builder for internal teams. It provides a visual canvas for composing approved automation blocks while keeping credentials, model calls, and execution on the server.

The POC is designed around:

- React + React Flow for the no-code editor
- Convex for workflow persistence, run history, webhooks, and durable execution
- OpenRouter for `openai/gpt-5.6-luna`, with optional web search
- Vercel for the frontend

## What the POC can do

- Build workflows by dragging blocks onto a canvas and connecting them
- Save workflow definitions and editor positions in Convex
- Start workflows manually, from an HTTP webhook, or from a five-field cron schedule
- Call `openai/gpt-5.6-luna` through OpenRouter without exposing the API key to the browser
- Give Luna live web access with OpenRouter's `openrouter:web_search` server tool and return its citation annotations
- Call public HTTPS APIs with templated headers and request bodies
- Transform data with safe `{{input.path}}` templates—there is no arbitrary JavaScript execution
- Route through true/false condition handles
- Pause durably for a delay or human approval
- Stream run/step state back into the visual canvas through Convex subscriptions
- Accept enabled workflows at `POST /webhooks/{slug}` on the Convex HTTP deployment

## Architecture

```text
Vercel (Vite + React)
  └─ visual workflow editor
       └─ Convex cloud
            ├─ workflow definitions and run history
            ├─ durable Workflow/Workpool execution
            ├─ webhook and cron triggers
            └─ server actions
                 ├─ OpenRouter: openai/gpt-5.6-luna
                 ├─ OpenRouter web search
                 └─ approved HTTPS APIs
```

Vercel never executes a long workflow. It serves the frontend; Convex owns the durable execution and secrets. This avoids Vercel request-duration limits and keeps runs alive across deploys or transient failures.

## Local development

Requirements: [Bun](https://bun.com/) 1.3.14 or newer and a Convex account.

```bash
bun install
bunx convex dev
```

In a second terminal:

```bash
bun run dev
```

`bunx convex dev` creates `.env.local` with `VITE_CONVEX_URL`. Without that variable, the editor deliberately falls back to a browser-only demo runner so UI work is never blocked.

## Configure OpenRouter

Create an OpenRouter API key, then store it only in Convex:

```bash
bunx convex env set OPENROUTER_API_KEY sk-or-v1-your-key
bunx convex env set OPENROUTER_APP_NAME OpenWorkflow
```

Optionally set the deployed frontend URL for OpenRouter attribution:

```bash
bunx convex env set OPENROUTER_SITE_URL https://your-app.vercel.app
```

The AI block defaults to `openai/gpt-5.6-luna`. When **Web search** is enabled it sends:

```json
{
  "type": "openrouter:web_search",
  "parameters": {
    "max_results": 5,
    "max_total_results": 15,
    "search_context_size": "medium"
  }
}
```

Web search is not free merely because the model is inexpensive: OpenRouter bills search-engine usage separately. The result limit in the inspector is therefore also a cost control.

## Deploy to Vercel

1. In the Convex dashboard, open **Project Settings → Deploy Key** and create a Production deploy key.
2. Import `usharma123/OpenWorkflow` into Vercel.
3. Add `CONVEX_DEPLOY_KEY` to the Vercel project as a Production environment variable.
4. Set the Vercel build command to:

   ```bash
   bunx convex deploy --cmd 'bun run build'
   ```

5. Keep the install command as `bun install`. Vercel detects `bun.lock` and Bun automatically.
6. Add `OPENROUTER_API_KEY`, `OPENROUTER_APP_NAME`, and optionally `OPENROUTER_SITE_URL` to the **production Convex deployment**, not Vercel.

Convex injects the production `VITE_CONVEX_URL` while it runs the Vite build. The SPA rewrite in `vercel.json` handles client-side routes.

## Webhooks

Add a Webhook trigger, choose a unique slug, enable the workflow, and send JSON to:

```text
POST https://<your-convex-site>.convex.site/webhooks/<slug>
Content-Type: application/json
X-OpenWorkflow-Secret: <secret-if-configured>
```

The endpoint returns `202 Accepted` with a run ID. For production use, add authentication and authorization in front of the editor and configure a secret for every webhook workflow.

## Deliberate POC boundaries

- The editor currently manages one starter workflow; multi-workflow navigation is the next product layer.
- HTTP blocks reject obvious local/private hosts, but production should use an explicit hostname allowlist plus DNS-level SSRF protection.
- Authentication/RBAC, encrypted connection management, audit exports, and rate limits should be added before a company-wide rollout.
- Cron supports standard five-field expressions, lists, ranges, and step values. It intentionally does not support seconds or vendor-specific macros.
- Arbitrary code, shell execution, package installation, and user-authored server functions are intentionally excluded.

## Useful commands

```bash
bun run build          # Typecheck and create the Vercel bundle
bunx convex dev        # Sync backend functions during development
bunx convex deploy     # Deploy the Convex production backend
bunx convex run workflows:list
```
