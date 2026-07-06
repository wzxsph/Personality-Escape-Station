/**
 * Image generation client — OpenAI-compatible chat completions with image output.
 * Reads IMAGE_GEN_* env vars. Default: OpenRouter + gemini-3.1-flash-image-preview.
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logModelCall, logModelResponse, logModelImageResponse, logError } from "../utils/logger.mjs";
import { getMapImageSizeLabel } from "../utils/generation-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLD_SEED_ROOT = join(__dirname, "../../../..");
dotenv.config({ path: join(WORLD_SEED_ROOT, ".env") });

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3.1-flash-image-preview";
const MODEL = process.env.IMAGE_GEN_MODEL || DEFAULT_MODEL;
const BASE_URL = process.env.IMAGE_GEN_BASE_URL || DEFAULT_BASE_URL;
const PROVIDER = (process.env.IMAGE_GEN_PROVIDER || "").trim().toLowerCase();
const DEFAULT_REQUEST_TIMEOUT_MS = parseInt(process.env.IMAGE_GEN_TIMEOUT_MS || "180000", 10);
const MAX_CONSECUTIVE_FAILURES = Math.max(1, parseInt(process.env.IMAGE_GEN_MAX_RETRIES || "2", 10));

async function withRetry(fn, logStep) {
  for (let attempt = 1; attempt <= MAX_CONSECUTIVE_FAILURES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[${logStep}] Attempt ${attempt} failed (${e.message}), retrying...`);
        continue;
      }
      throw e;
    }
  }
}

function resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey) {
  if (Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0) {
    return requestTimeoutMs;
  }

  if (timeoutEnvKey && process.env[timeoutEnvKey]) {
    const parsed = parseInt(process.env[timeoutEnvKey], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function useGoogleNativeProvider() {
  return (
    PROVIDER === "google-native" ||
    PROVIDER === "google" ||
    (!PROVIDER && BASE_URL.includes("generativelanguage.googleapis.com"))
  );
}

// SiliconFlow and some providers use dedicated images/generations endpoint
function useDedicatedImageEndpoint() {
  return PROVIDER === "openai-images" ||
    PROVIDER === "images" ||
    (BASE_URL.includes("siliconflow.cn") && MODEL.includes("/"));
}

// api.openai-next.com doesn't support modalities/image_config, use plain request
function useOpenAIDirectEndpoint() {
  return BASE_URL.includes("api.openai-next.com");
}

function mapSizeToPixels(size, aspectRatio = "1:1") {
  // Map "1K", "2K" etc to pixels for dedicated image APIs
  if (aspectRatio === "9:16") {
    return size === "2K" || size === "2k" ? "2048x3584" : "1024x1792";
  }
  if (aspectRatio === "16:9") {
    return size === "2K" || size === "2k" ? "3584x2048" : "1792x1024";
  }
  const sizeMap = {
    "256x256": "1024x1024",
    "512x512": "1024x1024",
    "1K": "1024x1024",
    "1k": "1024x1024",
    "2K": "2048x2048",
    "2k": "2048x2048",
    "1024x1024": "1024x1024",
    "2048x2048": "2048x2048",
  };
  return sizeMap[size] || "1024x1024";
}

function getGoogleNativeBaseUrl() {
  const trimmed = BASE_URL.replace(/\/+$/, "");
  return trimmed.endsWith("/openai")
    ? trimmed.slice(0, -"/openai".length)
    : trimmed;
}

function getGoogleNativeModel() {
  return MODEL.replace(/^google\//, "").replace(/^models\//, "");
}

function buildGoogleNativeUrl(apiKey) {
  const model = encodeURIComponent(getGoogleNativeModel());
  return `${getGoogleNativeBaseUrl()}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function buildGoogleNativeBody(parts) {
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };
}

async function postGoogleNativeImage(parts, { apiKey, signal }) {
  return fetch(buildGoogleNativeUrl(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGoogleNativeBody(parts)),
    signal,
  });
}

/**
 * Text-to-image generation.
 * @returns {Buffer} PNG image buffer
 */
export async function generateImage(
  prompt,
  { aspectRatio = "16:9", imageSize = getMapImageSizeLabel(), logStep = "flash-img-gen", requestTimeoutMs, timeoutEnvKey } = {},
) {
  return withRetry(async () => {
    const API_KEY = process.env.IMAGE_GEN_API_KEY || "";
    logModelCall(logStep, MODEL, prompt, [`config: aspect=${aspectRatio}, size=${imageSize}`]);
    const timeoutMs = resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const nativePrompt = useGoogleNativeProvider()
        ? `${prompt}\n\nGenerate the image in ${aspectRatio} aspect ratio.`
        : prompt;
      const res = useGoogleNativeProvider()
        ? await postGoogleNativeImage([{ text: nativePrompt }], {
            apiKey: API_KEY,
            signal: controller.signal,
          })
        : useDedicatedImageEndpoint()
        ? await fetch(`${BASE_URL}/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              prompt: nativePrompt,
              n: 1,
              size: mapSizeToPixels(imageSize, aspectRatio),
            }),
            signal: controller.signal,
          })
        : await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(useOpenAIDirectEndpoint()
              ? {
                  model: MODEL,
                  messages: [{ role: "user", content: nativePrompt }],
                  max_tokens: 2048,
                }
              : {
                  model: MODEL,
                  messages: [{ role: "user", content: nativePrompt }],
                  modalities: ["image", "text"],
                  image_config: { aspect_ratio: aspectRatio, image_size: imageSize },
                }),
            signal: controller.signal,
          });

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Image Gen API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const buf = useGoogleNativeProvider()
        ? extractGoogleNativeImageBuffer(data)
        : await extractImageBuffer(data);
      logModelImageResponse(logStep, MODEL, "(returned to caller)", buf.length);
      return buf;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Image Gen request timed out after ${timeoutMs / 1000}s`);
        logError(logStep, error);
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }, logStep);
}

