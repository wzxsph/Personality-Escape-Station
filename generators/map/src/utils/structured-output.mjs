export const STRUCTURED_OUTPUT_MODES = {
  AUTO: "auto",
  JSON_OBJECT: "json_object",
  PROMPT_ONLY: "prompt_only",
};

export function resolveStructuredOutputMode(explicitMode, envMode, fallback) {
  const mode = explicitMode || envMode || fallback || STRUCTURED_OUTPUT_MODES.PROMPT_ONLY;
  return Object.values(STRUCTURED_OUTPUT_MODES).includes(mode)
    ? mode
    : STRUCTURED_OUTPUT_MODES.PROMPT_ONLY;
}

export function getStructuredOutputAttemptModes(mode, cachedCapability) {
  if (cachedCapability) {
    return [cachedCapability];
  }
  if (mode === STRUCTURED_OUTPUT_MODES.AUTO) {
    return [STRUCTURED_OUTPUT_MODES.JSON_OBJECT, STRUCTURED_OUTPUT_MODES.PROMPT_ONLY];
  }
  return [mode];
}

export function isUnsupportedJsonModeError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("response_format") || message.includes("json_object") || message.includes("unsupported");
}

export function parsePossiblyMalformedJSON(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new Error("Empty JSON response");
  }

  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) {
      return JSON.parse(fenced);
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    }

    throw new Error("Failed to parse JSON response");
  }
}
