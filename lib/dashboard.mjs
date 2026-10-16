// 活动面板：内置本地 Web 服务器（仅绑定 127.0.0.1，只读展示采集数据）
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonl, dirSize, listFiles, dateKey, weekDayKeys, mondayOfWeek, addDays, weekKey, pad2, fmtDur } from './util.mjs'
import { dayStats, summarizeTicks, WEEKDAY_CN } from './report.mjs'
import { llmStatus, llmChat } from './llm.mjs'

function readPid(root, name) {
  try {
    const v = Number(fs.readFileSync(path.join(root, 'data', 'run', name + '.pid'), 'utf8').trim())
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch { return 0 }
}

function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function lastTick(root, day) {
  try {
    const f = path.join(root, 'data', 'logs', 'raw', day + '.jsonl')
    const size = fs.statSync(f).size
    const start = Math.max(0, size - 8192)
    const fd = fs.openSync(f, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]) } catch { }
    }
  } catch { }
  return null
}

// 当前应用连续时长：从当日日志尾部向前扫描同应用连续段（尾部 128KB，最多回溯约 100 分钟）
function currentRun(root, day) {
  try {
    const f = path.join(root, 'data', 'logs', 'raw', day + '.jsonl')
    const size = fs.statSync(f).size
    const start = Math.max(0, size - 131072)
    const fd = fs.openSync(f, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim())
    const ticks = []
    for (let i = lines.length - 1; i >= 0 && ticks.length < 900; i--) {
      try { ticks.push(JSON.parse(lines[i])) } catch { }
    }
    if (!ticks.length) return null
    const last = ticks[0]
    let since = last.ts
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i].app !== last.app) break
      since = ticks[i].ts
    }
    const ms = Date.parse(last.ts) - Date.parse(since)
    return { app: last.app, since, minutes: Math.max(0, Math.round(ms / 60000)) }
  } catch { return null }
}

// 活跃热力图数据：按天汇总十分钟总结里的活跃秒数（轻量，不解析原始日志）
function heatmapPayload(root, days) {
  const n = Math.min(Math.max(Number(days) || 84, 7), 366)
  const map = new Map()
  for (const rec of readJsonl(path.join(root, 'data', 'summaries', 'index.jsonl'))) {
    if (!rec || !rec.day) continue
    map.set(rec.day, (map.get(rec.day) || 0) + (Number(rec.activeSec) || 0))
  }
  const out = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = dateKey(addDays(today, -i))
    out.push({ d, sec: map.get(d) || 0 })
  }
  return { days: out }
}

