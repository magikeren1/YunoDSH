# Third-party notices

YunoDSH derives its bridge implementation from [konnokai/dc-bridge](https://github.com/konnokai/dc-bridge), originally based on [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge). The source baseline is recorded in [docs/UPSTREAM.md](docs/UPSTREAM.md) and `upstream.lock.json`.

The original MIT copyright notice is retained in the root [LICENSE](LICENSE). The inherited, extended notice remains unchanged in [apps/discord/LICENSE](apps/discord/LICENSE); historical QQ/SnowLuma descriptions there concern retained upstream components and do not describe the Discord-only deployment as a whole.

DeepSeek Harness is installed as the external `@deepseek-ai/dsh` npm dependency. Its source repository is [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). YunoDSH does not include a fork of that implementation. Each npm dependency keeps the license distributed with its package; dependencies and downloaded runtime binaries are not committed here.

Character reference assets have separate attribution and terms in [characters.json](apps/discord/assets/ai-chan-sheets/characters.json) and the accompanying asset README. The code's MIT license does not replace those asset terms. Preserve those files when reusing the assets.

FFmpeg/FFprobe and optional external services are installed separately. Their binaries and private configuration are not part of the source publication.
