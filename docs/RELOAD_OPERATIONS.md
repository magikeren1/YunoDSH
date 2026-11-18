# Reloading the Discord Agent on Debian

This guide uses the systemd deployment at `/opt/yunodsh`, running as the `yunodsh` service account. The checkout at `/root/YunoDSH` is separate; edit the deployed files under `/opt/yunodsh` for changes to take effect. Wait for the current reply to finish before restarting a service: a restart can interrupt an active request.

| Operation | Use when | Effect on conversation |
| --- | --- | --- |
| `/reload-system-prompt` | You want a fresh prompt boundary in Discord | Summarizes the current conversation into a handoff and starts a new Session |
| Apply persona and restart DSH | You edited the `dc-chat` persona source | Keeps existing DSH state and Sessions |
| Restart DSH | DSH or its configuration needs a restart | Keeps existing DSH state and Sessions |
| `/reset` | You want a new conversation without a handoff | Prior conversation is not carried into the new Session |

## Reload in Discord

Send `/reload-system-prompt` in the owner DM to create a new Session with a summary of the current conversation. Details omitted from the summary may no longer be available as turn-by-turn context. This does not rebuild the persona bundle or restart DSH. Use `/reset` if the old conversation should not influence the new one.

## Apply a persona edit

Edit `/opt/yunodsh/apps/discord/dsh/agent-presets/dc-chat/agent.cordis.yml`, then run:

```sh
cd /opt/yunodsh
sudo -u yunodsh ./.tools/node-v26.13.1-linux-x64/bin/node scripts/apply-persona.mjs
sudo systemctl restart yunodsh-dsh.service
```

The first command validates the change and updates the mounted persona bundle, backing up the previous bundle under `state/preset-backups/` when it changes. If validation fails, review the reported differences before restarting. The second command restarts DSH while the Discord bridge remains running and reconnects. Profiles, credentials, and conversation files are preserved. The next request should use the updated persona; historical system messages remain unchanged.

To restart DSH without applying a source edit:

```sh
sudo systemctl restart yunodsh-dsh.service
```

## Stop and start

Stop the bridge first, then DSH:

```sh
sudo systemctl stop yunodsh-discord.service
sudo systemctl stop yunodsh-dsh.service
```

Start DSH and the bridge again:

```sh
sudo systemctl start yunodsh-dsh.service
sudo systemctl start yunodsh-discord.service
```

These commands preserve configuration and state. Stopping a service does not disable its startup at boot. Starting the services does not by itself prove that Discord login or model requests work; check the logs below. Manage this deployment with systemd rather than the separate background launcher scripts.

## Bot presence

Run the interactive presence helper as the service account:

```sh
cd /opt/yunodsh
sudo -u yunodsh ./.tools/node-v26.13.1-linux-x64/bin/node scripts/bot-status.mjs
sudo systemctl restart yunodsh-discord.service
```

Choose `online`, `idle`, `dnd`, or `invisible` and optional custom status text. The helper's printed Windows launcher instructions do not apply to this systemd deployment. Presence applies across servers and takes precedence over model-set status; `invisible` does not stop the bot.

## Channel image analysis cost trial

`discord.media.requireMentionInGuild: true` limits server-channel image and video analysis to messages that explicitly mention or reply to the bot. Image-only posts without either do not open a chat turn; captions still participate as text. The restriction also covers link previews and `view_message` media in unsolicited turns. Keyword triggers and the follow-up window do not authorize media. DMs retain their existing media behavior and limits.

The bridge console's feature settings expose `media.requireMentionInGuild`. Turn it off and save to restore automatic channel media ingestion without restarting. When editing `config.json` directly, restart `yunodsh-discord.service` after saving. Existing images already in DSH conversation history remain there; this switch controls new ingestion. Hourly text digests and slang learning retain their own schedules.

## Status and logs

```sh
sudo systemctl status yunodsh-dsh.service yunodsh-discord.service
sudo journalctl -u yunodsh-dsh.service -u yunodsh-discord.service --no-pager -n 100
```

To follow new bridge logs, use `sudo journalctl -u yunodsh-discord.service -f`. DSH's authenticated browser URL is in its journal; it contains a secret token. Do not share it, bot tokens, cookies, or private Session logs. DSH listens on `127.0.0.1:3080`; use an SSH tunnel for access from another computer. See [Debian deployment](DEBIAN.md) for configuration and backups.
