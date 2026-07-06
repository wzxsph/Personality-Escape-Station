const TEMPORARY_PUBLIC_APP_URL = 'https://TIspace.weirdwork.cn/'

export const ensureTrailingSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`)

const readEnvUrl = (value: string | undefined) => {
  const trimmedValue = value?.trim()
  return trimmedValue ? ensureTrailingSlash(trimmedValue) : undefined
}

export const configuredPublicAppUrl = readEnvUrl(import.meta.env.VITE_PUBLIC_APP_URL)
export const configuredOnlineAppUrl = readEnvUrl(import.meta.env.VITE_ONLINE_APP_URL)

export const defaultPublicAppUrl = configuredPublicAppUrl ?? TEMPORARY_PUBLIC_APP_URL
export const defaultOnlineFullAppUrl = configuredOnlineAppUrl ?? configuredPublicAppUrl ?? TEMPORARY_PUBLIC_APP_URL
