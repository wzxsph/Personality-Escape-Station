# Personality Asset Generators

This folder is the retained WorldX image-generation foundation.

The product target is now `Personality Escape Station`, not the old WorldX runtime. Generated assets should be reusable and kept as a fixed asset library first:

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
  player/prompt.md
  agents/<agentId>/image.png
  agents/<agentId>/prompt.md
  agents/<agentId>/system-prompt.md
  props/<propId>/image.png
  props/<propId>/prompt.md
```

## Entry Points

Run these commands from the repository root:

```bash
npm run assets:generate
npm run assets:generate -- --archetype BEDX
npm run assets:generate -- --all --only map --force
npm run assets:generate -- --all --skip-player --skip-verify
npm run assets:generate -- --all --only player --force --procedural-player
npm run assets:generate -- --all --dry-run
```

`assets:generate` is the product-level command. With no flags it publishes all fixed personality assets to `client/public/personality-assets/fixed` and then runs strict verification. It reuses completed assets by default, so interrupted runs can be resumed without starting from scratch. Add `--force` only when you intentionally want to regenerate the selected scope.

Use `--skip-player` when the image model is producing unreliable 8x8 player sheets but you still want to publish maps, props, Agent images, prompts, and manifests for every room.

Use `--procedural-player` to generate deterministic 8-direction player frames without calling the image API. This is the MVP-safe fallback when image models keep drawing off-grid or cropped 8x8 sheets.

The lower-level generator is still available for debugging:

```bash
npm run generate:fixed-assets -- --all --dry-run
npm run generate:fixed-asset -- --archetype BEDX --publish
npm run generate:fixed-assets -- --all --publish
```

`--dry-run` does not call image-generation APIs. It writes prompt previews, `room-design.json`, `system-prompt.md`, hotspot prompts, and draft manifests to `output/personality-assets/dry-run`.

`--publish` writes the retained fixed asset library to `client/public/personality-assets/fixed/<archetype>`. Without `--publish`, real generation writes to `output/personality-assets/runs/<runId>/fixed`.

## Map Generation Strategy

The fixed-personality MVP uses `composite-v1` as the default map path. This is deliberate: whole-map image generation is not stable enough to guarantee playable collision, hotspot reachability, and repeatable 9:16 room topology.

`composite-v1` works like this:

1. Build a deterministic `45x80` navigation grid from `worlds.ts`.
2. Publish `navigation-template.png` and `room-layout.json` as inspectable layout contracts.
3. Build `style-pack.json` from the archetype mood and palette.
4. Programmatically composite `background.png` with Sharp from the layout, palette, floor mask, blocked mask, landmark, decorations, trims, and lighting.
5. Write `map.tmj` and `walkable-grid.json` from the same deterministic grid.

The useful trick is that AI no longer owns the final topology. Future AI calls should generate small replaceable style assets, such as floor texture tiles, wall texture tiles, landmark cutouts, props, agents, and player sheets. The compositor places them into a deterministic room.

The old WorldX whole-image map pipeline is retained only as an experimental/diagnostic mode:

```bash
MAP_GENERATION_MODE=whole-image npm run generate:fixed-asset -- --archetype BEDX --publish --only map --force
```

When used, whole-image generation is checked against the template and can fail safely. It should not be the default for fixed rooms.

Rules for the first production pipeline:

- Maps are vertical, 9:16, and normalized to the H5 room stage (`900x1600`).
- Assets are retained for later reuse; they are not temporary cache files.
- First mode: fixed questionnaire result -> one of 12 fixed personality rooms.
- Future mode: every user's questionnaire and optional sentence can generate a real-time room variant.
- Old WorldX frontend, simulation, funeral, mourner, and demo-world assumptions should not leak into prompts or output schemas.
- The map output uses `tileSize=20`, `45x80` walkable grid, and a `map.tmj` collision layer.
- Fixed room maps default to `generationMode: "composite-v1"`.
- The frontend loads `manifest.json` first and falls back to legacy fixed assets only while new assets are missing.
- The player is generated as an 8-direction `8x8` walking sheet. It is then split mathematically into `64` retained PNG frames.
- Agent and prop assets are single-frame PNGs for MVP stability.

## Player Model Override

Character, map, Agent, and prop generation share `IMAGE_GEN_*` by default. The player sheet can use a stricter model without changing the rest of the pipeline:

```bash
PLAYER_IMAGE_GEN_PROVIDER=openai-images
PLAYER_IMAGE_GEN_BASE_URL=https://draw.openai-next.com/v1
PLAYER_IMAGE_GEN_MODEL=gpt-image-2
```

The fixed-asset pipeline passes these values to the character generator only for `--only player` / player generation. `--force` keeps a backup of the previous player asset folder and restores it if the new generation fails quality checks.
