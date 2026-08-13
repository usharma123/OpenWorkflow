# OpenWorkflow architecture

User builds a graph in the browser. Convex runs it as a durable, owner-isolated workflow. Clerk holds identity and Google tokens. Slack, OpenRouter, Daytona, and Exa are called only from the backend.

The system diagram is rendered to [`openworkflow-architecture.png`](openworkflow-architecture.png):

```bash
bunx --bun @mermaid-js/mermaid-cli \
  -i docs/architecture-system.mmd \
  -o docs/openworkflow-architecture.png \
  -t neutral -b white -s 2 -w 2400 -H 1600 \
  -p docs/mermaid-puppeteer.json
```

## System: user, app, backend, integrations

```mermaid
flowchart TB
  subgraph USER["User / browser"]
    U["Signed-in user"]
    APP["React editor on Vercel<br/>React Flow · draft autosave · live transcript"]
  end

  subgraph AUTH["Auth"]
    CLERK["Clerk<br/>session JWT · org tenancy<br/>Google OAuth tokens stay here"]
  end

  subgraph BACKEND["Convex backend"]
    AUTHZ["Auth + owner key<br/>org:id or user:id"]
    DEFS["Workflows + versions<br/>draft vs published"]
    ENGINE["Durable run engine<br/>@convex-dev/workflow"]
    LIVE["Live state<br/>watchQuery patches"]
    HTTP["HTTP<br/>/webhooks/:slug<br/>/oauth/slack/callback"]
    CRON["Crons every 1 min<br/>schedules · Google poll"]
  end

  subgraph INTEG["Integrations"]
    OR["OpenRouter<br/>LLM SSE"]
    GOOG["Google Workspace<br/>Gmail · Docs · Drive · Cal · Sheets"]
    SLACK["Slack<br/>chat:write"]
    DAY["Daytona<br/>code · shell · git"]
    EXA["Exa<br/>web search"]
  end

  U -->|"builds graph / hits Run"| APP
  APP -->|"sign in"| CLERK
  APP -->|"queries + mutations"| AUTHZ
  CLERK -->|"verified JWT"| AUTHZ
  AUTHZ --> DEFS
  DEFS --> ENGINE
  ENGINE --> LIVE
  LIVE -.->|"realtime transcript"| APP
  HTTP --> ENGINE
  CRON --> ENGINE
  ENGINE --> OR
  ENGINE -->|"fresh token from Clerk"| GOOG
  ENGINE -->|"decrypt bot token"| SLACK
  ENGINE --> DAY
  ENGINE --> EXA
```

## How a run works

```mermaid
sequenceDiagram
  actor User
  participant App as React editor
  participant Clerk
  participant Convex
  participant Engine as Durable engine
  participant Ext as Integrations

  User->>App: Sign in, edit graph, Run
  App->>Clerk: Session
  App->>Convex: startRun (owner-scoped)
  Clerk-->>Convex: Verified JWT → org: or user:
  Convex->>Convex: Pin immutable workflow version
  Convex->>Engine: executeWorkflow

  loop Topological waves
    Engine->>Engine: Logic, delay, merge
    Engine->>Ext: OpenRouter / Google / Slack / Daytona / Exa
    Engine-->>App: Live step patches
    opt Human gate
      Engine-->>App: waiting (approval or plan review)
      User->>Convex: Approve or reject
      Note over Engine: Reject throws — no downstream writes
    end
  end

  Engine-->>App: completed or failed
```

## Ingress

| Who starts it | Which graph | Guard |
| --- | --- | --- |
| Manual Run in the editor | Current draft | Signed-in principal + active connection |
| Schedule cron (1 min) | Published, enabled | Owner copied from the workflow |
| `POST /webhooks/:slug` | Published, enabled | Server secret + 24h idempotency key |
| Google poll cron (1 min) | Published, enabled | Dedupe keys; first poll is baseline only |

Manual runs test the draft. Schedules, webhooks, and Google event triggers use the published version only.

## Agent step: how it works

An Agent node is either a lightweight OpenRouter completion or a compute agent with tools. Compute is on when `useCompute` is true. `planFirst` pauses the durable run until a human accepts (or edits) Luna's proposed plan.

Rendered: [`openworkflow-agent.png`](openworkflow-agent.png)

```bash
bunx --bun @mermaid-js/mermaid-cli \
  -i docs/architecture-agent.mmd \
  -o docs/openworkflow-agent.png \
  -t neutral -b white -s 2 -w 2400 -H 2000 \
  -p docs/mermaid-puppeteer.json
```

```mermaid
flowchart TD
  START["Agent step in the workflow"] --> COMPUTE{"Use compute?"}

  COMPUTE -->|"off — lightweight"| STREAM["Stream OpenRouter completion"]
  STREAM --> WEB{"OpenRouter web search?"}
  WEB -->|optional| STREAM
  STREAM --> LIVE1["Patch live text every 200ms"]
  LIVE1 --> NEXT["Pass content to the next step"]

  COMPUTE -->|"on — Luna + tools"| PLANQ{"Plan first?"}

  PLANQ -->|yes| GEN["generatePlan: Luna must call propose_plan"]
  GEN --> WAIT["Run pauses — status waiting"]
  WAIT --> USER{"User reviews the plan"}
  USER -->|reject| STOP["Run fails. No tools ran."]
  USER -->|approve or edit| EXEC["runAgent — tool loop"]
  PLANQ -->|no| EXEC

  EXEC --> ROUND["OpenRouter chat round with tools"]
  ROUND --> CALL{"Function calls?"}
  CALL -->|yes, and budget left| DO["Validate and dispatch tools"]
  DO --> TRACE["Append toolTrace + live transcript"]
  TRACE --> ROUND
  CALL -->|no, or last round| SYNTH["Final answer with tools off"]

  SYNTH --> OUT["Return content, citations, artifacts, subagents"]
  OUT --> CLEAN["Delete Daytona sandbox"]
  CLEAN --> NEXT
```

## Agent step: what it does

The lead agent chooses tools. Subagents can only research. Sandbox tools create one ephemeral Daytona VM (blocked network, 60 min TTL) and delete it when the step finishes.

Rendered: [`openworkflow-agent-tools.png`](openworkflow-agent-tools.png)

```bash
bunx --bun @mermaid-js/mermaid-cli \
  -i docs/architecture-agent-tools.mmd \
  -o docs/openworkflow-agent-tools.png \
  -t neutral -b white -s 2 -w 2400 -H 1600 \
  -p docs/mermaid-puppeteer.json
```

```mermaid
flowchart TB
  L["Lead agent — Luna via OpenRouter<br/>picks tools for up to 12 rounds"]

  subgraph R["Research"]
    direction LR
    S["web_search<br/>one Exa query"]
    B["batch_web_search<br/>up to 6 queries"]
    F["fetch_url<br/>public HTTPS, SSRF-guarded"]
  end

  subgraph K["spawn_subagents"]
    direction LR
    K1["1 to 3 parallel children"]
    K2["search and fetch only"]
    K3["no sandbox, no recursion"]
  end

  subgraph D["Daytona sandbox — created on first compute tool"]
    direction LR
    C["run_code<br/>Python / JS / TS"]
    SH["run_shell<br/>allowlisted"]
    G["clone_repo<br/>public HTTPS"]
    RW["read / write files"]
    A["publish_artifact"]
  end

  subgraph P["Approved plan"]
    M["mark_plan_step<br/>active, done, skipped"]
  end

  O["Next step receives content, citations, artifacts, and toolTrace"]

  L --> R
  L --> K
  L --> D
  L --> P
  R --> O
  K --> O
  D --> O
  P --> O
```

