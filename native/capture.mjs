#!/usr/bin/env node
// 时迹 · 跨平台采集器（macOS / Linux）
// 与 native/capture.cs（Windows）输出完全相同的契约：
//   - 每 tick 秒向 data/logs/raw/YYYY-MM-DD.jsonl 追加一行：{ts,app,title,idle,shot,error?}
//   - 截图存入 shots/YYYY-MM-DD/HHmmss.jpg（同画面不重复落盘）
//   - 进程号写入 data/run/capture.pid
// 用法：node capture.mjs --root <目录> --tick 10 --shot 1 --quality 45 --maxwidth 1600 --idleskip 120
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const IS_MAC = process.platform === 'darwin'

// ---------- 纯工具（可单元测试） ----------
export function cleanText(s, max) {
  if (!s) return ''
  let out = ''
  for (const ch of String(s)) out += ch.charCodeAt(0) < 0x20 ? ' ' : ch
  out = out.trim()
  return out.length > max ? out.slice(0, max) : out
}

export function jsonEscape(s) {
  if (!s) return ''
  let out = ''
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0)
    if (c === 0x22) out += '\\"'
    else if (c === 0x5c) out += '\\\\'
    else if (c === 0x0a) out += '\\n'
    else if (c === 0x0d) out += '\\r'
    else if (c === 0x09) out += '\\t'
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0')
    else out += ch
  }
  return out
}

// ioreg 输出里的 HIDIdleTime（纳秒）→ 秒
export function parseHidIdleSec(ioregOut) {
  const m = String(ioregOut || '').match(/"HIDIdleTime"\s*=\s*(\d+)/)
  return m ? Math.round(Number(m[1]) / 1e9) : null
}

// gdbus / dbus-send 输出里的 uint32 → 秒
export function parseUint32Sec(out) {
  const m = String(out || '').match(/uint32\s+(\d+)/)
  return m ? Number(m[1]) : null
}

// ---------- 进程调用 ----------
function run(cmd, args, timeout = 4000) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
    return { ok: r.status === 0 && !r.error, out: String(r.stdout || '').trim(), err: r.error ? String(r.error.message) : String(r.stderr || '').trim() }
  } catch (e) { return { ok: false, out: '', err: String(e.message || e) } }
}

function findInPath(cmd) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) {
    try { if (fs.existsSync(path.join(d, cmd))) return path.join(d, cmd) } catch { }
  }
  return ''
}

function rm(f) { try { fs.unlinkSync(f) } catch { } }
function exists(f) { try { return fs.statSync(f).size > 0 } catch { return false } }
function md5File(f) { try { return createHash('md5').update(fs.readFileSync(f)).digest('hex') } catch { return '' } }

// ---------- 前台窗口 ----------
const MAC_SCRIPT = ['tell application "System Events"',
  'set frontApp to first process whose frontmost is true',
  'set appName to name of frontApp',
  'set winTitle to ""',
  'try',
  'set winTitle to name of front window of frontApp',
  'end try',
  'return appName & "@@" & winTitle',
  'end tell'].join('\n')

function macWindow() {
  const r = run('osascript', ['-e', MAC_SCRIPT], 6000)
  if (r.ok && r.out.includes('@@')) {
    const i = r.out.indexOf('@@')
    return { app: cleanText(r.out.slice(0, i), 80), title: cleanText(r.out.slice(i + 2), 160) }
  }
  // 兜底：lsappinfo（无需辅助功能权限，但拿不到窗口标题）
  const f = run('lsappinfo', ['front'], 4000)
  if (f.ok && f.out) {
    const asn = (f.out.match(/ASN:0x[0-9a-fA-F-]+/) || [])[0]
    if (asn) {
      const info = run('lsappinfo', ['info', '-only', 'name', asn], 4000)
      const m = info.out.match(/=\s*"([^"]*)"/)
      if (m) return { app: cleanText(m[1], 80), title: '' }
    }
  }
  return { app: '', title: '' }
}

function procName(pid) {
  try {
    const exe = fs.readlinkSync('/proc/' + pid + '/exe')
    const base = path.basename(exe)
    if (base && base !== 'exe') return cleanText(base, 80)
  } catch { }
  try { return cleanText(fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim(), 80) } catch { }
  try {
    const cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0')[0]
    if (cmd) return cleanText(path.basename(cmd), 80)
  } catch { }
  return ''
}

