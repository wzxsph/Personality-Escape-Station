export type WalkableGrid = number[][]

export interface StagePoint {
  x: number
  y: number
}

export interface GridPoint {
  x: number
  y: number
}

export interface InteractiveRect {
  x: number
  y: number
  width: number
  height: number
}

interface GridComponent {
  value: number
  cells: GridPoint[]
  touchesBorder: boolean
}

export interface RepairWalkableGridOptions {
  tileSize?: number
  preferredPoint?: StagePoint
  fillBlockedComponentMaxSize?: number
  bridgeCrackMaxSize?: number
}

const DEFAULT_FILL_BLOCKED_COMPONENT_MAX_SIZE = 16
const DEFAULT_BRIDGE_CRACK_MAX_SIZE = 24

export function repairWalkableGrid(grid: WalkableGrid, options: RepairWalkableGridOptions = {}) {
  if (!grid.length || !grid[0]?.length) {
    return grid
  }

  let next = cloneGrid(grid)
  next = fillSmallBlockedComponents(next, options.fillBlockedComponentMaxSize ?? DEFAULT_FILL_BLOCKED_COMPONENT_MAX_SIZE)
  next = bridgeShortCracks(next, options.bridgeCrackMaxSize ?? DEFAULT_BRIDGE_CRACK_MAX_SIZE)
  next = keepMainWalkableComponent(next, options)
  next = fillSmallBlockedComponents(next, options.fillBlockedComponentMaxSize ?? DEFAULT_FILL_BLOCKED_COMPONENT_MAX_SIZE)
  return next
}

export function getObjectRenderAnchor(
  object: InteractiveRect,
  _grid: WalkableGrid,
  _tileSize: number,
) {
  return {
    x: object.x + object.width / 2,
    y: object.y + object.height,
  }
}

export function getObjectInteractionAnchor(
  object: InteractiveRect,
  grid: WalkableGrid,
  tileSize: number,
) {
  const centerX = object.x + object.width / 2
  const bottomY = object.y + object.height
  const candidates = [
    { x: centerX, y: bottomY + tileSize },
    { x: centerX, y: bottomY + tileSize * 2 },
    { x: centerX, y: bottomY },
    { x: object.x - tileSize, y: bottomY },
    { x: object.x + object.width + tileSize, y: bottomY },
    { x: centerX, y: object.y + object.height / 2 },
  ]

  for (const candidate of candidates) {
    const snapped = snapPointToNearestWalkable(candidate, grid, tileSize, 4)
    if (snapped) {
      return snapped
    }
  }

  return null
}

export function snapPointToNearestWalkable(
  point: StagePoint,
  grid: WalkableGrid,
  tileSize: number,
  maxRadius = 5,
) {
  const start = pixelToGrid(point, tileSize)
  if (isGridWalkable(grid, start.x, start.y)) {
    return gridToPixel(start.x, start.y, tileSize)
  }

  let best: { point: GridPoint; distance: number } | null = null
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let y = start.y - radius; y <= start.y + radius; y += 1) {
      for (let x = start.x - radius; x <= start.x + radius; x += 1) {
        if (!isGridWalkable(grid, x, y)) {
          continue
        }
        const pixel = gridToPixel(x, y, tileSize)
        const distance = Math.hypot(pixel.x - point.x, pixel.y - point.y)
        if (!best || distance < best.distance) {
          best = { point: { x, y }, distance }
        }
      }
    }
    const found = best as { point: GridPoint; distance: number } | null
    if (found) {
      return gridToPixel(found.point.x, found.point.y, tileSize)
    }
  }

  return null
}

export function pixelToGrid(point: StagePoint, tileSize: number): GridPoint {
  return {
    x: Math.floor(point.x / tileSize),
    y: Math.floor(point.y / tileSize),
  }
}

export function gridToPixel(x: number, y: number, tileSize: number): StagePoint {
  return {
    x: x * tileSize + tileSize / 2,
    y: y * tileSize + tileSize / 2,
  }
}

