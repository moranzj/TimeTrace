#!/usr/bin/env node
// 语法检查：对仓库内所有 .mjs 运行 node --check（CI 用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'data', 'shots', '.git', 'dist'])

function walk(dir, out = []) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && p.endsWith('.mjs')) out.push(p)
  }
  return out
}

const files = walk(ROOT)
let bad = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    bad++
    console.error(`✗ ${path.relative(ROOT, f)}\n${r.stderr || ''}`)
  }
}
console.log(bad === 0 ? `✓ 语法检查通过（${files.length} 个 .mjs 文件）` : `✗ ${bad} 个文件有问题`)
process.exit(bad === 0 ? 0 : 1)
