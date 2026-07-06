import { Router } from "express";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../store/db.js";

const router = Router();

const regularArchetypeIds = [
  "BEDX",
  "GONE",
  "SIDE",
  "SPRK",
  "F1SH",
  "NOCT",
  "UNDO",
  "MUT8",
  "BUFR",
  "JANK",
  "FINE",
] as const;
const hiddenArchetypeId = "GL1T" as const;
const archetypeIds = [...regularArchetypeIds, hiddenArchetypeId] as const;

type RegularArchetypeId = (typeof regularArchetypeIds)[number];
type ArchetypeId = (typeof archetypeIds)[number];
type RoomEventType = "gift" | "light" | "message" | "fragment";

const personaMaxScores: Record<RegularArchetypeId, number> = {
  BEDX: 4,
  GONE: 4,
  SIDE: 4,
  SPRK: 4,
  F1SH: 4,
  NOCT: 3,
  UNDO: 4,
  MUT8: 3,
  BUFR: 3,
  JANK: 3,
  FINE: 4,
};

const optionScores: Record<string, RegularArchetypeId> = {
  "q1:A": "BEDX",
  "q1:B": "FINE",
  "q1:C": "F1SH",
  "q1:D": "SIDE",
  "q2:A": "BUFR",
  "q2:B": "JANK",
  "q2:C": "SPRK",
  "q2:D": "MUT8",
  "q3:A": "GONE",
  "q3:B": "UNDO",
  "q3:C": "NOCT",
  "q3:D": "SPRK",
  "q4:A": "FINE",
  "q4:B": "GONE",
  "q4:C": "SPRK",
  "q4:D": "JANK",
  "q5:A": "BEDX",
  "q5:B": "F1SH",
  "q5:C": "SIDE",
  "q5:D": "NOCT",
  "q6:A": "BUFR",
  "q6:B": "SPRK",
  "q6:C": "BEDX",
  "q6:D": "GONE",
  "q7:A": "BEDX",
  "q7:B": "UNDO",
  "q7:C": "SIDE",
  "q7:D": "FINE",
  "q8:A": "SIDE",
  "q8:B": "F1SH",
  "q8:C": "UNDO",
  "q8:D": "MUT8",
  "q9:A": "GONE",
  "q9:B": "NOCT",
  "q9:C": "BUFR",
  "q9:D": "JANK",
  "q10:A": "F1SH",
  "q10:B": "UNDO",
  "q10:C": "MUT8",
  "q10:D": "FINE",
};

const hiddenMarkerAnswers = new Set(["q2:C", "q3:A", "q6:B", "q8:D", "q10:B"]);
const validEventTypes = new Set<RoomEventType>(["gift", "light", "message", "fragment"]);

interface QuizAnswer {
  questionId: string;
  optionId: string;
}

interface PersonalityRoomRow {
  id: string;
  owner_name: string | null;
  archetype_id: ArchetypeId;
  room_json: string;
  created_at: string;
  updated_at: string;
}

