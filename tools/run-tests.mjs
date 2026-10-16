#!/usr/bin/env node
// 运行 tests/ 下全部 *.test.mjs（显式文件列表：跨 Node 版本与 Windows cmd 都稳妥）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(ROOT, 'tests')
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f))
  : []
if (!files.length) {
  console.error('没有找到测试文件（tests/*.test.mjs）')
  process.exit(1)
}
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(r.status || 0)