/**
 * Image editing: pass an existing image + text instruction → modified image.
 * @param {string} text  - editing instruction
 * @param {Buffer} imageBuffer - source image
 * @returns {Buffer} PNG image buffer
 */
export async function editImage(text, imageBuffer, { aspectRatio = "1:1", imageSize = "2K", logStep = "flash-img-edit", requestTimeoutMs, timeoutEnvKey } = {}) {
  return withRetry(async () => {
    const API_KEY = process.env.IMAGE_GEN_API_KEY || "";
    logModelCall(logStep, MODEL, text, [`input_image: ${(imageBuffer.length / 1024).toFixed(0)}KB`, `config: aspect=${aspectRatio}, size=${imageSize}`]);
    const timeoutMs = resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey);

    const base64 = imageBuffer.toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = useGoogleNativeProvider()
        ? await postGoogleNativeImage(
            [
              { text },
              { inlineData: { mimeType: "image/png", data: base64 } },
            ],
            {
              apiKey: API_KEY,
              signal: controller.signal,
            },
          )
        : useDedicatedImageEndpoint()
        ? await fetch(`${BASE_URL}/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              prompt: text,
              image_url: `data:image/png;base64,${base64}`,
              n: 1,
              size: mapSizeToPixels(imageSize, aspectRatio),
            }),
            signal: controller.signal,
          })
        : await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(useOpenAIDirectEndpoint()
              ? {
                  model: MODEL,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text },
                        {
                          type: "image_url",
                          image_url: { url: `data:image/png;base64,${base64}` },
                        },
                      ],
                    },
                  ],
                  max_tokens: 2048,
                }
              : {
                  model: MODEL,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text },
                        {
                          type: "image_url",
                          image_url: { url: `data:image/png;base64,${base64}` },
                        },
                      ],
                    },
                  ],
                  modalities: ["image", "text"],
                  image_config: { aspect_ratio: aspectRatio, image_size: imageSize },
                }),
            signal: controller.signal,
          });

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Image Gen Edit API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const buf = useGoogleNativeProvider()
        ? extractGoogleNativeImageBuffer(data)
        : await extractImageBuffer(data);
      logModelImageResponse(logStep, MODEL, "(returned to caller)", buf.length);
      return buf;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Image Gen Edit request timed out after ${timeoutMs / 1000}s`);
        logError(logStep, error);
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }, logStep);
}

async function extractImageBuffer(data) {
  const message = data.choices?.[0]?.message;

  if (message?.images && message.images.length > 0) {
    const url = message.images[0].image_url.url;
    const b64 = url.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(b64, "base64");
  }

  if (message?.content && typeof message.content === "string") {
    // Try base64 first
    const b64Match = message.content.match(/data:image\/\w+;base64,([A-Za-z0-9+/=]+)/);
    if (b64Match) return Buffer.from(b64Match[1], "base64");
    // Try markdown image: ![alt](https://...)
    const mdMatch = message.content.match(/!\[.*?\]\((https?:\/\/[^\s\)]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^)\s]*)?)\)/);
    if (mdMatch) return downloadImage(mdMatch[1]);
    // Try plain https URL in content
    const urlMatch = message.content.match(/(https?:\/\/pro\.filesystem\.site\/cdn\/[^\s\)]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^)\s]*)?)/);
    if (urlMatch) return downloadImage(urlMatch[1]);
  }

  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part.type === "image_url") {
        const url = part.image_url?.url || "";
        const b64 = url.replace(/^data:image\/\w+;base64,/, "");
        if (b64) return Buffer.from(b64, "base64");
      }
    }
  }

  // OpenAI images API format: { data: [{ url: "https://..." }] }
  if (Array.isArray(data.data) && data.data[0]?.url) {
    return downloadImage(data.data[0].url);
  }

  throw new Error("No image found in Image Gen response");
}

function extractGoogleNativeImageBuffer(data) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate.content?.parts)
      ? candidate.content.parts
      : [];
    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        return Buffer.from(inlineData.data, "base64");
      }
    }
  }

  throw new Error("No image found in Google native Image Gen response");
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}
