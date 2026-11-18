# YunoDSH

A customized Discord bridge for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness), derived from [konnokai/dc-bridge](https://github.com/konnokai/dc-bridge).

This repository maintains the bridge, MCP tools, presets, console, tests, and deployment helpers. DSH provides the agent runtime through the pinned `@deepseek-ai/dsh` npm dependency. The official Harness implementation is not vendored or forked here.

## Features

- Persistent channel and DM sessions, batching, and per-conversation turn gates.
- Journaled intake and request recovery, hourly incremental channel digests, user memory, and source references.
- Images, GIFs, stickers, and bounded video-frame processing with FFmpeg/FFprobe.
- `discord.media.requireMentionInGuild`: optionally require a mention or reply to the bot for channel image analysis while preserving normal DM ingestion.
- Saved custom emoji catalogs and occasional automatic reactions without a model call per automatic reaction. Building the catalog itself uses model calls.
- A local bridge console for sessions, usage, settings, memory, notes, and emoji management.
- Debian/systemd templates and Windows development helpers.

The historical QQ/OneBot implementation remains as upstream reference code; Discord is the maintained entry point.

## Quick start

Requirements: Node.js 26.x (development pin: 26.13.1), npm, FFmpeg, FFprobe, a Discord bot, and a DSH model provider.

```sh
git clone https://github.com/magikeren1/YunoDSH.git
cd YunoDSH
npm ci --ignore-scripts
npm ci --prefix apps/discord --ignore-scripts
npm run project:init
```

Edit the private `.env` and `apps/discord/config.json` created by initialization. Set `DISCORD_TOKEN`, owner IDs, and the intended user/channel/guild allowlists. Enable the required Discord intents. These files and all runtime state must stay out of Git.

Start DSH and configure its provider/model in its local web interface:

```sh
npm run dsh:start
```

In another terminal:

```sh
npm run dsh:smoke
npm run discord:start
```

DSH normally listens on loopback port 3080; the bridge console defaults to loopback port 3110. Authenticated browser links contain private tokens. See the [Debian guide](docs/DEBIAN.md) for systemd deployment and SSH access.

To limit channel image costs, enable `discord.media.requireMentionInGuild` in your local config or the bridge console. It defaults to `false` for compatibility. It does not change the DM media limits or behavior.

## Development

```sh
npm run check
npm run doctor:deployment
npm run test:discord
```

The doctor checks local prerequisites and the installed runtime. Optional source-review clones are not required; `node scripts/doctor.mjs --references` verifies them if you maintain copies. The Discord regression suite runs without a live Discord login or model inference, although some tests start local HTTP servers and subprocesses.

The 40-script Discord suite passed during November 2026 validation. Focused checks also cover DM preservation, channel media policy, emoji model inheritance, and duplicate emoji names. These checks do not prove exhaustive live recovery behavior or a particular server capacity; see [release gaps](docs/RELEASE_GAPS.md).

Windows users can use `scripts/dev.cmd` or `scripts/dev.ps1` with the corresponding command name. Downloaded tools under `.tools/` are local only.

## Layout

| Path | Contents |
| --- | --- |
| `apps/discord/` | Bridge application, MCP tools, presets, console, tests, and retained upstream components |
| `scripts/` | Initialization, lifecycle, validation, and persona synchronization |
| `deploy/systemd/` | DSH and bridge service templates |
| `config/` | Public templates and requirement/reference metadata |
| `docs/` | YunoDSH setup, operations, provenance, and validation notes |
| `upstream.lock.json` | Exact revisions used for the original source review |

`apps/discord/dsh/agent-presets/` is bridge configuration, not the official Harness implementation. Dependencies, credentials, sessions, channel history, memory databases, generated media, and local backups are excluded.

## Documentation and attribution

- [Upstream provenance and fork maintenance](docs/UPSTREAM.md)
- [Debian installation](docs/DEBIAN.md)
- [Restarts, persona changes, and channel media control](docs/RELOAD_OPERATIONS.md)
- [Recovery, digests, and source references](docs/RELIABILITY_AND_DIGEST.md)
- [Bridge feature reference](apps/discord/docs/guides/DISCORD.md)
- [Changes from the source baseline](apps/discord/SOURCE_ORIGIN.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

The source baseline is `konnokai/dc-bridge` commit `a393a5bc557f26277e41c1309b60b481cfd3bec8`, itself derived from `Derpyu520/qq-bridge`. Original notices are retained. See [LICENSE](LICENSE); assets and dependencies retain their own licenses and attributions.
