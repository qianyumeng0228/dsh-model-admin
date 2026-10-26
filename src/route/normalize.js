/**
 * Canonical model names — the one identity a model has across channels.
 *
 * The same real model arrives under different ids on different channels:
 * `deepseek-v4.1-flash` on one, `deepseek-v4.1-flash-free` on another,
 * `DeepSeek-V4.1-Flash` on a third. The aggregate route groups candidates by
 * canonical name, so these three must normalize to one key.
 *
 * The rules are deliberately conservative: strip only suffixes the channels
 * themselves use as tier markers (`-free`, `-sg`, `-cn`, `-intl`, `-pro`,
 * `-lite` kept? no — see below), lowercase, and collapse separators. A rule
 * that merges two genuinely different models is worse than a missed merge,
 * because the route would then send a request to a model that cannot answer
 * it.
 */

/**
 * Suffixes channels append as tier/region markers, in strip order.
 *
 * `-flash` is deliberately NOT here: it is a product line (v4.1-flash and
 * v4.1 are different models upstream), not a tier marker. Stripping it would
 * merge two models the route must keep apart.
 */
const TIER_SUFFIXES = [
  '-free',
  '-sg',
  '-cn',
  '-intl',
  '-global',
  '-paid',
  '-pro',
  '-max',
  '-mini',
  '-lite',
]

/**
 * Normalize one raw model id into its canonical key.
 *
 * `deepseek-v4.1-flash-free` → `deepseek-v4.1-flash`: the tier marker goes,
 * the version dot and the product line stay. A rule that merges two
 * genuinely different models is worse than a missed merge, because the route
 * would then send a request to a model that cannot answer it.
 *
 * @param {string} raw
 * @returns {string} canonical key, '' for empty input
 */
export function canonicalModelKey(raw) {
  let key = String(raw ?? '').trim().toLowerCase()
  if (key === '') return ''
  // Underscores become dashes; dots are KEPT (they carry version numbers:
  // v4.1 must not become v4-1). Collapse dash runs only.
  key = key.replace(/_+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  // Strip a vendor prefix when one channel namespaces its ids
  // (`buddy/deepseek-v4.1-flash` → `deepseek-v4.1-flash`).
  const slash = key.lastIndexOf('/')
  if (slash >= 0) key = key.slice(slash + 1)
  // Strip tier markers, but never strip past the product identity: at most
  // two suffixes, and only ones on the list.
  for (let round = 0; round < 2; round += 1) {
    const hit = TIER_SUFFIXES.find(suffix => key.endsWith(suffix) && key.length > suffix.length)
    if (hit === undefined) break
    key = key.slice(0, -hit.length)
  }
  return key.replace(/-+$/g, '')
}

/**
 * The display name for a canonical key: the most common raw name wins, and
 * ties break toward the shorter (less decorated) spelling.
 *
 * @param {readonly {id: string, name?: string}[]} members raw rows sharing one key
 * @returns {string}
 */
export function canonicalDisplayName(members) {
  const counts = new Map()
  for (const member of members ?? []) {
    const name = String(member?.name ?? '').trim()
    if (name === '') continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount || (count === bestCount && name.length < best.length)) {
      best = name
      bestCount = count
    }
  }
  return best === '' ? String(members?.[0]?.id ?? '') : best
}

/**
 * Group raw catalog rows by canonical key.
 *
 * @param {readonly {provider: string, id: string, name?: string}[]} rows
 * @returns {Map<string, {provider: string, id: string, name?: string}[]>}
 */
export function groupByCanonical(rows) {
  /** @type {Map<string, {provider: string, id: string, name?: string}[]>} */
  const groups = new Map()
  for (const row of rows ?? []) {
    const key = canonicalModelKey(row?.id)
    if (key === '') continue
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [row])
    else bucket.push(row)
  }
  return groups
}
