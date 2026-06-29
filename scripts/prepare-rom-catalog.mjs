import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const defaultCatalogUrl = 'https://raw.githubusercontent.com/while-coder/nes-roms/main/catalog.json'
const defaultLocalCatalogPath = process.platform === 'win32' ? 'E:\\nes-roms\\catalog.json' : ''
const fallbackLocalCatalogPath = path.resolve(rootDir, '..', 'nes-roms', 'catalog.json')
// 输出路径:优先 CLI 参数,其次 env,默认 web 包的 public(不破坏 web 既有流程)。
// 路径相对仓库根解析,便于各包在自己的 npm script 里指定自身 public 目录。
const outputArg = process.argv[2] || process.env.NES_ROM_CATALOG_OUT
const outputPath = outputArg
  ? path.resolve(rootDir, outputArg)
  : path.resolve(rootDir, 'packages', 'web', 'public', 'catalog.json')

const catalog = await readCatalog()
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

console.log(`ROM catalog synced: ${catalog.games.length} games -> ${path.relative(rootDir, outputPath)}`)

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
