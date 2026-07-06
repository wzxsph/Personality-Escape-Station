import sharp from "sharp";
import { generateWalkableMap } from "../steps/step4-walkable-areas.mjs";
import { computeGrid } from "../steps/step5-compute-grid.mjs";
import { resizeImage, getImageSize } from "./image-utils.mjs";

export async function runTemplateAdherenceCheck({
  mapBuffer,
  templateBuffer,
  userPrompt,
  worldDesign,
  save,
  targetWidth,
  targetHeight,
  attempt,
}) {
  const templateGrid = await extractTemplateGrid(templateBuffer, targetWidth, targetHeight);
  const { buffer: checkMap, width } = await resizeImage(mapBuffer, 1024, { allowUpscale: false });
  const mapSize = await getImageSize(checkMap);
  const checkSave = (name, data) => save(`01-template-adherence-attempt-${attempt}-${name}`, data);
  const walkable = await generateWalkableMap(checkMap, userPrompt, worldDesign, checkSave);
  const sourceGrid = await computeGrid(checkMap, walkable.buffer, width || mapSize.width);
  const detectedGrid = resampleGrid(sourceGrid.grid, targetWidth, targetHeight);
  const stats = compareGrids(templateGrid, detectedGrid);
  const thresholds = {
    minIou: parseFloat(process.env.MAP_TEMPLATE_MIN_IOU || "0.58"),
    minCoverage: parseFloat(process.env.MAP_TEMPLATE_MIN_COVERAGE || "0.72"),
    maxExtraRatio: parseFloat(process.env.MAP_TEMPLATE_MAX_EXTRA_RATIO || "0.45"),
  };
  const issues = [];
  if (!walkable.reviewPassed) {
    issues.push("old walkable overlay review did not pass");
  }
  if (stats.iou < thresholds.minIou) {
    issues.push(`template/detected walkable IoU ${stats.iou.toFixed(3)} < ${thresholds.minIou}`);
  }
  if (stats.templateCoverage < thresholds.minCoverage) {
    issues.push(`template walkable coverage ${stats.templateCoverage.toFixed(3)} < ${thresholds.minCoverage}`);
  }
  if (stats.extraRatio > thresholds.maxExtraRatio) {
    issues.push(`detected extra-walkable ratio ${stats.extraRatio.toFixed(3)} > ${thresholds.maxExtraRatio}`);
  }

  const result = {
    pass: issues.length === 0,
    issues,
    thresholds,
    stats,
    walkableReviewPassed: walkable.reviewPassed,
    walkableAttempts: walkable.attempts,
    sourceGrid: {
      width: sourceGrid.gridWidth,
      height: sourceGrid.gridHeight,
      tileSize: sourceGrid.tileSize,
    },
  };
  save(`01-template-adherence-attempt-${attempt}.json`, result);
  save(`01-template-adherence-attempt-${attempt}-detected-grid.json`, {
    gridWidth: targetWidth,
    gridHeight: targetHeight,
    grid: detectedGrid,
  });
  return result;
}

async function extractTemplateGrid(templateBuffer, targetWidth, targetHeight) {
  const { data, info } = await sharp(templateBuffer)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grid = [];
  for (let y = 0; y < info.height; y += 1) {
    const row = [];
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      const brightness = (r + g + b) / 3;
      const isTemplateFloor = brightness > 120 && r > 130 && g > 120;
      row.push(isTemplateFloor ? 0 : 1);
    }
    grid.push(row);
  }
  return grid;
}

function compareGrids(templateGrid, detectedGrid) {
  let templateWalkable = 0;
  let detectedWalkable = 0;
  let intersection = 0;
  let union = 0;
  let extraWalkable = 0;
  let missedWalkable = 0;
  const height = Math.min(templateGrid.length, detectedGrid.length);
  const width = Math.min(templateGrid[0]?.length ?? 0, detectedGrid[0]?.length ?? 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const templateIsWalkable = templateGrid[y]?.[x] === 0;
      const detectedIsWalkable = detectedGrid[y]?.[x] === 0;
      if (templateIsWalkable) templateWalkable += 1;
      if (detectedIsWalkable) detectedWalkable += 1;
      if (templateIsWalkable && detectedIsWalkable) intersection += 1;
      if (templateIsWalkable || detectedIsWalkable) union += 1;
      if (!templateIsWalkable && detectedIsWalkable) extraWalkable += 1;
      if (templateIsWalkable && !detectedIsWalkable) missedWalkable += 1;
    }
  }

  return {
    width,
    height,
    templateWalkable,
    detectedWalkable,
    intersection,
    union,
    extraWalkable,
    missedWalkable,
    iou: union > 0 ? intersection / union : 0,
    templateCoverage: templateWalkable > 0 ? intersection / templateWalkable : 0,
    extraRatio: detectedWalkable > 0 ? extraWalkable / detectedWalkable : 0,
    missedRatio: templateWalkable > 0 ? missedWalkable / templateWalkable : 0,
  };
}

function resampleGrid(sourceGrid, targetWidth, targetHeight) {
  if (!sourceGrid?.length || !sourceGrid[0]?.length) {
    return Array.from({ length: targetHeight }, () => Array.from({ length: targetWidth }, () => 1));
  }

  const sourceHeight = sourceGrid.length;
  const sourceWidth = sourceGrid[0].length;
  return Array.from({ length: targetHeight }, (_, y) => {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight));
    return Array.from({ length: targetWidth }, (_, x) => {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth));
      return sourceGrid[sourceY]?.[sourceX] === 0 ? 0 : 1;
    });
  });
}
