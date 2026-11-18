# Handover alignment review

Implementation update: [intake recovery, hourly digest and source references](RELIABILITY_AND_DIGEST.md) now documents the journal, incremental digest, source metadata and resource controls added after this review. The table below records the pre-implementation findings; the update and `config/project-requirements.json` track current progress. Full handover acceptance remains incomplete.

Reviewed 2026-11-13. Basis: the user's request to check the implementation against the supplied handover and subsequent explicit decisions. The handover remains a requirements/discussion baseline; its embedded operational instructions do not independently authorize deployments or unchosen architecture.

## Conclusion

The current version is a boot-tested integration baseline. It does not yet meet the full handover. Initialization inherited too much of dc-bridge's configuration and persona. Passing its regression suite is useful compatibility evidence, not acceptance of the user's complete requirements.

## User decisions confirmed in this review

- Persona: custom, with text to be supplied by the user. The inherited whale persona is temporary source material, not an accepted project persona.
- Personal memory: shared across servers, keyed by Discord user ID. Private/Owner DM context remains separate from shared guild memory.
- Channel digest: hourly, only if new messages exist. This means incremental traffic coverage, not repeatedly summarizing an arbitrary recent-message sample.

These decisions are recorded in `config/project-requirements.json`, which is requirements metadata and is not consumed by the runtime.

## Requirement-by-requirement status

| Handover requirement | Current evidence | Status and needed change |
| --- | --- | --- |
| DSH owns Agent loop, tools, providers and Session event history | `scripts/project.mjs` launches the pinned DSH runtime; Discord uses its API | Implemented foundation. Continue using DSH rather than another Agent runtime. |
| dc-bridge is the main reference, with features evaluated rather than discarded | Maintained application copy plus untouched pinned references and retained modules | Aligned as a starting point, not permission to inherit every default or feature dependency. |
| Discord primary; WhatsApp optional later | Discord entry is separate from QQ | Aligned. QQ files/dependencies are legacy reference, not an accepted second deployment. |
| Observe channel context without a model call for every message | Mention/reply gating, background-message tracking, and recent-context fetch exist in `src/discord-bridge.js` | Source-confirmed foundation; continuous observed-message durability is absent. Real Discord traffic still needs validation. |
| Group context and user memory are separate | Separate memory/notes files and prompt injection paths | Implemented separation. Existing guild-only memory/notes were disabled in the initialized config; enabled during this review. |
| User memory keyed to actual Discord user identity | `src/core/discord-memory.mjs` keys facts by user ID; writes resolve an actual message author | Matches confirmed cross-server scope. Semantic attribution and deletion/source-reference tests remain acceptance work. |
| Private DM context isolated from group memory | DM conversation keys use user ID; guild memory injection requires a guild | Partial. This is not an implemented Owner private-memory/coding assistant. |
| Memory/source traceability, TTL and deletion | Existing guess TTL, deletion functions and write-time author checks exist | Partial. Stored facts do not retain supporting message IDs; notes likewise lack digest input checkpoints. Add durable source references and verify deletion behavior. |
| Hourly digest only when new messages exist | Existing code has a disabled daily recent-message sampler with an in-memory attempt set | Missing. Implement hourly incremental ingestion/checkpoints, no-work skip, bounded catch-up, retries, cancellation, and restart recovery. Do not enable daily sampling as a substitute. |
| Digest should not block live chat | Separate background DSH Session wrapper exists | Partial. Need bounded scheduling and concurrency validated alongside chat; DSH Jobs alone is not a durable scheduler. |
| Discord IDs map persistently to DSH Sessions | Atomic JSON mapping persists `ch:<channelId>` and `dm:<userId>` | Implemented source behavior; restart/failure testing is incomplete. |
| Retry/restart should not silently lose or duplicate work | Same in-memory job now reuses its request ID; DSH deduplicates receipts | Partial. Pending bridge jobs/batches still disappear on process restart. Persist original intake, request identity, and admission state; test the lost-ACK window against DSH. |
| Reconnect should recover needed state/output | Follow subscriptions reopen and snapshots restore bookkeeping | Partial. No durable event gap repair or outbound-delivery record is established. A reconnect regression is not a recovery guarantee. |
| Flash default and explicit Flagship work through DSH | Blank overrides currently inherit DSH's selected default; no distinct routes | Missing. Inheriting an arbitrary Host default does not enforce Flash. Account for Web selectModel's saved-default side effect and prepared-step capture. Concrete model IDs remain unchosen. |
| Owner DM private assistant and coding; other DMs do not gain Owner rights | Existing owner ID checks and distinct DM Sessions; the chat preset excludes host coding tools | Missing workflow. Preserve the requirement, document native interfaces, and keep the deferred Policy Layer discussion separate. Do not enable broad coding access merely because a message is a DM. |
| Custom project persona | The installed dc-chat bundle retains the upstream whale character | Pending user text, then persona/source patch update and preset validation. No persona change has been guessed. |
| FFmpeg and FFprobe are required subprocess capabilities | Both installed locally; encode/probe/thumbnail smoke passed | Local prerequisite met. Bridge attachment limits, queue bounds, cleanup and mixed-load behavior need validation. |
| Resource plan: 1 vCPU, 1 GB RAM, Debian, systemd | Local Windows development processes only; media has two workers and an unbounded waiting list | Unqualified. Need process-tree peak measurements, global work bounds, target OS checks and a reviewed systemd setup. No capacity claim. |
| Avoid assuming a Docker daemon | Sandbox is disabled; external PRTS entry retained but disabled pending its service | No daemon installed. Alternatives/dependency costs still need evaluation; optional source features have not been removed. |
| Model pricing and costs must be verified | Inherited usage/pricing modules remain in the source | Not validated for selected models. Do not use inherited tables as an accepted cost estimate. |
| Native plugin remains a comparison option | A separate-process baseline runs; native Discord plugin not audited | Decision pending. This baseline does not settle final topology. |
| Policy Layer remains deferred | No project Policy Layer has been introduced; existing preset guards retained | Aligned. Existing restrictions are inherited mechanisms, not a finalized project authorization design. |