export function startDashboard({ root, cfg, log }) {
  const dcfg = { enabled: true, port: 8377, ...(cfg.dashboard || {}) }
  if (!dcfg.enabled) { log('活动面板：已关闭（config.dashboard.enabled=false）'); return null }
  const port = Number(dcfg.port) || 8377

  const sendJson = (res, obj) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(obj))
  }
  const sendFile = (res, file, type, cache = false) => {
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('未找到：' + path.basename(file)); return }
      res.writeHead(200, { 'content-type': type, 'cache-control': cache ? 'public, max-age=3600' : 'no-store' })
      res.end(data)
    })
  }
  const bad = (res, msg) => { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg) }

  function overview() {
    const day = dateKey()
    const st = dayStats(root, day, cfg)
    const shotDir = path.join(root, 'shots', day)
    const shots = listFiles(shotDir).filter((f) => f.endsWith('.jpg'))
    const dpid = readPid(root, 'daemon')
    const cpid = readPid(root, 'capture')
    return {
      now: new Date().toISOString(),
      day,
      daemon: { running: pidAlive(dpid), pid: dpid },
      capture: { running: pidAlive(cpid), pid: cpid },
      llm: { enabled: !!(cfg.llm && cfg.llm.enabled), model: (cfg.llm && cfg.llm.model) || '', ...llmStatus() },
      idleThresholdSeconds: cfg.idleThresholdSeconds || 60,
      current: (() => { const c = lastTick(root, day); if (c) { const r0 = currentRun(root, day); if (r0) { c.runMinutes = r0.minutes; c.runSince = r0.since } } return c })(),
      today: {
        activeSec: st.activeSec, idleSec: st.idleSec, switches: st.switches, streak: st.streak,
        firstMs: st.firstMs, lastMs: st.lastMs,
        shots: shots.length, shotsBytes: dirSize(shotDir),
        apps: st.appList.slice(0, 6),
      },
    }
  }

  function daysList() {
    return listFiles(path.join(root, 'data', 'logs', 'raw'))
      .map((f) => /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f))
      .filter(Boolean)
      .map((m) => m[1])
      .sort()
      .reverse()
  }

  function dayPayload(day) {
    const st = dayStats(root, day, cfg)
    const wl = (cfg.summaryMinutes || 10) * 60000
    const aiMap = new Map()
    for (const rec of readJsonl(path.join(root, 'data', 'summaries', 'index.jsonl'))) {
      if (rec && rec.day === day && typeof rec.aiText === 'string' && rec.aiText) aiMap.set(rec.start, rec.aiText)
    }
    const windows = []
    if (st.ticks.length > 0) {
      const firstW = Math.floor(st.firstMs / wl) * wl
      const lastW = Math.floor(st.lastMs / wl) * wl
      for (let w = firstW; w <= lastW; w += wl) {
        const s = summarizeTicks(st.ticks, w, w + wl, cfg)
        if (!s.tickCount) continue
        windows.push({
          startMs: w, endMs: w + wl,
          activeSec: s.activeSec, idleSec: s.idleSec, switches: s.switches, streak: s.streak,
          apps: s.appList.slice(0, 5),
          titles: s.titleList.slice(0, 3).map((t) => t[0]),
          ai: aiMap.get(new Date(w).toISOString()) || '',
        })
      }
    }
    const shotDir = path.join(root, 'shots', day)
    const shots = listFiles(shotDir).filter((f) => /^\d{6}\.jpg$/.test(f)).sort()
    let dayAi = ''
    try { dayAi = fs.readFileSync(path.join(root, 'data', '.ai-cache', `day-${day}.txt`), 'utf8') } catch { }
    const dt = parseDay(day)
    const prevDay = dateKey(addDays(dt || new Date(), -1))
    const pst = dayStats(root, prevDay, cfg)
    return {
      day,
      weekday: dt ? WEEKDAY_CN[dt.getDay()] : '',
      ticks: st.ticks.length,
      activeSec: st.activeSec, idleSec: st.idleSec, switches: st.switches, streak: st.streak,
      firstMs: st.firstMs, lastMs: st.lastMs,
      apps: st.appList, titles: st.titleList.slice(0, 10),
      hourly: st.hourly,
      shots, shotsBytes: dirSize(shotDir),
      windows,
      compare: { day: prevDay, activeSec: pst.activeSec, switches: pst.switches },
      ai: dayAi,
    }
  }

  function weekPayload(wk) {
    const dayList = weekDayKeys(wk)
    let totalActiveSec = 0
    const appTotals = new Map()
    const rows = dayList.map((d) => {
      const st = dayStats(root, d, cfg)
      totalActiveSec += st.activeSec
      for (const [a, s] of st.appSec) appTotals.set(a, (appTotals.get(a) || 0) + s)
      const dt = parseDay(d)
      return { day: d, weekday: dt ? WEEKDAY_CN[dt.getDay()] : '', activeSec: st.activeSec, idleSec: st.idleSec, topApps: st.appList.slice(0, 3) }
    })
    const apps = [...appTotals.entries()].sort((a, b) => b[1] - a[1])
    const prevWk = weekKey(addDays(mondayOfWeek(wk), -7))
    const prevTotalSec = weekDayKeys(prevWk).reduce((a, d) => a + dayStats(root, d, cfg).activeSec, 0)
    const busiest = rows.filter((r) => r.activeSec > 0).sort((a, b) => b.activeSec - a.activeSec)[0] || null
    let ai = ''
    try { ai = fs.readFileSync(path.join(root, 'data', '.ai-cache', `week-${wk}.txt`), 'utf8') } catch { }
    return { week: wk, days: rows, apps, totalActiveSec, prevWeek: prevWk, prevTotalSec, busiestDay: busiest ? busiest.day : null, ai }
  }

  // 「问一问」数据上下文：今天/昨天/本周统计 + 最近片段小结（供 AI 引用，控制在千余字内）
  function askContext() {
    const day = dateKey()
    const st = dayStats(root, day, cfg)
    const pday = dateKey(addDays(new Date(), -1))
    const pst = dayStats(root, pday, cfg)
    const wk = weekKey()
    const w = weekPayload(wk)
    const clock = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
    const lines = []
    lines.push(`今天 ${day}：活跃 ${fmtDur(st.activeSec)}，空闲 ${fmtDur(st.idleSec)}，切换 ${st.switches} 次` + (st.firstMs ? `，记录时段 ${clock(st.firstMs)}–${clock(st.lastMs)}` : ''))
    if (st.appList.length) lines.push('今日应用排行：' + st.appList.slice(0, 8).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、'))
    if (st.streak && st.streak.app) lines.push(`今日最长专注：${st.streak.app} ${fmtDur(st.streak.sec)}`)
    const hours = st.hourly.map((s, h) => [h, s]).filter(([, s]) => s >= 60)
    if (hours.length) lines.push('今日活跃分布：' + hours.map(([h, s]) => `${h} 点 ${Math.round(s / 60)} 分`).join('、'))
    lines.push(`昨天 ${pday}：活跃 ${fmtDur(pst.activeSec)}，切换 ${pst.switches} 次`)
    lines.push(`本周 ${wk}：总活跃 ${fmtDur(w.totalActiveSec)}；应用排行：` + (w.apps.slice(0, 6).map(([a, s]) => `${a} ${fmtDur(s)}`).join('、') || '无'))
    if (w.busiestDay) lines.push(`本周最活跃的一天：${w.busiestDay}`)
    const recs = readJsonl(path.join(root, 'data', 'summaries', 'index.jsonl')).filter((r) => r && r.day === day && r.aiText)
    if (recs.length) lines.push('今日片段小结：' + recs.slice(-8).map((r) => String(r.aiText).slice(0, 70)).join(' / '))
    let dayAi = ''
    try { dayAi = fs.readFileSync(path.join(root, 'data', '.ai-cache', `day-${day}.txt`), 'utf8') } catch { }
    if (dayAi) lines.push('今日 AI 日总结：' + dayAi.slice(0, 320))
    return lines.join('\n')
  }

  async function askPayload(q) {
    q = String(q || '').trim().slice(0, 200)
    if (!q) return { ok: false, error: '请输入问题' }
    if (!cfg.llm || !cfg.llm.enabled) return { ok: false, error: 'AI 问答未启用：在 config.local.json 配置任一 OpenAI 兼容端点（本地 Ollama 最省事，见 README「AI 总结」），然后运行 timetrace restart' }
    let ctx = ''
    try { ctx = askContext() } catch (e) { return { ok: false, error: '数据摘要构建失败：' + String(e.message || e) } }
    try {
      const answer = await llmChat(cfg.llm, {
        system: '你是「时迹」的时间数据分析助理。只依据用户电脑的本地活动统计回答，用简洁中文（不超过 150 字，可用 1–2 个要点）；数据没有覆盖的信息要直说“没有相关记录”，不要编造，也不要说“根据提供的数据”之类的客套。',
        user: `本地活动数据摘要：\n${ctx}\n\n用户的问题：${q}`,
        maxTokens: 400,
      })
      return { ok: true, answer }
    } catch (e) {
      return { ok: false, error: String(e.message || e) }
    }
  }

  function route(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1')
    const p = decodeURIComponent(u.pathname)
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(root, 'web', 'index.html'), 'text/html; charset=utf-8')
    if (p === '/favicon.ico') return sendFile(res, path.join(root, 'assets', 'activity.ico'), 'image/x-icon', true)
    if (p === '/api/overview') return sendJson(res, overview())
    if (p === '/api/days') return sendJson(res, daysList())
    if (p === '/api/day') {
      const day = u.searchParams.get('day') || dateKey()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '日期格式应为 YYYY-MM-DD')
      return sendJson(res, dayPayload(day))
    }
    if (p === '/api/week') {
      const wk = u.searchParams.get('week') || weekKey()
      if (!/^\d{4}-W\d{2}$/.test(wk)) return bad(res, '周格式应为 YYYY-Www')
      return sendJson(res, weekPayload(wk))
    }
    if (p === '/api/heatmap') return sendJson(res, heatmapPayload(root, u.searchParams.get('days')))
    if (p === '/api/ask') {
      askPayload(u.searchParams.get('q'))
        .then((r) => { try { sendJson(res, r) } catch { } })
        .catch((e) => { try { sendJson(res, { ok: false, error: String(e.message || e) }) } catch { } })
      return
    }
    const m = /^\/shot\/(\d{4}-\d{2}-\d{2})\/(\d{6})\.jpg$/.exec(p)
    if (m) return sendFile(res, path.join(root, 'shots', m[1], m[2] + '.jpg'), 'image/jpeg', true)
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('未找到')
  }

  const server = http.createServer((req, res) => {
    try { route(req, res) } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('内部错误：' + e.message)
    }
  })
  server.on('error', (e) => log(`活动面板启动失败（端口 ${port} 被占用？）：${e.message}`))
  server.listen(port, '127.0.0.1', () => log(`活动面板已就绪：http://127.0.0.1:${port}/`))
  return server
}
