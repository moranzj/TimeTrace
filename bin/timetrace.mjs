#!/usr/bin/env node
// 时迹 TimeTrace · 命令行工具（Windows / macOS / Linux 通用）
// 用法：timetrace <install|start|stop|restart|status|web|doctor|uninstall|...>
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../lib/config.mjs'
import * as plat from '../lib/platform.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE = process.execPath
const DAEMON = path.join(ROOT, 'daemon.mjs')
const RUN = path.join(ROOT, 'data', 'run')

const argv = process.argv.slice(2)
const cmd = (argv[0] || 'help').toLowerCase()
const has = (f) => argv.includes(f)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0' } catch { return '0.0.0' }
}

function daemonPid() { return plat.readPid(path.join(RUN, 'daemon.pid')) }
function capturePid() { return plat.readPid(path.join(RUN, 'capture.pid')) }

function tailLog(n = 8) {
  try {
    const t = fs.readFileSync(path.join(RUN, 'daemon.log'), 'utf8').trimEnd().split('\n')
    return t.slice(-n).join('\n')
  } catch { return '' }
}

function dashboardUrl() {
  const cfg = loadConfig(ROOT)
  const port = (cfg.dashboard && cfg.dashboard.port) || 8377
  return `http://127.0.0.1:${port}/`
}

async function waitHttp(url, timeoutMs = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.status > 0) return true
    } catch { }
    await sleep(400)
  }
  return false
}

