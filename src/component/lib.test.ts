/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api.js'
import { initConvexTest, mockYouFetch } from './setup.test.js'
import { canonicalize, hashKey, normalizeParams } from './youApi.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.stubEnv('YDC_API_KEY', '')
})

describe('search action', () => {
  test('keyless: fetches once, then serves from cache', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()

    const first = await t.action(api.lib.search, {
      params: { query: '  convex   components ', count: 3 },
    })
    expect(first.cached).toBe(false)
    expect(first.source).toBe('keyless')
    expect(first.query).toBe('convex components')
    expect(first.results[0].url).toBe('https://docs.convex.dev/components')
    expect(first.results[0].pageAge).toBe('2026-10-01T00:00:00')
    expect(first.searchUuid).toBe('uuid-1')
    const [stored] = await t.run(async (ctx) => ctx.db.query('searches').collect())
    expect(stored).not.toHaveProperty('latency')
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe('https://api.you.com/mcp?profile=free')
    expect(JSON.parse(String(mock.calls[0].init?.body)).params.arguments.count).toBe(3)

    const second = await t.action(api.lib.search, {
      params: { query: 'convex components', count: 3 },
    })
    expect(second.cached).toBe(true)
    expect(mock.calls).toHaveLength(1)

    const reactive = await t.query(api.lib.getCached, {
      params: { query: 'convex components', count: 3 },
    })
    expect(reactive?.results).toHaveLength(1)
  })

  test('different params are cached separately', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()
    await t.action(api.lib.search, { params: { query: 'a' } })
    await t.action(api.lib.search, {
      params: { query: 'a', freshness: 'day' },
    })
    vi.stubEnv('YDC_API_KEY', 'k')
    await t.action(api.lib.search, { params: { query: 'a' } })
    expect(mock.calls).toHaveLength(3)
    expect(await t.query(api.lib.listRecent, {})).toHaveLength(3)
  })

  test('keyed: reads YDC_API_KEY from the component env, POSTs to ydc-index, and does not store the key', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'secret-key')
    const t = initConvexTest()
    const res = await t.action(api.lib.search, {
      params: {
        query: 'news',
        highlights: true,
        includeDomains: ['B.com', 'a.com'],
      },
    })
    expect(res.source).toBe('keyed')
    const call = mock.calls[0]
    expect(call.url).toBe('https://ydc-index.io/v1/search')
    expect(call.init?.method).toBe('POST')
    expect(new Headers(call.init?.headers).get('X-API-Key')).toBe('secret-key')
    const body = JSON.parse(String(call.init?.body))
    expect(body.extraction).toEqual({ extraction_mode: 'highlights' })
    expect(body.include_domains).toEqual(['a.com', 'b.com'])
    const rows = await t.run(async (ctx) => ctx.db.query('searches').collect())
    expect(JSON.stringify(rows)).not.toContain('secret-key')
  })

  test('expired entries are refetched and cleaned up', async () => {
    vi.useFakeTimers()
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()
    await t.action(api.lib.search, { params: { query: 'ttl' }, ttlMs: 1000 })
    vi.advanceTimersByTime(2000)
    expect(await t.query(api.lib.getCached, { params: { query: 'ttl' } })).toBeNull()
    expect(
      await t.query(api.lib.getCached, {
        params: { query: 'ttl' },
        includeExpired: true,
      }),
    ).not.toBeNull()
    const deleted = await t.mutation(internal.lib.deleteExpired, {})
    expect(deleted).toBe(1)
    const again = await t.action(api.lib.search, { params: { query: 'ttl' } })
    expect(again.cached).toBe(false)
    expect(mock.calls).toHaveLength(2)
  })

  test('force bypasses the cache and replaces the row', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()
    await t.action(api.lib.search, { params: { query: 'f' } })
    const forced = await t.action(api.lib.search, {
      params: { query: 'f' },
      force: true,
    })
    expect(forced.cached).toBe(false)
    expect(mock.calls).toHaveLength(2)
    const rows = await t.run(async (ctx) => ctx.db.query('searches').collect())
    expect(rows).toHaveLength(1)
  })

  test('invalidate and clearAll', async () => {
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    await t.action(api.lib.search, { params: { query: 'x' } })
    await t.action(api.lib.search, { params: { query: 'y' } })
    expect(await t.mutation(api.lib.invalidate, { params: { query: 'x' } })).toBe(1)
    expect(await t.query(api.lib.getCached, { params: { query: 'x' } })).toBeNull()
    expect(await t.mutation(api.lib.clearAll, {})).toBe(1)
    expect(await t.query(api.lib.listRecent, {})).toHaveLength(0)
  })

  test('API errors surface and nothing is cached', async () => {
    vi.stubGlobal('fetch', mockYouFetch([], 402).fn)
    const t = initConvexTest()
    await expect(t.action(api.lib.search, { params: { query: 'limit' } })).rejects.toThrow(/402/)
    expect(await t.query(api.lib.listRecent, {})).toHaveLength(0)
  })

  test('rejects invalid combinations before calling the API', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()
    await expect(t.action(api.lib.search, { params: { query: '   ' } })).rejects.toThrow(/empty/)
    await expect(
      t.action(api.lib.search, { params: { query: 'a', includeDomains: ['a.com'], excludeDomains: ['b.com'] } }),
    ).rejects.toThrow(/cannot be combined/)
    await expect(t.action(api.lib.search, { params: { query: 'a'.repeat(401) } })).rejects.toThrow(/400 characters/)
    expect(mock.calls).toHaveLength(0)
  })

  test('a row with a colliding cacheKey but different params is never served', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()
    const canonical = canonicalize(normalizeParams({ query: 'real' }, 'keyless'), 'keyless')
    await t.run(async (ctx) => {
      await ctx.db.insert('searches', {
        cacheKey: hashKey(canonical),
        canonical: 'something else entirely',
        source: 'keyless',
        params: { query: 'other' },
        results: [{ url: 'https://wrong.example', title: 'Wrong' }],
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      })
    })
    expect(await t.query(api.lib.getCached, { params: { query: 'real' } })).toBeNull()
    const res = await t.action(api.lib.search, { params: { query: 'real' } })
    expect(res.cached).toBe(false)
    expect(res.results[0].url).not.toBe('https://wrong.example')
    const rows = await t.run(async (ctx) => ctx.db.query('searches').collect())
    expect(rows).toHaveLength(2)
  })

  test('keyless and keyed results are cached separately and getCached follows the component key', async () => {
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    vi.stubEnv('YDC_API_KEY', 'key')
    await t.action(api.lib.search, { params: { query: 'k' } })
    expect(await t.query(api.lib.getCached, { params: { query: 'k' }, keyless: true })).toBeNull()
    expect((await t.query(api.lib.getCached, { params: { query: 'k' } }))?.source).toBe('keyed')
    vi.stubEnv('YDC_API_KEY', '')
    expect(await t.query(api.lib.getCached, { params: { query: 'k' } })).toBeNull()
  })

  test('ttlMs is clamped to the range 0 to 30 days', async () => {
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    const long = await t.action(api.lib.search, { params: { query: 'long' }, ttlMs: 10 ** 12 })
    expect(long.expiresAt - long.fetchedAt).toBe(30 * 24 * 60 * 60 * 1000)
    const none = await t.action(api.lib.search, { params: { query: 'none' }, ttlMs: -5 })
    expect(none.expiresAt).toBe(none.fetchedAt)
    expect(await t.query(api.lib.getCached, { params: { query: 'none' } })).toBeNull()
  })

  test('a non-finite ttlMs falls back to the default lifetime', async () => {
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    const res = await t.action(api.lib.search, { params: { query: 'nan' }, ttlMs: Number.NaN })
    expect(res.expiresAt - res.fetchedAt).toBe(60 * 60 * 1000)
    expect((await t.action(api.lib.search, { params: { query: 'nan' } })).cached).toBe(true)
  })

  test('getCached returns null for params that search would reject', async () => {
    const t = initConvexTest()
    expect(await t.query(api.lib.getCached, { params: { query: '  ' } })).toBeNull()
    expect(
      await t.query(api.lib.getCached, {
        params: { query: 'a', includeDomains: ['a.com'], excludeDomains: ['b.com'] },
      }),
    ).toBeNull()
  })

  test('listRecent is newest first and honors limit', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    for (const q of ['one', 'two', 'three']) {
      await t.action(api.lib.search, { params: { query: q } })
      vi.advanceTimersByTime(10)
    }
    expect((await t.query(api.lib.listRecent, {})).map((r) => r.query)).toEqual(['three', 'two', 'one'])
    expect((await t.query(api.lib.listRecent, { limit: 2 })).map((r) => r.query)).toEqual(['three', 'two'])
    expect(await t.query(api.lib.listRecent, { limit: 0 })).toHaveLength(1)
    expect(await t.query(api.lib.listRecent, { limit: 2.5 })).toHaveLength(2)
    expect(await t.query(api.lib.listRecent, { limit: Number.NaN })).toHaveLength(3)
  })

  test('deleteExpired never throws or reschedules forever on an invalid batchSize', async () => {
    vi.useFakeTimers()
    const t = initConvexTest()
    for (const batchSize of [0, -1, Number.NaN]) {
      expect(await t.mutation(internal.lib.deleteExpired, { batchSize })).toBe(0)
    }
    const scheduled = await t.run(async (ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled).toHaveLength(0)
  })

  test('deleteExpired keeps live rows and continues in batches', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    await t.action(api.lib.search, { params: { query: 'a' }, ttlMs: 1000 })
    await t.action(api.lib.search, { params: { query: 'b' }, ttlMs: 1000 })
    await t.action(api.lib.search, { params: { query: 'live' }, ttlMs: 10 ** 7 })
    vi.advanceTimersByTime(2000)
    expect(await t.mutation(internal.lib.deleteExpired, { batchSize: 1 })).toBe(1)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await t.run(async (ctx) => ctx.db.query('searches').collect())
    expect(left.map((r) => r.params.query)).toEqual(['live'])
  })

  test('keyless: true uses the free profile even when a key is set', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'key')
    const t = initConvexTest()
    const res = await t.action(api.lib.search, { params: { query: 'free' }, keyless: true })
    expect(res.source).toBe('keyless')
    expect(mock.calls[0].url).toBe('https://api.you.com/mcp?profile=free')
  })

  test('the search action does not accept an API key argument', async () => {
    vi.stubGlobal('fetch', mockYouFetch().fn)
    const t = initConvexTest()
    await expect(
      t.action(api.lib.search, { params: { query: 'x' }, apiKey: 'k' } as unknown as { params: { query: string } }),
    ).rejects.toThrow(/apiKey/)
  })
})

