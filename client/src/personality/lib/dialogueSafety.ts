export const dialogueSafetyLimits = {
  userInputChars: 80,
  historyMessageChars: 180,
  agentReplyChars: 140,
  historyMessageCount: 6,
} as const

export function sanitizeDialogueText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') {
    return ''
  }

  const withoutReasoning = stripReasoningBlocks(value)
    .replace(/<\s*\/?\s*(think|thought|reasoning|analysis)\b[^>]*>/gi, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return limitDialogueChars(withoutReasoning, maxChars)
}

export function sanitizeAgentReply(value: unknown, fallback: string): string {
  return (
    sanitizeDialogueText(value, dialogueSafetyLimits.agentReplyChars) ||
    sanitizeDialogueText(fallback, dialogueSafetyLimits.agentReplyChars) ||
    '它把一段内部碎碎念收进抽屉里，只留下一个很轻的点头。'
  )
}

function stripReasoningBlocks(value: string) {
  let text = value
  const closedBlockPattern = /<\s*(think|thought|reasoning|analysis)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi
  for (let i = 0; i < 8; i += 1) {
    const next = text.replace(closedBlockPattern, '')
    if (next === text) break
    text = next
  }

  const openTag = text.search(/<\s*(think|thought|reasoning|analysis)\b[^>]*>/i)
  if (openTag >= 0) {
    text = text.slice(0, openTag)
  }

  return text
}

function limitDialogueChars(value: string, maxChars: number) {
  const chars = Array.from(value)
  if (chars.length <= maxChars) {
    return value
  }

  const hardCut = chars.slice(0, maxChars).join('').trim()
  const sentenceCut = Math.max(
    hardCut.lastIndexOf('。'),
    hardCut.lastIndexOf('！'),
    hardCut.lastIndexOf('？'),
    hardCut.lastIndexOf('.'),
    hardCut.lastIndexOf('!'),
    hardCut.lastIndexOf('?'),
  )

  if (sentenceCut >= Math.floor(maxChars * 0.45)) {
    return hardCut.slice(0, sentenceCut + 1).trim()
  }

  return `${Array.from(hardCut).slice(0, Math.max(0, maxChars - 1)).join('').trim()}…`
}
