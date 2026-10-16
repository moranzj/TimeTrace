// 公共小工具：日期、格式化、文件读写
import fs from 'node:fs'
import path from 'node:path'

export const pad2 = (n) => String(n).padStart(2, '0')

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function parseDayKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

export function weekKey(date = new Date()) {
  const { year, week } = isoWeekInfo(date)
  return `${year}-W${pad2(week)}`
}

export function parseWeekKey(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key || ''))
  return m ? { year: Number(m[1]), week: Number(m[2]) } : null
}

/** 该 ISO 周的周一（本地 0 点） */
export function mondayOfWeek(weekKeyStr) {
  const { year, week } = parseWeekKey(weekKeyStr)
  const jan4 = new Date(year, 0, 4)
  const jan4Day = jan4.getDay() || 7
  const monday = addDays(jan4, 1 - jan4Day + (week - 1) * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export function weekDayKeys(weekKeyStr) {
  const m = mondayOfWeek(weekKeyStr)
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(m, i)))
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h} 小时 ${pad2(m)} 分`
  if (m > 0) return `${m} 分 ${pad2(s)} 秒`
  return `${s} 秒`
}

export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  n = Number(n) || 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function readJsonl(file) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') } catch { return [] }
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try { out.push(JSON.parse(s)) } catch { /* 跳过坏行 */ }
  }
  return out
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function listFiles(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

export function dirSize(dir) {
  let total = 0
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) total += dirSize(p)
      else { try { total += fs.statSync(p).size } catch { } }
    }
  } catch { }
  return total
}

/** 追加一行文本（自动忽略失败），用于日志/流水文件 */
export function logLine(file, line) {
  try {
    fs.appendFileSync(file, line + '\n', 'utf8')
  } catch { }
}
