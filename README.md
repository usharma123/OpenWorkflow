# OpenWorkflow

OpenWorkflow is an authenticated, owner-isolated visual agent builder built with Vite, React, Convex, Clerk, and Vercel. Agents connect triggers, model reasoning, tools, decisions, and human approvals as durable workflows.

Gmail, Google Docs, and Slack are included integrations—not the product boundary. One starter workflow demonstrates this path:

```text
Gmail inbox → GPT-5.6 Luna via OpenRouter → Google Doc → human approval → Slack
```

Safe demo mode is explicit and remains the default. Connected mode uses each signed-in user's approved Google or Slack connection; there are no shared bootstrap tokens.

## Implemented security model

- Clerk authenticates the React app and Convex validates Clerk session JWTs.
- Records are partitioned by the active Clerk organization, or by the Clerk user when no organization is active.
- Workflows, runs, steps, approvals, schedules, webhook dispatch, connections, and audit events enforce that owner boundary server-side.
- Ownerless legacy rows are not silently claimed and are inaccessible through authenticated APIs.
- Google account metadata is stored in Convex, but Google tokens are not. Each Gmail or Docs action asks Clerk for a current provider token, validates exact scopes, and fails closed on missing or rejected grants.
- Slack uses a direct OAuth v2 callback. Authorization state is random, hashed, owner-bound, single-use, and expires after ten minutes. Bot tokens are AES-256-GCM encrypted at rest with a Convex-only key and never returned by a query.
- Rejected approvals terminate the durable run before Slack executes.
- Gmail snippets and bodies are removed from persisted run output.

Google Calendar, Outlook, and Microsoft Teams are marked **Coming soon** because they do not yet have complete OAuth and connector paths.

## 1. Install and run locally

Requirements: Bun 1.3.14+, a Convex project, and a Clerk application.

```bash
bun install
bunx convex dev
```

In another terminal:

```bash
bun run dev
```

The project includes the Clerk CLI as a Bun dev dependency. Link an existing Clerk application only after choosing the correct workspace and instance:

```bash
bunx clerk auth login
bunx clerk link
bunx clerk env pull
bunx clerk doctor
```

`clerk auth login` creates persistent CLI access. Do not run it in an unattended environment without the account owner's approval. The CLI can inspect or patch instance configuration with `clerk config pull`, `clerk config patch --dry-run`, and `clerk config patch`; Google Cloud OAuth credentials still need to be created in Google Cloud and entered into the Clerk connection.

## 2. Configure Clerk and Convex authentication

1. Create or select a Clerk development application.
2. In Clerk, activate the **Convex** integration. Copy the Clerk Frontend API/issuer URL, such as `https://verb-noun-00.clerk.accounts.dev`.
3. Add the publishable key to `.env.local`:

   ```bash
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
   ```

4. Set the issuer and Clerk secret on the Convex development deployment:

   ```bash
   bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://verb-noun-00.clerk.accounts.dev
   bunx convex env set CLERK_SECRET_KEY sk_test_...
   bunx convex env set APP_URL http://localhost:5173
   ```

5. Run `bunx convex dev` so `convex/auth.config.ts` is deployed. The Clerk JWT audience must be `convex`.

Repeat the same configuration with production Clerk values on the production Convex deployment. Never expose `CLERK_SECRET_KEY` through Vite or Vercel client variables.

## 3. Configure Google Workspace through Clerk

