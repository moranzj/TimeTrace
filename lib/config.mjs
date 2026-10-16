// 配置加载：config.json（随仓库分发的默认值）+ config.local.json（本机私有覆盖，不进 git）
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CONFIG = {
  tickSeconds: 10,
  idleThresholdSeconds: 60,
  summaryMinutes: 10,
  screenshots: { enabled: true, quality: 45, maxWidth: 1600, skipWhenIdleSeconds: 120 },
  retention: { screenshotDays: 7, maxScreenshotGB: 2.5, rawLogDays: 120 },
  dashboard: { enabled: true, port: 8377 },
  llm: {
    enabled: false,
    baseURL: '',
    apiKey: '',
    apiKeyFile: '',
    model: '',
    fallbackModels: [],
    timeoutSeconds: 45,
    minuteSummary: true,
    daySummary: true,
    weekSummary: true,
  },
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return {} }
}

// 浅合并顶层 + 已知的嵌套对象（screenshots/retention/llm/dashboard）
export function mergeConfig(base, over) {
  const o = over && typeof over === 'object' ? over : {}
  return {
    ...base,
    ...o,
    screenshots: { ...(base.screenshots || {}), ...(o.screenshots || {}) },
    retention: { ...(base.retention || {}), ...(o.retention || {}) },
    llm: { ...(base.llm || {}), ...(o.llm || {}) },
    dashboard: { ...(base.dashboard || {}), ...(o.dashboard || {}) },
  }
}

export function loadConfig(root) {
  const base = readJson(path.join(root, 'config.json'))
  const local = readJson(path.join(root, 'config.local.json'))
  return mergeConfig(mergeConfig(DEFAULT_CONFIG, base), local)
}
