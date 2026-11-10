# You.com Search for Convex

A [Convex component](https://www.convex.dev/components) that adds web search
from [You.com](https://you.com) to your Convex backend.

- Works without an API key. With no key it calls `you-search` on You.com's
  free MCP profile. Add `YDC_API_KEY` to use the keyed API instead.
- Caches results in the component's own tables with a TTL, so repeated searches
  are served from your database.
- Cached results can be read from a Convex query, so a UI subscribed to a search
  updates when new results land.
- Reads full page content for URLs you already have, such as the top search
  results (requires `YDC_API_KEY`).
- Includes a `webSearch` tool for
  [`@convex-dev/agent`](https://www.convex.dev/components/agent).

```ts
const results = await youSearch.search(ctx, { query: "convex components" });
// { query, source: "keyless", cached: false, results: [{ url, title, snippets, pageAge, ... }], ... }
```

<!-- START: Include on https://convex.dev/components -->

## Requirements

- Convex 1.43 or later.
- A You.com API key is optional. Without one, search uses the free profile
  (100 searches per day). `contents` needs a key.
- `@convex-dev/agent`, `ai`, and `zod` only if you use the agent tool.

## Install

```sh
npm install @youdotcom-oss/convex-search
```

Add the component to your app in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import youSearch from "@youdotcom-oss/convex-search/convex.config.js";

const app = defineApp();
app.use(youSearch);

export default app;
```

Then run `npx convex dev` so Convex generates `components.youSearch`.

To use the keyed API, declare `YDC_API_KEY` on your app and pass it to the
component. The component reads it from its own environment, so the key never
appears in function arguments:

```ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import youSearch from "@youdotcom-oss/convex-search/convex.config.js";

const app = defineApp({
  env: { YDC_API_KEY: v.optional(v.string()) },
});
app.use(youSearch, { env: { YDC_API_KEY: app.env.YDC_API_KEY } });

export default app;
```

```sh
npx convex env set YDC_API_KEY <your key>
```

## Usage

Create a client once and call it from your own functions:

```ts
// convex/search.ts
import { action, query } from "./_generated/server";
import { components } from "./_generated/api";
import { YouSearch } from "@youdotcom-oss/convex-search";
import { v } from "convex/values";

const youSearch = new YouSearch(components.youSearch, {
  ttlMs: 60 * 60 * 1000, // cache for one hour (the default)
  defaultCount: 5,
});

export const search = action({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    return await youSearch.search(ctx, { query: args.query });
  },
});

// Reactive read of the cached results for the same query.
export const cached = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    return await youSearch.getCached(ctx, { query: args.query });
  },
});
```

On the client, call the action and subscribe to the query:

```tsx
const search = useAction(api.search.search);
const cached = useQuery(api.search.cached, { query });
```

### Search options

| Option           | Type                                             | Notes                                                             |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `query`          | `string`                                         | Required. Up to 400 characters and 50 words. Supports operators.  |
| `count`          | `number`                                         | Results to return. Clamped to 1 to 50 keyless, 1 to 100 keyed.    |
| `freshness`      | `"day" \| "week" \| "month" \| "year" \| string` | Or a range such as `"2026-01-01to2026-06-30"`.                    |
| `offset`         | `number`                                         | Page offset in multiples of `count`, 0 to 9.                      |
| `country`        | `string`                                         | Country code, for example `"US"` or `"GB"`.                       |
| `language`       | `string`                                         | Language code, for example `"EN"`.                                |
| `safesearch`     | `"off" \| "moderate" \| "strict"`                |                                                                   |
| `includeDomains` | `string[]`                                       | Only return results from these domains.                           |
| `excludeDomains` | `string[]`                                       | Drop results from these domains. Cannot be combined with include. |
| `highlights`     | `boolean`                                        | Returns query-relevant passages per result. Up to 50 results.     |
| `force`          | `boolean`                                        | Skip the cache read and fetch fresh results.                      |
| `ttlMs`          | `number`                                         | Cache lifetime for this call.                                     |

Each result has `url`, `title`, and when available `description`, `snippets`,
`highlights`, `pageAge`, `faviconUrl` and `thumbnailUrl`.

## Keyless and keyed

With no key, searches call `you-search` on
`https://api.you.com/mcp?profile=free`. No signup is needed, which makes it easy
to try the component or run a low traffic app. The free profile allows 100
searches per day. When the limit is reached, or when you ask for more than 50
results, You.com returns HTTP 402 and the component throws an error that says
so.

