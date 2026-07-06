# AGENTS.md

## Direction

This repository is `Personality Escape Station`, a productized fork of MIT-licensed WorldX.

Keep the project focused on:

- `client/src/personality`: the H5 product.
- `server/src/api/routes/personality.ts`: minimal personality room API.
- `worker/src`: Cloudflare Worker API and Minimax Agent chat runtime.
- `client/public/personality-assets/fixed`: retained fixed game assets.
- `generators`: retained image-generation foundation for vertical maps, protagonists, interactive agents, and props.

Do not reintroduce old WorldX frontend, simulation runtime, funeral/mourner mode, demo worlds, or old product docs. Cloudflare Worker deployment should remain game-first and must not expose a user-facing image-generation UI unless explicitly requested.

## Generation Modes

First mode:

- Fixed questionnaire result maps to one of 12 reusable personality asset sets.
- Maps are 9:16 portrait.
- Generated assets are retained as reusable assets.

Future mode:

- Every user's questionnaire and optional one-sentence prompt can generate a real-time room variant.

## Search

Try `mcp__fast_context__fast_context_search` first for exploratory code search. If it fails because the Windsurf API key is missing, use `rg`.

## Verification

Run after product, scoring, API, generator, or Worker changes:

```bash
npm run verify:personality
npm run typecheck:client
npm run typecheck:worker
cd server && npm run typecheck
```
