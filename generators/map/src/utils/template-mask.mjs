import sharp from "sharp";
import { getImageSize } from "./image-utils.mjs";

export async function applyTemplateFloorMask(mapBuffer, templateBuffer, options = {}) {
  const { width, height } = await getImageSize(mapBuffer);
  const template = await sharp(templateBuffer)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const floorAlpha = clampByte(parseInt(process.env.MAP_TEMPLATE_FLOOR_ALPHA || String(options.floorAlpha ?? 255), 10));
  const blockedAlpha = clampByte(parseInt(process.env.MAP_TEMPLATE_BLOCKED_ALPHA || String(options.blockedAlpha ?? 132), 10));
  const floor = Buffer.alloc(width * height * 4);
  const blocked = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const templateIndex = pixelIndex * template.info.channels;
      const r = template.data[templateIndex] ?? 0;
      const g = template.data[templateIndex + 1] ?? 0;
      const b = template.data[templateIndex + 2] ?? 0;
      const brightness = (r + g + b) / 3;
      const isTemplateFloor = brightness > 120 && r > 130 && g > 120;
      const out = pixelIndex * 4;

      if (isTemplateFloor) {
        const grain = ((x * 17 + y * 11 + ((x >> 4) * 7) + ((y >> 4) * 13)) % 19) - 9;
        floor[out] = clampByte(229 + grain);
        floor[out + 1] = clampByte(197 + grain);
        floor[out + 2] = clampByte(143 + Math.round(grain * 0.55));
        floor[out + 3] = floorAlpha;
      } else {
        blocked[out] = 17;
        blocked[out + 1] = 14;
        blocked[out + 2] = 28;
        blocked[out + 3] = blockedAlpha;
      }
    }
  }

  const floorLayer = await sharp(floor, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  const blockedLayer = await sharp(blocked, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();

  return sharp(mapBuffer)
    .composite([
      { input: blockedLayer, left: 0, top: 0 },
      { input: floorLayer, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}