For production traffic, get an API key at
[you.com/platform](https://you.com/platform) and pass it to the component as
shown in [Install](#install). With a key, searches go to
`POST https://ydc-index.io/v1/search`, which supports up to 100 results. See the
[Web Search API reference](https://you.com/docs/api-reference/search/v1-search)
for details and pricing. Use `new YouSearch(components.youSearch, { keyless: true })`
to stay on the free profile even when a key is set.

The component reads the key from its own environment for outbound requests
only. It is never a function argument and is never written to the component's
tables.

## Reading pages

`contents` fetches page content for up to 10 URLs you already have, such as the
top results of a search. It uses `POST https://ydc-index.io/v1/contents` and
needs `YDC_API_KEY`.

```ts
export const read = action({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, args) => {
    return await youSearch.contents(ctx, { urls: args.urls });
  },
});
// [{ url, title, markdown }, ...] in request order
```

| Option         | Type                                         | Notes                                              |
| -------------- | -------------------------------------------- | -------------------------------------------------- |
| `urls`         | `string[]`                                   | Required. 1 to 10 absolute http(s) URLs.           |
| `formats`      | `("markdown" \| "html" \| "metadata")[]`     | Defaults to `["markdown"]`.                        |
| `crawlTimeout` | `number`                                     | Seconds to wait per page, 1 to 60. Defaults to 10. |
| `maxAge`       | `number`                                     | Max age of cached content in seconds. `0` refetches. |

Each page has `url` and, when available, `title`, `markdown`, `html`,
`siteName` and `faviconUrl`. A URL that returned nothing has `error` set
instead. Page content is not cached by the component.

## Caching

Every successful search is stored in the component's `searches` table, keyed by
a hash of the normalized parameters (trimmed query, clamped count, sorted
domains) plus whether it was keyless or keyed. A later search with the same
parameters returns the stored results with `cached: true` until the entry
expires.

- `ttlMs` sets the lifetime. The default is one hour, and the maximum is 30
  days.
- `force: true` skips the cache read and replaces the stored entry.
- `getCached(ctx, params)` returns the stored entry or `null`. Expired entries
  return `null` unless you pass `includeExpired: true`. Convex re-runs queries
  when data changes, not on a timer, so a subscribed client sees an entry expire
  on the next change or reload.
- `listRecent(ctx, { limit })` returns the newest stored searches.
- `invalidate(ctx, params)` removes one entry. `clearAll(ctx)` removes all.
- A cron in the component deletes expired rows every hour.

Failed searches are not cached.

## Agent tool

Add web search to an agent built with `@convex-dev/agent` (unit tested with 0.7.9 and
AI SDK 7):

```ts
import { Agent } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { YouSearch } from "@youdotcom-oss/convex-search";
import { youSearchTool } from "@youdotcom-oss/convex-search/agent";
import { components } from "./_generated/api";

const youSearch = new YouSearch(components.youSearch);

export const researcher = new Agent(components.agent, {
  name: "Researcher",
  languageModel: openai.chat("gpt-4o-mini"),
  instructions: "Use webSearch for anything recent. Cite the URLs you used.",
  tools: { webSearch: youSearchTool(youSearch, { maxCount: 8 }) },
  maxSteps: 4,
});
```

The tool accepts `query`, an optional `count` (capped at `maxCount`, otherwise
the client's `defaultCount`) and an optional `freshness`. It returns numbered results as plain text with titles,
URLs, publish dates and snippets. Searches made by the tool use the same cache.
`formatResultsForModel` is exported if you want the same text format elsewhere.

<!-- END: Include on https://convex.dev/components -->

## Testing your app

The package exports a helper for
[`convex-test`](https://docs.convex.dev/testing/convex-test):

```ts
import { convexTest } from "convex-test";
import youSearch from "@youdotcom-oss/convex-search/test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

test("search", async () => {
  const t = convexTest(schema, modules);
  youSearch.register(t);
  // Stub global fetch to avoid live calls in unit tests.
});
```

## Example app

`example/` has a small Vite app with a search box, a freshness filter, a cached
results view and a list of recent searches, plus an agent example in
`example/convex/agent.ts`.

```sh
bun run dev           # Convex backend
bun run dev:frontend  # Vite app, in a second terminal
```

The UI does not call the agent, `read`, or `invalidate`. Run them from the CLI:

```sh
npx convex env set OPENAI_API_KEY <your key>
npx convex run agent:ask '{"prompt":"What changed in Convex this month?"}'
npx convex env set YDC_API_KEY <your key>
npx convex run example:read '{"urls":["https://docs.convex.dev/components"]}'
npx convex run example:invalidate '{"query":"convex components"}'
```

Run `bun run build` after changing the component: the example imports it from `dist`.

## Development

Requires [Bun](https://bun.com).

```sh
bun install
bun run codegen        # regenerate component types
bun run build          # build the package
bun run test           # unit and component tests with mocked fetch
bun run test:live      # calls the real free MCP profile
bun run check          # Biome, TypeScript and ESLint
```

## Releasing

Run **Actions** -> **Publish Release** on `main`. Pick `patch`, `minor` or
`major`; the workflow bumps `package.json`, publishes to npm with provenance
through trusted publishing, and creates a `v<version>` GitHub release. Pick
`none` to publish the version already in `package.json`.

npm cannot create a new package through trusted publishing, so the first
release needs a one-time bootstrap: publish a `0.0.0` placeholder with a
temporary token, then add a trusted publisher on npmjs.com for
`youdotcom-oss/convex-youcom-search` with workflow `publish.yml`.

## License

Apache-2.0
