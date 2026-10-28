const PROVIDER_ICON_BASE_PATH = '/assets/provider-icons'

const PROVIDER_ICON_PATHS = {
  baiduBaike: `${PROVIDER_ICON_BASE_PATH}/baiduBaike.ico`,
  qidian: `${PROVIDER_ICON_BASE_PATH}/qidian.ico`,
  douban: `${PROVIDER_ICON_BASE_PATH}/douban.ico`,
  qimao: `${PROVIDER_ICON_BASE_PATH}/qimao.ico`,
  fanqie: `${PROVIDER_ICON_BASE_PATH}/fanqie.png`,

  google: `${PROVIDER_ICON_BASE_PATH}/google.svg`,
  goodreads: `${PROVIDER_ICON_BASE_PATH}/goodreads.svg`,
  amazon: `${PROVIDER_ICON_BASE_PATH}/amazon.svg`,
  hardcover: `${PROVIDER_ICON_BASE_PATH}/hardcover.svg`,
  openLibrary: `${PROVIDER_ICON_BASE_PATH}/openlibrary.svg`,
  itunes: `${PROVIDER_ICON_BASE_PATH}/apple-books.svg`,
  audible: `${PROVIDER_ICON_BASE_PATH}/audible.svg`,
  librofm: `${PROVIDER_ICON_BASE_PATH}/librofm.svg`,
  kobo: `${PROVIDER_ICON_BASE_PATH}/kobo.svg`,
  ranobedb: `${PROVIDER_ICON_BASE_PATH}/ranobedb.svg`,
  lubimyczytac: `${PROVIDER_ICON_BASE_PATH}/lubimyczytac.svg`,
  aladin: `${PROVIDER_ICON_BASE_PATH}/aladin.svg`,
} as const

type ProviderIconKey = keyof typeof PROVIDER_ICON_PATHS

export function providerIconPath(provider: ProviderIconKey): string {
  return PROVIDER_ICON_PATHS[provider]
}

export function providerIconPathSafe(provider: string): string | null {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ICON_PATHS, provider) ? PROVIDER_ICON_PATHS[provider as ProviderIconKey] : null
}