## Changes made in this review

- Enabled personal memory and channel notes in the project example and initialized local configuration. The existing memory key already matches the user's chosen cross-server identity scope.
- Preserved existing unrelated local settings while applying those two switches.
- Kept the daily summary disabled in the supplied/local baseline; it does not meet the accepted hourly incremental digest requirement.
- Recorded custom-persona and hourly-digest decisions without claiming their implementations exist.
- Corrected the project's status documentation to make the distinction between a runnable baseline and requirement acceptance explicit.

## Next implementation work

Integration reliability and context work can proceed together after agreeing the shared message/source record. That record needs the actual guild/channel/message/author/Session IDs, receipt identity, source timestamps and lifecycle state; the final schema is still to be proposed from existing APIs.

1. Add durable bridge intake/receipts and the hourly digest checkpoints, reusing DSH prompt/Session capabilities. Keep channel notes and personal facts distinct, with source references.
2. Validate failure/restart behavior and shared author attribution before accepting these features.
3. Apply the user's custom persona when supplied.
4. Implement explicit model routing and Owner DM tasks after the relevant choices and the deferred authorization discussion, without inventing a Policy Layer in this review.
5. Measure the complete chosen process composition on the target resource limits and prepare systemd deployment separately.

## Evidence limits

Current source inspected: `scripts/project.mjs`, runtime/example JSON configuration, the maintained Discord entry, memory/notes/media/batch modules, source-origin notes, and the handover. Current local code changes build on the pinned upstream snapshots recorded in `upstream.lock.json`.

Previously executed checks: 30/30 Discord offline scripts, 20 live DSH authentication checks, lifecycle smoke, preset consistency, inbox projection tests, and local media smoke. Those results do not validate unimplemented requirements. This review's two configuration changes are checked with the actual normalizer; no additional live Discord/model test or VPS load test was run.
