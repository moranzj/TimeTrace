#!/usr/bin/env node
// 时迹 · 主控进程
//  - 守护 capture.ps1：每 N 秒记录前台应用 / 窗口标题 / 空闲时间 / 截图
//  - 每 10 分钟生成一次活动总结（可选叠加 AI 解读）
//  - 实时刷新当日日报；跨天固化日报；周报实时/固化
//  - 截图保留期 + 磁盘配额清理
//
// 用法：
//   node daemon.mjs                启动守护进程（推荐用 start.vbs 隐藏窗口启动）
//   node daemon.mjs --status       查看状态与今日概览
//   node daemon.mjs --summary-now  预览当前 10 分钟窗口的总结
//   node daemon.mjs --test-ai      测试 AI 总结链路
//   node daemon.mjs --rebuild-day 2026-10-16
//   node daemon.mjs --rebuild-week 2026-W42
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dateKey, pad2, weekKey, fmtDur, fmtBytes, ensureDir, dirSize, listFiles, logLine } from './lib/util.mjs'
import { buildDayReport, buildWeekReport, summarizeTicks, renderWindowMarkdown, compactTimeline, dayStats, dayText, weekText } from './lib/report.mjs'
import { aiForWindow, aiForDay, aiForWeek } from './lib/llm.mjs'
import { startDashboard } from './lib/dashboard.mjs'
import { loadConfig } from './lib/config.mjs'
import { resolveCaptureLaunch } from './lib/platform.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const P = (...s) => path.join(ROOT, ...s)

// 配置：config.json（默认值）+ config.local.json（本机覆盖，不进 git）
const cfg = loadConfig(ROOT)

const D = {
  raw: P('data', 'logs', 'raw'),
  apps: P('data', 'logs', 'apps'),
  summaries: P('data', 'summaries'),
  reports: P('data', 'reports'),
  run: P('data', 'run'),
  aiCache: P('data', '.ai-cache'),
  shots: P('shots'),
  log: P('data', 'run', 'daemon.log'),
}

