export type RomEntry = {
  name: string
  genre?: string
  publisher?: string
  tags?: string[]
  download_url: string
  file_size: number
  sha256: string
  mapper?: number
}

export type RomCatalog = {
  source?: string
  version?: number
  captured_at?: string
  updated_at?: string
  count?: number
  games: RomEntry[]
}

export const DEFAULT_CATALOG_URL = 'https://gitee.com/qingfeng346/nes-roms/raw/master/catalog.json'

export function emptyRomCatalog(): RomCatalog {
  return {
    source: DEFAULT_CATALOG_URL,
    games: [],
  }
}

export async function loadRomCatalog(url = DEFAULT_CATALOG_URL): Promise<RomCatalog> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`读取 ROM 目录失败: HTTP ${response.status}`)
  }
  const catalog = (await response.json()) as RomCatalog
  if (!Array.isArray(catalog.games)) {
    throw new Error('ROM 目录格式无效')
  }
  for (const game of catalog.games) {
    if (!game.name || !game.download_url || !game.sha256 || typeof game.file_size !== 'number') {
      throw new Error('ROM 目录缺少必要字段')
    }
  }
  return catalog
}

export function listGenres(games: RomEntry[]): string[] {
  return Array.from(new Set(games.map((game) => game.genre).filter(Boolean) as string[])).sort(
    (a, b) => a.localeCompare(b, 'zh-Hans-CN'),
  )
}

export function searchRoms(
  games: RomEntry[],
  query: string,
  genre: string,
  downloadedOnly: boolean,
  cachedKeys: Set<string>,
): RomEntry[] {
  const q = normalize(query)
  return games.filter((game) => {
    if (downloadedOnly && !cachedKeys.has(romKey(game))) return false
    if (genre && game.genre !== genre) return false
    if (!q) return true
    return searchableText(game).includes(q)
  })
}

export function romKey(game: RomEntry): string {
  return game.sha256
}

function searchableText(game: RomEntry): string {
  return normalize(
    [
      game.name,
      game.genre,
      game.publisher,
      game.mapper,
      ...(game.tags ?? []),
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(' '),
  )
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('zh-Hans-CN')
}
