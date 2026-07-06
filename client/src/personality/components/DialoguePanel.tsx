import { useState, useEffect, useRef, useCallback } from 'react'
import type { WorldHotspot } from '../data/worlds'
import type { ArchetypeId, PersonaFragment } from '../data/types'
import { matchResponse } from '../lib/dialogueEngine'
import { dialogueSafetyLimits, sanitizeAgentReply, sanitizeDialogueText } from '../lib/dialogueSafety'
import styles from './DialoguePanel.module.css'

interface DialoguePanelProps {
  archetypeId: ArchetypeId
  hotspot: WorldHotspot
  fragment?: PersonaFragment
  onClose: () => void
  onFragmentCollected: (fragmentId: string) => void
  isFragmentAlreadyCollected: boolean
}

interface ChatMessage {
  id: string
  role: 'agent' | 'user'
  text: string
}

export default function DialoguePanel({
  archetypeId,
  hotspot,
  fragment,
  onClose,
  onFragmentCollected,
  isFragmentAlreadyCollected,
}: DialoguePanelProps) {
  const dialogue = hotspot.dialogue!
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [currentRound, setCurrentRound] = useState(0)
  const [isCompleted, setIsCompleted] = useState(false)
  const [showFragment, setShowFragment] = useState(false)
  const [isDisabled, setIsDisabled] = useState(isFragmentAlreadyCollected)
  const [isSending, setIsSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // 初始化 greeting
  useEffect(() => {
    setMessages([
      { id: 'greeting', role: 'agent', text: dialogue.greeting },
    ])
  }, [dialogue.greeting])

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, showFragment])

  const handleSend = useCallback(async () => {
    const text = sanitizeDialogueText(inputValue, dialogueSafetyLimits.userInputChars)
    if (!text || isDisabled || isCompleted || isSending) return

    const round = currentRound + 1

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${round}`,
      role: 'user',
      text,
    }

    const result = matchResponse(text, dialogue, round)
    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setIsSending(true)

    let responseText = sanitizeAgentReply(result.response, result.response)
    try {
      const response = await fetch('/api/personality/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetypeId,
          hotspotId: hotspot.id,
          messages: messages.slice(-dialogueSafetyLimits.historyMessageCount).map(message => ({
            role: message.role,
            text: sanitizeDialogueText(message.text, dialogueSafetyLimits.historyMessageChars),
          })),
          userText: text,
          round,
        }),
      })
      if (response.ok) {
        const payload = await response.json() as { response?: string }
        responseText = sanitizeAgentReply(payload.response, responseText)
      }
    } catch {
      responseText = sanitizeAgentReply(result.response, responseText)
    } finally {
      setIsSending(false)
    }

    const agentMsg: ChatMessage = {
      id: `agent-${round}`,
      role: 'agent',
      text: responseText,
    }

    setMessages(prev => [...prev, agentMsg])
    setCurrentRound(round)

    if (result.isComplete) {
      setIsCompleted(true)
      setIsDisabled(true)
      // 显示碎片动画
      setShowFragment(true)
      if (hotspot.fragmentId) {
        onFragmentCollected(hotspot.fragmentId)
      }
    }
  }, [archetypeId, inputValue, isDisabled, isCompleted, isSending, currentRound, dialogue, hotspot.id, hotspot.fragmentId, messages, onFragmentCollected])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.panel}>
        {/* 顶栏 */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.headerLabel}>{hotspot.label}</span>
            <span>·</span>
            <span>{dialogue.taskDescription}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* 消息列表 */}
        <div className={styles.messageList} ref={listRef}>
          {messages.map(msg => (
            <div
              key={msg.id}
              className={msg.role === 'agent' ? styles.agentBubble : styles.userBubble}
            >
              {msg.role === 'agent'
                ? sanitizeAgentReply(msg.text, '')
                : sanitizeDialogueText(msg.text, dialogueSafetyLimits.userInputChars)}
            </div>
          ))}

          {/* 碎片获取动画 */}
          {showFragment && fragment && (
            <div className={styles.fragmentCard}>
              <div className={styles.fragmentTitle}>{fragment.title}</div>
              <div className={styles.fragmentContent}>{fragment.content}</div>
            </div>
          )}
        </div>

        {/* 已探索状态 */}
        {isFragmentAlreadyCollected && (
          <div className={styles.collectedBanner}>✓ 已探索</div>
        )}

        {/* 输入区 */}
        {!isFragmentAlreadyCollected && (
          <div className={styles.inputArea}>
            <div className={styles.hintText}>💡 {dialogue.hintPlaceholder}</div>
            <div className={styles.inputRow}>
              <input
                className={styles.input}
                type="text"
                maxLength={dialogueSafetyLimits.userInputChars}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={dialogue.hintPlaceholder}
                disabled={isDisabled || isSending}
              />
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={isDisabled || isSending || !inputValue.trim()}
              >
                {isSending ? '发送中' : '发送'}
              </button>
            </div>
            <div className={styles.roundIndicator}>任务进行中 · 第 {currentRound + 1} 次回声</div>
          </div>
        )}
      </div>
    </>
  )
}
