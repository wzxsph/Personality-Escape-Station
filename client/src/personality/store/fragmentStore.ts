import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const COOLDOWN_MS = 30_000

interface FragmentState {
  /** worldId → 已收集的 fragmentId 数组 */
  collected: Record<string, string[]>
  /** 各hotspot的冷却时间戳 (hotspotId → timestamp) */
  cooldowns: Record<string, number>

  /** 收集碎片 */
  addFragment: (worldId: string, fragmentId: string) => void
  /** 获取某世界的收集进度 */
  getWorldProgress: (worldId: string, totalFragments: number) => { collected: number; total: number }
  /** 判断某世界是否收集完毕 */
  isWorldComplete: (worldId: string, totalFragments: number) => boolean
  /** 判断某碎片是否已收集 */
  isFragmentCollected: (worldId: string, fragmentId: string) => boolean
  /** 设置冷却时间 */
  setCooldown: (hotspotId: string) => void
  /** 检查冷却是否结束（30秒） */
  isCoolingDown: (hotspotId: string) => boolean
}

export const useFragmentStore = create<FragmentState>()(
  persist(
    (set, get) => ({
      collected: {},
      cooldowns: {},

      addFragment: (worldId, fragmentId) => {
        const state = get()
        const existing = state.collected[worldId] ?? []
        if (existing.includes(fragmentId)) return
        set({
          collected: {
            ...state.collected,
            [worldId]: [...existing, fragmentId],
          },
        })
      },

      getWorldProgress: (worldId, totalFragments) => {
        const collected = get().collected[worldId]?.length ?? 0
        return { collected, total: totalFragments }
      },

      isWorldComplete: (worldId, totalFragments) => {
        return (get().collected[worldId]?.length ?? 0) >= totalFragments
      },

      isFragmentCollected: (worldId, fragmentId) => {
        return get().collected[worldId]?.includes(fragmentId) ?? false
      },

      setCooldown: (hotspotId) => {
        set((state) => ({
          cooldowns: { ...state.cooldowns, [hotspotId]: Date.now() },
        }))
      },

      isCoolingDown: (hotspotId) => {
        const timestamp = get().cooldowns[hotspotId]
        if (!timestamp) return false
        return Date.now() - timestamp < COOLDOWN_MS
      },
    }),
    {
      name: 'persona-fragments',
      partialize: (state) => ({ collected: state.collected, cooldowns: state.cooldowns }),
    },
  ),
)
