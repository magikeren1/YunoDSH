# Debian deployment

This guide applies to the Discord bridge and DSH on the same Debian host. The project requires Node 26.x, npm, FFmpeg and FFprobe; Git is needed for checkout and the reference-source doctor checks. The root and Discord application use separate lockfiles. Install both without lifecycle scripts, as in the upstream development setup:

```sh
npm ci --ignore-scripts
npm ci --prefix apps/discord --ignore-scripts
npm run project:init
```

Run these commands from the project root as the account that will run the services. `project:init` preserves existing `.env`, Discord configuration and installed preset settings; it creates the local DSH profile under `state/dsh`. DSH's plugin links point into this checkout, so do not move the checkout after initialization without checking and rebuilding those links. Keep the checkout, state, and `.env` accessible to the service account and restrict access to that account: state includes credentials, private conversations, and the DSH browser login token. Back up `state/`, `apps/discord/state/`, `apps/discord/config.json`, `.env`, and any edited persona source before upgrades or migration.

`npm run doctor:deployment` requires the expected Node major version, installed DSH version, and FFmpeg/FFprobe. Optional reference Git checkouts are not runtime dependencies. `node scripts/doctor.mjs --references` verifies those checkouts when maintained for research; see [upstream provenance](UPSTREAM.md). A passing doctor check does not test Discord, model credentials, or host capacity.

## Configure the accounts

Edit `.env` privately and set `DISCORD_TOKEN`; edit `apps/discord/config.json` to set `discord.ownerIds` and the intended `discord.allow` user, channel, and guild IDs. IDs are strings. Empty allowlists are not an unrestricted configuration. Set the bot's Discord intents and permissions to suit the chosen scope, following [Discord v1](DISCORD_V1.md). Initialization does not supply credentials or choose a provider/model.

Start DSH to configure its provider and credentials:

```sh
npm run dsh:start
```

The printed authenticated URL is sensitive. DSH listens on `127.0.0.1:3080`; for a remote host, forward that port over SSH and open the resulting local URL in a browser. Keep the token from the printed URL. The bridge console also defaults to loopback, port 3110. Avoid exposing either listener directly to the Internet.

With DSH running, run `npm run dsh:smoke` in another shell for the local no-model checks. Once configured, `npm run discord:start` starts the bridge in the foreground. Verify a real Discord conversation with the chosen provider; an initialized profile and passing offline tests do not prove this works. Stop foreground processes with Ctrl-C. The optional PRTS service, image-generation dependency, and Docker sandbox are not installed or enabled by this guide.

## Operations and validation

After a source persona edit, `npm run persona:apply` updates the generated preset bundle while preserving the current profile; reload DSH before the next request. Restarting DSH may interrupt an active reply. Keep a backup before changing profiles or upgrading. The full release still needs live group/media/digest and restart recovery tests and actual CPU, memory, disk, and backlog measurements on the target host; see [release gaps](RELEASE_GAPS.md).

## Supervision with systemd

The templates in `deploy/systemd/` start DSH and the bridge separately, restart failed processes, and start DSH when the bridge starts. Configure the Discord token and allowlists before enabling the bridge. Install both templates as `/etc/systemd/system/yunodsh-dsh.service` and `/etc/systemd/system/yunodsh-discord.service`, replacing the placeholders with the absolute checkout path, Node executable, Node bin directory, and service account. On this device the checkout is `/root/YunoDSH`, so only root can traverse it; a dedicated service account requires a checkout in an accessible directory with ownership and permissions set before initialization. The account needs write access to the checkout's state, config, and preset files.

After rendering both units, review them and run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now yunodsh-discord.service
sudo systemctl status yunodsh-dsh.service yunodsh-discord.service
sudo journalctl -u yunodsh-dsh.service -u yunodsh-discord.service
```

DSH's journal contains its authenticated browser URL; restrict journal access accordingly. Use `sudo systemctl restart yunodsh-dsh.service` to reload DSH after applying a persona edit, or restart the Discord unit after bridge configuration changes. Use `sudo systemctl stop yunodsh-discord.service yunodsh-dsh.service` to stop both. Manage these services with systemd consistently; do not run the separate background launch helpers alongside them. `After=` controls startup order, not application readiness, so verify both service status and logs after launch.

## On-demand video review

Ask DSH to review a YouTube or Bilibili link in Discord, or name a time range such as “look closely at 1:10–1:35.” The `review_video` tool returns up to three timestamped contact sheets with eight sampled frames each. For long videos it spreads the sheets across the requested span. `discord.videoLinks.enabled` and the Discord media permission settings apply.

The tool uses available subtitles and falls back to local Whisper speech recognition. Install `whisper-cli` and a multilingual model to enable the fallback. The bridge looks for `.tools/whisper/bin/whisper-cli` and `.tools/whisper/ggml-tiny-q5_1.bin` from the project root. `WHISPER_PATH` and `WHISPER_MODEL` in `.env` can point to other absolute paths. Audio is transcribed in segments of up to 180 seconds and the tool reports the next start time for longer selections.

Build `whisper-cli` from the [Whisper.cpp release](https://github.com/ggml-org/whisper.cpp/releases) and download the [multilingual model](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny-q5_1.bin). Make both files readable by the service account and give the CLI execute permission. Refresh the Discord DSH profile with `node scripts/project.mjs init --refresh-presets` as the service account, then restart DSH and the Discord bridge to load the tool.
