/// <reference types="vite/client" />

import { defineSchema } from 'convex/server'
import { v } from 'convex/values'
import { defineTestApp } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { youSearchTool } from '../agent/index.js'
import { mockYouFetch } from '../component/setup.test.js'
import componentTest from '../test.js'
import { formatResultsForModel, YouSearch } from './index.js'

const app = defineTestApp({
  schema: defineSchema({}),
  components: { youSearch: componentTest },
})
const youSearch = new YouSearch(app.components.youSearch, {
  defaultCount: 4,
  keyless: true,
})
const keyedSearch = new YouSearch(app.components.youSearch)
const tool = youSearchTool(youSearch, { maxCount: 3 })

const { api, createTest } = app.defineModules({
  search: {
    run: app.action({
      args: { query: v.string(), keyed: v.optional(v.boolean()) },
      handler: async (ctx, args) => {
        const client = args.keyed ? keyedSearch : youSearch
        return await client.search(ctx, { query: args.query })
      },
    }),
    cached: app.query({
      args: { query: v.string() },
      handler: async (ctx, args) => {
        return await youSearch.getCached(ctx, { query: args.query })
      },
    }),
    cachedKeyed: app.query({
      args: { query: v.string() },
      handler: async (ctx, args) => {
        return await keyedSearch.getCached(ctx, { query: args.query })
      },
    }),
    read: app.action({
      args: { urls: v.array(v.string()) },
      handler: async (ctx, args) => {
        return await keyedSearch.contents(ctx, { urls: args.urls })
      },
    }),
    invalidate: app.mutation({
      args: { query: v.string() },
      handler: async (ctx, args) => {
        return await youSearch.invalidate(ctx, { query: args.query })
      },
    }),
    viaTool: app.action({
      args: { query: v.string(), count: v.optional(v.number()) },
      handler: async (ctx, args): Promise<string> => {
        // The Agent injects ctx like this before calling a tool.
        const webSearch = { ...tool, ctx } as unknown as {
          execute: (input: unknown, options: unknown) => Promise<string>
        }
        const input = { query: args.query, count: args.count }
        return await webSearch.execute(input, {
          toolCallId: 'call-1',
          messages: [],
          context: {},
        })
      },
    }),
  },
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('YouSearch client', () => {
  test('search then reactive getCached with the same args', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = createTest()
    expect(await t.query(api.search.cached, { query: 'convex' })).toBeNull()
    const res = await t.action(api.search.run, { query: 'convex' })
    expect(res.cached).toBe(false)
    expect(JSON.parse(String(mock.calls[0].init?.body)).params.arguments.count).toBe(4)
    const cached = await t.query(api.search.cached, { query: 'convex' })
    expect(cached?.results[0].title).toContain('Components')
    expect(await t.mutation(api.search.invalidate, { query: 'convex' })).toBe(1)
  })

  test('uses the keyed API when the component has YDC_API_KEY, and reads the cache it wrote', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'test-key')
    const t = createTest()
    const res = await t.action(api.search.run, { query: 'k', keyed: true })
    expect(res.source).toBe('keyed')
    expect(mock.calls[0].url).toBe('https://ydc-index.io/v1/search')
    expect(new Headers(mock.calls[0].init?.headers).get('X-API-Key')).toBe('test-key')
    expect((await t.query(api.search.cachedKeyed, { query: 'k' }))?.source).toBe('keyed')
  })

  test('keyless: true stays on the free profile when a key is set', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    vi.stubEnv('YDC_API_KEY', 'test-key')
    const t = createTest()
    expect((await t.action(api.search.run, { query: 'f' })).source).toBe('keyless')
    expect(mock.calls[0].url).toBe('https://api.you.com/mcp?profile=free')
  })

  test('contents reads known URLs through the component', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return Response.json([{ url: 'https://a.com/', title: 'A', markdown: '# A' }])
    }) as typeof fetch)
    vi.stubEnv('YDC_API_KEY', 'test-key')
    const t = createTest()
    const pages = await t.action(api.search.read, { urls: ['https://a.com/'] })
    expect(pages).toEqual([{ url: 'https://a.com/', title: 'A', markdown: '# A' }])
    expect(calls[0]).toEqual({
      url: 'https://ydc-index.io/v1/contents',
      body: { urls: ['https://a.com/'], formats: ['markdown'] },
    })
  })

  test('agent tool runs a search and returns model-ready text', async () => {
    const mock = mockYouFetch()
    vi.stubGlobal('fetch', mock.fn)
    const t = createTest()
    const text = await t.action(api.search.viaTool, {
      query: 'convex components',
      count: 50,
    })
    expect(text).toContain('[1] Components | Convex Developer Hub')
    expect(text).toContain('https://docs.convex.dev/components')
    // maxCount caps whatever the model asks for.
    expect(JSON.parse(String(mock.calls[0].init?.body)).params.arguments.count).toBe(3)
  })
})

