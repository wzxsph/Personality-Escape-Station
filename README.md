# Personality Escape Station

Personality Escape Station is a mobile-first personality test and vertical pixel-room experience. Users answer a fixed 10-question test, receive a shareable pixel identity card, and enter a 9:16 personality room with props, NPC/Agent interactions, fragments, and visit links.

This project is derived from the MIT-licensed WorldX project, but it is no longer the old WorldX frontend or demo-world runtime. The current product keeps the useful generation foundation and rebuilds it around `人格出逃空间站 / Personality Escape Station`.

[中文说明](./README_ZH.md)

## Product Origin

The product concept and early questionnaire framework were primarily co-created by the "Life Again" team at Douyin AI Creator Program, Haidian Station 2 (`抖音 AI 创变者计划海淀二站「人生再活一次」团队`). This repository turns that concept into an open-source web product with personality scoring, vertical rooms, reusable generated assets, and Agent interactions.

## Current Status

- Product name: `人格出逃空间站 / Personality Escape Station`.
- Recommended repository name: `personality-escape-station`.
- Fixed MVP mode is implemented: questionnaire result -> one of 12 reusable personality rooms.
- The fixed asset library is generated under `client/public/personality-assets/fixed`.
- Generated fixed assets are intentionally kept in the repository so the fixed MVP can run without calling image-generation APIs.
- All 12 archetypes currently have manifests, vertical maps, TMJ collision data, walkable grids, player frames, props, and Agent images.
- Maps use deterministic `composite-v1` layout: AI does not control collision or hotspot reachability.
- Player frames use an MVP-safe procedural 8-direction fallback when image models produce unreliable 8x8 sheets.
- Future mode: use questionnaire data and an optional user sentence to generate personalized room variants.

## Product Flow

- `/`: product home.
- `/quiz`: 10-question personality escape test.
- `/result`: identity card and share poster.
- `/space`: current user's personality room.
- `/space?visit=<archetypeId>&owner=<name>`: visit another room.

## Gameplay

1. Answer 10 short questions to get one of 12 personality archetypes.
2. Receive a pixel identity card that can be saved or shared.
3. Enter a portrait personality room with an 8-direction player character.
4. Walk around the room, approach props or Agents, and trigger short interactions.
5. Collect personality fragments and share a visit link so other players can enter your room.

## Screenshots

Captured from the local running app at `http://localhost:3200`.

<p align="center">
  <img src="./docs/media/personality-home.png" alt="Personality Escape Station home screen" width="260" />
  <img src="./docs/media/personality-space-bedx.png" alt="BEDX personality room" width="260" />
</p>

## Asset Library

Fixed assets are retained in the public client asset library:

```text
client/public/personality-assets/fixed/<archetype>/
  manifest.json
  room-design.json
  system-prompt.md
  map/background.png
  map/map.tmj
  map/walkable-grid.json
  map/navigation-template.png
  map/room-layout.json
  map/style-pack.json
  player/frames/frame_000.png ... frame_063.png
  player/frames/metadata.json
  player/prompt.md
  agents/<agentId>/image.png
  agents/<agentId>/metadata.json
  agents/<agentId>/prompt.md
  agents/<agentId>/system-prompt.md
  props/<propId>/image.png
  props/<propId>/metadata.json
  props/<propId>/prompt.md
```

Archetype IDs:

```text
BEDX GONE SIDE SPRK F1SH NOCT UNDO MUT8 BUFR JANK FINE GL1T
```

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3200
```

The dev script starts:

- client: `http://localhost:3200`
- server: `http://localhost:3100`

Stop dev servers:

```bash
npm run stop
```

The fixed questionnaire and room browsing flow does not require model keys. Asset generation and LLM dialogue require local `.env` model configuration. Do not commit real API keys.

## Asset Generation

Use the product-level command:

```bash
npm run assets:generate
```

Useful variants:

```bash
npm run assets:generate -- --all --dry-run
npm run assets:generate -- --archetype BEDX
npm run assets:generate -- --all --only map --force
npm run assets:generate -- --all --skip-player --skip-verify
npm run assets:generate -- --all --only player --force --procedural-player
npm run assets:generate -- --archetype JANK --only hotspot:jank-magnifier --force
```

Notes:

- Runs are resumable. Completed assets are reused unless `--force` is used.
- `--dry-run` writes prompts and draft manifests without image API calls.
- `--skip-player` is useful when image models are unstable but maps, props, and Agents should still be generated.
- `--procedural-player` creates deterministic 8-direction player frames without calling the image API.
- The legacy whole-image map pipeline is retained only for experiments; fixed rooms should use `composite-v1`.

## Verification

```bash
npm run verify:personality
npm run verify:fixed-assets:strict
npm run typecheck:client
cd server && npm run typecheck
cd client && npm run build
```

`verify:fixed-assets:strict` checks all fixed manifests, map dimensions, TMJ collision, walkable-grid topology, hotspot reachability, player frame metadata, props, and Agent images.

## Server Interfaces

- `POST /api/personality/score`
- `POST /api/personality/rooms`
- `GET /api/personality/rooms/:roomId`
- `POST /api/personality/rooms/:roomId/events`
- `PATCH /api/personality/rooms/:roomId/events/:eventId`
- `POST /api/personality/dialogue`

Room event types: `gift`, `light`, `message`, `fragment`.

Dialogue uses an OpenAI-compatible chat endpoint when configured. Replies are cleaned before display to remove reasoning tags such as `<think>` and to enforce short response limits.

## Project Layout

```text
client/src/personality/        H5 product source
client/public/personality-assets/fixed/
                               retained 12-room fixed asset library
server/src/                    Express API and SQLite persistence
generators/personality/        fixed personality asset pipeline
generators/map/                retained map-generation experiments
generators/character/          retained character/prop image pipeline
scripts/generate-assets.mjs    product-level asset generation command
```

## License

MIT. This project is derived from the MIT-licensed WorldX project and keeps the license in [LICENSE](./LICENSE).
