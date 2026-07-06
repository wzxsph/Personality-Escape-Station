import { existsSync, readFileSync } from "fs";
import { generateImage, editImage } from "../models/gemini-flash-img.mjs";
import { geminiProVisionJSON } from "../models/gemini-pro.mjs";
import { chat } from "../models/llm-client.mjs";
import { loadPrompt } from "../utils/prompt-loader.mjs";
import { resizeImage } from "../utils/image-utils.mjs";
import { getMapImageSizeLabel } from "../utils/generation-config.mjs";
import { runTemplateAdherenceCheck } from "../utils/template-adherence.mjs";
import { applyTemplateFloorMask } from "../utils/template-mask.mjs";
import {
  formatElementSummary,
  formatMapPlanSummary,
  formatRegionSummary,
} from "../utils/world-design-summary.mjs";

/**
 * Generate the source map with self-feedback loop.
 * Allows up to MAX_RETRIES modifications + 1 final review.
 * @param {string} userPrompt
 * @param {object} worldDesign
 * @param {(name: string, data: any) => void} save - callback to persist intermediate artifacts
 * @param {{ originalUserPrompt?: string }} options
 * @returns {{ buffer: Buffer, reviewPassed: boolean, attempts: number }}
 */
export async function generateMap(userPrompt, worldDesign, save, { originalUserPrompt = "" } = {}) {
  const MAX_RETRIES = parseInt(process.env.STEP1_MAX_RETRIES || process.env.MAX_RETRIES || "3", 10);
  const MAP_IMAGE_SIZE = getMapImageSizeLabel();
  // Personality Escape Station maps are portrait-first; keep 9:16 as the default.
  const MAP_ASPECT_RATIO = process.env.MAP_ASPECT_RATIO || worldDesign.mapAspectRatio || "9:16";
  const GENERATE_TIMEOUT_MS = parseInt(process.env.STEP1_GENERATE_TIMEOUT_MS || "180000", 10);
  const REVIEW_TIMEOUT_MS = parseInt(process.env.STEP1_REVIEW_TIMEOUT_MS || "90000", 10);
  const ADJUST_TIMEOUT_MS = parseInt(process.env.STEP1_ADJUST_TIMEOUT_MS || "90000", 10);
  let additionalConstraints = "";
  let mapBuffer = null;
  const totalAttempts = MAX_RETRIES + 1;
  const mapPlanSummary = formatMapPlanSummary(worldDesign);
  const regionSummary = formatRegionSummary(worldDesign);
  const elementSummary = formatElementSummary(worldDesign);
  const layoutTemplatePath = process.env.MAP_LAYOUT_TEMPLATE_PATH || "";
  const layoutTemplateBuffer = layoutTemplatePath && existsSync(layoutTemplatePath)
    ? readFileSync(layoutTemplatePath)
    : null;
  const templateAdherenceCheckEnabled = Boolean(layoutTemplateBuffer) && process.env.MAP_TEMPLATE_ADHERENCE_CHECK !== "0";
  const templateAdherenceStrict = process.env.MAP_TEMPLATE_ADHERENCE_STRICT !== "0";
  const enforceTemplateFloorMask = Boolean(layoutTemplateBuffer) && process.env.MAP_ENFORCE_TEMPLATE_FLOOR_MASK === "1";
  const templateGridWidth = parseInt(process.env.MAP_STAGE_GRID_WIDTH || process.env.MAP_TEMPLATE_GRID_WIDTH || "45", 10);
  const templateGridHeight = parseInt(process.env.MAP_STAGE_GRID_HEIGHT || process.env.MAP_TEMPLATE_GRID_HEIGHT || "80", 10);
  if (layoutTemplatePath && !layoutTemplateBuffer) {
    console.warn(`[Step 1] MAP_LAYOUT_TEMPLATE_PATH was set but not found: ${layoutTemplatePath}`);
  }

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    console.log(`[Step 1] Generating map (attempt ${attempt}/${totalAttempts})${layoutTemplateBuffer ? " from fixed navigation template" : ""}...`);

    const promptName = layoutTemplateBuffer ? "step1-map-from-template.md" : "step1-map-generation.md";
    const prompt = loadPrompt(promptName, {
      userPrompt,
      originalUserPrompt: originalUserPrompt || "",
      mapPlanSummary,
      regionSummary,
      elementSummary,
      additionalConstraints,
    });

    mapBuffer = layoutTemplateBuffer
      ? await editImage(prompt, layoutTemplateBuffer, {
          aspectRatio: MAP_ASPECT_RATIO,
          imageSize: MAP_IMAGE_SIZE,
          logStep: "Step 1 template generate",
          requestTimeoutMs: GENERATE_TIMEOUT_MS,
        })
      : await generateImage(prompt, {
          aspectRatio: MAP_ASPECT_RATIO,
          imageSize: MAP_IMAGE_SIZE,
          logStep: "Step 1 generate",
          requestTimeoutMs: GENERATE_TIMEOUT_MS,
        });
    console.log(`[Step 1] Generated image: ${mapBuffer.length} bytes`);
    save(`01-map-attempt-${attempt}-raw.png`, mapBuffer);
    if (enforceTemplateFloorMask) {
      mapBuffer = await applyTemplateFloorMask(mapBuffer, layoutTemplateBuffer);
      console.log(`[Step 1] Applied deterministic template floor mask: ${mapBuffer.length} bytes`);
      save(`01-map-attempt-${attempt}-template-mask.png`, mapBuffer);
    }
    save(`01-map-attempt-${attempt}.png`, mapBuffer);

    console.log(`[Step 1] Reviewing (${attempt}/${totalAttempts})...`);
    const { buffer: smallBuf } = await resizeImage(mapBuffer, 1024);

    const reviewPrompt = loadPrompt(layoutTemplateBuffer ? "step1-map-template-review.md" : "step1-map-review.md", {
      userPrompt,
      originalUserPrompt: originalUserPrompt || "",
      mapPlanSummary,
      regionSummary,
      elementSummary,
    });
    const reviewImages = layoutTemplateBuffer
      ? [(await resizeImage(layoutTemplateBuffer, 1024, { allowUpscale: true })).buffer, smallBuf]
      : [smallBuf];

    let review;
    let reviewError = null;
    try {
      review = await geminiProVisionJSON(reviewPrompt, reviewImages, {
        logStep: "Step 1 review",
        requestTimeoutMs: REVIEW_TIMEOUT_MS,
      });
    } catch (e) {
      reviewError = e;
      console.warn(`[Step 1] Review failed on attempt ${attempt}: ${e.message}`);
      review = { pass: false, issues: [`Review request failed: ${e.message}`], promptAdjustments: [] };
    }

    if (review.pass && templateAdherenceCheckEnabled) {
      console.log(`[Step 1] Running template adherence check (${attempt}/${totalAttempts})...`);
      try {
        const adherence = await runTemplateAdherenceCheck({
          mapBuffer,
          templateBuffer: layoutTemplateBuffer,
          userPrompt,
          worldDesign,
          save,
          targetWidth: templateGridWidth,
          targetHeight: templateGridHeight,
          attempt,
        });
        if (!adherence.pass) {
          review = {
            pass: false,
            issues: [
              ...(review.issues ?? []),
              ...adherence.issues.map((issue) => `Template adherence: ${issue}`),
            ],
            promptAdjustments: [
              ...(review.promptAdjustments ?? []),
              "必须把输入模板当作硬性可走区 mask：浅色地面轮廓、暗色阻挡岛、左右凹口和中心岛都必须在最终地图中保持，不允许新增视觉走廊或把暗区画成可走地面。",
              "大型家具、墙体、床、柜台、沙发和装饰只能画在模板暗区；模板浅色区域必须保持连续、干净、像可行走地面。",
            ],
          };
          console.log(`[Step 1] Template adherence failed. Issues: ${adherence.issues.join("; ")}`);
        } else {
          console.log(`[Step 1] Template adherence passed. IoU=${adherence.stats.iou.toFixed(3)}, coverage=${adherence.stats.templateCoverage.toFixed(3)}, extra=${adherence.stats.extraRatio.toFixed(3)}`);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[Step 1] Template adherence check failed to run: ${message}`);
        if (templateAdherenceStrict) {
          review = {
            pass: false,
            issues: [...(review.issues ?? []), `Template adherence check failed to run: ${message}`],
            promptAdjustments: [
              ...(review.promptAdjustments ?? []),
              "生成图必须严格遵守输入导航模板，避免依赖后处理猜测可走区域。",
            ],
          };
        }
      }
    }

    if (review.pass) {
      console.log("[Step 1] Review result: pass=true, issues=0");
      console.log(`[Step 1] Map passed review on attempt ${attempt}.`);
      return { buffer: mapBuffer, reviewPassed: true, attempts: attempt };
    }

    if (reviewError) {
      console.log(`[Step 1] Review unavailable on attempt ${attempt}, retrying generation.`);
      continue;
    }

    console.log(`[Step 1] Review failed. Issues: ${review.issues?.join("; ")}`);

    if (attempt < totalAttempts && review.promptAdjustments?.length) {
      const adjustmentRequest = `以下是对地图生成prompt的审查反馈，请将这些调整建议整合成额外的约束条件（用中文，简洁明了）：\n${review.promptAdjustments.join("\n")}`;
      const newConstraints = await chat([
        { role: "user", content: adjustmentRequest },
      ], { logStep: "Step 1 adjust", requestTimeoutMs: ADJUST_TIMEOUT_MS });
      additionalConstraints += `\n${newConstraints}`;
      console.log(`[Step 1] Accumulated constraints: ${additionalConstraints.slice(0, 300)}`);
    }
  }

  console.warn(`[Step 1] All ${totalAttempts} attempts exhausted, review never passed.`);
  return { buffer: mapBuffer, reviewPassed: false, attempts: totalAttempts };
}