OpenWorkflow requests only:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive.file`

In Google Cloud:

1. Create/select a project and enable the Gmail API, Google Docs API, and Google Drive API.
2. Configure the OAuth consent screen and add the three scopes above.
3. Create a Web OAuth client using the exact redirect URI shown by Clerk's Google social connection.
4. Keep a Testing app limited to explicit test users, or complete Google's production/verification requirements before broad release.

In Clerk:

1. Add Google as a social connection.
2. Enable custom credentials and enter the Google client ID and secret.
3. Configure the three additional scopes above.
4. Activate the connection.

Those Clerk connection scopes are what make the initial Google sign-in double as a Workspace
grant. If they are absent or incomplete, sign-in still succeeds; the setup screen detects the
missing grant and offers a separate **Connect Google** authorization flow.

The product's **Connect Google** button uses Clerk's `createExternalAccount()` or `reauthorize()` flow with those same scopes. Convex calls `getUserOauthAccessToken(userId, "google")` for every durable Gmail or Docs action and matches the selected external account ID. Google tokens never enter local storage, workflow definitions, or Convex tables.

Keep the app origin and callback routes available throughout Clerk's verification flow. In development, Clerk may send a session reverification through its hosted Account Portal before returning to the app. `ClerkProvider` therefore uses `/` as its sign-in and sign-up fallback, while `/sso-callback` remains the normal OAuth callback. A same-tab `sessionStorage` marker contains only the boolean fact that Google synchronization is pending; it never contains a provider token or account data. Returning to either route causes the server to read the verified external account from Clerk and persist only safe metadata in Convex.

Disconnect removes the Clerk external account. Clerk may reject removal when it is the user's only sign-in factor; add another sign-in method first in that case.

## 4. Configure Slack OAuth

Create a Slack app for each environment:

1. Add the bot scope `chat:write`. Add `chat:write.public` only if policy explicitly allows posting to channels the app has not joined; OpenWorkflow does not request it by default.
2. Add this exact redirect URL in **OAuth & Permissions**:

   ```text
   https://<your-convex-site>.convex.site/oauth/slack/callback
   ```

3. Set server-only Convex variables:

   ```bash
   bunx convex env set SLACK_CLIENT_ID '<client id>'
   bunx convex env set SLACK_CLIENT_SECRET '<client secret>'
   bunx convex env set SLACK_OAUTH_REDIRECT_URI 'https://<your-convex-site>.convex.site/oauth/slack/callback'
   bunx convex env set CONNECTION_ENCRYPTION_KEY '<base64-encoded 32 random bytes>'
   ```

Generate the encryption key once per environment with a cryptographically secure tool, store it in the deployment secret manager, and back it up securely. Rotating it requires a token re-encryption migration or reconnecting Slack workspaces.

Connected Slack steps require a channel ID such as `C0123456789`; a `#channel-name` is intentionally rejected because Slack's posting API needs an unambiguous resource identifier. The app must be invited to private channels.

## 5. Configure OpenRouter

```bash
bunx convex env set OPENROUTER_API_KEY '<key>'
bunx convex env set OPENROUTER_APP_NAME OpenWorkflow
bunx convex env set OPENROUTER_SITE_URL http://localhost:5173
```

The key stays in Convex. Browser safe demo mode does not call OpenRouter; Convex-backed runs do.
OpenRouter responses are consumed as SSE streams. The current model text is patched to the active
step at most once every 200ms so the run transcript updates live without creating a write per token.

## 6. Configure isolated Daytona execution

Code, Shell, and Git steps run only when they are placed inside a Daytona sandbox boundary. All
steps in one boundary share one ephemeral sandbox and filesystem for that run. Sandboxes default to
blocked outbound networking, have a bounded TTL, and are deleted after success or failure.

```bash
bunx convex env set DAYTONA_API_KEY '<api key>'
bunx convex env set DAYTONA_TARGET us
```

`DAYTONA_API_URL` is optional and defaults to Daytona Cloud. A boundary can use a prebuilt snapshot
and an explicit domain allowlist. OpenWorkflow does not copy Google or Slack OAuth tokens into
sandbox code. Git clone currently accepts public HTTPS URLs only.

Workflow runs are pinned to an immutable workflow version. Connections carry independent output
packets, so sibling branches receive their common parent's output and multi-input joins receive an
`items` array plus source provenance instead of whichever branch happened to run last.

## 7. Deploy with Vercel

Vercel serves the frontend; Convex owns durable execution and secrets.

1. Add `VITE_CLERK_PUBLISHABLE_KEY` to the Vercel project. Configure two environment-scoped values named `CONVEX_DEPLOY_KEY`: a production deploy key scoped only to **Production**, and a Convex project preview deploy key scoped only to **Preview**. Convex rejects production deploy keys in preview builds by design. In Convex Project Settings, add `CLERK_JWT_ISSUER_DOMAIN` as a **Preview** default environment variable so newly created preview deployments can compile `convex/auth.config.ts`.
2. Use the checked-in Bun install and build settings. `vercel.json` deploys Convex and injects `VITE_CONVEX_URL` for the Vite build.
3. Set `APP_URL` on the production Convex deployment to the canonical HTTPS Vercel domain.
4. Use production Clerk, Google, Slack, OpenRouter, and optional Daytona values in the production Convex deployment.
5. Add the production `/sso-callback` URL to Clerk's allowed redirect URLs and the production Convex callback to Slack.

Do not put Clerk secret keys, Google tokens, Slack tokens, Slack client secrets, the encryption key, OpenRouter keys, or Daytona keys in Vercel variables prefixed with `VITE_`.

## Validation

```bash
bunx clerk doctor
bunx convex codegen
bunx tsc -p convex/tsconfig.json --pretty false
bun run typecheck
bun run build
```

`bunx convex codegen` requires `CLERK_JWT_ISSUER_DOMAIN` to already be set on the selected Convex deployment. Real Google success testing additionally requires an administrator-created Google OAuth client, Clerk custom Google credentials, and explicit user consent. Real Slack success testing separately requires a configured Slack app and explicit workspace authorization. The UI never simulates a completed grant.
