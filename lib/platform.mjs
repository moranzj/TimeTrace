// 平台适配：采集器启动方式、开机自启、桌面集成、打开浏览器、依赖体检
// Windows：沿用 native/capture.exe（csc 编译）；macOS / Linux：用 native/capture.mjs（系统自带命令）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureDir } from './util.mjs'

export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'

export function platformName() {
  return IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : IS_LINUX ? 'Linux' : process.platform
}

// ---------- 基础工具 ----------
export function findInPath(cmd) {
  if (!cmd) return ''
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const exts = IS_WIN ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : ['']
  for (const d of dirs) {
    for (const ext of exts) {
      const p = path.join(d, cmd + ext)
      try { if (fs.existsSync(p)) return p } catch { }
    }
  }
  return ''
}

export function readPid(file) {
  try {
    const v = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch { return 0 }
}

export function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

// Windows 上执行临时 PowerShell 脚本（UTF-8 带 BOM，保证中文正确）
export function runPsFile(root, script, timeout = 60000) {
  const tmp = path.join(root, 'data', 'run', `tt-${Date.now()}.ps1`)
  ensureDir(path.dirname(tmp))
  fs.writeFileSync(tmp, '\uFEFF' + script, 'utf8')
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8', windowsHide: true, timeout })
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
  } finally {
    try { fs.unlinkSync(tmp) } catch { }
  }
}

// ---------- 采集器 ----------
export const CAPTURE_EXE = (root) => path.join(root, 'native', 'capture.exe')
export const CAPTURE_CS = (root) => path.join(root, 'native', 'capture.cs')
export const CAPTURE_MJS = (root) => path.join(root, 'native', 'capture.mjs')

// Windows：确保 capture.exe 已用系统自带 csc.exe 编译
export function ensureCaptureBuilt(root, log = () => { }) {
  const exe = CAPTURE_EXE(root)
  const cs = CAPTURE_CS(root)
  let needBuild = true
  try {
    needBuild = fs.statSync(cs).mtimeMs > fs.statSync(exe).mtimeMs + 1000
  } catch { needBuild = true }
  if (!needBuild) return true
  const cscCandidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ]
  const csc = cscCandidates.find((p) => fs.existsSync(p))
  if (!csc) {
    if (fs.existsSync(exe)) { log('未找到 csc.exe，沿用现有 capture.exe'); return true }
    log('采集器编译失败：未找到 csc.exe（需要系统自带 .NET Framework 4.x）')
    return false
  }
  try {
    ensureDir(path.dirname(exe))
    const r = spawnSync(csc, ['/nologo', '/target:winexe', '/out:' + exe, cs, '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll'], { windowsHide: true, encoding: 'utf8' })
    if (r.status === 0 && fs.existsSync(exe)) {
      log('采集器 capture.exe 已编译就绪')
      return true
    }
    log(`采集器编译失败：${String((r.stderr || '') + (r.stdout || '')).slice(0, 400)}`)
  } catch (e) {
    log(`采集器编译异常：${e.message}`)
  }
  return fs.existsSync(exe)
}

// 返回采集进程的启动方式（cmd + args）；Windows 编译失败时返回 null（由调用方稍后重试）
export function resolveCaptureLaunch({ root, cfg, log }) {
  const s = cfg.screenshots
  const args = ['--root', root, '--tick', String(cfg.tickSeconds), '--shot', s.enabled ? '1' : '0', '--quality', String(s.quality), '--maxwidth', String(s.maxWidth), '--idleskip', String(s.skipWhenIdleSeconds)]
  if (IS_WIN) {
    if (!ensureCaptureBuilt(root, log)) return null
    return { cmd: CAPTURE_EXE(root), args, label: 'capture.exe' }
  }
  return { cmd: process.execPath, args: [CAPTURE_MJS(root), ...args], label: 'capture.mjs' }
}