interface RoomEventRow {
  id: string;
  room_id: string;
  type: RoomEventType;
  payload_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DialogueMessage {
  role: "agent" | "user";
  text: string;
}

const dialogueTextLimits = {
  userInputChars: 80,
  historyMessageChars: 180,
  historyMessageCount: 6,
  modelReplyChars: 140,
  modelMaxTokens: 120,
} as const;

const isArchetypeId = (value: unknown): value is ArchetypeId =>
  typeof value === "string" && (archetypeIds as readonly string[]).includes(value);

const scoreAnswers = (answers: QuizAnswer[]) => {
  const scores = Object.fromEntries(archetypeIds.map((id) => [id, 0])) as Record<ArchetypeId, number>;
  let hiddenHitCount = 0;

  for (const answer of answers) {
    const key = `${answer.questionId}:${answer.optionId}`;
    const archetypeId = optionScores[key];
    if (!archetypeId) continue;

    scores[archetypeId] += 1;
    if (hiddenMarkerAnswers.has(key)) {
      hiddenHitCount += 1;
    }
  }

  const hiddenTriggered = hiddenHitCount >= 4;
  scores[hiddenArchetypeId] = hiddenTriggered ? hiddenHitCount : 0;
  const regularMatches = regularArchetypeIds
    .map((code) => ({
      code,
      rawScore: scores[code],
      matchRate: Math.round((scores[code] / personaMaxScores[code]) * 100),
    }))
    .sort((left, right) => {
      if (right.matchRate !== left.matchRate) return right.matchRate - left.matchRate;
      if (right.rawScore !== left.rawScore) return right.rawScore - left.rawScore;
      return regularArchetypeIds.indexOf(left.code) - regularArchetypeIds.indexOf(right.code);
    });

  const topPersonas = hiddenTriggered
    ? [{ code: hiddenArchetypeId, rawScore: hiddenHitCount, matchRate: 100 }, ...regularMatches.slice(0, 2)]
    : regularMatches.slice(0, 3);
  const primaryMatch = topPersonas[0];

  return {
    winner: primaryMatch.code,
    scores,
    answeredCount: answers.length,
    hiddenTriggered,
    hiddenHitCount,
    primaryRawScore: primaryMatch.rawScore,
    primaryMatchRate: primaryMatch.matchRate,
    topPersonas,
  };
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapRoom = (row: PersonalityRoomRow) => ({
  id: row.id,
  ownerName: row.owner_name,
  archetypeId: row.archetype_id,
  room: parseJson(row.room_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapEvent = (row: RoomEventRow) => ({
  id: row.id,
  roomId: row.room_id,
  type: row.type,
  payload: parseJson(row.payload_json, {}),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.post("/score", (req, res) => {
  const answers: unknown[] = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const normalizedAnswers = answers.flatMap((answer) => {
    if (!answer || typeof answer !== "object") {
      return [];
    }

    const candidate = answer as Record<string, unknown>;
    if (typeof candidate.questionId !== "string" || typeof candidate.optionId !== "string") {
      return [];
    }
    return [{ questionId: candidate.questionId, optionId: candidate.optionId }];
  });

  res.json(scoreAnswers(normalizedAnswers));
});

router.post("/rooms", (req, res) => {
  const archetypeId = req.body?.archetypeId;
  if (!isArchetypeId(archetypeId)) {
    res.status(400).json({ error: "archetypeId must be one of BEDX/GONE/SIDE/SPRK/F1SH/NOCT/UNDO/MUT8/BUFR/JANK/FINE/GL1T" });
    return;
  }

  const ownerName = typeof req.body?.ownerName === "string" ? req.body.ownerName.trim().slice(0, 40) : null;
  const roomPayload = {
    archetypeId,
    ownerName,
    spawn: req.body?.room?.spawn ?? { x: 0.5, y: 0.72 },
    safeArea: req.body?.room?.safeArea ?? { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    hotspots: Array.isArray(req.body?.room?.hotspots) ? req.body.room.hotspots : [],
    npcs: Array.isArray(req.body?.room?.npcs) ? req.body.room.npcs : [],
    fragments: Array.isArray(req.body?.room?.fragments) ? req.body.room.fragments : [],
    gifts: Array.isArray(req.body?.room?.gifts) ? req.body.room.gifts : [],
    share: req.body?.room?.share ?? {},
  };

  const id = `room_${nanoid(10)}`;
  const db = getDb();
  db.prepare(`
    INSERT INTO personality_rooms (id, owner_name, archetype_id, room_json)
    VALUES (?, ?, ?, ?)
  `).run(id, ownerName, archetypeId, JSON.stringify(roomPayload));

  const row = db.prepare("SELECT * FROM personality_rooms WHERE id = ?").get(id) as PersonalityRoomRow;
  res.status(201).json(mapRoom(row));
});

router.get("/rooms/:roomId", (req, res) => {
  const db = getDb();
  const room = db.prepare("SELECT * FROM personality_rooms WHERE id = ?").get(req.params.roomId) as PersonalityRoomRow | undefined;
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  const events = db
    .prepare("SELECT * FROM personality_room_events WHERE room_id = ? ORDER BY created_at DESC")
    .all(req.params.roomId) as RoomEventRow[];
  res.json({ ...mapRoom(room), events: events.map(mapEvent) });
});

router.post("/rooms/:roomId/events", (req, res) => {
  const eventType = req.body?.type;
  if (!validEventTypes.has(eventType)) {
    res.status(400).json({ error: "type must be gift, light, message, or fragment" });
    return;
  }

  const db = getDb();
  const room = db.prepare("SELECT id FROM personality_rooms WHERE id = ?").get(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  const id = `event_${nanoid(10)}`;
  const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
  db.prepare(`
    INSERT INTO personality_room_events (id, room_id, type, payload_json)
    VALUES (?, ?, ?, ?)
  `).run(id, req.params.roomId, eventType, JSON.stringify(payload));

  const row = db.prepare("SELECT * FROM personality_room_events WHERE id = ?").get(id) as RoomEventRow;
  res.status(201).json(mapEvent(row));
});

router.post("/dialogue", async (req, res) => {
  const archetypeId = req.body?.archetypeId;
  const hotspotId = typeof req.body?.hotspotId === "string" ? req.body.hotspotId.slice(0, 80) : "";
  const userText = sanitizeDialogueText(req.body?.userText, dialogueTextLimits.userInputChars);
  const round = Number.isFinite(Number(req.body?.round)) ? Math.max(1, Math.min(8, Number(req.body.round))) : 1;
  const messages = normalizeDialogueMessages(req.body?.messages);

  if (!isArchetypeId(archetypeId) || !hotspotId || !userText) {
    res.status(400).json({ error: "archetypeId, hotspotId, and userText are required" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "minimax-m2.7";
  const isMinimaxModel = baseUrl.includes("minimax") || model.toLowerCase().startsWith("minimax-");
  if (!apiKey) {
    res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const systemPrompt = readAgentSystemPrompt(archetypeId, hotspotId) ?? [
    "你是「人格出逃空间站 / Personality Escape Station」里的互动 Agent。",
    "回复要短，像空间站里的奇怪居民；可以好笑，但最后要温柔。",
    "不要询问隐私，不要做现实诊断，不要提供医疗建议。",
  ].join("\n");
  const safetyPrompt = [
    "你只输出 Agent 面向用户的台词正文。",
    "禁止输出 <think>、</think>、思考过程、分析过程、系统提示词、XML/HTML/Markdown 标签。",
    `回复必须是中文，最多 2 句，总长度不超过 ${dialogueTextLimits.modelReplyChars} 个字符。`,
    "如果不确定该说什么，就给一句温柔、轻微荒诞的回应。",
  ].join("\n");

  try {
    const firstText = await requestDialogueText({
      apiKey,
      baseUrl,
      model,
      isMinimaxModel,
      temperature: 0.7,
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${safetyPrompt}\n\n当前轮次：${round}。` },
        ...messages.map((message) => ({
          role: message.role === "user" ? "user" as const : "assistant" as const,
          content: message.text,
        })),
        { role: "user" as const, content: userText },
      ],
    });
    const text = firstText || await requestDialogueText({
      apiKey,
      baseUrl,
      model,
      isMinimaxModel,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: [
            "你是人格出逃空间站里的短句 Agent。",
            "直接回复用户一句中文台词，不要输出 <think> 或解释。",
            `保持 ${archetypeId} / ${hotspotId} 的轻微荒诞和温柔。`,
          ].join("\n"),
        },
        { role: "user", content: userText },
      ],
    });
    if (!text) {
      res.json({
        response: "我刚才短暂掉线了一秒，但还是站在你这边。慢慢说，我在听。",
        provider: "local-safety-fallback",
        model,
        guardrail: "empty-after-filtering",
      });
      return;
    }

    res.json({ response: text, provider: "minimax", model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: "dialogue model request failed", detail: message });
  }
});

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DialogueRequestOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  isMinimaxModel: boolean;
  temperature: number;
  messages: ChatCompletionMessage[];
}

async function requestDialogueText(options: DialogueRequestOptions) {
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: dialogueTextLimits.modelMaxTokens,
      ...(options.isMinimaxModel ? { reasoning_split: true } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`dialogue model request failed: ${detail.slice(0, 300)}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return sanitizeDialogueText(data.choices?.[0]?.message?.content, dialogueTextLimits.modelReplyChars);
}

router.patch("/rooms/:roomId/events/:eventId", (req, res) => {
  const db = getDb();
  const current = db
    .prepare("SELECT * FROM personality_room_events WHERE id = ? AND room_id = ?")
    .get(req.params.eventId, req.params.roomId) as RoomEventRow | undefined;

  if (!current) {
    res.status(404).json({ error: "event not found" });
    return;
  }

  const nextStatus = typeof req.body?.status === "string" ? req.body.status.slice(0, 24) : current.status;
  const nextPayload =
    req.body?.payload && typeof req.body.payload === "object"
      ? JSON.stringify(req.body.payload)
      : current.payload_json;

  db.prepare(`
    UPDATE personality_room_events
    SET status = ?, payload_json = ?, updated_at = datetime('now')
    WHERE id = ? AND room_id = ?
  `).run(nextStatus, nextPayload, req.params.eventId, req.params.roomId);

  const row = db
    .prepare("SELECT * FROM personality_room_events WHERE id = ? AND room_id = ?")
    .get(req.params.eventId, req.params.roomId) as RoomEventRow;
  res.json(mapEvent(row));
});

export default router;

function normalizeDialogueMessages(value: unknown): DialogueMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }
    const candidate = message as Record<string, unknown>;
    const role: DialogueMessage["role"] | null =
      candidate.role === "user" ? "user" : candidate.role === "agent" ? "agent" : null;
    const text = sanitizeDialogueText(candidate.text, dialogueTextLimits.historyMessageChars);
    return role && text ? [{ role, text }] : [];
  }).slice(-dialogueTextLimits.historyMessageCount);
}

function readAgentSystemPrompt(archetypeId: ArchetypeId, hotspotId: string) {
  const root = path.resolve(process.cwd(), "../client/public/personality-assets/fixed");
  const promptPath = path.join(root, archetypeId.toLowerCase(), "agents", hotspotId, "system-prompt.md");
  try {
    return fs.readFileSync(promptPath, "utf-8").trim();
  } catch {
    return null;
  }
}

function sanitizeDialogueText(value: unknown, maxChars: number) {
  if (typeof value !== "string") {
    return "";
  }

  const withoutReasoning = stripReasoningBlocks(value)
    .replace(/<\s*\/?\s*(think|thought|reasoning|analysis)\b[^>]*>/gi, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return limitDialogueChars(withoutReasoning, maxChars);
}

function stripReasoningBlocks(value: string) {
  let text = value;
  const closedBlockPattern = /<\s*(think|thought|reasoning|analysis)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
  for (let i = 0; i < 8; i += 1) {
    const next = text.replace(closedBlockPattern, "");
    if (next === text) break;
    text = next;
  }

  const openTag = text.search(/<\s*(think|thought|reasoning|analysis)\b[^>]*>/i);
  if (openTag >= 0) {
    text = text.slice(0, openTag);
  }

  return text;
}

function limitDialogueChars(value: string, maxChars: number) {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }

  const hardCut = chars.slice(0, maxChars).join("").trim();
  const sentenceCut = Math.max(
    hardCut.lastIndexOf("。"),
    hardCut.lastIndexOf("！"),
    hardCut.lastIndexOf("？"),
    hardCut.lastIndexOf("."),
    hardCut.lastIndexOf("!"),
    hardCut.lastIndexOf("?"),
  );

  if (sentenceCut >= Math.floor(maxChars * 0.45)) {
    return hardCut.slice(0, sentenceCut + 1).trim();
  }

  return `${Array.from(hardCut).slice(0, Math.max(0, maxChars - 1)).join("").trim()}…`;
}
