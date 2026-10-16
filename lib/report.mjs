// 汇总与报告生成（模板渲染，纯函数）
import path from 'node:path'
import { readJsonl, fmtDur, fmtBytes, pad2, parseDayKey, dirSize, listFiles, weekDayKeys, mondayOfWeek, weekKey, addDays } from './util.mjs'

export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const APP_LABELS = {
  Code: 'VS Code', code: 'VS Code', msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox',
  explorer: '资源管理器', WindowsTerminal: '终端', powershell: 'PowerShell', pwsh: 'PowerShell', cmd: '命令提示符',
  wechat: '微信', WeChat: '微信', QQ: 'QQ', TIM: 'TIM', DingTalk: '钉钉', WXWork: '企业微信',
  Obsidian: 'Obsidian', Typora: 'Typora', notepad: '记事本', Notepad: '记事本',
  devenv: 'Visual Studio', idea64: 'IntelliJ IDEA', pycharm64: 'PyCharm', goland64: 'GoLand', webstorm64: 'WebStorm',
  Bilibili: '哔哩哔哩', bilibili: '哔哩哔哩', CloudMusic: '网易云音乐', QQMusic: 'QQ 音乐',
  Steam: 'Steam', Taskmgr: '任务管理器', SnippingTool: '截图工具', mstsc: '远程桌面',
}

export function appLabel(name) {
  if (!name) return '（未知）'
  return APP_LABELS[name] || name
}

const TITLE_NOISE = new Set(['', 'Default IME', 'MSCTFIME UI', 'Program Manager', 'Windows Input Experience', 'Windows Shell Experience Host'])

function isIdleTick(t, idleThreshold) {
  if (Number(t.idle || 0) >= idleThreshold) return true
  const app = t.app || ''
  return app === 'LogonUI' || app === 'LockApp'
}

const hmOf = (ms) => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 聚合 ts 落在 [startMs, endMs) 内 ticks 的统计 */
export function summarizeTicks(ticks, startMs, endMs, cfg) {
  const tickSec = cfg.tickSeconds || 10
  const idleThreshold = cfg.idleThresholdSeconds || 60
  const stats = { activeSec: 0, idleSec: 0, appSec: new Map(), titleSec: new Map(), switches: 0, streak: { app: '', sec: 0 }, firstMs: null, lastMs: null, tickCount: 0 }
  let prevApp = null
  let curApp = ''
  let curSec = 0
  for (const t of ticks) {
    const ms = Date.parse(t.ts)
    if (!Number.isFinite(ms) || ms < startMs || ms >= endMs) continue
    stats.tickCount++
    if (stats.firstMs === null) stats.firstMs = ms
    stats.lastMs = ms
    if (isIdleTick(t, idleThreshold)) {
      stats.idleSec += tickSec
      prevApp = null
      curApp = ''
      curSec = 0
      continue
    }
    stats.activeSec += tickSec
    const app = appLabel(t.app)
    stats.appSec.set(app, (stats.appSec.get(app) || 0) + tickSec)
    const title = String(t.title || '').trim()
    if (title && !TITLE_NOISE.has(title)) {
      const key = title.length > 80 ? title.slice(0, 80) : title
      stats.titleSec.set(key, (stats.titleSec.get(key) || 0) + tickSec)
    }
    if (prevApp !== null && app !== prevApp) stats.switches++
    if (curApp === app) curSec += tickSec
    else { curApp = app; curSec = tickSec }
    if (curSec > stats.streak.sec) stats.streak = { app, sec: curSec }
    prevApp = app
  }
  stats.appList = [...stats.appSec.entries()].sort((a, b) => b[1] - a[1])
  stats.titleList = [...stats.titleSec.entries()].sort((a, b) => b[1] - a[1])
  return stats
}