// ---------- 日志 ----------
function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`
  console.log(line)
  try {
    if (fs.existsSync(D.log) && fs.statSync(D.log).size > 5 * 1024 * 1024) {
      try { fs.rmSync(D.log + '.old', { force: true }) } catch { }
      fs.renameSync(D.log, D.log + '.old')
    }
  } catch { }
  logLine(D.log, line)
}

let lastAiErrAt = 0
function logAiError(msg) {
  if (Date.now() - lastAiErrAt > 30 * 60000) {
    lastAiErrAt = Date.now()
    log(`AI 总结调用失败（会自动降级为模板，30 分钟内不再提示）：${msg}`)
  }
}

function readPid(file) {
  try {
    const v = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch { return 0 }
}

function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

// ---------- 数据摄入 ----------
let ticks = []
let ingestState = { file: '', offset: 0, partial: '' }
let currentDay = dateKey(new Date())

function ingest() {
  const day = dateKey(new Date())
  const file = path.join(D.raw, day + '.jsonl')
  if (ingestState.file !== file) {
    ingestState = { file, offset: 0, partial: '' }
    ticks = []
  }
  let size = 0
  try { size = fs.statSync(file).size } catch { return }
  if (size < ingestState.offset) { ingestState.offset = 0; ingestState.partial = ''; ticks = [] }
  if (size === ingestState.offset) {
    if (day !== currentDay) rollDay(day)
    return
  }
  let text = ''
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - ingestState.offset)
    const read = fs.readSync(fd, buf, 0, buf.length, ingestState.offset)
    fs.closeSync(fd)
    text = buf.subarray(0, read).toString('utf8')
  } catch { return }
  ingestState.offset = size
  const merged = ingestState.partial + text.replace(/^\uFEFF/, '')
  const lines = merged.split('\n')
  ingestState.partial = lines.pop()
  for (const l of lines) {
    const s = l.trim()
    if (!s) continue
    try { ticks.push(JSON.parse(s)) } catch { }
  }
  if (day !== currentDay) rollDay(day)
}

function rollDay(newDay) {
  const old = currentDay
  currentDay = newDay
  log(`日期切换：${old} → ${newDay}`)
  void (async () => {
    try { await regenerateDay(old) } catch (e) { log(`固化日报失败：${e.message}`) }
    try {
      const nd = new Date(newDay + 'T12:00:00')
      if (nd.getDay() === 1) {
        const prev = weekKey(new Date(new Date(old + 'T12:00:00').getTime() - 4 * 86400000))
        await regenerateWeek(prev, { final: true })
      }
      await regenerateWeek(weekKey())
    } catch (e) { log(`刷新周报失败：${e.message}`) }
  })()
}

// ---------- AI 缓存 ----------
function aiCachePath(key) { return path.join(D.aiCache, key + '.txt') }
function cachedAi(key, maxAgeMs = Infinity) {
  try {
    const f = aiCachePath(key)
    const s = fs.statSync(f)
    if (Date.now() - s.mtimeMs <= maxAgeMs) return fs.readFileSync(f, 'utf8')
  } catch { }
  return null
}
function saveAi(key, text) {
  ensureDir(D.aiCache)
  try { fs.writeFileSync(aiCachePath(key), text, 'utf8') } catch { }
}

// ---------- 日报 / 周报 ----------
const dayInflight = new Map()

async function regenerateDay(day, { final = false } = {}) {
  if (dayInflight.has(day)) return dayInflight.get(day)
  const p = doRegenerateDay(day, final).finally(() => dayInflight.delete(day))
  dayInflight.set(day, p)
  return p
}

async function doRegenerateDay(day, final) {
  const st = dayStats(ROOT, day, cfg)
  if (st.ticks.length === 0 && !fs.existsSync(path.join(D.reports, day + '.md'))) return
  const key = `day-${day}`
  let ai = cachedAi(key, final ? 0 : 60 * 60000)
  if (ai === null && cfg.llm.enabled && cfg.llm.daySummary) {
    try {
      ai = await aiForDay(cfg.llm, dayText(ROOT, day, cfg))
      saveAi(key, ai)
    } catch (e) {
      logAiError(e.message)
      ai = cachedAi(key, Infinity) || ''
    }
  }
  const md = buildDayReport(ROOT, day, cfg, ai || '')
  ensureDir(D.reports)
  fs.writeFileSync(path.join(D.reports, day + '.md'), md, 'utf8')
  ensureDir(D.apps)
  fs.writeFileSync(path.join(D.apps, day + '.json'), JSON.stringify({
    day, activeSec: st.activeSec, idleSec: st.idleSec,
    apps: Object.fromEntries(st.appList), generatedAt: new Date().toISOString(),
  }, null, 2))
}

const weekInflight = new Map()

async function regenerateWeek(wkey, { final = false } = {}) {
  if (weekInflight.has(wkey)) return weekInflight.get(wkey)
  const p = doRegenerateWeek(wkey, final).finally(() => weekInflight.delete(wkey))
  weekInflight.set(wkey, p)
  return p
}

async function doRegenerateWeek(wkey, final) {
  const hasAny = (await Promise.resolve(listFiles(D.reports))).some((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  if (!hasAny) return
  const key = `week-${wkey}`
  let ai = cachedAi(key, final ? 0 : 6 * 3600000)
  if (ai === null && cfg.llm.enabled && cfg.llm.weekSummary) {
    try {
      ai = await aiForWeek(cfg.llm, weekText(ROOT, wkey, cfg))
      saveAi(key, ai)
    } catch (e) {
      logAiError(e.message)
      ai = cachedAi(key, Infinity) || ''
    }
  }
  const md = buildWeekReport(ROOT, wkey, cfg, ai || '')
  ensureDir(D.reports)
  fs.writeFileSync(path.join(D.reports, `${wkey}.md`), md, 'utf8')
}

// ---------- 10 分钟总结 ----------
const wl = cfg.summaryMinutes * 60000
let pendingStart = Math.floor(Date.now() / wl) * wl
let summarizing = false

async function summaryTick() {
  if (summarizing) return
  const cur = Math.floor(Date.now() / wl) * wl
  if (cur === pendingStart) return
  if (cur < pendingStart) { pendingStart = cur; return }
  summarizing = true
  try {
    let guard = 0
    while (pendingStart < cur && guard++ < 500) {
      const s = pendingStart
      const e = pendingStart + wl
      pendingStart = e
      await writeWindowSummary(s, e)
    }
    if (pendingStart < cur) pendingStart = cur
  } finally {
    summarizing = false
  }
}

async function writeWindowSummary(startMs, endMs) {
  const st = summarizeTicks(ticks, startMs, endMs, cfg)
  if (st.tickCount === 0) return
  let ai = ''
  if (cfg.llm.enabled && cfg.llm.minuteSummary) {
    try { ai = await aiForWindow(cfg.llm, compactTimeline(ticks, startMs, endMs, cfg)) } catch (e) { logAiError(e.message) }
  }
  const md = renderWindowMarkdown(startMs, endMs, st, ai)
  const day = dateKey(new Date(startMs))
  ensureDir(D.summaries)
  const file = path.join(D.summaries, `${day}.md`)
  if (!fs.existsSync(file)) fs.appendFileSync(file, `# 十分钟总结 · ${day}\n\n`, 'utf8')
  fs.appendFileSync(file, md, 'utf8')
  logLine(path.join(D.summaries, 'index.jsonl'), JSON.stringify({
    day, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
    activeSec: st.activeSec, idleSec: st.idleSec, switches: st.switches,
    apps: st.appList.slice(0, 5), ai: ai ? 1 : 0, aiText: ai || '',
  }))
  await regenerateDay(day)
  const hm = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
  log(`10 分钟总结 [${hm(startMs)}–${hm(endMs)}] 已写入（活跃 ${Math.round(st.activeSec / 60)} 分${ai ? '，含 AI' : '，模板'}）`)
}