let xdotoolWarned = false
function linuxWindow() {
  const w = run('xdotool', ['getactivewindow'], 3000)
  if (!w.ok) {
    if (!xdotoolWarned) {
      xdotoolWarned = true
      console.log(`窗口记录不可用：${w.err || 'xdotool 未安装或无 X11 会话'}（Wayland 下窗口标题通常无法读取；可在 X11 会话获得完整体验）`)
    }
    return { app: '', title: '' }
  }
  const id = w.out
  if (!id) return { app: '', title: '' }
  const title = run('xdotool', ['getwindowname', id], 3000)
  const cls = run('xdotool', ['getwindowclassname', id], 3000)
  let app = cleanText(cls.out, 80)
  if (!app) {
    const p = run('xdotool', ['getwindowpid', id], 3000)
    const pid = parseInt(p.out, 10)
    if (Number.isFinite(pid) && pid > 0) app = procName(pid)
  }
  return { app, title: cleanText(title.out, 160) }
}

// ---------- 空闲时间 ----------
function macIdle() {
  const r = run('ioreg', ['-c', 'IOHIDSystem'], 5000)
  const v = parseHidIdleSec(r.out)
  return v == null ? 0 : v
}

function linuxIdle() {
  const x = run('xprintidle', [], 3000)
  if (x.ok) {
    const ms = parseInt(x.out, 10)
    if (Number.isFinite(ms)) return Math.round(ms / 1000)
  }
  const g = run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.ScreenSaver', '--object-path', '/org/freedesktop/ScreenSaver', '--method', 'org.freedesktop.ScreenSaver.GetSessionIdleTime'], 3000)
  if (g.ok) { const v = parseUint32Sec(g.out); if (v != null) return v }
  const d = run('dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver.GetSessionIdleTime'], 3000)
  if (d.ok) { const v = parseUint32Sec(d.out); if (v != null) return v }
  return 0
}

// ---------- 截图 ----------
let converterWarned = false

function ffmpegQuality(q) { return Math.max(2, Math.round(31 - (q / 100) * 29)) }
function converterCmd() { return findInPath('magick') || findInPath('convert') || '' }
function ffmpegCmd() { return findInPath('ffmpeg') || '' }

