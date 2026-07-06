import type { WorldConfig, WorldHotspot } from '../data/worlds'

export const STAGE_WIDTH = 900
export const STAGE_HEIGHT = 1600
export const TILE_SIZE = 24

const pixelPointFromPercent = (x: number, y: number, width = STAGE_WIDTH, height = STAGE_HEIGHT) => ({
  x: (x / 100) * width,
  y: (y / 100) * height,
})

const buildHotspotObject = (hotspot: WorldHotspot) => {
  const center = pixelPointFromPercent(hotspot.x, hotspot.y)
  return {
    id: hotspot.id,
    name: hotspot.label,
    x: center.x - 34,
    y: center.y - 48,
    width: 68,
    height: 82,
    properties: [{ name: 'objectId', type: 'string', value: hotspot.id }],
  }
}

export const getStagePointFromPercent = (x: number, y: number) => pixelPointFromPercent(x, y)

export const buildStageMap = (world: WorldConfig) => {
  const gridWidth = Math.ceil(STAGE_WIDTH / TILE_SIZE)
  const gridHeight = Math.ceil(STAGE_HEIGHT / TILE_SIZE)
  const collisionGrid = Array.from({ length: gridHeight }, () => Array.from({ length: gridWidth }, () => 0))
  const collisionLayerData = collisionGrid.flat()

  return {
    width: gridWidth,
    height: gridHeight,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    layers: [
      {
        type: 'tilelayer',
        name: 'collision',
        width: gridWidth,
        height: gridHeight,
        data: collisionLayerData,
      },
      {
        type: 'objectgroup',
        name: 'regions',
        objects: [
          {
            id: 1,
            name: 'Main Area',
            x: 0,
            y: 0,
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            properties: [{ name: 'id', type: 'string', value: 'main_area' }],
          },
        ],
      },
      {
        type: 'objectgroup',
        name: 'interactive_objects',
        objects: world.hotspots.map(buildHotspotObject),
      },
    ],
  }
}
