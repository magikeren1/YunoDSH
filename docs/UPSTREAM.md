# Upstream provenance and fork maintenance

YunoDSH is a modified Discord bridge derived from [konnokai/dc-bridge](https://github.com/konnokai/dc-bridge). The original bridge source used here is commit [`a393a5bc557f26277e41c1309b60b481cfd3bec8`](https://github.com/konnokai/dc-bridge/tree/a393a5bc557f26277e41c1309b60b481cfd3bec8). The upstream bridge also retains its lineage from [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge).

## Source boundaries

| Component | Relationship to YunoDSH |
| --- | --- |
| `konnokai/dc-bridge` | Fork source. Its application was moved under `apps/discord/` and modified. |
| `deepseek-ai/deepseek-harness` | External agent runtime. Installed from the pinned `@deepseek-ai/dsh` npm package, not vendored or forked here. |
| `apps/discord/dsh/agent-presets/` | Bridge-owned DSH preset configuration. These files are part of the integration. |
| `apps/discord/plugins/` | Bridge-owned plugin integration and retained upstream plugins. |
| `upstream.lock.json` | Historical source-review revisions. These references do not imply that either upstream checkout is required to run YunoDSH. |

The runtime is pinned in the root `package.json` and `package-lock.json`; the original Harness research revision in `upstream.lock.json` is a reference, not another source tree to distribute. `node_modules/`, optional `upstream/` research clones, downloaded tools, and private state are excluded from Git.

## Notable bridge changes

- A project-local DSH profile and pinned npm runtime, with initialization and lifecycle helpers.
- A persistent SQLite intake/request/digest journal and recovery checks.
- Hourly incremental channel summaries, source references, and bounded media work.
- User-managed persona synchronization and Debian/systemd deployment templates.
- Separate channel image-analysis controls that preserve DM ingestion.
- Emoji indexing that inherits the configured DSH model and preserves distinct Discord emoji IDs when names are duplicated.

See [SOURCE_ORIGIN.md](../apps/discord/SOURCE_ORIGIN.md) and the [reliability notes](RELIABILITY_AND_DIGEST.md) for details and limits. Older handover/review documents describe historical decisions; they are not a claim that every planned capability has shipped.

## Comparing upstream changes

Keep `origin` pointed at your YunoDSH repository and add the bridge as `upstream`:

```sh
git remote add upstream https://github.com/konnokai/dc-bridge.git
git fetch upstream
git log --oneline a393a5bc557f26277e41c1309b60b481cfd3bec8..upstream/main
git diff a393a5bc557f26277e41c1309b60b481cfd3bec8 upstream/main -- src scripts plugins dsh
```

Read the upstream changes before applying them. Upstream application paths correspond to `apps/discord/<path>` here, so merging the current upstream tree directly would reintroduce its old root layout. Port selected changes to the maintained application, review shared imports, and run its regression suite. Do not copy production configuration or runtime state between checkouts as part of a source update.

The publication branch is prepared from the recorded bridge commit so Git ancestry records the actual source baseline. Later upstream commits are not implicitly included. There is no need to create a fork of the official Harness repository.

## Validation and publication

Run the offline checks from the project root:

```sh
npm run check
npm run test:discord
```

Verify that the publication contains no `.env`, live `config.json`, backup copies, DSH credentials, session logs, channel/user memory, generated media, or dependency directories. Public examples belong in `.env.example` and `apps/discord/config.example.json`.

Retain the upstream source license, inherited notices, and separate asset attributions when moving or updating files. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
