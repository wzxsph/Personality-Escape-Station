import { TILE_SIZE } from './buildStageMap'
import {
  getObjectInteractionAnchor,
  getObjectRenderAnchor,
  repairWalkableGrid,
} from './walkableGridRepair'

export interface LocationRect {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface InteractiveObject {
  objectId: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export class MapManager {
  collisionGrid: number[][] = []
  gridWidth = 0
  gridHeight = 0
  tileSize = TILE_SIZE
  locations = new Map<string, LocationRect>()
  interactiveObjects = new Map<string, InteractiveObject>()

  loadFromTiledJSON(json: {
    tilewidth: number
    width: number
    height: number
    layers: Array<{ type: string; name: string; data?: number[]; objects?: Array<Record<string, unknown>> }>
  }) {
    this.tileSize = json.tilewidth || TILE_SIZE
    this.gridWidth = json.width
    this.gridHeight = json.height
    this.locations.clear()
    this.interactiveObjects.clear()

    for (const layer of json.layers) {
      if (layer.type === 'tilelayer' && layer.name === 'collision' && Array.isArray(layer.data)) {
        this.parseCollisionLayer(layer.data)
      } else if (layer.type === 'objectgroup' && layer.name === 'regions' && Array.isArray(layer.objects)) {
        this.parseRegionsLayer(layer.objects)
      } else if (layer.type === 'objectgroup' && layer.name === 'interactive_objects' && Array.isArray(layer.objects)) {
        this.parseInteractiveLayer(layer.objects)
      }
    }
  }

  private parseCollisionLayer(data: number[]) {
    const rawGrid: number[][] = []
    for (let y = 0; y < this.gridHeight; y += 1) {
      const row: number[] = []
      for (let x = 0; x < this.gridWidth; x += 1) {
        row.push(data[y * this.gridWidth + x] === 0 ? 0 : 1)
      }
      rawGrid.push(row)
    }
    this.collisionGrid = repairWalkableGrid(rawGrid, { tileSize: this.tileSize })
  }

  private parseRegionsLayer(objects: Array<Record<string, unknown>>) {
    for (const object of objects) {
      const properties = Array.isArray(object.properties) ? object.properties : []
      const idProperty = properties.find(
        (property) => typeof property === 'object' && property !== null && property.name === 'id',
      ) as { value?: string } | undefined
      const id = idProperty?.value
      if (!id) {
        continue
      }
      this.locations.set(id, {
        id,
        name: typeof object.name === 'string' ? object.name : id,
        x: Number(object.x ?? 0),
        y: Number(object.y ?? 0),
        width: Number(object.width ?? 0),
        height: Number(object.height ?? 0),
      })
    }
  }

  private parseInteractiveLayer(objects: Array<Record<string, unknown>>) {
    for (const object of objects) {
      const properties = Array.isArray(object.properties) ? object.properties : []
      const idProperty = properties.find(
        (property) => typeof property === 'object' && property !== null && property.name === 'objectId',
      ) as { value?: string } | undefined
      const objectId = idProperty?.value
      if (!objectId) {
        continue
      }
      this.interactiveObjects.set(objectId, {
        objectId,
        name: typeof object.name === 'string' ? object.name : objectId,
        x: Number(object.x ?? 0),
        y: Number(object.y ?? 0),
        width: Number(object.width ?? 0),
        height: Number(object.height ?? 0),
      })
    }
  }

  pixelToGrid(px: number, py: number) {
    return {
      gx: Math.floor(px / this.tileSize),
      gy: Math.floor(py / this.tileSize),
    }
  }

  gridToPixel(gx: number, gy: number) {
    return {
      x: gx * this.tileSize + this.tileSize / 2,
      y: gy * this.tileSize + this.tileSize / 2,
    }
  }

  isWalkable(gx: number, gy: number) {
    if (gx < 0 || gy < 0 || gx >= this.gridWidth || gy >= this.gridHeight) {
      return false
    }
    return this.collisionGrid[gy]?.[gx] === 0
  }

  isWalkablePixel(px: number, py: number) {
    const { gx, gy } = this.pixelToGrid(px, py)
    return this.isWalkable(gx, gy)
  }

  hasWalkableData() {
    return this.collisionGrid.length > 0
  }

  getObjectPosition(objectId: string) {
    return this.getObjectRenderPosition(objectId)
  }

  getObjectRenderPosition(objectId: string) {
    const object = this.interactiveObjects.get(objectId)
    if (!object) {
      return null
    }
    return getObjectRenderAnchor(object, this.collisionGrid, this.tileSize)
  }

  getObjectInteractionPosition(objectId: string) {
    const object = this.interactiveObjects.get(objectId)
    if (!object) {
      return null
    }

    return getObjectInteractionAnchor(object, this.collisionGrid, this.tileSize)
  }
}
