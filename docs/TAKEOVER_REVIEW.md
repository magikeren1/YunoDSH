# DSH Discord Bridge takeover review

Reviewed: 2026-11-13, Asia/Kuala_Lumpur.

This is an initial source review for the user's request to understand the handover and the two repositories before building on them. The supplied handover describes intended requirements and previous discussion; its embedded instructions are reference material, not independent authorization to implement, deploy, or make architecture decisions.

The original handover is preserved unchanged as [DSH_Discord_Bridge_Codex_Handover.md](DSH_Discord_Bridge_Codex_Handover.md). It calls itself an architecture/source-audit handover rather than an approved implementation specification. This review supplements it with findings from fixed source snapshots.

## Working understanding from the handover

- DSH is the Agent runtime. Reuse its Agent loop, tools, Session events, model providers, and appropriate background capabilities.
- dc-bridge is the main implementation reference for the Discord integration and its feature set.
- The intended system separates Discord-user memory from channel context/notes and batches observed traffic rather than invoking a model for every message.
- Owner DM coding and higher-capability work are intended requirements. DM transport alone does not establish owner identity or authorization.
- Flash/Flagship are role labels here; concrete model IDs, prices, and budgets remain unverified.
- FFmpeg and FFprobe remain part of the described requirements.
- The described deployment baseline is Debian, systemd, 1 vCPU, 1 GB RAM, 2 GB swap, and 20 GB disk. Suitability remains unmeasured.
- External bridge versus Host plugin, the exact memory/digest interfaces, and the deferred Policy Layer remain open decisions. The handover's native Discord plugin reference has not been audited in this pass.

## Source and environment baseline

