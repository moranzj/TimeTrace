#!/usr/bin/env node
// 图标打包：从 assets/iconset/timetrace-*.png 生成 macOS .icns 与 Linux 用 PNG
// 用法：node tools/make-icons.mjs [--iconset <目录>] [--out <目录>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// icns 类型 → 像素尺寸（PNG 数据条目）
export const ICNS_TYPES = [
  ['ic11', 32],   // 16x16@2x
  ['ic12', 64],   // 32x32@2x
  ['ic07', 128],  // 128x128
  ['ic13', 256],  // 128x128@2x
  ['ic08', 256],  // 256x256
  ['ic14', 512],  // 256x256@2x
  ['ic09', 512],  // 512x512
  ['ic10', 1024], // 512x512@2x
]

export function buildIcns(pngBySize) {
  const entries = []
  for (const [type, size] of ICNS_TYPES) {
    const data = pngBySize[size]
    if (data) entries.push({ type, data })
  }
  if (!entries.length) throw new Error('没有可用的 PNG 资源')
  let total = 8
  for (const e of entries) total += 8 + e.data.length
  const buf = Buffer.alloc(total)
  buf.write('icns', 0, 'ascii')
  buf.writeUInt32BE(total, 4)
  let off = 8
  for (const e of entries) {
    buf.write(e.type, off, 'ascii')
    buf.writeUInt32BE(8 + e.data.length, off + 4)
    e.data.copy(buf, off + 8)
    off += 8 + e.data.length
  }
  return buf
}

function main() {
  const argv = process.argv.slice(2)
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const setDir = path.resolve(arg('--iconset', path.join(ROOT, 'assets', 'iconset')))
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'assets')))
  const pngBySize = {}
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    try { pngBySize[size] = fs.readFileSync(path.join(setDir, `timetrace-${size}.png`)) } catch { }
  }
  if (!pngBySize[256]) {
    console.error(`缺少 ${path.join(setDir, 'timetrace-256.png')}（先用 tools/makeicon.cs --png <目录> 生成）`)
    process.exit(1)
  }
  const icns = buildIcns(pngBySize)
  fs.writeFileSync(path.join(outDir, 'timetrace.icns'), icns)
  fs.writeFileSync(path.join(outDir, 'timetrace.png'), pngBySize[256])
  if (pngBySize[512]) fs.writeFileSync(path.join(outDir, 'timetrace-512.png'), pngBySize[512])
  console.log(`✓ ${path.join(outDir, 'timetrace.icns')}（${icns.length} 字节）`)
  console.log(`✓ ${path.join(outDir, 'timetrace.png')}${pngBySize[512] ? ' + timetrace-512.png' : ''}`)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) main()
