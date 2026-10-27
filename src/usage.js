/**
 * Usage tracker — records every dispatch for stats.
 *
 * Records: timestamp, model, channel, latency, promptTokens, completionTokens,
 * success/failure. Persists to usage.json, pruned to last 30 days.
 */

import fs from 'node:fs'
import path from 'node:path'

const MAX_ENTRIES = 5000
const DAY_MS = 86400000

export function createUsageTracker({ dataDir }) {
  const file = path.join(dataDir, 'usage.json')
  let entries = load()

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  }

  function save() {
    try { fs.writeFileSync(file, JSON.stringify(entries)) } catch {}
  }

  // Persist is cheap relative to a network dispatch; coalesce bursts (fallback
  // can complete several candidates close together) but always flush within
  // the same tick so a restart never loses settled calls.
  let saveQueued = false
  function scheduleSave() {
    if (saveQueued) return
    saveQueued = true
    queueMicrotask(() => { saveQueued = false; save() })
  }

  /**
   * Record a completed dispatch.
   * @param {object} rec
   * @param {string} rec.model
   * @param {string} rec.channel
   * @param {number} rec.latencyMs
   * @param {number} [rec.promptTokens]
   * @param {number} [rec.completionTokens]
   * @param {boolean} rec.success
   * @param {string} [rec.error]
   */
  function record(rec) {
    entries.push({
      ts: Date.now(),
      model: rec.model,
      channel: rec.channel,
      latencyMs: Math.round(rec.latencyMs),
      promptTokens: rec.promptTokens ?? 0,
      completionTokens: rec.completionTokens ?? 0,
      success: rec.success,
      ...rec.error ? { error: rec.error.slice(0, 100) } : {},
    })
    prune()
    scheduleSave()
  }

  function prune() {
    const cutoff = Date.now() - 30 * DAY_MS
    entries = entries.filter(e => e.ts > cutoff)
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  }

  /**
   * Summary for the panel.
   * @param {number} days
   */
  function summary(days = 7) {
    const cutoff = Date.now() - days * DAY_MS
    const recent = entries.filter(e => e.ts > cutoff)
    const byChannel = {}
    const byModel = {}
    let totalPrompt = 0, totalCompletion = 0, failures = 0, totalLatency = 0

    for (const e of recent) {
      byChannel[e.channel] ??= { calls: 0, tokens: 0, failures: 0, totalLatency: 0 }
      byChannel[e.channel].calls++
      byChannel[e.channel].tokens += e.promptTokens + e.completionTokens
      byChannel[e.channel].totalLatency += e.latencyMs
      if (!e.success) byChannel[e.channel].failures++

      byModel[e.model] ??= { calls: 0, tokens: 0 }
      byModel[e.model].calls++
      byModel[e.model].tokens += e.promptTokens + e.completionTokens

      totalPrompt += e.promptTokens
      totalCompletion += e.completionTokens
      if (!e.success) failures++
      totalLatency += e.latencyMs
    }

    return {
      windowDays: days,
      totalCalls: recent.length,
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      failures,
      avgLatencyMs: recent.length ? Math.round(totalLatency / recent.length) : 0,
      byChannel,
      byModel,
    }
  }

  function reset() { entries = []; save() }

  return { record, summary, reset }
}