/** 把窗口内的活动压成“时间段”文本行（给 AI / 报告复用） */
export function compactTimeline(ticks, startMs, endMs, cfg, maxSegments = 14) {
  const tickSec = cfg.tickSeconds || 10
  const idleThreshold = cfg.idleThresholdSeconds || 60
  const segs = []
  let cur = null
  for (const t of ticks) {
    const ms = Date.parse(t.ts)
    if (!Number.isFinite(ms) || ms < startMs || ms >= endMs) continue
    if (isIdleTick(t, idleThreshold)) { cur = null; continue }
    const app = appLabel(t.app)
    const title = String(t.title || '').trim().slice(0, 60)
    if (cur && cur.app === app) {
      cur.end = ms
      if (title) cur.titles.add(title)
    } else {
      cur = { app, start: ms, end: ms, titles: new Set(title ? [title] : []) }
      segs.push(cur)
    }
  }
  let lines = segs.map((s) => {
    const t = [...s.titles][0] || (s.titles.size ? '' : '')
    const dur = fmtDur(Math.round((s.end - s.start) / 1000) + tickSec)
    return `${hmOf(s.start)}–${hmOf(s.end + tickSec * 1000)} ${s.app}${t ? ` ｜ ${t}` : ''}（${dur}）`
  })
  if (lines.length > maxSegments) lines = lines.slice(0, maxSegments).concat([`…其余 ${segs.length - maxSegments} 段省略`])
  return lines
}

/** 单个 10 分钟窗口的 markdown 小节 */
export function renderWindowMarkdown(wStartMs, wEndMs, stats, aiText) {
  const out = []
  out.push(`### ${hmOf(wStartMs)} – ${hmOf(wEndMs)}`)
  const parts = [`活跃 **${fmtDur(stats.activeSec)}**`]
  if (stats.idleSec > 0) parts.push(`空闲 ${fmtDur(stats.idleSec)}`)
  if (stats.switches > 0) parts.push(`切换 ${stats.switches} 次`)
  if (stats.streak.sec > 0) parts.push(`最长专注 ${stats.streak.app} ${fmtDur(stats.streak.sec)}`)
  out.push(`- ${parts.join(' · ')}`)
  if (stats.appList.length) {
    out.push(`- 应用：${stats.appList.slice(0, 4).map(([k, s]) => `${k} ${fmtDur(s)}`).join(' ｜ ')}`)
  }
  if (stats.titleList.length) {
    out.push(`- 窗口：${stats.titleList.slice(0, 3).map(([t]) => '`' + t.replace(/`/g, "'") + '`').join('；')}`)
  }
  if (aiText) out.push(`- 🤖 ${aiText}`)
  out.push('')
  return out.join('\n')
}

/** 读取某天原始日志并做全天聚合 */
export function dayStats(root, day, cfg) {
  const ticks = readJsonl(path.join(root, 'data', 'logs', 'raw', `${day}.jsonl`))
  const tickSec = cfg.tickSeconds || 10
  const idleThreshold = cfg.idleThresholdSeconds || 60
  const res = {
    day, ticks, activeSec: 0, idleSec: 0, appSec: new Map(), titleSec: new Map(),
    switches: 0, streak: { app: '', sec: 0 }, firstMs: null, lastMs: null,
    hourly: Array.from({ length: 24 }, () => 0),
  }
  let prevApp = null
  let curApp = ''
  let curSec = 0
  for (const t of ticks) {
    const ms = Date.parse(t.ts)
    if (!Number.isFinite(ms)) continue
    if (res.firstMs === null) res.firstMs = ms
    res.lastMs = ms
    if (isIdleTick(t, idleThreshold)) {
      res.idleSec += tickSec
      prevApp = null
      curApp = ''
      curSec = 0
      continue
    }
    res.activeSec += tickSec
    res.hourly[new Date(ms).getHours()] += tickSec
    const app = appLabel(t.app)
    res.appSec.set(app, (res.appSec.get(app) || 0) + tickSec)
    const title = String(t.title || '').trim()
    if (title && !TITLE_NOISE.has(title)) {
      const key = title.length > 80 ? title.slice(0, 80) : title
      res.titleSec.set(key, (res.titleSec.get(key) || 0) + tickSec)
    }
    if (prevApp !== null && app !== prevApp) res.switches++
    if (curApp === app) curSec += tickSec
    else { curApp = app; curSec = tickSec }
    if (curSec > res.streak.sec) res.streak = { app, sec: curSec }
    prevApp = app
  }
  res.appList = [...res.appSec.entries()].sort((a, b) => b[1] - a[1])
  res.titleList = [...res.titleSec.entries()].sort((a, b) => b[1] - a[1])
  return res
}

/** 日报 markdown */
export function buildDayReport(root, day, cfg, aiText = '') {
  const st = dayStats(root, day, cfg)
  const dt = parseDayKey(day) || new Date()
  const out = []
  out.push(`# 活动日报 · ${day}（${WEEKDAY_CN[dt.getDay()]}）`)
  out.push('')
  if (st.ticks.length === 0) {
    out.push('> 这一天没有采集到数据（程序可能未运行）。')
    return out.join('\n')
  }
  out.push(`- 首次活动：**${hmOf(st.firstMs)}** · 最后活动：**${hmOf(st.lastMs)}** · 跨度 ${fmtDur((st.lastMs - st.firstMs) / 1000)}`)
  const ratio = Math.round((st.activeSec / Math.max(1, st.activeSec + st.idleSec)) * 100)
  out.push(`- 活跃时长：**${fmtDur(st.activeSec)}** · 空闲 ${fmtDur(st.idleSec)} · 活跃占比 ${ratio}%`)
  out.push(`- 应用切换：**${st.switches} 次** · 最长专注：**${st.streak.app || '—'} ${fmtDur(st.streak.sec)}**`)

  const shotDir = path.join(root, 'shots', day)
  const shots = listFiles(shotDir).filter((f) => f.endsWith('.jpg'))
  out.push(`- 截图：**${shots.length} 张**（${fmtBytes(dirSize(shotDir))}） · 原始数据：\`data/logs/raw/${day}.jsonl\``)
  out.push('')

  out.push('## 应用时长排行')
  out.push('')
  out.push('| # | 应用 | 时长 | 占比 |')
  out.push('|---|------|------|------|')
  st.appList.slice(0, 15).forEach(([app, sec], i) => {
    out.push(`| ${i + 1} | ${app} | ${fmtDur(sec)} | ${((sec / Math.max(1, st.activeSec)) * 100).toFixed(1)}% |`)
  })
  if (st.appList.length > 15) {
    const restSec = st.appList.slice(15).reduce((a, b) => a + b[1], 0)
    out.push(`| … | 其余 ${st.appList.length - 15} 个应用 | ${fmtDur(restSec)} | ${((restSec / Math.max(1, st.activeSec)) * 100).toFixed(1)}% |`)
  }
  out.push('')

  out.push('## 每小时活跃')
  out.push('')
  for (let h = 0; h < 24; h++) {
    const sec = st.hourly[h]
    if (sec <= 0) continue
    const blocks = Math.min(24, Math.max(1, Math.round(sec / 300)))
    out.push(`- ${pad2(h)} 时 ${'█'.repeat(blocks)} ${fmtDur(sec)}`)
  }
  out.push('')

  if (st.titleList.length) {
    out.push('## 常见窗口')
    out.push('')
    for (const [t, sec] of st.titleList.slice(0, 10)) out.push(`- ${fmtDur(sec)} · \`${t.replace(/`/g, "'")}\``)
    out.push('')
  }

  if (aiText) {
    out.push('## 🤖 AI 总结')
    out.push('')
    out.push(aiText)
    out.push('')
  }

  out.push('## 十分钟切片')
  out.push('')
  const wl = (cfg.summaryMinutes || 10) * 60000
  const firstW = Math.floor(st.firstMs / wl) * wl
  const lastW = Math.floor(st.lastMs / wl) * wl
  for (let w = firstW; w <= lastW; w += wl) {
    const ws = summarizeTicks(st.ticks, w, w + wl, cfg)
    if (ws.tickCount === 0) continue
    out.push(renderWindowMarkdown(w, w + wl, ws, ''))
  }
  out.push('---')
  out.push(`_由时迹生成 · ${new Date().toLocaleString('zh-CN')}_`)
  return out.join('\n')
}