function toJpg(src, dst, quality, maxWidth) {
  const c = converterCmd()
  if (c) {
    const r = run(c, [src, '-resize', `${maxWidth}x>`, '-quality', String(quality), dst], 30000)
    if (r.ok && exists(dst)) return true
  }
  const ff = ffmpegCmd()
  if (ff) {
    const r = run(ff, ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=min(${maxWidth}\\,iw):-2`, '-q:v', String(ffmpegQuality(quality)), dst], 30000)
    if (r.ok && exists(dst)) return true
  }
  return false
}

function shrinkJpg(file, quality, maxWidth) {
  const c = converterCmd()
  if (c) {
    const out = file + '.opt.jpg'
    const r = run(c, [file, '-resize', `${maxWidth}x>`, '-quality', String(quality), out], 30000)
    if (r.ok && exists(out)) { try { fs.renameSync(out, file); return true } catch { } }
    rm(out)
  }
  const ff = ffmpegCmd()
  if (ff) {
    const out = file + '.opt.jpg'
    const r = run(ff, ['-y', '-loglevel', 'error', '-i', file, '-vf', `scale=min(${maxWidth}\\,iw):-2`, '-q:v', String(ffmpegQuality(quality)), out], 30000)
    if (r.ok && exists(out)) { try { fs.renameSync(out, file); return true } catch { } }
    rm(out)
  }
  return false
}

function shrinkJpgSips(file, quality, maxWidth) {
  const r = run('sips', ['-Z', String(maxWidth), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), file], 20000)
  return r.ok
}

function makeShotFn(opts) {
  const { TMP, SHOTS, shotQuality, shotMaxWidth } = opts
  let lastHash = ''
  return function takeShot(now) {
    const tmpJpg = path.join(TMP, 'shot.jpg')
    const tmpPng = path.join(TMP, 'shot.png')
    rm(tmpJpg); rm(tmpPng)
    const wayland = String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
    let produced = ''
    if (IS_MAC) {
      const r = run('screencapture', ['-x', '-t', 'jpg', tmpJpg], 25000)
      if (r.ok && exists(tmpJpg)) produced = 'jpg'
    } else {
      const cands = wayland
        ? [['grim', [tmpPng]], ['gnome-screenshot', ['-f', tmpPng]], ['spectacle', ['-b', '-n', '-o', tmpPng]]]
        : [['scrot', ['-z', '-q', String(shotQuality), tmpJpg]], ['import', ['-window', 'root', '-quality', String(shotQuality), tmpJpg]], ['maim', [tmpJpg]], ['gnome-screenshot', ['-f', tmpPng]], ['spectacle', ['-b', '-n', '-o', tmpPng]]]
      for (const [cmd, args] of cands) {
        if (!findInPath(cmd)) continue
        run(cmd, args, 25000)
        if (exists(tmpJpg)) { produced = 'jpg'; break }
        if (exists(tmpPng)) { produced = 'png'; break }
      }
    }
    if (!produced) {
      if (!converterWarned) {
        converterWarned = true
        console.log('未找到可用截图工具（scrot / grim / gnome-screenshot / spectacle / import），已跳过截图')
      }
      return ''
    }
    if (produced === 'png') {
      const ok = toJpg(tmpPng, tmpJpg, shotQuality, shotMaxWidth)
      rm(tmpPng)
      if (!ok) {
        console.log('截图转 JPG 失败：需要 ImageMagick（convert/magick）或 ffmpeg')
        return ''
      }
    } else if (IS_MAC) {
      shrinkJpgSips(tmpJpg, shotQuality, shotMaxWidth)
    } else {
      shrinkJpg(tmpJpg, shotQuality, shotMaxWidth)
    }
    if (!exists(tmpJpg)) return ''
    const hash = md5File(tmpJpg)
    if (hash && hash === lastHash) { rm(tmpJpg); return '' }
    lastHash = hash
    const d = dayStr(now)
    const dir = path.join(SHOTS, d)
    try { fs.mkdirSync(dir, { recursive: true }) } catch { return '' }
    const name = clock(now).replace(/:/g, '') + '.jpg'
    const dst = path.join(dir, name)
    try { fs.renameSync(tmpJpg, dst) } catch {
      try { fs.copyFileSync(tmpJpg, dst); rm(tmpJpg) } catch { return '' }
    }
    return `shots/${d}/${name}`
  }
}

// ---------- 时间格式 ----------
function pad2(n) { return String(n).padStart(2, '0') }
function dayStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function clock(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
function tsStr(d) { return `${dayStr(d)}T${clock(d)}` }

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2)
  const argv = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def }
  const root = path.resolve(argv('--root', '.'))
  let tickSeconds = Number(argv('--tick', 10)) || 10
  const shotEnabled = argv('--shot', '1') !== '0'
  const shotQuality = Math.min(100, Math.max(10, Number(argv('--quality', 45)) || 45))
  const shotMaxWidth = Math.max(320, Number(argv('--maxwidth', 1600)) || 1600)
  const idleSkip = Math.max(5, Number(argv('--idleskip', 120)) || 120)
  if (tickSeconds < 1) tickSeconds = 10

  const DIRS = {
    run: path.join(root, 'data', 'run'),
    raw: path.join(root, 'data', 'logs', 'raw'),
    TMP: path.join(root, 'data', 'run', 'tmp'),
    SHOTS: path.join(root, 'shots'),
  }
  for (const d of Object.values(DIRS)) { try { fs.mkdirSync(d, { recursive: true }) } catch { } }
  // 清理上次残留
  for (const f of ['shot.jpg', 'shot.png', 'shot.jpg.opt.jpg']) rm(path.join(DIRS.TMP, f))

  try { fs.writeFileSync(path.join(DIRS.run, 'capture.pid'), String(process.pid)) } catch { }

  const tools = IS_MAC
    ? ['screencapture', 'osascript', 'ioreg'].filter(findInPath).join(',')
    : ['xdotool', 'xprintidle', 'gdbus', 'scrot', 'grim', 'gnome-screenshot', 'spectacle', 'import'].filter(findInPath).join(',')
  console.log(`capture.mjs started on ${process.platform} (${process.version}) tools=[${tools}]`)

  const cleanup = () => { try { fs.unlinkSync(path.join(DIRS.run, 'capture.pid')) } catch { } }
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('exit', cleanup)

  const takeShot = makeShotFn({ TMP: DIRS.TMP, SHOTS: DIRS.SHOTS, shotQuality, shotMaxWidth })
  const isWayland = String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'

  for (;;) {
    const startedAt = Date.now()
    const now = new Date()
    let app = ''
    let title = ''
    let idle = 0
    let shot = ''
    let error = ''
    try {
      idle = IS_MAC ? macIdle() : linuxIdle()
      const w = IS_MAC ? macWindow() : linuxWindow()
      app = w.app
      title = w.title
      const locked = app === 'loginwindow' || app === 'lockapp' || app === 'LockApp'
      if (shotEnabled && !locked && idle < idleSkip) shot = takeShot(now)
    } catch (e) {
      error = cleanText(String((e && e.message) || e), 180)
    }
    const line = `{"ts":"${tsStr(now)}","app":"${jsonEscape(app)}","title":"${jsonEscape(title)}","idle":${idle},"shot":"${jsonEscape(shot)}"${error ? `,"error":"${jsonEscape(error)}"` : ''}}`
    try { fs.appendFileSync(path.join(DIRS.raw, dayStr(now) + '.jsonl'), line + '\n', 'utf8') } catch { }

    const wait = Math.max(200, tickSeconds * 1000 - (Date.now() - startedAt))
    await new Promise((r) => setTimeout(r, wait))
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) main().catch((e) => { console.error('capture.mjs 异常：' + e.message); process.exit(1) })
