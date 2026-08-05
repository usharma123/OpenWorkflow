# Secure connector architecture

## Goal

A workflow may select an approved connection, but it must never read, write, log, or export the underlying OAuth credential. Provider access is mediated by a server-side adapter with an explicit operation and scope set.

## Target request path

```text
Business user
  → chooses connectionRef in a workflow step
  → Convex authorizes user, workflow, operation, and resource policy
  → adapter requests token by opaque secretLocator
  → vault decrypts token only for the duration of the server action
  → provider API call
  → privacy-filtered result + append-only audit event
```

The POC implements connection metadata, named references, fixed provider adapters, server-only token lookup, step-output redaction, approval gating, and audit rows. It deliberately uses Convex environment variables as a bootstrap secret store. OAuth callbacks, encrypted refresh-token persistence, and automatic rotation are not implemented.

## Connection record

The `connections` table holds non-secret metadata:

- external ID used by workflow steps
- provider and display name
- owner label and approved scopes
- status (`active`, `needs_reauth`, or `disabled`)
- opaque `secretLocator`
- created, updated, and last-used timestamps

The public list query strips `secretLocator`. A production mutation that creates or changes connections must be admin-only after authentication/RBAC is added.

## Credential vault

Production should store access and refresh tokens in a dedicated encrypted secret service, keyed by tenant and connection ID. Envelope encryption should use a managed KMS key; application records keep only a vault locator. Tokens are decrypted only inside a provider action, never returned to Convex queries or the browser, and refreshes rotate atomically.

Required protections:

1. Authorization-code flow with PKCE and strict redirect URI allowlists.
2. State and nonce validation, single-use callback state, and tenant binding.
3. Incremental consent and the smallest provider scopes for each operation.
4. Per-connection resource policies such as approved Drive folder, Slack channels, calendars, or Teams.
5. Revocation and reauthorization UI with `needs_reauth` status.
6. Token access metrics without logging token values or message/document bodies.

## Provider scope plan

| Provider | Initial operations | Minimum scopes |
| --- | --- | --- |
| Gmail | Search and read selected messages | `gmail.readonly` |
| Google Docs/Drive | Create a Doc in an app-authorized location | `documents`, `drive.file` |
| Slack | Post an approved link | `chat:write` |
| Google Calendar | Read selected event windows | `calendar.readonly` |
| Outlook | Read mail, later create drafts | `Mail.Read`, then `Mail.ReadWrite` only when drafts ship |
| Microsoft Teams | Post to approved channels | `ChannelMessage.Send` with tenant policy review |

Google Workspace may share one user grant, but each step still checks that its required scope is present. Microsoft Graph uses a separate connection and consent surface.

## Approval policy

Approval is a durable Convex event. The workflow records the pending step before it pauses. A decision includes the run ID, node ID, decision, optional note, actor identity, and timestamp. Downstream external actions receive the prior artifact plus the approval record; rejection fails closed and prevents Slack or Teams delivery.

The POC actor is `editor-user`. Production must derive actor and tenant from authenticated server context, enforce the configured approver or group, prevent self-approval where policy requires it, and support expiration/escalation.

## Audit and privacy

Audit events record operation, provider, connection reference, actor, outcome, and timestamps. They do not contain tokens or full provider payloads. Step history removes Gmail snippets and bodies before persistence while retaining sender/subject metadata for an understandable run timeline.

Production hardening should add append-only retention, export to the company SIEM, tenant-specific retention periods, data-subject deletion workflows, and field-level policies for generated summaries and documents.