function previousWeekKey(wkey) {
  const m = mondayOfWeek(wkey)
  return weekKey(addDays(m, -7))
}

/** 周报 markdown */
export function buildWeekReport(root, wkey, cfg, aiText = '') {
  const days = weekDayKeys(wkey)
  const per = days.map((d) => ({ day: d, st: dayStats(root, d, cfg) }))
  const totalActive = per.reduce((a, x) => a + x.st.activeSec, 0)
  const appTotals = new Map()
  for (const x of per) for (const [app, sec] of x.st.appSec) appTotals.set(app, (appTotals.get(app) || 0) + sec)
  const appList = [...appTotals.entries()].sort((a, b) => b[1] - a[1])
  const activeDays = per.filter((x) => x.st.activeSec > 0)

  const out = []
  out.push(`# 活动周报 · ${wkey}`)
  out.push('')
  out.push(`- 活跃天数：**${activeDays.length} / 7** · 本周总活跃：**${fmtDur(totalActive)}** · 日均（按有数据天数）：${fmtDur(totalActive / Math.max(1, activeDays.length))}`)

  const prevTotal = weekDayKeys(previousWeekKey(wkey)).reduce((a, d) => a + dayStats(root, d, cfg).activeSec, 0)
  if (prevTotal > 0) {
    const diff = totalActive - prevTotal
    out.push(`- 较上周（${fmtDur(prevTotal)}）：**${diff >= 0 ? '+' : '−'}${fmtDur(Math.abs(diff))}**（${((diff / prevTotal) * 100).toFixed(0)}%）`)
  }
  out.push('')

  out.push('## 每日一览')
  out.push('')
  out.push('| 日期 | 星期 | 活跃时长 | 主要应用 |')
  out.push('|------|------|----------|----------|')
  for (const x of per) {
    const dt = parseDayKey(x.day) || new Date()
    const top = x.st.appList.slice(0, 3).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、') || '—'
    out.push(`| ${x.day} | ${WEEKDAY_CN[dt.getDay()]} | ${x.st.activeSec ? fmtDur(x.st.activeSec) : '—'} | ${top} |`)
  }
  out.push('')

  out.push('## 应用排行（周）')
  out.push('')
  out.push('| # | 应用 | 总时长 | 日均 | 占比 |')
  out.push('|---|------|--------|------|------|')
  appList.slice(0, 15).forEach(([app, sec], i) => {
    out.push(`| ${i + 1} | ${app} | ${fmtDur(sec)} | ${fmtDur(sec / Math.max(1, activeDays.length))} | ${((sec / Math.max(1, totalActive)) * 100).toFixed(1)}% |`)
  })
  out.push('')

  const busiest = activeDays.slice().sort((a, b) => b.st.activeSec - a.st.activeSec)[0]
  if (busiest) out.push(`- 最专注的一天：**${busiest.day}**（${fmtDur(busiest.st.activeSec)}）`)
  out.push('')

  if (aiText) {
    out.push('## 🤖 AI 总结')
    out.push('')
    out.push(aiText)
    out.push('')
  }
  out.push('---')
  out.push(`_由时迹生成 · ${new Date().toLocaleString('zh-CN')}_`)
  return out.join('\n')
}

