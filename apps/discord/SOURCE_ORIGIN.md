# Source origin and first-version changes

This application was copied from konnokai/dc-bridge at commit `a393a5bc557f26277e41c1309b60b481cfd3bec8`. The original `LICENSE`, documentation, and asset attribution are retained. Character reference assets have their own license recorded in `assets/ai-chan-sheets/characters.json` and its README; they are not covered solely by the source MIT license.

This copy is maintained in the YunoDSH Git repository. Optional source-review clones under `upstream/` are not distributed or required to run it. See the root `docs/UPSTREAM.md` for fork ancestry and the distinction between bridge source and the external Harness runtime.

First-version changes:

- Read DSH_AUTH_TOKEN from the launch environment when no explicit token is configured.
- Blank provider/model overrides inherit the selected DSH default; remove inherited provider/model names from the example.
- Preserve a job's prompt request ID across in-process offline retries, including lost acknowledgments. Pending jobs are still not persisted across restart.
- Add the `session/state` request wrapper required by DSH 0.2.2-rc.2, verified against a running local Host.
- Add a lost-ACK identity regression and a no-model DSH initialization smoke check.
- Enable personal memory and channel notes in the project example following the handover alignment review. The user confirmed shared cross-server memory by Discord user ID; the hourly incremental digest and custom persona remain outstanding work, recorded in the root requirement alignment document.

The upstream feature set and existing preset tool restrictions remain available. Persona text is now user-managed; the root `persona:apply` helper synchronizes manual edits into the loaded chat bundle while preserving other preset settings. No new Policy Layer, Owner coding workflow, or final Flash/Flagship routing was introduced.

Subsequent reliability work adds a SQLite intake/request/digest journal, hourly incremental digest worker, source references for memory/notes, non-dropping durable turn batching, and bounded/streamed media work. Follow-up text uses normal durable batches rather than volatile tool-response interception. See the root `docs/RELIABILITY_AND_DIGEST.md` for guarantees and remaining gaps.

Later YunoDSH changes add Debian/systemd lifecycle helpers, expanded console settings, a channel-only mention/reply media policy that preserves DM ingestion, and emoji indexing fixes for inherited DSH model selection and duplicate emoji names. The Harness implementation remains an npm dependency rather than a vendored source fork.
