// Apps call these as `components.youSearch.lib.<fn>`, usually through the
// `YouSearch` client class in src/client.
import { v } from 'convex/values'
import { internal } from './_generated/api.js'
import type { Doc } from './_generated/dataModel.js'
import { action, env, internalMutation, internalQuery, type MutationCtx, mutation, query } from './_generated/server.js'
import {
  contentsFormatValidator,
  type Page,
  pageValidator,
  resultValidator,
  type SearchResponse,
  searchParamsValidator,
  searchResponseValidator,
  sourceValidator,
} from './validators.js'
import { canonicalize, fetchContents, fetchSearch, hashKey, normalizeParams, type Source } from './youApi.js'

/** Default cache lifetime: one hour. */
export const DEFAULT_TTL_MS = 60 * 60 * 1000
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** The component's API key, or undefined for keyless search. Read inside handlers only. */
function apiKey(): string | undefined {
  return env.YDC_API_KEY || undefined
}

function sourceFor(keyless: boolean | undefined): Source {
  return !keyless && apiKey() ? 'keyed' : 'keyless'
}

function keyFor(params: Doc<'searches'>['params'], source: Source) {
  const normalized = normalizeParams(params, source)
  const canonical = canonicalize(normalized, source)
  return { normalized, canonical, cacheKey: hashKey(canonical) }
}

function toResponse(doc: Doc<'searches'>, cached: boolean): SearchResponse {
  return {
    query: doc.params.query,
    source: doc.source,
    cached,
    results: doc.results,
    ...(doc.searchUuid ? { searchUuid: doc.searchUuid } : {}),
    fetchedAt: doc.fetchedAt,
    expiresAt: doc.expiresAt,
  }
}

/**
 * Search the web with You.com, reading from and writing to the cache.
 *
 * Uses the keyed API when the component's `YDC_API_KEY` env var is set, and
 * You.com's free MCP profile otherwise or when `keyless` is true. The key is
 * read from the component env for the outbound request only; it is never a
 * function argument and is never stored.
 */