describe('contents action', () => {
  const pages = [
    {
      url: 'https://b.com/',
      title: 'B',
      markdown: '# B',
      metadata: { site_name: 'B site', favicon_url: 'https://f/b' },
    },
    { url: 'https://a.com/', title: 'A', markdown: '# A', html: null },
  ]
  const mockContents = (body: unknown = pages, status = 200) => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(JSON.stringify(body), { status })
    }
    return { fn: fn as typeof fetch, calls }
  }

  test('POSTs to /v1/contents with the key and returns pages in request order', async () => {
    const mock = mockContents()
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'secret-key')
    const t = initConvexTest()
    const res = await t.action(api.lib.contents, { urls: ['https://a.com/', 'https://b.com/', 'https://c.com/'] })
    expect(mock.calls[0].url).toBe('https://ydc-index.io/v1/contents')
    expect(new Headers(mock.calls[0].init?.headers).get('X-API-Key')).toBe('secret-key')
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual({
      urls: ['https://a.com/', 'https://b.com/', 'https://c.com/'],
      formats: ['markdown'],
    })
    expect(res).toEqual([
      { url: 'https://a.com/', title: 'A', markdown: '# A' },
      { url: 'https://b.com/', title: 'B', markdown: '# B', siteName: 'B site', faviconUrl: 'https://f/b' },
      { url: 'https://c.com/', error: 'No content returned for this URL.' },
    ])
  })

  test('forwards formats, crawlTimeout and maxAge', async () => {
    const mock = mockContents([])
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'k')
    const t = initConvexTest()
    await t.action(api.lib.contents, {
      urls: ['https://a.com/'],
      formats: ['html', 'metadata'],
      crawlTimeout: 20,
      maxAge: 0,
    })
    expect(JSON.parse(String(mock.calls[0].init?.body))).toEqual({
      urls: ['https://a.com/'],
      formats: ['html', 'metadata'],
      crawl_timeout: 20,
      max_age: 0,
    })
  })

  test('rejects bad input before calling the API', async () => {
    const mock = mockContents()
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'k')
    const t = initConvexTest()
    await expect(t.action(api.lib.contents, { urls: [] })).rejects.toThrow(/at least one URL/)
    await expect(
      t.action(api.lib.contents, { urls: Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`) }),
    ).rejects.toThrow(/at most 10/)
    await expect(t.action(api.lib.contents, { urls: ['ftp://a.com/x'] })).rejects.toThrow(/http/)
    await expect(t.action(api.lib.contents, { urls: ['not a url'] })).rejects.toThrow(/http/)
    await expect(t.action(api.lib.contents, { urls: ['https://a.com/'], crawlTimeout: 61 })).rejects.toThrow(
      /crawlTimeout/,
    )
    expect(mock.calls).toHaveLength(0)
  })

  test('needs YDC_API_KEY', async () => {
    const mock = mockContents()
    vi.stubGlobal('fetch', mock.fn)
    const t = initConvexTest()
    await expect(t.action(api.lib.contents, { urls: ['https://a.com/'] })).rejects.toThrow(/YDC_API_KEY/)
    expect(mock.calls).toHaveLength(0)
  })

  test('API errors carry the status', async () => {
    vi.stubGlobal('fetch', mockContents({ error: 'nope' }, 401).fn)
    vi.stubEnv('YDC_API_KEY', 'bad')
    const t = initConvexTest()
    await expect(t.action(api.lib.contents, { urls: ['https://a.com/'] })).rejects.toThrow(/401/)
  })
})
