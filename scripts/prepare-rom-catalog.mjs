import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const defaultCatalogUrl = 'https://gitee.com/qingfeng346/nes-roms/raw/master/catalog.json'
const defaultLocalCatalogPath = process.platform === 'win32' ? 'E:\\nes-roms\\catalog.json' : ''
const fallbackLocalCatalogPath = path.resolve(rootDir, '..', 'nes-roms', 'catalog.json')
const outputPath = path.resolve(rootDir, 'packages', 'web', 'public', 'catalog.json')

const catalog = await readCatalog()
const prepared = prepareCatalog(catalog)
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(prepared, null, 2)}\n`, 'utf8')

console.log(`ROM catalog synced: ${prepared.games.length} games -> ${path.relative(rootDir, outputPath)}`)

async function readCatalog() {
  const explicitPath = process.env.NES_ROM_CATALOG_PATH?.trim()
  const localCandidates = [explicitPath, defaultLocalCatalogPath, fallbackLocalCatalogPath].filter(Boolean)

  for (const candidate of localCandidates) {
    if (existsSync(candidate)) {
      return parseCatalog(await readFile(candidate, 'utf8'), candidate)
    }
  }

  const url = process.env.NES_ROM_CATALOG_URL?.trim() || defaultCatalogUrl
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to fetch ROM catalog: ${url} HTTP ${response.status}`)
  }
  return parseCatalog(await response.text(), url)
}

function parseCatalog(text, source) {
  const catalog = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!Array.isArray(catalog.games)) {
    throw new Error(`Invalid ROM catalog from ${source}: missing games array`)
  }
  return catalog
}

function prepareCatalog(catalog) {
  const downloadBase = process.env.NES_ROM_DOWNLOAD_BASE_URL?.trim()
  if (!downloadBase) return catalog

  return {
    ...catalog,
    rom_url_base: downloadBase,
    games: catalog.games.map((game) => ({
      ...game,
      download_url: joinUrlPath(downloadBase, romPathFromDownloadUrl(game.download_url)),
    })),
  }
}

function romPathFromDownloadUrl(url) {
  const rawPrefix = 'https://gitee.com/qingfeng346/nes-roms/raw/master/'
  if (typeof url === 'string' && url.startsWith(rawPrefix)) {
    return url.slice(rawPrefix.length)
  }
  try {
    return new URL(url).pathname.replace(/^\/+/, '')
  } catch {
    return String(url).replace(/^\/+/, '')
  }
}

function joinUrlPath(base, value) {
  return `${base.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`
}
