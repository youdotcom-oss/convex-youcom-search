import type { GenericActionCtx, GenericDataModel, GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { ComponentApi } from '../component/_generated/component.js'
import type { ContentsFormat, Page, SearchParams, SearchResponse, SearchResultItem } from '../component/validators.js'

export type { ContentsFormat, Page, SearchParams, SearchResponse, SearchResultItem }

/** Options for {@link YouSearch}. */
export type YouSearchOptions = {
  /**
   * Always search through the keyless free MCP profile, even when the
   * component has `YDC_API_KEY`. The key itself is configured on the component
   * in `convex.config.ts`, never in this client.
   */
  keyless?: boolean
  /** Cache lifetime for new results, in ms. Defaults to one hour. */
  ttlMs?: number
  /** Default number of results when a call does not set `count`. */
  defaultCount?: number
}

/** Arguments for {@link YouSearch.contents}. */
export type ContentsArgs = {
  /** Up to 10 absolute http(s) URLs. */
  urls: string[]
  /** Formats to return. Defaults to `["markdown"]`. */
  formats?: ContentsFormat[]
  /** Seconds to wait for each page, 1 to 60. The API default is 10. */
  crawlTimeout?: number
  /** Maximum age of cached page content in seconds. `0` forces a fresh fetch. */
  maxAge?: number
}

/** Arguments for {@link YouSearch.search}: search params plus cache controls. */
export type SearchArgs = SearchParams & {
  /** Skip the cache read and fetch fresh results (they are still cached). */
  force?: boolean
  /** Per call override of the cache lifetime, in ms. */
  ttlMs?: number
}

/**
 * Client for the You.com search component.
 *
 * ```ts
 * import { YouSearch } from "@youdotcom-oss/convex-search";
 * import { components } from "./_generated/api";
 * const youSearch = new YouSearch(components.youSearch);
 * ```
 */
export class YouSearch {
  constructor(
    public component: ComponentApi,
    public options: YouSearchOptions = {},
  ) {}

  private keylessArg(): { keyless?: true } {
    return this.options.keyless ? { keyless: true } : {}
  }

  private params(args: SearchParams): SearchParams {
    const { force: _f, ttlMs: _t, ...rest } = args as SearchArgs
    return {
      ...rest,
      count: rest.count ?? this.options.defaultCount,
    }
  }

  /**
   * Search the web. Returns cached results when a fresh entry exists,
   * otherwise calls You.com and caches the response. Call from an action.
   */
  async search(ctx: ActionCtx, args: SearchArgs): Promise<SearchResponse> {
    const ttlMs = args.ttlMs ?? this.options.ttlMs
    return await ctx.runAction(this.component.lib.search, {
      params: this.params(args),
      ...this.keylessArg(),
      ...(ttlMs === undefined ? {} : { ttlMs }),
      ...(args.force ? { force: true } : {}),
    })
  }

  /**
   * Read a cached search without calling You.com. Reactive when used inside
   * a Convex query, so UIs update as soon as `search` stores new results.
   */
  async getCached(ctx: QueryCtx, args: SearchParams & { includeExpired?: boolean }): Promise<SearchResponse | null> {
    const { includeExpired, ...params } = args
    return await ctx.runQuery(this.component.lib.getCached, {
      params: this.params(params),
      ...this.keylessArg(),
      ...(includeExpired ? { includeExpired } : {}),
    })
  }

  /**
   * Fetch page content for known URLs, for example the top results of a
   * search. Returns one entry per URL in request order; a URL that returned
   * nothing has `error` set. Requires `YDC_API_KEY` on the component.
   */
  async contents(ctx: ActionCtx, args: ContentsArgs): Promise<Page[]> {
    return await ctx.runAction(this.component.lib.contents, args)
  }

  /** Most recent cached searches, newest first. */
  async listRecent(ctx: QueryCtx, args: { limit?: number } = {}): Promise<SearchResponse[]> {
    return await ctx.runQuery(this.component.lib.listRecent, args)
  }

  /** Remove the cache entry for one request. Returns rows deleted. */
  async invalidate(ctx: MutationCtx, args: SearchParams): Promise<number> {
    return await ctx.runMutation(this.component.lib.invalidate, {
      params: this.params(args),
      ...this.keylessArg(),
    })
  }

  /** Remove all cached searches. */
  async clearAll(ctx: MutationCtx): Promise<number> {
    return await ctx.runMutation(this.component.lib.clearAll, {})
  }
}

/** Format results as compact text for an LLM prompt or tool result. */
export function formatResultsForModel(
  response: Pick<SearchResponse, 'results'>,
  opts: { maxSnippetsPerResult?: number } = {},
): string {
  const max = opts.maxSnippetsPerResult ?? 3
  if (response.results.length === 0) return 'No results.'
  return response.results
    .map((r, i) => {
      const lines = [`[${i + 1}] ${r.title}`, r.url]
      if (r.pageAge) lines.push(`Published: ${r.pageAge}`)
      const text = (r.highlights ?? r.snippets ?? []).slice(0, max)
      if (text.length) lines.push(...text)
      else if (r.description) lines.push(r.description)
      return lines.join('\n')
    })
    .join('\n\n')
}

// Minimal ctx types, so callers can pass any ctx with these methods.
type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, 'runQuery'>
type MutationCtx = Pick<GenericMutationCtx<GenericDataModel>, 'runQuery' | 'runMutation'>
type ActionCtx = Pick<GenericActionCtx<GenericDataModel>, 'runQuery' | 'runMutation' | 'runAction'>
