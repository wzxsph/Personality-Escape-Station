/**
 * Build sprite sheet metadata (frame dimensions + animation definitions)
 * for use by the Phaser.js viewer.
 *
 * Uses rule-based detection to find frame boundaries:
 * 1. Scan for content density using sliding windows
 * 2. Detect transitions between empty and content regions
 * 3. Calculate optimal grid layout based on detected boundaries
 */

import sharp from "sharp";

const WALK_FRAME_RATE = 8;

/**
 * Analyze spritesheet to detect frame boundaries based on content density.
 * Returns detected frame grid info.
 */
async function detectFrameGrid(buffer) {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  const windowSize = 10;
  const threshold = 50; // Window with >50 non-transparent pixels = has content

  /**
   * Check if a vertical strip (column window) has significant content
   */
  const colHasContent = (x) => {
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let dx = 0; dx < windowSize && x + dx < width; dx++) {
        if (data[(y * width + x + dx) * channels + 3] > 10) {
          count++;
          if (count > threshold) return true;
        }
      }
    }
    return false;
  };

  /**
   * Check if a horizontal strip (row window) has significant content
   */
  const rowHasContent = (y) => {
    let count = 0;
    for (let x = 0; x < width; x++) {
      for (let dy = 0; dy < windowSize && y + dy < height; dy++) {
        if (data[((y + dy) * width + x) * channels + 3] > 10) {
          count++;
          if (count > threshold) return true;
        }
      }
    }
    return false;
  };

  /**
   * Detect boundaries (transitions) between empty and content regions
   */
  const detectBoundaries = (hasContentFn, maxDim, step = windowSize) => {
    const boundaries = [];
    let prevHasContent = null;

    for (let i = 0; i < maxDim; i += step) {
      const hasContent = hasContentFn(i);
      if (prevHasContent !== null && hasContent !== prevHasContent) {
        boundaries.push({ pos: i, type: hasContent ? "start" : "end" });
      }
      prevHasContent = hasContent;
    }
    return boundaries;
  };

  const colBoundaries = detectBoundaries(colHasContent, width);
  const rowBoundaries = detectBoundaries(rowHasContent, height);

  // Extract frame regions from boundaries
  const colStarts = colBoundaries
    .filter((b) => b.type === "start")
    .map((b) => b.pos);
  const colEnds = colBoundaries
    .filter((b) => b.type === "end")
    .map((b) => b.pos);
  const rowStarts = rowBoundaries
    .filter((b) => b.type === "start")
    .map((b) => b.pos);
  const rowEnds = rowBoundaries
    .filter((b) => b.type === "end")
    .map((b) => b.pos);

  const columns = colStarts.length || 6;
  const rows = rowStarts.length || 5;

  // Calculate average frame dimensions
  let frameWidth, frameHeight;

  if (colStarts.length > 0 && colEnds.length > 0) {
    const colWidths = colStarts.map((start, i) => {
      const end = colEnds[i] ?? width;
      return end - start;
    });
    frameWidth = Math.round(colWidths.reduce((a, b) => a + b, 0) / colWidths.length);
  } else {
    frameWidth = Math.floor(width / columns);
  }

  if (rowStarts.length > 0 && rowEnds.length > 0) {
    const rowHeights = rowStarts.map((start, i) => {
      const end = rowEnds[i] ?? height;
      return end - start;
    });
    frameHeight = Math.round(rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length);
  } else {
    frameHeight = Math.floor(height / rows);
  }

  return {
    frameWidth: Math.max(1, frameWidth),
    frameHeight: Math.max(1, frameHeight),
    columns,
    rows,
    detected: true,
    boundaries: {
      columns: { starts: colStarts, ends: colEnds },
      rows: { starts: rowStarts, ends: rowEnds },
    },
  };
}

/**
 * Generate metadata JSON for a processed sprite sheet.
 * @param {Buffer} spritesheetBuffer - the transparent-background spritesheet
 * @param {{ id: string, name: string, description: string }} charInfo
 * @returns {Promise<object>} metadata object
 */
export async function buildMetadata(spritesheetBuffer, charInfo) {
  const { width, height } = await sharp(spritesheetBuffer).metadata();
  const grid = await detectFrameGrid(spritesheetBuffer);

  const expectedFrames = grid.columns * grid.rows;
  const animations = {};

  if (expectedFrames >= 6) {
    animations["walk-left"] = { start: 0, end: 5, frameRate: WALK_FRAME_RATE };
  }
  if (expectedFrames >= 12) {
    animations["walk-down"] = { start: 6, end: 11, frameRate: WALK_FRAME_RATE };
  }
  if (expectedFrames >= 18) {
    animations["walk-up"] = { start: 12, end: 17, frameRate: WALK_FRAME_RATE };
  }

  // Idle frames
  const idleFrame = Math.min(18, expectedFrames - 1);
  animations["idle-front"] = { frame: idleFrame };
  if (expectedFrames > 19) {
    animations["idle-back"] = { frame: 19 };
  }
  if (expectedFrames > 20) {
    animations["idle-left"] = { frame: 20 };
  }

  return {
    id: charInfo.id,
    name: charInfo.name,
    description: charInfo.description,
    createdAt: new Date().toISOString(),
    frameWidth: grid.frameWidth,
    frameHeight: grid.frameHeight,
    columns: grid.columns,
    rows: grid.rows,
    sourceWidth: width,
    sourceHeight: height,
    detected: grid.detected,
    animations,
  };
}

/**
 * Export for use in other modules
 */
export { detectFrameGrid };