// ---------- 打开浏览器 ----------
export function openUrl(url) {
  try {
    if (IS_WIN) spawnSync('cmd', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' })
    else if (IS_MAC) spawnSync('open', [url], { stdio: 'ignore' })
    else spawnSync(findInPath('xdg-open') || 'xdg-open', [url], { stdio: 'ignore' })
    return true
  } catch { return false }
}

// ---------- 开机自启 ----------
const MAC_LABEL = 'com.timetrace.agent'

export function installAutostart(root) {
  const nodeExe = process.execPath
  if (IS_WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install-startup.ps1')], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
    return { ok: r.status === 0, detail: '任务计划 ActivityTracker（登录时启动）', out: (r.stdout || '') + (r.stderr || '') }
  }
  if (IS_MAC) {
    const dir = path.join(os.homedir(), 'Library', 'LaunchAgents')
    ensureDir(dir)
    const plist = path.join(dir, MAC_LABEL + '.plist')
    const logDir = path.join(root, 'data', 'run')
    ensureDir(logDir)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEsc(nodeExe)}</string>
    <string>${xmlEsc(path.join(root, 'daemon.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEsc(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>${xmlEsc(path.join(logDir, 'launchd.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(path.join(logDir, 'launchd.log'))}</string>
</dict>
</plist>
`
    fs.writeFileSync(plist, xml, 'utf8')
    const uid = typeof process.getuid === 'function' ? process.getuid() : ''
    let loaded = false
    if (uid !== '' && findInPath('launchctl')) {
      const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { encoding: 'utf8', timeout: 20000 })
      loaded = r.status === 0
      if (!loaded) {
        const r2 = spawnSync('launchctl', ['load', '-w', plist], { encoding: 'utf8', timeout: 20000 })
        loaded = r2.status === 0
      }
    }
    return { ok: true, detail: `LaunchAgent（登录时启动）${loaded ? '' : '，将在下次登录生效'}`, plist }
  }
  // Linux：XDG autostart
  const dir = path.join(os.homedir(), '.config', 'autostart')
  ensureDir(dir)
  const file = path.join(dir, 'timetrace.desktop')
  const exec = `"${nodeExe}" "${path.join(root, 'bin', 'timetrace.mjs')}" start`
  fs.writeFileSync(file, `[Desktop Entry]
Type=Application
Name=时迹 TimeTrace
Comment=Local activity tracker (autostart)
Exec=${exec}
Terminal=false
X-GNOME-Autostart-enabled=true
`, 'utf8')
  return { ok: true, detail: 'XDG autostart（登录时启动）', file }
}

export function removeAutostart(root) {
  if (IS_WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'uninstall-startup.ps1')], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
    return { ok: r.status === 0, detail: '已移除登录启动任务', out: (r.stdout || '') + (r.stderr || '') }
  }
  if (IS_MAC) {
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', MAC_LABEL + '.plist')
    const uid = typeof process.getuid === 'function' ? process.getuid() : ''
    if (uid !== '') spawnSync('launchctl', ['bootout', `gui/${uid}/${MAC_LABEL}`], { encoding: 'utf8', timeout: 20000 })
    spawnSync('launchctl', ['unload', '-w', plist], { encoding: 'utf8', timeout: 20000 })
    try { fs.unlinkSync(plist) } catch { }
    return { ok: true, detail: '已移除 LaunchAgent' }
  }
  const file = path.join(os.homedir(), '.config', 'autostart', 'timetrace.desktop')
  try { fs.unlinkSync(file); return { ok: true, detail: '已移除 XDG autostart' } } catch { return { ok: true, detail: '未安装 autostart' } }
}

// ---------- 桌面集成（图标 / 应用入口） ----------
export function installDesktopIntegration(root) {
  const notes = []
  if (IS_WIN) {
    const iconSrc = path.join(root, 'assets', 'timetrace.ico')
    const iconDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'TimeTrace')
    try {
      ensureDir(iconDir)
      if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(iconDir, 'timetrace.ico'))
    } catch { }
    const icon = fs.existsSync(iconSrc) ? `${psq(path.join(iconDir, 'timetrace.ico'))},0` : ''
    const script = `$ErrorActionPreference = 'Stop'
$root = '${psq(root)}'
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$s1 = $ws.CreateShortcut((Join-Path $desk '时迹.lnk'))
$s1.TargetPath = Join-Path $root 'open-dashboard.vbs'
$s1.WorkingDirectory = $root
$s1.Description = 'TimeTrace - open dashboard'
${icon ? `$s1.IconLocation = '${icon}'` : ''}
$s1.Save()
$s2 = $ws.CreateShortcut((Join-Path $desk '停止时迹.lnk'))
$s2.TargetPath = Join-Path $root 'stop-tracker.vbs'
$s2.WorkingDirectory = $root
$s2.Description = 'TimeTrace - stop'
${icon ? `$s2.IconLocation = '${icon}'` : ''}
$s2.Save()
Write-Output 'shortcuts ok'
`
    const r = runPsFile(root, script)
    notes.push(r.status === 0 ? '桌面快捷方式：时迹 / 停止时迹' : `桌面快捷方式创建失败：${r.out.slice(0, 200)}`)
    return notes
  }
  if (IS_MAC) {
    const appDir = path.join(os.homedir(), 'Applications', 'TimeTrace.app')
    const macos = path.join(appDir, 'Contents', 'MacOS')
    const res = path.join(appDir, 'Contents', 'Resources')
    ensureDir(macos); ensureDir(res)
    const nodeExe = process.execPath
    const launcher = path.join(macos, 'timetrace')
    fs.writeFileSync(launcher, `#!/bin/sh\nexec "${nodeExe}" "${path.join(root, 'bin', 'timetrace.mjs')}" web\n`, 'utf8')
    try { fs.chmodSync(launcher, 0o755) } catch { }
    fs.writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TimeTrace</string>
  <key>CFBundleDisplayName</key><string>时迹 TimeTrace</string>
  <key>CFBundleIdentifier</key><string>com.timetrace.app</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>timetrace</string>
  <key>CFBundleIconFile</key><string>timetrace.icns</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`, 'utf8')
    const icns = path.join(root, 'assets', 'timetrace.icns')
    if (fs.existsSync(icns)) { try { fs.copyFileSync(icns, path.join(res, 'timetrace.icns')) } catch { } }
    notes.push(`已创建 ~/Applications/TimeTrace.app（点开即启动并打开面板）`)
    return notes
  }
  // Linux：应用菜单 + 图标
  const apps = path.join(os.homedir(), '.local', 'share', 'applications')
  const icons = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor')
  ensureDir(apps)
  ensureDir(path.join(icons, '256x256', 'apps'))
  ensureDir(path.join(icons, '512x512', 'apps'))
  const src256 = path.join(root, 'assets', 'timetrace.png')
  const src512 = path.join(root, 'assets', 'timetrace-512.png')
  try { if (fs.existsSync(src256)) fs.copyFileSync(src256, path.join(icons, '256x256', 'apps', 'timetrace.png')) } catch { }
  try { if (fs.existsSync(src512)) fs.copyFileSync(src512, path.join(icons, '512x512', 'apps', 'timetrace.png')) } catch { }
  const nodeExe = process.execPath
  fs.writeFileSync(path.join(apps, 'timetrace.desktop'), `[Desktop Entry]
Type=Application
Name=时迹 TimeTrace
Comment=本地活动追踪面板
Exec="${nodeExe}" "${path.join(root, 'bin', 'timetrace.mjs')}" web
Icon=timetrace
Terminal=false
Categories=Utility;
`, 'utf8')
  spawnSync(findInPath('update-desktop-database') || 'update-desktop-database', [apps], { stdio: 'ignore' })
  notes.push('已创建应用菜单入口「时迹 TimeTrace」')
  return notes
}

export function removeDesktopIntegration(root) {
  const notes = []
  if (IS_WIN) {
    const script = `$desk = [Environment]::GetFolderPath('Desktop')
Remove-Item (Join-Path $desk '时迹.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $desk '停止时迹.lnk') -Force -ErrorAction SilentlyContinue
Write-Output 'shortcuts removed'
`
    const r = runPsFile(root, script)
    notes.push(r.status === 0 ? '已移除桌面快捷方式' : `移除快捷方式失败：${r.out.slice(0, 200)}`)
    return notes
  }
  if (IS_MAC) {
    const appDir = path.join(os.homedir(), 'Applications', 'TimeTrace.app')
    try { fs.rmSync(appDir, { recursive: true, force: true }); notes.push('已移除 ~/Applications/TimeTrace.app') } catch { }
    return notes
  }
  const desktop = path.join(os.homedir(), '.local', 'share', 'applications', 'timetrace.desktop')
  try { fs.unlinkSync(desktop); notes.push('已移除应用菜单入口') } catch { }
  return notes
}

// ---------- 体检 ----------
export function doctor(root, cfg) {
  const checks = []
  const add = (ok, name, hint = '') => checks.push({ ok: !!ok, name, hint: ok ? '' : hint })

  add(true, `Node.js ${process.version}（${platformName()}）`)
  if (IS_WIN) {
    const csc = ['C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'].find((p) => fs.existsSync(p))
    add(csc, 'C# 编译器 csc.exe（编译 capture.exe，系统自带）', '缺少 .NET Framework 4.x')
    add(fs.existsSync(CAPTURE_EXE(root)), 'capture.exe 已编译', '首次启动守护进程时会自动编译')
  } else if (IS_MAC) {
    add(findInPath('screencapture'), 'screencapture（截图，系统自带）', '系统缺少基础组件')
    add(findInPath('osascript'), 'osascript（前台应用 / 窗口标题）', '系统缺少基础组件')
    add(findInPath('ioreg'), 'ioreg（空闲检测）', '系统缺少基础组件')
    add(true, '提示：窗口标题与截图需要「系统设置 → 隐私与安全性」里给终端/Node 授予 辅助功能 + 屏幕录制 权限', '')
  } else {
    const wayland = String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
    add(wayland || process.env.DISPLAY, wayland ? `Wayland 会话（${process.env.XDG_CURRENT_DESKTOP || 'unknown'}）` : 'X11 会话（DISPLAY 已设置）', '没有图形会话？')
    add(findInPath('xdotool'), 'xdotool（窗口标题 / 应用名，X11 必需）', 'sudo apt install xdotool（对应发行版的软件包）')
    add(findInPath('xprintidle') || findInPath('gdbus') || findInPath('dbus-send'), '空闲检测（xprintidle 或 D-Bus）', 'sudo apt install xprintidle')
    const shot = ['grim', 'scrot', 'import', 'maim', 'gnome-screenshot', 'spectacle'].find((c) => findInPath(c))
    add(shot, `截图工具（${shot || '未找到'}）`, 'sudo apt install scrot（Wayland 推荐 grim；KDE 可用 spectacle）')
    const conv = ['magick', 'convert', 'ffmpeg'].find((c) => findInPath(c))
    add(conv || true, `图片缩放/压缩（${conv || '未找到，截图保留原尺寸'}）`, '')
  }
  const llm = cfg && cfg.llm
  add(llm && llm.enabled && llm.baseURL && llm.model, 'AI 总结（可选）', '在 config.local.json 配置任意 OpenAI 兼容端点后启用')
  const dpid = readPid(path.join(root, 'data', 'run', 'daemon.pid'))
  add(pidAlive(dpid), dpid && pidAlive(dpid) ? `守护进程运行中（PID ${dpid}）` : '守护进程未运行', '运行：timetrace start')
  return checks
}

// ---------- 内部 ----------
function psq(s) { return String(s).replace(/'/g, "''") }
function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
