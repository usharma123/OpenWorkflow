# OpenWorkflow

OpenWorkflow is a business-friendly workflow POC for internal teams. People compose understandable steps on a visual canvas while Convex owns durable execution, approvals, audit records, and server-side credentials.

The polished starter workflow is:

```text
Gmail inbox → GPT-5.6 Luna → Google Doc → human approval → Slack link
```

## What is implemented

- Plain-language steps and configuration instead of developer-first action names
- A template library, connector discovery, and an in-product “How it works” guide
- A safe demo mode that completes the inbox workflow without touching company data
- GPT-5.6 Luna through OpenRouter, with optional cited web search
- Gmail read-only, Google Docs creation, and Slack posting adapters in Convex
- Named connection references, connection metadata and scopes, privacy-aware run records, and connector audit events
- Durable human approval with approve/reject notes before Slack can execute
- Stage-by-stage run explanations, actionable errors, generated artifact cards, and final delivery state
- Existing manual, schedule, webhook, condition, transform, delay, HTTPS request, and output steps

## POC reality check

| Capability | In this POC | Production follow-up |
| --- | --- | --- |
| Visual editor and persistence | Real | Add authentication, RBAC, and multi-workflow navigation |
| Durable Convex runs and approvals | Real | Add approver identity, policy groups, reminders, and escalation |
| Luna through OpenRouter | Real when `OPENROUTER_API_KEY` is configured | Add model allowlists, budgets, and prompt/version governance |
| Gmail, Google Docs, Slack | Real server adapters plus safe demo mode | Replace bootstrap tokens with full OAuth authorization-code flows and encrypted token vaulting |
| Google Calendar, Outlook, Teams | Discovery and architecture only | Add provider adapters after OAuth onboarding is available |
| Audit trail | Connector and approval events are recorded | Add immutable retention, export, SIEM delivery, and admin review UI |
| Safe demo | Real browser or Convex execution using representative data | Keep it available for onboarding and template testing |

Safe demo is the default for Gmail, Docs, and Slack. Switching a step to **Connected** never puts a token in the workflow definition; the step carries only an approved connection reference.

## Architecture

```text
Vercel (Vite + React)
  └─ editor, templates, help, approval controls
       └─ Convex cloud
            ├─ workflow and run records
            ├─ durable workflow engine and approval events
            ├─ connection metadata and audit log
            └─ server actions
                 ├─ OpenRouter / openai/gpt-5.6-luna
                 ├─ Gmail read-only adapter
                 ├─ Google Docs create adapter
                 └─ Slack post adapter
```

Vercel serves the frontend only. Long-running work and secret resolution stay in Convex, so runs survive frontend deploys and request-duration limits. See [Connector architecture](docs/CONNECTOR_ARCHITECTURE.md) for the target OAuth and vault design.

## Local development

Requirements: Bun 1.3.14 or newer and a Convex account.

```bash
bun install
bunx convex dev
```

In a second terminal:

```bash
bun run dev
```

`bunx convex dev` creates `.env.local` with `VITE_CONVEX_URL`. Without it, the editor uses the browser-only safe demo runner. The browser demo intentionally simulates Luna as well as connectors; a Convex-backed run makes the real OpenRouter call.

## Configure Luna

Store OpenRouter settings in Convex, never in a `VITE_` variable:

```bash
bunx convex env set OPENROUTER_API_KEY sk-or-v1-your-key
bunx convex env set OPENROUTER_APP_NAME OpenWorkflow
bunx convex env set OPENROUTER_SITE_URL https://your-app.vercel.app
```

The AI step defaults to `openai/gpt-5.6-luna`. Web search is optional and billed separately by OpenRouter.

## Bootstrap connected-mode adapters

The POC adapter layer resolves short-lived bootstrap tokens only inside Convex. These variables demonstrate credential indirection; they are not a replacement for the production OAuth/token-vault flow.

```bash
bunx convex env set GOOGLE_WORKSPACE_CONNECTION_REF google-workspace-poc
bunx convex env set GOOGLE_WORKSPACE_ACCESS_TOKEN '<short-lived scoped token>'
bunx convex env set SLACK_CONNECTION_REF slack-poc
bunx convex env set SLACK_BOT_TOKEN '<scoped bot token>'
bunx convex env set SLACK_CHANNEL_ID '<approved channel ID>'
```

Minimum scopes:

- Gmail: `https://www.googleapis.com/auth/gmail.readonly`
- Google Docs: `https://www.googleapis.com/auth/documents` plus `https://www.googleapis.com/auth/drive.file`
- Slack: `chat:write`; add `chat:write.public` only if posting to channels the app has not joined is an approved requirement

The Google adapter currently creates the document in the authorized app context. Folder placement is displayed in the POC configuration but requires a Drive move call in the next slice.

## Deploy to Vercel

The existing deployment contract remains unchanged:

1. Create a production Convex deploy key.
2. Add `CONVEX_DEPLOY_KEY` to Vercel.
3. Use `bun install` as the install command.
4. Use the checked-in Vercel build command, which runs `bunx convex deploy --cmd 'bun run build'` and injects `VITE_CONVEX_URL`.
5. Configure Luna and connector variables in the production Convex deployment, not Vercel client variables.

This feature branch has not been pushed or deployed.

## Security boundaries

- Workflow definitions store connection references, never access or refresh tokens.
- Gmail uses read-only scope and stores only metadata in step history; message snippets are redacted from persisted step outputs.
- Slack executes after the durable approval event and does not unfurl the shared link.
- Connector use and approval decisions produce audit events.
- Arbitrary code, shell execution, and user-authored server functions are excluded.
- The generic HTTP step blocks obvious private/local destinations. Production still needs DNS-aware SSRF protection and an explicit hostname allowlist.
- Authentication/RBAC, OAuth callback handling, encrypted refresh-token storage, tenant isolation, retention controls, rate limits, and audit export remain required before company-wide use.

## Useful commands

```bash
bun run typecheck
bun run build
bunx convex dev
bunx convex run workflows:list
```
