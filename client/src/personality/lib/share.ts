import { configuredPublicAppUrl, defaultPublicAppUrl, ensureTrailingSlash } from '../config/publicUrl'

const isLoopbackHost = (hostname: string) => ['localhost', '127.0.0.1'].includes(hostname)

export const getShareUrl = () => {
  if (configuredPublicAppUrl) {
    return configuredPublicAppUrl
  }

  if (typeof window === 'undefined') {
    return defaultPublicAppUrl
  }

  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
  return isLoopbackHost(window.location.hostname) ? defaultPublicAppUrl : ensureTrailingSlash(baseUrl)
}

export const getWorldInviteUrl = (params: { visit: string; owner?: string }) => {
  const baseUrl = getShareUrl()
  const url = new URL(baseUrl)
  const searchParams = new URLSearchParams({ visit: params.visit })

  if (params.owner) {
    searchParams.set('owner', params.owner)
  }

  url.pathname = `${url.pathname.replace(/\/$/, '')}/space`
  url.search = searchParams.toString()
  url.hash = ''
  return url.toString()
}

export const shareCopy = {
  title: '人格出逃空间站',
  text: '10 道逃离题，生成你的逃离人格和专属精神空间。',
}

export const copyToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export const shareLink = async (extraText?: string, urlOverride?: string) => {
  const url = urlOverride ?? getShareUrl()
  const text = extraText ? `${extraText} ${shareCopy.text}` : shareCopy.text

  if (navigator.share) {
    await navigator.share({ title: shareCopy.title, text, url })
    return 'shared' as const
  }

  await copyToClipboard(url)
  return 'copied' as const
}

export const dataUrlToFile = async (dataUrl: string, filename: string) => {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

export const shareImageFile = async (file: File, text: string) => {
  const payload = { title: shareCopy.title, text, files: [file] }
  const canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare(payload)

  if (!navigator.share || !canShareFiles) {
    return false
  }

  await navigator.share(payload)
  return true
}