/** 给 AI 的当天紧凑文本 */
export function dayText(root, day, cfg) {
  const st = dayStats(root, day, cfg)
  if (st.ticks.length === 0) return `日期：${day}\n（无数据）`
  const dt = parseDayKey(day) || new Date()
  const lines = []
  lines.push(`日期：${day}（${WEEKDAY_CN[dt.getDay()]}）`)
  lines.push(`活跃合计：${fmtDur(st.activeSec)}；空闲：${fmtDur(st.idleSec)}；应用切换 ${st.switches} 次；最长专注 ${st.streak.app} ${fmtDur(st.streak.sec)}`)
  lines.push(`首次活动 ${hmOf(st.firstMs)}；最后活动 ${hmOf(st.lastMs)}`)
  lines.push(`应用时长：${st.appList.slice(0, 12).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、')}`)
  const hours = st.hourly.map((s, h) => (s > 0 ? `${pad2(h)} 时 ${Math.round(s / 60)} 分` : null)).filter(Boolean).join('，')
  lines.push(`按小时活跃：${hours}`)
  const segs = compactTimeline(st.ticks, st.firstMs, st.lastMs + 60000, cfg, 20)
  if (segs.length) lines.push(`主要轨迹：\n${segs.join('\n')}`)
  return lines.join('\n')
}

/** 给 AI 的当周紧凑文本 */
export function weekText(root, wkey, cfg) {
  const days = weekDayKeys(wkey)
  const per = days.map((d) => ({ day: d, st: dayStats(root, d, cfg) }))
  const total = per.reduce((a, x) => a + x.st.activeSec, 0)
  const appTotals = new Map()
  for (const x of per) for (const [app, sec] of x.st.appSec) appTotals.set(app, (appTotals.get(app) || 0) + sec)
  const appList = [...appTotals.entries()].sort((a, b) => b[1] - a[1])
  const lines = []
  lines.push(`周：${wkey}；总活跃：${fmtDur(total)}`)
  for (const x of per) {
    if (x.st.activeSec <= 0) continue
    const dt = parseDayKey(x.day) || new Date()
    lines.push(`${x.day}（${WEEKDAY_CN[dt.getDay()]}）活跃 ${fmtDur(x.st.activeSec)}，主要：${x.st.appList.slice(0, 4).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、')}`)
  }
  lines.push(`整周应用排行：${appList.slice(0, 10).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、')}`)
  return lines.join('\n')
}