export function isGridWalkable(grid: WalkableGrid, x: number, y: number) {
  return grid[y]?.[x] === 0
}

function keepMainWalkableComponent(grid: WalkableGrid, options: RepairWalkableGridOptions) {
  const components = findComponents(grid, 0)
  if (components.length <= 1) {
    return grid
  }

  const tileSize = options.tileSize ?? 20
  const preferredGridPoint = options.preferredPoint ? pixelToGrid(options.preferredPoint, tileSize) : null
  const preferredComponent = preferredGridPoint
    ? components.find((component) => component.cells.some((cell) => cell.x === preferredGridPoint.x && cell.y === preferredGridPoint.y))
    : undefined
  const mainComponent = preferredComponent ?? [...components].sort((a, b) => b.cells.length - a.cells.length)[0]
  const mainCells = new Set(mainComponent.cells.map((cell) => `${cell.x},${cell.y}`))
  const next = cloneGrid(grid)

  for (const component of components) {
    for (const cell of component.cells) {
      if (!mainCells.has(`${cell.x},${cell.y}`)) {
        next[cell.y][cell.x] = 1
      }
    }
  }

  return next
}

function fillSmallBlockedComponents(grid: WalkableGrid, maxSize: number) {
  const next = cloneGrid(grid)
  for (const component of findComponents(grid, 1)) {
    if (component.touchesBorder || component.cells.length > maxSize) {
      continue
    }
    for (const cell of component.cells) {
      next[cell.y][cell.x] = 0
    }
  }
  return next
}

function bridgeShortCracks(grid: WalkableGrid, maxSize: number) {
  const next = cloneGrid(grid)
  for (const component of findComponents(grid, 1)) {
    if (component.touchesBorder || component.cells.length > maxSize) {
      continue
    }
    const bridgeableCells = component.cells.filter((cell) => {
      const neighbours = countWalkableNeighbours(grid, cell.x, cell.y)
      const horizontalBridge = isGridWalkable(grid, cell.x - 1, cell.y) && isGridWalkable(grid, cell.x + 1, cell.y)
      const verticalBridge = isGridWalkable(grid, cell.x, cell.y - 1) && isGridWalkable(grid, cell.x, cell.y + 1)
      return neighbours >= 5 || horizontalBridge || verticalBridge
    })
    if (bridgeableCells.length === 0) {
      continue
    }
    for (const cell of component.cells) {
      next[cell.y][cell.x] = 0
    }
  }
  return next
}

function countWalkableNeighbours(grid: WalkableGrid, x: number, y: number) {
  let count = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue
      }
      if (isGridWalkable(grid, x + dx, y + dy)) {
        count += 1
      }
    }
  }
  return count
}

function findComponents(grid: WalkableGrid, value: number) {
  const height = grid.length
  const width = grid[0]?.length ?? 0
  const visited = Array.from({ length: height }, () => Array.from({ length: width }, () => false))
  const components: GridComponent[] = []
  const neighbours = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (visited[y][x] || grid[y][x] !== value) {
        continue
      }

      const cells: GridPoint[] = []
      const queue: GridPoint[] = [{ x, y }]
      visited[y][x] = true
      let touchesBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1

      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]
        cells.push(current)
        for (const offset of neighbours) {
          const next = { x: current.x + offset.x, y: current.y + offset.y }
          if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
            continue
          }
          if (visited[next.y][next.x] || grid[next.y][next.x] !== value) {
            continue
          }
          visited[next.y][next.x] = true
          touchesBorder ||= next.x === 0 || next.y === 0 || next.x === width - 1 || next.y === height - 1
          queue.push(next)
        }
      }

      components.push({ value, cells, touchesBorder })
    }
  }

  return components
}

function cloneGrid(grid: WalkableGrid) {
  return grid.map((row) => [...row])
}
