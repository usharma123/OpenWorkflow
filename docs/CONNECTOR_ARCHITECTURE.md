# Connector and tenant architecture

## Owner boundary

Every authenticated request derives a principal from Convex's verified Clerk identity. The active Clerk organization becomes `org:<organizationId>`; otherwise the owner is `user:<userId>`. The browser never supplies or overrides this key.

```text
Clerk session JWT
  → Convex verifies issuer + audience
  → server derives ownerKey and Clerk user ID
  → every query/mutation checks the record owner
  → durable run copies the immutable owner identity
  → connector action resolves only that owner's connection
```

Schedules copy ownership from the saved workflow. Webhooks resolve only an enabled, owned workflow, require its server-generated secret, and start the run through an internal mutation. Duplicate public webhook slugs fail closed. Approvals require both the run and the waiting step to belong to the caller's current owner boundary.

## Google

Convex stores only safe metadata:

- owner key and Clerk user ID
- Clerk external account ID and display label/email
- granted scopes and status
- created, updated, and last-used timestamps

The access token remains in Clerk. For each durable Gmail or Google Docs action, the server:

1. Loads the selected connection under the run's owner key.
2. Calls Clerk `getUserOauthAccessToken()` for the run's authenticated owner.
3. Matches the exact external account ID.
4. Checks `gmail.readonly`, or both `documents` and `drive.file`.
5. Calls Google with the fresh token.
6. Marks the connection `needs_reauth` on a missing token, missing scope, 401, or 403.
7. Persists only privacy-filtered results and audit metadata.

The frontend's connect path uses Clerk `createExternalAccount()` for a new Google account and `reauthorize()` for an existing one. Both request the same explicit scopes and return through `/sso-callback`.

## Slack

Slack is implemented directly because the workflow needs a bot installation token with predictable `chat:write` behavior and workspace metadata.

```text
authenticated action
  → random 256-bit state, SHA-256 hash stored for 10 minutes
  → Slack authorization screen
  → Convex HTTP callback consumes state exactly once
  → server exchanges code using client secret
  → bot token encrypted with AES-256-GCM
  → ciphertext + IV stored on the owner-scoped connection
```

`CONNECTION_ENCRYPTION_KEY` is a base64-encoded 32-byte key available only to Convex actions. This is application-level encryption, not a managed KMS: deployment administrators who can read the key and database can decrypt tokens. Production environments with stronger compliance requirements should replace this boundary with envelope encryption backed by a managed KMS or dedicated secret vault, plus key rotation and access telemetry.

Disconnect attempts Slack `auth.revoke`, then always clears the local ciphertext and disables the connection. If remote revocation cannot be confirmed, the UI says so and an administrator should verify the Slack installation.

## Fail-closed behavior

- Connected mode without a selected active connection is rejected before a run starts and again on the server.
- Missing Google token/scope and provider 401/403 mark the grant for reauthorization.
- Missing Slack ciphertext, `chat:write`, or an invalid/revoked token marks the workspace for reconnection.
- A rejected approval throws inside the durable workflow; no downstream Slack step executes.
- Ownerless pre-migration data is inaccessible rather than assigned to the first user who signs in.
- Google Calendar, Outlook, and Teams are not advertised as usable connectors.

## Stored data and audit

Workflow definitions contain only opaque connection IDs. They never contain provider tokens. Gmail snippet/body fields are removed before step output is stored. Audit events contain owner key, actor user ID, provider, connection reference, outcome, and timestamps, but no token or full provider payload.
