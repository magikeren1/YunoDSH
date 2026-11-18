# Intake recovery, hourly digest and source references

Implemented 2026-11-13 against the maintained application copy. This updates the earlier alignment review; it is not full handover acceptance.

## Durable intake and receipts

`apps/discord/state/discord-journal.sqlite` uses Node's SQLite with WAL, FULL synchronous commits, and transactions. It stores observed human messages, queued message IDs, prepared DSH requests and their source associations. It does not implement an Agent runtime or duplicate DSH's output/event history.

- Messages selected for normal chat are marked pending before entering the volatile batcher.
- The exact prepared request, original request ID and source message IDs are committed before submitting to DSH.
- Repeated submissions of a prepared job reuse its saved payload and identity.
- Startup recovers pending requests into their original mapped Session, then refetches queued/unprepared messages from Discord for normal classification and batching. Recovery rechecks current channel access and Session mapping; it logs and retains blocked work instead of moving it into another Session.
- Transient failures retry. A full in-memory offline queue leaves the prepared work in SQLite rather than deleting its oldest entry.
- The application turn gate splits oversized held batches instead of dropping ordinary messages and does not merge already-prepared requests with new messages.
- Explicit conversation reset cancels journal work for that conversation so it is not resurrected after restart.
- Follow-up text remains in a normal durable prompt batch rather than being consumed solely through an unacknowledged in-flight tool response. This changes the inherited low-latency interception timing while retaining the message.

Current bounds: 20,000 retained observed messages, 4,000 text characters per message, 32 unacknowledged prepared requests, 8 MiB per prepared payload, and a main-database page budget of roughly 256 MiB at the default 4 KiB page size. SQLite/WAL overhead is additional. Completed/cancelled receipt records and processed observations are eligible for cleanup after 14 days. Unsummarized/pending work is not silently expired to free space. Capacity/storage failures are explicit; directed messages receive a retry notice if observation persistence fails.

These are development bounds, not a measured 1 GB host budget. The journal API exposes bounds for tests; further deployment tunables can be added after measurements.

## Hourly incremental channel digest

Member facts and channel digests have separate purposes and storage: the hourly worker publishes shared channel notes and does not create per-member memory digests. Personal facts are keyed by Discord user ID and shared across servers, with source author checks. Model-generated channel summaries may still contain attribution mistakes and require live review; storage separation alone cannot guarantee semantic accuracy. Owner DM long-term personal memory is not yet implemented.

## Video links (Windows MVP)

The local configuration enables video link inspection. The project launcher adds `.tools` to PATH for the official yt-dlp 2026.10.26 Windows executable (SHA-256 `f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d`); FFmpeg remains responsible for sampled frames. YouTube and Bilibili hosts are recognized. The bridge must be restarted to load these changes. This is metadata, available subtitles and sampled frames, not full video/audio understanding. Actual provider access, subtitles and frame extraction have not yet been verified live.

The project example and local config enable `discord.notes.digest`:

```json
{
  "enabled": true,
  "intervalMinutes": 60,
  "maxMessages": 100,
  "maxChars": 6000,
  "timeoutMs": 90000
}
```

The worker checks once a minute. A channel's first window becomes due one interval after its first observed message; later windows become due one interval after successful processing. Empty or already-processed channels do not make a model request. Busy background execution is deferred. The worker is sequential and all existing background Session calls share one active slot.

Each digest freezes an oldest-first, bounded set of unsummarized observations. New arrivals remain available for a later window. The prompt includes message IDs, author IDs, display names and timestamps, and treats transcript text as data. It asks for shared channel notes, separately from personal facts. It does not claim to summarize a complete day or an unlimited backlog in one call.

Execution uses the existing DSH background Session wrapper and timeout/cancellation path. Attempt time and interrupted Session ID are saved. After a restart, interrupted native Session work is stopped/archived before retrying the same input window. Failures are throttled to the configured interval and do not advance the input checkpoint. Such retries can repeat model work; billing/inference exactly-once is not claimed.

A successful result and input checkpoint commit together in SQLite. Note export uses a stable `digest-<job-id>` note ID and saves the note file before acknowledging export. Restart after note persistence retries the same note ID without another model call or duplicate note. A valid "no meaningful points" result advances the processed-input checkpoint without creating a note. Empty results and execution failures do not discard the input window. Semantic summary correctness still requires live validation.

The legacy daily sampler remains available separately; the project uses the incremental worker when digest is enabled. No per-message model call was added.

## Source references and persistence compatibility

New personal facts retain validated supporting Discord message metadata. New note tool calls can supply up to ten message references; the bridge resolves them and requires them to be readable in the same channel. Without explicit references, available turn context is labeled `turn-context`, not asserted as exact evidence. Digests retain the actual source window as `digest-input` references.

References include guild/channel/message/author IDs, timestamp, and relation. Author checks reject attaching another user's evidence to a personal fact; channel checks reject attaching another channel's evidence to a note. Existing JSON versions remain readable with additive optional fields; unknown historical sources are not invented. Reads preserve references, deduplication merges them within a fixed bound, and deleting a fact/user removes its stored references too. Oversize memory/note writes fail before replacing a readable file.

`/forget` remains deletion of personal facts. It does not purge channel transcripts, channel summaries or DSH Session history. Source references identify evidence locations; they do not prove every model-extracted statement is semantically correct. Existing facts/notes are not retroactively given missing evidence.

## Media and resource controls

The configured bridge defaults are one normalization subprocess task and one CDN download at a time, each with four waiting jobs. Excess work gets an explicit queue error. CDN reads enforce byte limits while streaming, including when Content-Length is absent. FFmpeg/FFprobe timeouts and cleanup remain in the existing modules. Media queue limit changes require a bridge restart.

These controls reduce known unbounded work; they do not qualify combined DSH, bridge, tools and subprocess peaks on Debian 1C1G.

## Verification and limits

Latest result: the full Discord suite passes 33/33 scripts, including 10 journal/digest/recovery tests, 2 media-budget tests and an MCP stdio schema handshake. The live no-model DSH smoke also passes 20 authentication checks and Session lifecycle operations. Syntax and runtime/source-pin checks pass. Both audited upstream checkouts remain clean.

The added tests cover abrupt process exit before batching; lost HTTP admission ACK and receipt reuse after reopening SQLite; capacity refusal; explicit reset; immutable prepared batches; empty/young digest channels; new input during inference; model failure/retry; interrupted Session cleanup callbacks; crash between note persistence and export ACK; no duplicate note on replay; source persistence/deletion/identity checks; oversize-write preservation; live chat journal operations while a digest awaits inference; media queue saturation; streamed byte bounds; and actual MCP stdio schema registration.

The existing no-model DSH smoke verifies authentication and native Session lifecycle, including cancellation after archive. A real Discord/model digest run and full process-level restart fault injection of a logged-in bridge remain untested without account setup.

Important remaining boundaries:

- Messages that never reached this running Gateway are not backfilled by this implementation. Recovery of journaled/unprepared messages depends on Discord retaining them and permitting refetch.
- DSH admission is not execution completion. Durable outbound Discord delivery and event-gap catch-up are still separate work; this is not end-to-end exactly-once delivery.
- Low-level observation and chat classification are distinct. The durable chat recovery guarantee starts after the pending marker commits, not before the process has received/classified a Gateway event.
- Very large or currently inaccessible backlog is retained/logged and may require operator intervention. The bounded digest can take multiple hourly windows to drain heavy traffic.
- Flash/Flagship routing, Owner DM coding/authorization choices, the custom persona text, final topology, systemd deployment and target-VPS resource qualification remain open.