// ---------- 截图/日志清理 ----------
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }) } catch { } }

function cleanupShots() {
  // 可选：按天保留（screenshotDays > 0 时启用）
  const keepDays = Number(cfg.retention.screenshotDays) || 0
  if (keepDays > 0) {
    for (const d of listFiles(D.shots).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort()) {
      const ms = Date.parse(d + 'T12:00:00')
      if (Number.isFinite(ms) && (Date.now() - ms) / 86400000 > keepDays) {
        rmrf(path.join(D.shots, d))
        log(`已删除过期截图目录 shots/${d}（超过 ${keepDays} 天）`)
      }
    }
  }
  // 总量上限：到达上限后，从最早的一张截图开始删除（滚动保留最近的截图）
  const maxBytes = Math.max(0.1, Number(cfg.retention.maxScreenshotGB) || 1) * 1024 ** 3
  const all = []
  let total = 0
  for (const d of listFiles(D.shots).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort()) {
    const dir = path.join(D.shots, d)
    for (const f of listFiles(dir)) {
      if (!/^\d{6}\.jpg$/.test(f)) continue
      let size = 0
      try { size = fs.statSync(path.join(dir, f)).size } catch { continue }
      const ms = Date.parse(`${d}T${f.slice(0, 2)}:${f.slice(2, 4)}:${f.slice(4, 6)}`)
      all.push({ day: d, file: f, ms: Number.isFinite(ms) ? ms : 0, size })
      total += size
    }
  }
  if (total <= maxBytes) return
  all.sort((a, b) => (a.ms - b.ms) || (a.file < b.file ? -1 : 1))
  const touched = new Set()
  let removed = 0
  let removedBytes = 0
  for (const it of all) {
    if (total <= maxBytes) break
    try {
      fs.rmSync(path.join(D.shots, it.day, it.file), { force: true })
      total -= it.size
      removed++
      removedBytes += it.size
      touched.add(it.day)
    } catch { }
  }
  for (const d of touched) {
    try {
      const dir = path.join(D.shots, d)
      if (listFiles(dir).length === 0) fs.rmSync(dir, { force: true })
    } catch { }
  }
  if (removed > 0) log(`截图总量已达上限，删除最早的 ${removed} 张（${fmtBytes(removedBytes)}），当前 ${fmtBytes(total)} / 上限 ${fmtBytes(maxBytes)}`)
}