describe('YouSearch client options', () => {
  const plain = { query: 'q' }
  const echo = (calls: unknown[]) => ({
    runAction: async (_ref: unknown, args: unknown) => {
      calls.push(args)
      return {}
    },
  })

  test('forwards ttlMs, force, keyless and the default count', async () => {
    const calls: Record<string, unknown>[] = []
    const client = new YouSearch(app.components.youSearch, { keyless: true, ttlMs: 5, defaultCount: 7 })
    await client.search(echo(calls) as never, { ...plain, force: true })
    expect(calls[0]).toEqual({ params: { query: 'q', count: 7 }, keyless: true, ttlMs: 5, force: true })
    await client.search(echo(calls) as never, { ...plain, count: 2, ttlMs: 9 })
    expect(calls[1]).toEqual({ params: { query: 'q', count: 2 }, keyless: true, ttlMs: 9 })
  })

  test('never sends an API key to the component', async () => {
    vi.stubEnv('YDC_API_KEY', 'test-key')
    const calls: Record<string, unknown>[] = []
    await keyedSearch.search(echo(calls) as never, plain)
    expect(calls[0]).toEqual({ params: { query: 'q' } })
    expect(JSON.stringify(calls)).not.toContain('test-key')
  })

  test('force and ttlMs are not sent as search params', async () => {
    const calls: { params: Record<string, unknown> }[] = []
    await youSearch.search(echo(calls) as never, { ...plain, force: true, ttlMs: 1 })
    expect(calls[0].params).not.toHaveProperty('force')
    expect(calls[0].params).not.toHaveProperty('ttlMs')
  })
})

describe('youSearchTool', () => {
  const run = async (input: Record<string, unknown>, options = {}) => {
    const calls: { params: Record<string, unknown> }[] = []
    const ctx = {
      runAction: async (_r: unknown, a: { params: Record<string, unknown> }) => {
        calls.push(a)
        return { results: [] }
      },
    }
    const t = youSearchTool(youSearch, options) as unknown as {
      execute: (input: unknown, options: unknown, ctx?: unknown) => Promise<string>
      description: string
    }
    const out = await ({ ...t, ctx } as typeof t).execute(input, { toolCallId: 'c', messages: [], context: {} })
    return { out, calls, description: t.description }
  }

  test('uses the client defaultCount when the model omits count, and forwards freshness', async () => {
    const { out, calls } = await run({ query: 'q', freshness: 'week' })
    expect(out).toBe('No results.')
    expect(calls[0].params).toEqual({ query: 'q', count: 4, freshness: 'week' })
  })
  test('caps a model-requested count at maxCount', async () => {
    const { calls } = await run({ query: 'q', count: 9 }, { maxCount: 2 })
    expect(calls[0].params.count).toBe(2)
  })
  test('the default description marks results as untrusted evidence', async () => {
    expect((await run({ query: 'q' })).description).toMatch(/untrusted/)
  })
  test('uses a custom description when given', async () => {
    expect((await run({ query: 'q' }, { description: 'custom' })).description).toBe('custom')
  })
})

describe('formatResultsForModel', () => {
  test('limits snippets per result and includes the published date', () => {
    const text = formatResultsForModel(
      { results: [{ url: 'https://a', title: 'A', pageAge: '2026-01-01', snippets: ['1', '2', '3', '4'] }] },
      { maxSnippetsPerResult: 2 },
    )
    expect(text).toBe('[1] A\nhttps://a\nPublished: 2026-01-01\n1\n2')
  })
  test('prefers highlights, then snippets, then description', () => {
    const text = formatResultsForModel({
      results: [
        { url: 'https://a', title: 'A', highlights: ['h'], snippets: ['s'] },
        { url: 'https://b', title: 'B', snippets: ['s1', 's2'] },
        { url: 'https://c', title: 'C', description: 'd' },
      ],
    })
    expect(text).toBe('[1] A\nhttps://a\nh\n\n[2] B\nhttps://b\ns1\ns2\n\n[3] C\nhttps://c\nd')
    expect(formatResultsForModel({ results: [] })).toBe('No results.')
  })
})