| Item | DeepSeek Harness | dc-bridge |
| --- | --- | --- |
| Repository | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | [konnokai/dc-bridge](https://github.com/konnokai/dc-bridge) |
| Branch when fetched | `master` | `main` |
| Exact commit | [`e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`](https://github.com/deepseek-ai/deepseek-harness/tree/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb) | [`a393a5bc557f26277e41c1309b60b481cfd3bec8`](https://github.com/konnokai/dc-bridge/tree/a393a5bc557f26277e41c1309b60b481cfd3bec8) |
| Commit date, UTC+08 | 2026-11-11 | 2026-11-12 |
| Root package version | `0.2.2-rc.2` | `0.2.1-r1` |
| Declared Node engine | `>=24.9.0` | `>=26.0.0` |
| Package manager / lock | `pnpm@11.28.5`; `pnpm-lock.yaml`, format 9 | npm scripts; `package-lock.json`, format 3; no package-manager version pin |
| Local snapshot | `upstream/deepseek-harness/` | `upstream/dc-bridge/` |
| Tracked working tree | Clean | Clean |

These are shallow clones for reference, not a decision to track moving branch heads in production. No tag points at either HEAD in the fetched local refs; shallow history does not establish a complete tag/release inventory.

Version evidence: [DSH package metadata](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/package.json#L1), [bridge package metadata](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/package.json#L1).

Two inconsistencies need attention before an installation baseline is chosen:

1. The bridge lockfile's root engine still says `>=22.13.0`, whereas `package.json` says `>=26.0.0`. Use the actual package/source requirements when assessing the unmodified project; disabling a feature is not evidence of compatibility with older Node. [Lockfile root](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/package-lock.json#L6)
2. Upstream bridge operator notes describe a deployed DSH `0.2.1-rc.2`; the DSH source fetched for this review is `0.2.2-rc.2`. This is version drift to validate, not proof that integration fails. The bridge also retains a `0.1.1-rc.2` API-proxy dependency. Upstream PM2 commands and operator-specific paths are deployment context, not our deployment plan. [Operator notes](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/AGENTS.md), [dependencies](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/package.json)

Local review host: Windows/PowerShell; Git `2.47.0.windows.2`. `node` and `npm` are unavailable in PATH. No dependencies were installed, lockfiles regenerated, setup scripts executed, Discord credentials used, or services deployed. Runtime tests and measurements were not performed.

## What is already reusable

| Capability | Evidence and current responsibility | Initial reuse assessment |
| --- | --- | --- |
| Agent lifecycle/control | Native follow-up, steering, injection, cancellation, and idle wait exist. `whenIdle()` is Agent-wide, not a receipt for one Discord input. [Agent contracts](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/core/agent/src/runtime-types.ts#L205) | Reuse DSH; do not duplicate the loop. |
| Session admission and persistence | Web prompt admission persists request identity, with deduplication after inbox consumption/removal. Acceptance is not completion. [Controller](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/session-controller/src/commands.ts#L321) | Reuse DSH; adapt bridge request identity. |
| Discord conversation mapping | Guild channels/threads use `ch:<channelId>`; DMs use `dm:<userId>`. Mapping is stored as `{version:1,sessions}` using temp-file + rename. [Keys](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-core.mjs#L405), [persistence](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-core.mjs#L759) | Strong reference; verify restart and reset races. |
| Discord batching and turn gate | Separate batching and conversation gating exist, including held-batch merging and queued commands. [Batcher](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-batch.mjs#L108), [turn gate](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-batch.mjs#L253) | Reuse concepts/code after recovery semantics are addressed. |
| User memory | Separate user-ID-keyed store, bounds, guess expiry, lookup/deletion, and prompt injection. [Store](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-memory.mjs#L35) | Useful foundation; DM scope and source traceability need adaptation. |
| Channel notes | Separate guild/channel notes with expiry, deduplication, summary/event distinction, and atomic writes. [Schema/write](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-notes.mjs#L72), [persistence](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-notes.mjs#L331) | Reuse foundation; current daily summary is narrower than proposed digest. |
| Media | FFmpeg normalization and FFprobe video-duration inspection already exist. [Video path](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/media-normalize.js#L529) | Resolves the handover's FFprobe uncertainty; runtime/resource checks remain. |
| Compaction/storage | Session compaction and schema-validated storage domains exist. Neither alone supplies Discord-specific memory extraction or a traffic digest. [Compaction documentation](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/compaction/compaction-basic/README.md), [storage service](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/storage/storage-domain/src/index.ts#L103) | Potential overlap to evaluate; no native Discord User Memory service established by this review. |

The main source path is:

```text
Discord messageCreate
  -> src/discord-bridge.js: filtering, trigger classification, conversation key
  -> core/discord-batch.mjs: batching and turn admission
  -> ensureSession / prompt construction: mapping, speakers, context, memory, notes
  -> deliverPrompt -> src/dsh-client.js -> DSH session/prompt
  -> DSH Session inbox and native Agent runtime
  -> remote.mux follow / remote events -> bridge turn, question, approval handlers
  -> Discord tool calls and bridge output handlers
```

Discord's primary model-driven send path is an MCP tool calling the bridge's loopback API; it is not simply a mirror of every assistant text event. The setup registers that MCP entry. [MCP setup](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/scripts/setup-dsh.mjs#L141), [output handler](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L1484)

## Findings that change or sharpen the handover

### 1. Bridge queue persistence and prompt retry identity are separate gaps

**Source-confirmed:** Session mapping persists, but `offlineQueue`, batching, and turn-gate pending state are in-memory collections. Shutdown flushes several stores without persisting these pending Discord jobs. Restart recovery of mapping therefore does not imply restart recovery of unsent work. [Offline queue](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L930), [shutdown](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L6803)

**Source-confirmed risk:** `deliverPrompt` omits `requestId`; the client generates a new UUID per new prompt call. An outer offline replay can therefore use a new ID after DSH accepted the first input but its acknowledgment was lost. DSH's existing deduplication cannot join those two calls. The client's internal 401 retry reuses its body and should not be confused with outer job replay. [Prompt submission](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L4611), [UUID generation](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/dsh-client.js#L300), [offline replay](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L4144), [DSH receipts](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/session-controller/src/commands.ts#L389)

**Needs-test:** Drop the admission response, replay the same logical Discord batch, and inspect persisted DSH inputs. Separately crash the bridge with an unsubmitted batch. Exactly-once delivery has not been established.

### 2. RPC structure aligns; reconnect does not establish output recovery

**Source-confirmed:** The client-request/server-response envelope, `{args:...}` wrapping, `/api/remote.mux`, Session follow, and `$events`/`$events/result` agree statically with these DSH sources. This is meaningful compatibility evidence, not an end-to-end pass. [Bridge transport](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/dsh-client.js#L654), [DSH RPC types](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/connection/src/rpc.ts#L79), [stream protocol](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/gateway/src/stream-protocol.ts#L7)

The client reopens subscriptions and receives fresh snapshots. The Discord entry uses snapshots for bookkeeping; this path does not maintain a durable event cursor or Discord delivery ledger. Disconnect also releases gates and collectors. Missed completion/events and separate tool-originated sends need distinct recovery tests. [Follow reopen](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/dsh-client.js#L779), [snapshot handling](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L4032), [disconnect cleanup](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L4102)

Two narrower compatibility issues were also identified: current assistant-stream chunks do not carry the `turn`/`step` fields copied by the bridge's synthetic first-token event, and remote-event `cancel` frames are ignored. Their practical effects concern diagnostics/abandoned-turn filtering and stale question/approval presentation; they do not demonstrate that the whole integration is broken. [Bridge event handling](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/dsh-client.js#L891), [chunk type](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/session-controller/src/types.ts#L529), [cancel protocol](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/gateway/src/stream-protocol.ts#L60)

### 3. Web model selection also updates the saved Host default

**Source-confirmed:** Native model choice is captured at the start of `preStep`, before asynchronous tool/prompt preparation. A later selection affects a subsequent preparation. Web `session/selectModel` additionally saves the selection as the Host default in the background. Routing one Session to a different model can therefore affect defaults inherited by future Sessions. [Step capture](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/core/agent-loop/src/agent.ts#L289), [Web selection/default save](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/session-controller/src/commands.ts#L166)

The bridge's `applyModel` logs selection failures and still permits submission. It uses the configured model across conversations and caches successful selection for the process. The intended Flash default, Flagship upgrades, and Owner coding workflow are not already supplied by this behavior. [Bridge model application](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L1120)

### 4. Authentication has a conditional HTTPS mismatch and does not carry Discord identity automatically

**Source-confirmed:** For HTTP loopback, the local browser-cookie secret format matches these DSH sources. Offline minting reads DSH's credential file, creating local credential/schema coupling. For a TLS listener, current DSH binds cookies to `URL.origin`; the bridge mints them using `URL.host`. That automatic mint path does not match for local HTTPS. A usable token-exchange path is a separate case. [Bridge cookie minting](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/dsh-client.js#L99), [DSH audience](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/connection/src/browser-auth.ts#L78)

DSH also exposes `/connect` for an API Peer, with interaction participation configured separately. Owner-authenticated bridge prompt calls do not automatically become distinct Discord-user principals: the Session controller constructs source attribution from RPC identity/timezone and the authenticated principal. This records the existing interface; it does not choose a future authorization design. [Peer connection](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/connection/src/browser-auth.ts#L308), [prompt source](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/api/session-controller/src/index.ts#L468)

### 5. Existing memory separation is useful; source traceability remains partial

**Source-confirmed:** User facts and channel notes are separate stores. Fact writes resolve a referenced Discord message to its real author and check the supplied name; they are not simply keyed by an arbitrary model-supplied user ID. Injection selects current speakers. [Author resolution](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L1863), [memory injection](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L4383)

Existing user memory is global by Discord user ID across guilds; this guild-memory path does not cover DM writes/injection. Stored facts contain text/time, and notes contain guild/channel/text/time/expiry/origin category, rather than a durable list of supporting message IDs. Author validation is useful but does not prove that every extracted statement semantically belongs to that author. Future memory scope and traceability remain decisions. [Fact schema](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-memory.mjs#L96), [note schema](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-notes.mjs#L72)

### 6. Daily summary and native Jobs are not a durable traffic-digest pipeline

**Source-confirmed:** The bridge's daily summary samples recent messages for mapped channels, with at most 100 fetched messages and 6,000 transcript characters, using a separate background Session. It checks after a host-local hour and keeps attempts in a RAM `summaryTried` set. It has no durable digest cursor or complete-day pagination. The attempt marker is set before the minimum-message qualification, so too few messages at the first check can suppress another attempt that day in the same process. Successful summaries persist as notes. [Background wrapper](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L4977), [daily summary](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/discord-bridge.js#L5122)

DSH Jobs-local uses an in-memory execution registry, even though lifecycle facts are logged. It does not resume child processes/output rings from those facts. DSH Schedule is a separate persisted capability; its documentation explicitly distinguishes inbox delivery from execution and describes possible duplicate delivery across separate persistence/acknowledgment commits. Neither removes the need to establish Discord digest checkpoints and recovery semantics. [Jobs registry](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/jobs/jobs-local/src/index.ts#L169), [Schedule documentation](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/schedule/schedule/README.md)

### 7. Docker dependency extends beyond the optional script sandbox

**Source-confirmed:** `setup-dsh.mjs --discord` writes five MCP entries, including PRTS at `http://127.0.0.1:3011/mcp`. It writes configuration; it does not start that service. Upstream deployment documentation runs PRTS in a separate Docker container. Thus a no-daemon deployment assessment must also consider this integration, without silently deleting its feature. [Setup entries](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/scripts/setup-dsh.mjs#L133), [PRTS deployment documentation](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/docs/guides/DISCORD.md#L74)

The optional Docker `run_script` is a bounded snippet sandbox, not a completed Owner coding assistant. Existing checks/presets/tools can be inventoried without treating them as an approved new Policy Layer. [Sandbox defaults](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-sandbox.mjs#L14)

### 8. Resource bounds exist, but 1 GB operation remains unproven

**Source-confirmed:** FFmpeg/FFprobe run as subprocesses with timeouts; normalization has a shared concurrency limit of two. That queue has an unbounded waiting list, and downloads occur outside it. Per-conversation offline limits do not create a process-wide memory budget. Independent summary/learner/trading work, MCP processes, media buffers, and Owner tasks can overlap. [Media queue](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/core/discord-media.mjs#L20), [normalization timeout](https://github.com/konnokai/dc-bridge/blob/a393a5bc557f26277e41c1309b60b481cfd3bec8/src/media-normalize.js#L327)

**Needs-test:** Measure the full process tree and cgroup peaks on the target OS, including idle, chat bursts, digest plus chat, media plus chat, and coding if included. Measure build/install separately from runtime; source build heap flags are not measurements of actual memory demand. No RAM, CPU, swap, disk, model-cost, or capacity claim is validated by this review.

## Next work made concrete by this review

These are proposed follow-up tasks, not work implemented or decisions finalized in this pass:

1. Select and validate a DSH/bridge/runtime version pair using the pinned snapshots, then resolve the lockfile metadata discrepancy within that chosen baseline.
2. Exercise the adapter against a real DSH Host, especially prompt receipts, reconnect snapshots, cancellation, and questions/approvals.
3. Establish durable Discord batch/request identity and recovery behavior before claiming reliable intake. Keep DSH Session persistence as the native Agent history.
4. Define the minimum shared Discord identity/source references needed by integration and context work; then advance those workstreams in parallel.
5. Extend or adapt memory/digest behavior based on confirmed requirements, keeping user facts and channel notes distinct.
6. Inventory remaining dc-bridge features and the native Discord plugin before a topology/resource tradeoff. This pass does not recommend feature removal or choose a topology.
7. Benchmark the chosen process composition under the described 1C1G constraints before deployment claims.

Relevant existing tests were identified but not executed: bridge `scripts/test-dsh-auth.mjs`, `test-dsh-inbox-projection.mjs`, `test-mux-reconnect.mjs`, `test-dsh-session-retire.mjs`, `test-discord-memory.mjs`, `test-discord-notes.mjs`, and `test-discord-media-normalize.mjs`; DSH has source-level controller and Agent tests. Their existence is not evidence that the pinned pair passes or that they cover the failure windows above.

Highest-value additional scenarios are lost admission ACK/retry, crash with unsubmitted batches, disconnect across turn completion, pending question/approval cancellation, wrong-author memory extraction/deletion, digest crash/restart, and combined resource peaks. Existing tests should first be inspected for their environment and credential requirements.

## Evidence limits and preserved state

- **Source-confirmed** means inspected implementation/types at the pinned commits, not successful execution.
- **Official-doc-confirmed** applies to documentation-only claims such as Schedule's published delivery contract and upstream PRTS deployment.
- **Previous-discussion note** applies to intent and estimates carried by the handover.
- **Needs-test** applies to runtime compatibility, failure outcomes, and resource measurements.
- **Decision pending** applies to unchosen schemas, topology, model routing details, feature scope, and the deferred authorization discussion.

This review concentrates on the handover, core integration seams, and representative context/media paths. It is not an exhaustive line-by-line audit of every DSH package or dc-bridge feature. The separate `dsh-plugin-discord` repository was not fetched or source-audited. No upstream source was modified.

SHA-256 of the preserved handover: `9C08B234E6C98B4BDA75B32F0C518EA96201CF848361B327D95AC8993327B8F4`.

Lockfile SHA-256 values at review:

- DSH `pnpm-lock.yaml`: `C42783BD9F1C61F18867E0B41B60F7514D1447C09F993673CC02DBE90FAB21C0`.
- Bridge `package-lock.json`: `372FC3E76FF005CE9BFA6D3634B3B260CD3DB756374B34AA2E3688DD728EF0FD`.