function cleanupRaw() {
  for (const f of listFiles(D.raw)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)
    if (!m) continue
    const ms = Date.parse(m[1] + 'T12:00:00')
    if (Number.isFinite(ms) && (Date.now() - ms) / 86400000 > cfg.retention.rawLogDays) {
      rmrf(path.join(D.raw, f))
      log(`已删除过期日志 ${f}`)
    }
  }
}

function maintenance() {
  try { cleanupShots() } catch (e) { log(`清理截图失败：${e.message}`) }
  try { cleanupRaw() } catch (e) { log(`清理日志失败：${e.message}`) }
}

// ---------- 采集进程守护 ----------
let captureProc = null
let shuttingDown = false

function killStaleCapture() {
  const pf = path.join(D.run, 'capture.pid')
  const pid = readPid(pf)
  if (pid && pidAlive(pid)) {
    try { process.kill(pid) ; log(`结束残留采集进程 ${pid}`) } catch { }
  }
  try { fs.unlinkSync(pf) } catch { }
}

// 采集器启动方式由平台决定：Windows = capture.exe，macOS/Linux = capture.mjs
function startCapture() {
  const launch = resolveCaptureLaunch({ root: ROOT, cfg, log })
  if (!launch) {
    if (!shuttingDown) setTimeout(() => { if (!shuttingDown && !captureProc) startCapture() }, 30000)
    return
  }
  captureProc = spawn(launch.cmd, launch.args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  log(`采集进程已启动（${launch.label}，PID ${captureProc.pid}，每 ${cfg.tickSeconds} 秒一轮）`)
  captureProc.stdout.on('data', (d) => {
    const s = String(d).trim()
    if (s) log(`采集输出：${s.slice(0, 200)}`)
  })
  captureProc.stderr.on('data', (d) => {
    const s = String(d).trim()
    if (s) log(`采集错误：${s.slice(0, 300)}`)
  })
  captureProc.on('exit', (code) => {
    log(`采集进程退出（code ${code}）`)
    captureProc = null
    if (!shuttingDown) {
      setTimeout(() => {
        if (!shuttingDown && !captureProc) {
          log('重新启动采集进程…')
          try { startCapture() } catch (e) { log(`采集进程启动失败：${e.message}`) }
        }
      }, 5000)
    }
  })
  captureProc.on('error', (e) => log(`采集进程错误：${e.message}`))
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  log('收到退出信号，正在停止…')
  try { if (captureProc) captureProc.kill() } catch { }
  try { fs.unlinkSync(path.join(D.run, 'daemon.pid')) } catch { }
  setTimeout(() => process.exit(0), 300).unref?.()
}

// ---------- 状态 ----------
function statusCmd() {
  const day = dateKey(new Date())
  const st = dayStats(ROOT, day, cfg)
  const dpid = readPid(path.join(D.run, 'daemon.pid'))
  const cpid = readPid(path.join(D.run, 'capture.pid'))
  const shots = listFiles(path.join(D.shots, day)).filter((f) => f.endsWith('.jpg'))
  console.log('时迹状态')
  console.log(`  守护进程：${dpid && pidAlive(dpid) ? `运行中（PID ${dpid}）` : '未运行'}`)
  console.log(`  采集进程：${cpid && pidAlive(cpid) ? `运行中（PID ${cpid}）` : '未运行'}`)
  console.log(`  今日（${day}）：活跃 ${fmtDur(st.activeSec)}，空闲 ${fmtDur(st.idleSec)}，切换 ${st.switches} 次`)
  console.log(`  今日截图：${shots.length} 张（${fmtBytes(dirSize(path.join(D.shots, day)))}）`)
  console.log(`  应用排行：${st.appList.slice(0, 5).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、') || '暂无数据'}`)
  console.log(`  今日报告：data/reports/${day}.md`)
  console.log(`  十分钟总结：data/summaries/${day}.md`)
  console.log(`  本周报告：data/reports/${weekKey()}.md`)
  console.log(`  AI 总结：${cfg.llm.enabled ? `开启（${cfg.llm.model}）` : '关闭'}`)
}

// ---------- 启动 ----------
function run() {
  ensureDir(D.raw); ensureDir(D.apps); ensureDir(D.summaries); ensureDir(D.reports); ensureDir(D.run); ensureDir(D.aiCache)
  const pidFile = path.join(D.run, 'daemon.pid')
  const old = readPid(pidFile)
  if (old && pidAlive(old)) {
    console.error(`时迹已在运行（PID ${old}）。如需重启：timetrace restart（或先 stop 再 start）`)
    process.exit(1)
  }
  fs.writeFileSync(pidFile, String(process.pid), 'ascii')

  ingest()
  killStaleCapture()
  log(`时迹启动（PID ${process.pid}，Node ${process.version}）`)
  log(`配置：每 ${cfg.tickSeconds} 秒采集 · 每 ${cfg.summaryMinutes} 分钟总结 · 截图${cfg.screenshots.enabled ? `开（宽 ≤ ${cfg.screenshots.maxWidth}，质量 ${cfg.screenshots.quality}）` : '关'} · 截图滚动保留 ≤ ${cfg.retention.maxScreenshotGB} GB（超出自动删最早的）${Number(cfg.retention.screenshotDays) > 0 ? ` · 另按天保留 ${cfg.retention.screenshotDays} 天` : ''}`)
  if (cfg.llm.enabled) log(`AI 总结：开启（${cfg.llm.baseURL} · ${cfg.llm.model}）`)
  else log('AI 总结：关闭（仅模板统计；可在 config.local.json 打开，见 README）')

  startCapture()
  startDashboard({ root: ROOT, cfg, log })
  setInterval(() => { try { ingest() } catch (e) { log(`数据读取失败：${e.message}`) } }, 3000)
  setInterval(() => { void summaryTick().catch((e) => log(`总结失败：${e.message}`)) }, 5000)
  setInterval(() => { try { maintenance() } catch (e) { log(`维护任务失败：${e.message}`) } }, 10 * 60000)

  void regenerateDay(dateKey()).catch(() => { })
  void regenerateWeek(weekKey()).catch(() => { })

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// ---------- CLI ----------
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

if (has('--help')) {
  console.log(`时迹（activity-tracker）

  node daemon.mjs                启动守护进程
  node daemon.mjs --status       查看状态与今日概览
  node daemon.mjs --summary-now  预览当前窗口总结
  node daemon.mjs --test-ai      测试 AI 总结链路
  node daemon.mjs --rebuild-day [YYYY-MM-DD]
  node daemon.mjs --rebuild-week [YYYY-Www]
`)
} else if (has('--status')) {
  statusCmd()
} else if (has('--summary-now')) {
  const now = Date.now()
  const start = Math.floor(now / wl) * wl
  ingest()
  const st = summarizeTicks(ticks, start, now, cfg)
  if (st.tickCount === 0) {
    console.log('当前窗口暂无数据（守护进程可能未在运行？）')
  } else {
    console.log(renderWindowMarkdown(start, now, st, ''))
  }
} else if (has('--test-ai')) {
  if (!cfg.llm.enabled) {
    console.log('AI 总结未启用（config.json -> llm.enabled = false）')
  } else {
    try {
      const out = await aiForWindow(cfg.llm, [
        '10:00–10:05 VS Code ｜ index.mjs（5 分）',
        '10:05–10:08 Edge ｜ 搜索：Node.js 定时器（3 分）',
      ])
      console.log(`模型：${cfg.llm.model}`)
      console.log(`回答：${out}`)
    } catch (e) {
      console.log(`AI 调用失败：${e.message}`)
    }
  }
} else if (has('--rebuild-day')) {
  const day = val('--rebuild-day') || dateKey(new Date(Date.now() - 86400000))
  await regenerateDay(day)
  console.log(`已重建日报：data/reports/${day}.md`)
} else if (has('--rebuild-week')) {
  const w = val('--rebuild-week') || weekKey()
  await regenerateWeek(w)
  console.log(`已重建周报：data/reports/${w}.md`)
} else {
  run()
}
