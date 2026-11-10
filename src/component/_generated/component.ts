/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      clearAll: FunctionReference<"mutation", "internal", {}, number, Name>;
      contents: FunctionReference<
        "action",
        "internal",
        {
          crawlTimeout?: number;
          formats?: Array<"markdown" | "html" | "metadata">;
          maxAge?: number;
          urls: Array<string>;
        },
        Array<{
          error?: string;
          faviconUrl?: string;
          html?: string;
          markdown?: string;
          siteName?: string;
          title?: string;
          url: string;
        }>,
        Name
      >;
      getCached: FunctionReference<
        "query",
        "internal",
        {
          includeExpired?: boolean;
          keyless?: boolean;
          params: {
            count?: number;
            country?: string;
            excludeDomains?: Array<string>;
            freshness?: string;
            highlights?: boolean;
            includeDomains?: Array<string>;
            language?: string;
            offset?: number;
            query: string;
            safesearch?: "off" | "moderate" | "strict";
          };
        },
        null | {
          cached: boolean;
          expiresAt: number;
          fetchedAt: number;
          query: string;
          results: Array<{
            description?: string;
            faviconUrl?: string;
            highlights?: Array<string>;
            pageAge?: string;
            snippets?: Array<string>;
            thumbnailUrl?: string;
            title: string;
            url: string;
          }>;
          searchUuid?: string;
          source: "keyless" | "keyed";
        },
        Name
      >;
      invalidate: FunctionReference<
        "mutation",
        "internal",
        {
          keyless?: boolean;
          params: {
            count?: number;
            country?: string;
            excludeDomains?: Array<string>;
            freshness?: string;
            highlights?: boolean;
            includeDomains?: Array<string>;
            language?: string;
            offset?: number;
            query: string;
            safesearch?: "off" | "moderate" | "strict";
          };
        },
        number,
        Name
      >;
      listRecent: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          cached: boolean;
          expiresAt: number;
          fetchedAt: number;
          query: string;
          results: Array<{
            description?: string;
            faviconUrl?: string;
            highlights?: Array<string>;
            pageAge?: string;
            snippets?: Array<string>;
            thumbnailUrl?: string;
            title: string;
            url: string;
          }>;
          searchUuid?: string;
          source: "keyless" | "keyed";
        }>,
        Name
      >;
      search: FunctionReference<
        "action",
        "internal",
        {
          force?: boolean;
          keyless?: boolean;
          params: {
            count?: number;
            country?: string;
            excludeDomains?: Array<string>;
            freshness?: string;
            highlights?: boolean;
            includeDomains?: Array<string>;
            language?: string;
            offset?: number;
            query: string;
            safesearch?: "off" | "moderate" | "strict";
          };
          ttlMs?: number;
        },
        {
          cached: boolean;
          expiresAt: number;
          fetchedAt: number;
          query: string;
          results: Array<{
            description?: string;
            faviconUrl?: string;
            highlights?: Array<string>;
            pageAge?: string;
            snippets?: Array<string>;
            thumbnailUrl?: string;
            title: string;
            url: string;
          }>;
          searchUuid?: string;
          source: "keyless" | "keyed";
        },
        Name
      >;
    };
  };
