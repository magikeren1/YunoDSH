# YunoDSH bridge contributor notes

Discord is the maintained application; QQ is retained upstream reference code. Runtime, credentials, sessions, and generated media belong outside version control.

Run the project with Node 26.x. From the repository root, use `npm run check` and `npm run test:discord`. Some offline checks use local HTTP servers and subprocesses. Persona changes should be validated with `node apps/discord/scripts/test-preset-prompt.mjs` and `node apps/discord/scripts/build-agent-preset-patches.mjs --check`.

For Debian deployment, follow the root `docs/DEBIAN.md` and `docs/RELOAD_OPERATIONS.md` with your own host, service account, and paths. Inherited upstream PM2 deployment helpers are references, not this fork's default deployment workflow. Do not run `git clean` against a live installation or commit private state.

When inspecting console UI changes, use the offline fixture described in `docs/guides/CONSOLE-UI-TESTING.md`. The upstream console UI suite has two known failures: exact payload baseline matching and the token trend chart range/metric checks; investigate additional failures.

See the root `docs/UPSTREAM.md` for source provenance. DSH is installed as an npm runtime; a Harness source fork is not required.