export const search = action({
  args: {
    params: searchParamsValidator,
    keyless: v.optional(v.boolean()),
    ttlMs: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  returns: searchResponseValidator,
  handler: async (ctx, args): Promise<SearchResponse> => {
    const source = sourceFor(args.keyless)
    const { normalized, canonical, cacheKey } = keyFor(args.params, source)

    if (!args.force) {
      const hit = await ctx.runQuery(internal.lib.getFresh, {
        cacheKey,
        canonical,
        now: Date.now(),
      })
      if (hit) return toResponse(hit, true)
    }

    const fetched = await fetchSearch(normalized, { apiKey: source === 'keyed' ? apiKey() : undefined })
    const requestedTtl = Number.isFinite(args.ttlMs) ? (args.ttlMs as number) : DEFAULT_TTL_MS
    const ttl = Math.min(MAX_TTL_MS, Math.max(0, requestedTtl))
    const fetchedAt = Date.now()
    const doc = await ctx.runMutation(internal.lib.store, {
      cacheKey,
      canonical,
      source,
      params: normalized,
      results: fetched.results,
      ...(fetched.searchUuid ? { searchUuid: fetched.searchUuid } : {}),
      fetchedAt,
      expiresAt: fetchedAt + ttl,
    })
    return toResponse(doc, false)
  },
})

export const getFresh = internalQuery({
  args: { cacheKey: v.string(), canonical: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('searches')
      .withIndex('cacheKey', (q) => q.eq('cacheKey', args.cacheKey))
      .collect()
    return rows.find((r) => r.canonical === args.canonical && r.expiresAt > args.now) ?? null
  },
})

export const store = internalMutation({
  args: {
    cacheKey: v.string(),
    canonical: v.string(),
    source: sourceValidator,
    params: searchParamsValidator,
    results: v.array(resultValidator),
    searchUuid: v.optional(v.string()),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Replace any earlier row for the same request so there is one per key.
    const existing = await ctx.db
      .query('searches')
      .withIndex('cacheKey', (q) => q.eq('cacheKey', args.cacheKey))
      .collect()
    for (const row of existing) {
      if (row.canonical === args.canonical) await ctx.db.delete('searches', row._id)
    }
    const id = await ctx.db.insert('searches', args)
    return (await ctx.db.get('searches', id))!
  },
})

/**
 * Reactive read of a cached search. Returns null when there is no entry or
 * the entry has expired. Pass the same params (and `keyless`) used for search.
 *
 * Expiry is checked against `now` when given, otherwise against the time the
 * query runs. Convex re-runs queries when the underlying rows change, not on
 * a timer, so a subscribed client sees expiry on the next change or reload.
 */
export const getCached = query({
  args: {
    params: searchParamsValidator,
    keyless: v.optional(v.boolean()),
    includeExpired: v.optional(v.boolean()),
  },
  returns: v.union(v.null(), searchResponseValidator),
  handler: async (ctx, args) => {
    const source = sourceFor(args.keyless)
    let key: ReturnType<typeof keyFor>
    try {
      key = keyFor(args.params, source)
    } catch {
      return null
    }
    const rows = await ctx.db
      .query('searches')
      .withIndex('cacheKey', (q) => q.eq('cacheKey', key.cacheKey))
      .collect()
    const row = rows.find((r) => r.canonical === key.canonical)
    if (!row) return null
    if (!args.includeExpired && row.expiresAt <= Date.now()) return null
    return toResponse(row, true)
  },
})

/**
 * Fetch page content for up to 10 known URLs with the keyed contents API.
 * Returns one entry per URL in request order. Requires `YDC_API_KEY`.
 */
export const contents = action({
  args: {
    urls: v.array(v.string()),
    formats: v.optional(v.array(contentsFormatValidator)),
    crawlTimeout: v.optional(v.number()),
    maxAge: v.optional(v.number()),
  },
  returns: v.array(pageValidator),
  handler: async (_ctx, args): Promise<Page[]> => {
    const key = apiKey()
    if (!key) throw new Error('contents needs YDC_API_KEY set on the component; the free profile does not support it')
    return await fetchContents({ ...args, apiKey: key })
  },
})

/** Most recent cached searches, newest first. */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(searchResponseValidator),
  handler: async (ctx, args) => {
    const limit = Number.isFinite(args.limit) ? Math.floor(args.limit as number) : 20
    const rows = await ctx.db
      .query('searches')
      .withIndex('fetchedAt')
      .order('desc')
      .take(Math.min(100, Math.max(1, limit)))
    return rows.map((r) => toResponse(r, true))
  },
})

/** Drop the cache entry for one request so the next search refetches. */
export const invalidate = mutation({
  args: { params: searchParamsValidator, keyless: v.optional(v.boolean()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const source = sourceFor(args.keyless)
    const { cacheKey, canonical } = keyFor(args.params, source)
    const rows = await ctx.db
      .query('searches')
      .withIndex('cacheKey', (q) => q.eq('cacheKey', cacheKey))
      .collect()
    let n = 0
    for (const row of rows) {
      if (row.canonical === canonical) {
        await ctx.db.delete('searches', row._id)
        n++
      }
    }
    return n
  },
})

/** Delete up to `batchSize` expired rows. Reschedules itself if more remain. */
export const deleteExpired = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const batchSize = Number.isFinite(args.batchSize) ? Math.max(1, Math.floor(args.batchSize as number)) : 500
    const rows = await ctx.db
      .query('searches')
      .withIndex('expiresAt', (q) => q.lte('expiresAt', Date.now()))
      .take(batchSize)
    for (const row of rows) await ctx.db.delete('searches', row._id)
    if (rows.length === batchSize) {
      await ctx.scheduler.runAfter(0, internal.lib.deleteExpired, {
        batchSize,
      })
    }
    return rows.length
  },
})

/** Remove every cached row, in batches. Returns the number deleted now. */
export const clearAll = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    return await deleteBatch(ctx)
  },
})

export const clearAllInternal = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    return await deleteBatch(ctx)
  },
})

async function deleteBatch(ctx: MutationCtx): Promise<number> {
  const rows = await ctx.db.query('searches').take(500)
  for (const row of rows) await ctx.db.delete('searches', row._id)
  if (rows.length === 500) {
    await ctx.scheduler.runAfter(0, internal.lib.clearAllInternal, {})
  }
  return rows.length
}
