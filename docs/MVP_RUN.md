# Local DM MVP

The configured group channel also accepts its configured `discord.keywordTriggers` phrases as directed messages. Matching is case-insensitive; Latin words require word boundaries. Other channels retain their existing mention rules. Self-blacklisted users' keyword-only messages do not trigger the bot.

The current test is restricted to the configured owner's DMs. Guild/channel allowlists remain empty and Message Content Intent is disabled for this DM-only run. The bot must share a Discord server with the user for normal bot DMs; shared server membership does not enable server conversations in this bridge.

The user manages model credentials and the `dc-chat` persona. The current local login link is in ignored `state/MVP_ACCESS.md`. Normal project initialization preserves an already-mounted Discord preset bundle; source preset refresh is explicit with `npm run project:init -- --refresh-presets`.

Discord's bot token is in the ignored root `.env`. Local DSH cookie authentication is automatic. Do not put the DSH-reserved `DSH_AUTH_TOKEN` name in that file; an optional bridge-only override uses `BRIDGE_DSH_AUTH_TOKEN`. The legacy starter entry was renamed without displaying or altering its value.

## Slow DM / transport failure fix

The first live attempt exposed two separate issues:

- DM batching inherited the 20-second guild debounce. DMs now use a configurable 1,200 ms debounce and 3,000 ms maximum batching wait, and start the typing indicator after their pending marker is saved. Guild batching retains its prior settings. Model execution and an already-running turn can still add latency.
- DSH was launched in a restricted environment that could not make outbound TLS requests (`EACCES`). A credential-free host check reached `https://api.deepseek.com/models` and received HTTP 401, proving reachability without exposing a key. Both DSH and the bot were restarted with host network access. Their stdout/stderr logs and launcher PIDs are under ignored `state/mvp-*` files.

These changes preserve saved DSH credentials, persona settings, and Session state. Latest validation: 34/34 Discord scripts pass, the DM timing regression passes, and the live DSH no-model smoke passes. The user subsequently confirmed that the live DM reply works. This confirms the basic text path; group, media, memory, digest and failure-recovery acceptance are separate checks.

The remaining architecture/deployment gaps are set aside for this MVP run at the user's request.

## Repeated research compaction fix

The live Session journal confirmed overlapping inherited triggers: the dc-chat DSH preset used `thresholdRatio: 0.08`, while the bridge separately issued `/compact` after a turn exceeded 80,000 reported total tokens. One research turn crossed about 85,325 tokens and triggered native compaction; another large fetched result then left the final request at 83,580 tokens, triggering bridge compaction roughly 50 seconds after the first started.

The preset source and mounted bundle now use `thresholdRatio: 0.8`, matching DSH's normal model-window threshold. The effective trigger is still capped by DSH's output reservation and headroom calculation. The existing `retainTokens: 10000` setting was preserved. Bridge `autoCompactTokens` now defaults to 0 and is disabled in the local configuration; explicit fixed-threshold overrides remain available if deliberately configured.

Only compaction fields changed. The preset persona and profile overrides were not regenerated or reset. Both services were restarted after the completed research turn; effective DSH configuration and the Session lifecycle smoke were verified. Compaction remains available natively and manually through `/compact`.

## Applying manual persona edits

The Discord config and persisted DM Session both select `dc-chat`. Its load path is:

```text
apps/discord/dsh/agent-presets/dc-chat/agent.cordis.yml
  -> apps/discord/plugins/dc-agent-presets/presets/dc-chat.patch.yml
  -> state/dsh/plugins/dc-agent-presets (junction to the application bundle)
  -> state/dsh/profiles/web (dc-agent-presets bundle)
  -> dc-chat Agent composition
```

The human-edited source is not itself the file DSH loads. An observed edit left 18,430 characters in the source while the loaded bundle still had 18,009. The Session's latest historical system message matched that older bundle. The edited source was synchronized without changing its text or other preset configuration, DSH was reloaded, and the live `agentPresets/read` response now matches the edited source.

For subsequent source-file edits:

```powershell
.\scripts\dev.cmd persona:apply
```

This backs up the previous bundle under ignored `state/preset-backups/`, checks that only persona configuration differs, and rebuilds only the chat preset bundle. It refuses unrelated tool/config changes. Reload DSH before the next request to ensure an existing Session uses the update; conversation files do not need to be reset. Initialization also warns when the source file is newer than its loaded bundle.

Historical `system/message` records are immutable evidence of earlier requests. They do not change retroactively after a persona edit; inspect the next request's system message to verify the newly applied text. A saved DSH profile override, when used, can take precedence over the source bundle and is intentionally preserved by this helper.

## Hard reload commands

The complete operator reference is [Reloading the Discord Agent](RELOAD_OPERATIONS.md). The short command reference is below.

Run from the project root in a normal Windows terminal after the current reply has finished:

```powershell
# Apply a source persona edit and restart DSH:
.\scripts\dev.cmd persona:reload

# Restart DSH without rebuilding the persona:
.\scripts\dev.cmd dsh:restart
```

The restart helper targets only the managed background DSH launcher recorded in `state/mvp-dsh-launcher.pid`. It verifies the process belongs to this workspace before stopping its process tree, refuses a reused/mismatched PID, restarts hidden with local log files, and refreshes `state/MVP_ACCESS.md`. The Discord bridge remains running and reconnects. Conversation/profile/credential files are retained. A hard restart can interrupt active inference, so wait for an idle moment.

`/reload-system-prompt` in Discord is a different operation: it summarizes the current conversation into a handoff and starts a new Session. `/reset` starts a fresh conversation without that handoff. Neither command rebuilds the source preset or restarts the DSH process.
