import { YouSearch } from '@youdotcom-oss/convex-search'
import { v } from 'convex/values'
import { components } from './_generated/api.js'
import { action, mutation, query } from './_generated/server.js'

// Keyless by default. Set YDC_API_KEY in the Convex dashboard (or with
// `npx convex env set YDC_API_KEY ...`) to switch to the keyed API. The key is
// passed to the component in convex.config.ts.
const youSearch = new YouSearch(components.youSearch, {
  ttlMs: 60 * 60 * 1000,
  defaultCount: 5,
})

const freshness = v.optional(v.union(v.literal('day'), v.literal('week'), v.literal('month'), v.literal('year')))

/** Run a search (served from cache when a fresh entry exists). */
export const search = action({
  args: { query: v.string(), freshness, force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    return await youSearch.search(ctx, args)
  },
})

/** Reactive read of cached results for the same query. */
export const cached = query({
  args: { query: v.string(), freshness },
  handler: async (ctx, args) => {
    return await youSearch.getCached(ctx, args)
  },
})

export const recent = query({
  args: {},
  handler: async (ctx) => {
    return await youSearch.listRecent(ctx, { limit: 10 })
  },
})

export const invalidate = mutation({
  args: { query: v.string(), freshness },
  handler: async (ctx, args) => {
    return await youSearch.invalidate(ctx, args)
  },
})

/** Read the full page for URLs you already have, such as top search results. Needs YDC_API_KEY. */
export const read = action({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, args) => {
    return await youSearch.contents(ctx, { urls: args.urls })
  },
})
