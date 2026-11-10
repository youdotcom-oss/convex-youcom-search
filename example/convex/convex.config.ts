import agent from '@convex-dev/agent/convex.config'
import youSearch from '@youdotcom-oss/convex-search/convex.config.js'
import { defineApp } from 'convex/server'
import { v } from 'convex/values'

const app = defineApp({
  env: {
    // Optional. Without it, search runs keyless on the free profile.
    YDC_API_KEY: v.optional(v.string()),
  },
})
app.use(youSearch, { env: { YDC_API_KEY: app.env.YDC_API_KEY } })
app.use(agent)

export default app
