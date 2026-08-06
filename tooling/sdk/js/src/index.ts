export * from "./client.js"
export * from "./server.js"

import { createHYscienceClient } from "./client.js"
import { createHYscienceServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createHYscience(options?: ServerOptions) {
  const server = await createHYscienceServer({
    ...options,
  })

  const client = createHYscienceClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
