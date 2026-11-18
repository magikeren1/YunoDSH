# Implementation boundary

This directory is reserved for shared project integration code. The first runnable Discord application is maintained in `apps/discord/`; local DSH orchestration lives in `scripts/project.mjs`.

Reuse the pinned dc-bridge implementation and DSH runtime before introducing new modules. The first implementation work is adapter compatibility and reliable Discord intake. Shared Discord identity types and durable request identity should be proposed from those existing interfaces rather than finalized during initialization.

User memory, channel notes, digest checkpoints, model routing, and Owner coding remain in scope for subsequent work. Topology and the deferred Policy Layer remain undecided.
