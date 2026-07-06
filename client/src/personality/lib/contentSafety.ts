const blockedTerms = [
  '血腥',
  '暴力',
  '自杀',
  '自残',
  '疾病诊断',
  '诅咒',
  '未成年人',
  '死亡',
  '死相',
  '凉透',
  '死因',
  '葬礼',
  '坟头',
  '墓碑',
  '棺木',
  '火化',
  '地狱',
  '阴间',
  '遗体',
  '吊唁',
  '报仇',
  '扎针',
]

const softeningHints: Record<string, string> = {
  死因: '下线原因',
  葬礼: '告别式',
  遗体: '像素小人/灵魂',
  吊唁: '来看看',
  墓志铭: '出逃签名',
  阴间随礼: '像素随礼',
}

export interface ContentSafetyIssue {
  term: string
  replacement?: string
  field: string
}

export const scanText = (field: string, text: string): ContentSafetyIssue[] =>
  blockedTerms
    .filter((term) => text.includes(term))
    .map((term) => ({ term, replacement: softeningHints[term], field }))

export const scanRecord = (fieldPrefix: string, value: unknown): ContentSafetyIssue[] => {
  if (typeof value === 'string') {
    return scanText(fieldPrefix, value)
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => scanRecord(`${fieldPrefix}[${index}]`, item))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => scanRecord(`${fieldPrefix}.${key}`, item))
  }

  return []
}