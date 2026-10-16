// 可选 AI 总结：兼容 OpenAI /chat/completions 的任何端点
// 默认指向 dsh 本地网关（http://127.0.0.1:8326/v1），失败自动熔断降级为模板总结
import fs from 'node:fs'

let breaker = { fails: 0, until: 0 }

export function llmStatus() {
  return { ...breaker }
}

function resolveKey(cfg) {
  if (cfg.apiKey) return cfg.apiKey
  if (cfg.apiKeyFile) {
    const p = String(cfg.apiKeyFile).replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || '')
    try { return fs.readFileSync(p, 'utf8').trim() } catch { return '' }
  }
  return ''
}

function trip(msg) {
  breaker.fails++
  if (breaker.fails >= 3) breaker.until = Date.now() + 30 * 60000
  throw new Error(msg)
}

export async function llmChat(cfg, { system, user, maxTokens = 500 }) {
  if (!cfg || !cfg.enabled || !cfg.baseURL || !cfg.model) throw new Error('AI 总结未启用')
  if (Date.now() < breaker.until) throw new Error(`AI 暂时熔断（已连续失败 ${breaker.fails} 次），30 分钟后自动重试`)
  const base = String(cfg.baseURL).replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const key = resolveKey(cfg)
  const models = [cfg.model, ...(Array.isArray(cfg.fallbackModels) ? cfg.fallbackModels : [])].filter(Boolean)
  const errors = []
  for (const model of models) {
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(Math.max(5, Number(cfg.timeoutSeconds) || 30) * 1000),
      })
    } catch (e) {
      errors.push(`${model}: 请求失败 ${e.message}${e.cause && e.cause.code ? ` (${e.cause.code})` : ''}`)
      continue
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      errors.push(`${model}: HTTP ${res.status} ${t.slice(0, 100)}`)
      continue
    }
    const data = await res.json().catch(() => null)
    const text = String(data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning_content || '').trim()
    if (!text) { errors.push(`${model}: 空内容`); continue }
    breaker = { fails: 0, until: 0 }
    return text
  }
  trip(`全部模型失败：${errors.join(' | ').slice(0, 400)}`)
}

export async function aiForWindow(cfg, compactLines) {
  return llmChat(cfg, {
    system: '你是个人时间分析助手。根据电脑活动记录，用一两句中文概括用户这段时间主要在做什么（可结合窗口标题判断具体任务），文风简洁客观，不客套。直接输出正文，不要解释。',
    user: Array.isArray(compactLines) ? compactLines.join('\n') : String(compactLines),
    maxTokens: 300,
  })
}

export async function aiForDay(cfg, dayTextStr) {
  return llmChat(cfg, {
    system: '你是个人时间分析助手。根据一天的电脑活动统计，写 3 到 5 句中文日总结：主要做了什么、时间花在哪、有没有值得注意的点（专注度高、频繁切换、深夜或凌晨使用、大量空白时间等），最后给一句温和的一句话建议。直接输出正文。',
    user: dayTextStr,
    maxTokens: 600,
  })
}

export async function aiForWeek(cfg, weekTextStr) {
  return llmChat(cfg, {
    system: '你是个人时间分析助手。根据一周的电脑活动统计，写 3 到 6 句中文周总结：整体投入、主要产出方向、作息与专注模式、与日常习惯相关的观察，最后给一句温和的一句话建议。直接输出正文。',
    user: weekTextStr,
    maxTokens: 800,
  })
}
