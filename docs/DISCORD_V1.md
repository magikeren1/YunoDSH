# Discord v0.1.0 and local DSH

This is a runnable integration baseline, not complete handover acceptance. The [requirement alignment review](REQUIREMENTS_ALIGNMENT.md) records the user's choices. [Intake recovery and digest implementation](RELIABILITY_AND_DIGEST.md) describes the subsequently added journal, hourly incremental digest, source references and resource controls. Real Discord/model validation remains pending.

DSH runtime: npm `@deepseek-ai/dsh@0.2.2-rc.2`, exactly pinned in the root package and lockfile. Its release version matches the audited Harness checkout; the runtime uses published artifacts rather than building the whole monorepo on the target machine. Discord source origin and local changes are recorded in `apps/discord/SOURCE_ORIGIN.md`.

## Local initialization and launch

From the project root on Windows:

```powershell
.\scripts\dev.cmd project:init
.\scripts\dev.cmd dsh:start
```

The initializer preserves existing `.env` and `apps/discord/config.json`. It creates DSH's `web` profile and mounts the dc-chat, dc-learner, and dc-trader preset bundle. All DSH profile, credential, and Session state lives under ignored `state/dsh/`, separate from the user's global DSH home. Discord state stays under ignored `apps/discord/state/`.

DSH listens only on `127.0.0.1:3080`; its terminal prints the authenticated browser URL. Use that local URL to configure the chosen model/provider. No API or bot credentials are needed to initialize, boot the UI, or run the no-model smoke checks.

In another terminal, with DSH running:

```powershell
.\scripts\dev.cmd dsh:smoke
.\scripts\dev.cmd test:discord
```

The smoke checks authenticate locally, verify preset registration, create/read/cancel/archive a test Session, and make no model request.

## First real Discord conversation

Add `DISCORD_TOKEN` to the root ignored `.env`. Add model credentials through DSH's UI or the selected provider's supported environment variable. If environment credentials change, restart DSH. No specific model ID or provider is imposed by this project; blank bridge overrides use the DSH default.

Edit ignored `apps/discord/config.json` to set the actual `discord.ownerIds` and intended test guild/channel/user allowlists using string IDs. The copied bridge's `allowAllWhenEmpty: false` is retained, so empty allowlists do not enable unrestricted chat. Owner IDs are used by the existing bridge checks; DM transport alone does not grant Owner identity.

Enable the Message Content Intent for the bot in Discord's developer settings when using the default `messageContentIntent: true`, and invite the bot with the permissions/scopes described by the retained Discord guide. Then:

```powershell
.\scripts\dev.cmd discord:start
```

This command uses `.env`, workspace-local DSH state, and the local FFmpeg/FFprobe PATH. It refuses a live launch with a clear message when no bot token is present. Token validation and a real Discord conversation have not been tested without account credentials.

## Current feature and dependency boundaries

- Gateway intake, batching, turn gating, mapping, tools, questions/approvals, media, user memory, notes, and other upstream modules are retained. Personal memory and channel notes are enabled in the project baseline after the requirement alignment review; other optional features keep their existing switches.
- The project uses an hourly incremental digest with persisted source windows, retries and idempotent note export. The retained daily sampler is a separate legacy option.
- PRTS's HTTP MCP entry remains in the generated profile but is explicitly disabled until its external service is installed. It is not started by initialization. Image generation's separate `dsh-generate-image` dependency is not installed; startup reports that absence. The script sandbox remains optional and requires Docker if enabled.
- The upstream persona is retained for this first runnable baseline. Persona customization, Owner coding, exact Flash/Flagship routing, and topology decisions remain follow-up work.
- Journaled pending inputs and prepared prompt identities now survive restart. Durable Discord output catch-up and Gateway downtime backfill remain separate gaps; see the implementation document for exact recovery boundaries.
- DSH still has the audited Web model-selection saved-default side effect. A bridge model override is not a complete per-user routing design.
- No systemd service, VPS deployment, or 1 GB resource qualification has been performed.

## Validation performed

- Clean audited source snapshots and local runtime/media prerequisite checks.
- Complete Discord offline suite: 30/30 scripts passed, including the new lost-ACK identity regression.
- Preset source/patch consistency and preset prompt tests passed.
- Event mux reconnect regression passed.
- Inbox projection tests: 12/12 passed.
- Live DSH authentication checks: 20 passed, 0 failed; registered dc-chat, dc-learner, dc-trader alongside standard presets.
- Live DSH Session lifecycle smoke passed without model inference.

These results do not substitute for a real Discord-to-model round trip, fault-injection across process restarts, or target VPS measurements.
