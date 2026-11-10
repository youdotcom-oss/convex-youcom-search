import { defineComponent } from 'convex/server'
import { v } from 'convex/values'

export default defineComponent('youSearch', {
  env: {
    /** You.com API key. Unset means keyless search through the free MCP profile. */
    YDC_API_KEY: v.optional(v.string()),
  },
})
