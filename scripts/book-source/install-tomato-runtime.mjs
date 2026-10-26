import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const artifacts = {
  amd64: { name: 'Linux_musl_amd64', sha256: 'd9db872448e3cda78a18eaa3c7ee162ce631251ed51eb789f8e6676abe118722' },
  arm64: { name: 'Linux_musl_arm64', sha256: '3df139fd891ebcf88c6c8b476c755b45e61b3c31075e0b465fc9d14c46800201' },
}
const args = process.argv.slice(2)
function option(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const directory = option('--directory')
const artifact = artifacts[option('--arch')]
if (!directory || !artifact) throw new Error('Usage: node install-tomato-runtime.mjs --directory PATH --arch amd64|arm64 [--source LOCAL_BINARY]')
const target = resolve(directory)
await mkdir(target, { recursive: true })
if ((await lstat(target)).isSymbolicLink()) throw new Error('Destination must not be a symlink')
const staging = await mkdtemp(join(target, '.install-'))
const maxBytes = 32 * 1024 * 1024
try {
  let bytes
  const local = option('--source')
  if (local) {
    const info = await lstat(local)
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Invalid offline binary')
    bytes = await readFile(local)
  } else {
    const response = await fetch(`https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases/download/v2.4.15/TomatoNovelDownloader-${artifact.name}-v2.4.15`, { signal: AbortSignal.timeout(120000) })
    if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`)
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > maxBytes) throw new Error('Runtime exceeds 32 MiB')
      chunks.push(chunk)
    }
    bytes = Buffer.concat(chunks)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('SHA-256 mismatch, existing installation was not replaced')
  await writeFile(join(staging, 'downloader'), bytes, { mode: 0o755 })
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  await copyFile(join(root, 'licenses/tomato-novel-downloader-MIT.txt'), join(target, 'LICENSE'))
  await copyFile(join(root, 'licenses/tomato-novel-downloader-NOTICE.md'), join(target, 'NOTICE.md'))
  await rename(join(staging, 'downloader'), join(target, 'downloader'))
  console.log(`Installed verified v2.4.15 ${artifact.name}: ${join(target, 'downloader')}`)
} finally { await rm(staging, { recursive: true, force: true }) }
