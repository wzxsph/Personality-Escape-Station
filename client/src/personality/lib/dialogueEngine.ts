import type { HotspotDialogueTask } from '../data/types'

export interface DialogueResult {
  response: string
  isComplete: boolean
  isMaxRound: boolean
}

/**
 * 匹配用户输入，返回Agent回复
 */
export function matchResponse(
  userInput: string,
  task: HotspotDialogueTask,
  currentRound: number
): DialogueResult {
  const normalizedInput = userInput.trim().toLowerCase()

  // 优先匹配最长关键词（避免短关键词误触发）
  const sortedResponses = [...task.responses].sort((a, b) => {
    const maxLenA = Math.max(...a.keywords.map(k => k.length))
    const maxLenB = Math.max(...b.keywords.map(k => k.length))
    return maxLenB - maxLenA
  })

  for (const resp of sortedResponses) {
    const matched = resp.keywords.some(keyword =>
      normalizedInput.includes(keyword.toLowerCase())
    )
    if (matched) {
      return {
        response: resp.response,
        isComplete: resp.isTaskComplete ?? false,
        isMaxRound: currentRound >= task.maxRounds,
      }
    }
  }

  // 无匹配
  return {
    response: task.fallbackResponse,
    isComplete: false,
    isMaxRound: currentRound >= task.maxRounds,
  }
}
