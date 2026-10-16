// 单元测试：跨平台核心的纯函数部分（node --test tests/）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeConfig, DEFAULT_CONFIG } from '../lib/config.mjs'
import { buildIcns } from '../tools/make-icons.mjs'
import { cleanText, jsonEscape, parseHidIdleSec, parseUint32Sec } from '../native/capture.mjs'
import { findInPath } from '../lib/platform.mjs'

test('mergeConfig：local 覆盖模板，嵌套对象逐项合并', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { llm: { enabled: true, model: 'x' }, retention: { rawLogDays: 30 } })
  assert.equal(merged.llm.enabled, true)
  assert.equal(merged.llm.model, 'x')
  assert.equal(merged.llm.timeoutSeconds, DEFAULT_CONFIG.llm.timeoutSeconds)
  assert.equal(merged.retention.rawLogDays, 30)
  assert.equal(merged.retention.screenshotDays, DEFAULT_CONFIG.retention.screenshotDays)
  assert.equal(merged.tickSeconds, DEFAULT_CONFIG.tickSeconds)
  assert.equal(merged.dashboard.port, DEFAULT_CONFIG.dashboard.port)
})

test('cleanText：控制字符变空格并截断', () => {
  assert.equal(cleanText('a\nb\tc'), 'a b c')
  assert.equal(cleanText('  x  '), 'x')
  assert.equal(cleanText('y'.repeat(300), 10).length, 10)
  assert.equal(cleanText('', 10), '')
})

test('jsonEscape：引号 / 反斜杠 / 换行 / 控制字符', () => {
  assert.equal(jsonEscape('a"b\\c\nd'), 'a\\"b\\\\c\\nd')
  assert.equal(jsonEscape('\u0001'), '\\u0001')
  assert.equal(jsonEscape('中文标题 ok'), '中文标题 ok')
})

test('parseHidIdleSec：ioreg 输出 → 秒', () => {
  assert.equal(parseHidIdleSec('    "HIDIdleTime" = 1500000000\n'), 2)
  assert.equal(parseHidIdleSec('nothing'), null)
})

test('parseUint32Sec：gdbus / dbus-send 输出 → 秒', () => {
  assert.equal(parseUint32Sec('(uint32 42, )'), 42)
  assert.equal(parseUint32Sec('   uint32 7'), 7)
  assert.equal(parseUint32Sec('error'), null)
})

test('buildIcns：容器结构合法（头 + 条目长度自洽）', () => {
  const png = Buffer.from([1, 2, 3, 4])
  const icns = buildIcns({ 128: png, 256: png })
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  const types = []
  let off = 8
  while (off < icns.length) {
    const type = icns.subarray(off, off + 4).toString('ascii')
    const len = icns.readUInt32BE(off + 4)
    assert.equal(len, 8 + png.length)
    types.push(type)
    off += len
  }
  assert.deepEqual(types, ['ic07', 'ic13', 'ic08'])
})

test('findInPath：能找到系统必备命令；不存在的命令返回空', () => {
  const probe = process.platform === 'win32' ? 'cmd' : 'sh'
  assert.ok(findInPath(probe).length > 0)
  assert.equal(findInPath('definitely-not-a-command-xyz'), '')
})