async function startDaemon() {
  const pid = daemonPid()
  if (pid && plat.pidAlive(pid)) {
    console.log(`时迹已在运行（守护进程 PID ${pid}）`)
    return true
  }
  const child = spawn(NODE, [DAEMON], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  await sleep(1500)
  const now = daemonPid()
  if (now && plat.pidAlive(now)) {
    console.log(`✅ 时迹已启动（守护进程 PID ${now}）`)
    return true
  }
  console.error('❌ 启动失败，最近日志：')
  const t = tailLog()
  if (t) console.error(t)
  return false
}

async function stopAll() {
  const dpid = daemonPid()
  const cpid = capturePid()
  let stopped = 0
  if (dpid && plat.pidAlive(dpid)) {
    try { process.kill(dpid, 'SIGTERM') } catch { }
    const t0 = Date.now()
    while (plat.pidAlive(dpid) && Date.now() - t0 < 4000) await sleep(200)
    if (plat.pidAlive(dpid)) { try { process.kill(dpid, 'SIGKILL') } catch { } await sleep(200) }
    stopped++
  }
  if (cpid && plat.pidAlive(cpid)) {
    try { process.kill(cpid, 'SIGTERM') } catch { }
    const t0 = Date.now()
    while (plat.pidAlive(cpid) && Date.now() - t0 < 2500) await sleep(200)
    if (plat.pidAlive(cpid)) { try { process.kill(cpid, 'SIGKILL') } catch { } }
    stopped++
  }
  for (const f of ['daemon.pid', 'capture.pid']) { try { fs.unlinkSync(path.join(RUN, f)) } catch { } }
  return stopped
}

async function webCmd() {
  const url = dashboardUrl()
  const pid = daemonPid()
  if (!(pid && plat.pidAlive(pid))) {
    const ok = await startDaemon()
    if (!ok) { process.exitCode = 1; return }
  }
  const ready = await waitHttp(url)
  if (!ready) {
    console.error(`❌ 面板未就绪（${url}）—— 查看日志：data/run/daemon.log`)
    process.exitCode = 1
    return
  }
  console.log(`面板地址：${url}`)
  if (!has('--no-open')) plat.openUrl(url)
}

function doctorCmd() {
  const cfg = loadConfig(ROOT)
  const checks = plat.doctor(ROOT, cfg)
  if (has('--json')) {
    console.log(JSON.stringify({ platform: process.platform, node: process.version, checks }, null, 2))
    return
  }
  console.log(`时迹体检 · ${plat.platformName()} · Node ${process.version}`)
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '  → ' + c.hint}`)
  console.log('')
  console.log(cfg.llm && cfg.llm.enabled ? 'AI 总结：已开启' : '提示：想要 AI 总结，在 config.local.json 配置任意 OpenAI 兼容端点（见 README）')
}

async function installCmd() {
  console.log(`时迹 TimeTrace 安装 · ${plat.platformName()}`)
  let ok = true
  if (!has('--no-autostart')) {
    const r = plat.installAutostart(ROOT)
    console.log(`  ${r.ok ? '✓' : '✗'} 开机自启：${r.detail || ''}${r.ok ? '' : ' ' + String(r.out || '').slice(0, 300)}`)
    ok = ok && r.ok
  }
  for (const n of plat.installDesktopIntegration(ROOT)) console.log('  ✓ ' + n)
  if (!has('--no-start')) ok = (await startDaemon()) && ok
  if (!has('--no-web')) {
    const url = dashboardUrl()
    if (await waitHttp(url)) plat.openUrl(url)
  }
  console.log('')
  console.log('安装完成。常用命令：')
  console.log('  timetrace status    查看状态与今日概览')
  console.log('  timetrace web       打开面板')
  console.log('  timetrace stop      停止记录')
  console.log('  timetrace doctor    环境体检')
  process.exitCode = ok ? 0 : 1
}

async function uninstallCmd() {
  console.log(`时迹卸载 · ${plat.platformName()}`)
  const n = await stopAll()
  console.log(`  ${n > 0 ? '✓' : '-'} 已停止 ${n} 个进程`)
  if (!has('--no-autostart')) {
    const r = plat.removeAutostart(ROOT)
    console.log(`  ✓ ${r.detail}`)
  }
  for (const m of plat.removeDesktopIntegration(ROOT)) console.log('  ✓ ' + m)
  if (has('--purge')) {
    for (const d of ['data', 'shots']) {
      try { fs.rmSync(path.join(ROOT, d), { recursive: true, force: true }); console.log(`  ✓ 已删除 ${d}/`) } catch { }
    }
  } else {
    console.log('  数据目录已保留（data/ 与 shots/）。彻底删除：timetrace uninstall --purge')
  }
}

const HELP = `时迹 TimeTrace v${version()} · 本地活动追踪（Windows / macOS / Linux）

用法：timetrace <命令> [选项]

  install             一键安装：开机自启 + 桌面集成 + 启动（--no-autostart/--no-start/--no-web 可跳过）
  uninstall [--purge] 卸载（--purge 连带删除 data/ 与 shots/ 数据）
  start / stop / restart    启停守护进程
  status              状态与今日概览
  web [--no-open]     确保在运行并打开图形面板
  doctor [--json]     环境体检（截图工具 / 窗口工具 / AI 配置 / 运行状态）
  summary-now         预览当前 10 分钟总结
  test-ai             测试 AI 总结链路
  rebuild-day  [YYYY-MM-DD]   重建日报
  rebuild-week [YYYY-Www]     重建周报
  version / help

数据全部保存在本机（data/ 与 shots/ 目录），不上传任何服务器。`

switch (cmd) {
  case 'help': case '--help': case '-h':
    console.log(HELP)
    break
  case 'version': case '--version': case '-v':
    console.log(version())
    break
  case 'start': {
    const ok = await startDaemon()
    process.exitCode = ok ? 0 : 1
    break
  }
  case 'stop': {
    const n = await stopAll()
    console.log(n > 0 ? `✅ 已停止 ${n} 个进程（时迹已暂停）` : '时迹本来就没有在运行')
    break
  }
  case 'restart': {
    await stopAll()
    const ok = await startDaemon()
    process.exitCode = ok ? 0 : 1
    break
  }
  case 'status': {
    const r = spawnSync(NODE, [DAEMON, '--status'], { stdio: 'inherit', cwd: ROOT })
    process.exitCode = r.status || 0
    break
  }
  case 'web': case 'open': case 'dashboard':
    await webCmd()
    break
  case 'doctor':
    doctorCmd()
    break
  case 'install':
    await installCmd()
    break
  case 'uninstall':
    await uninstallCmd()
    break
  case 'summary-now':
  case 'test-ai': {
    const r = spawnSync(NODE, [DAEMON, '--' + cmd], { stdio: 'inherit', cwd: ROOT })
    process.exitCode = r.status || 0
    break
  }
  case 'rebuild-day':
  case 'rebuild-week': {
    const r = spawnSync(NODE, [DAEMON, '--' + cmd, ...argv.slice(1)], { stdio: 'inherit', cwd: ROOT })
    process.exitCode = r.status || 0
    break
  }
  default:
    console.log(HELP)
    process.exitCode = 1
}
