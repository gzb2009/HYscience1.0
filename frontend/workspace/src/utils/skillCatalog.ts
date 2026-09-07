export type SkillInfo = {
  name: string
  description?: string
  location: string
  category?: string
}

export function createCatalogCache<T>(load: () => Promise<T[]>) {
  let cache: T[] | undefined
  let inflight: Promise<T[]> | undefined

  return {
    peek() {
      return cache
    },
    invalidate() {
      cache = undefined
      inflight = undefined
    },
    get() {
      if (cache) return Promise.resolve(cache)
      if (inflight) return inflight
      inflight = load().then(
        (list) => {
          cache = list
          inflight = undefined
          return list
        },
        (err) => {
          inflight = undefined
          throw err
        },
      )
      return inflight
    },
  }
}

type SkillsClient = {
  client: {
    app: {
      skills: () => Promise<{ data?: SkillInfo[] }>
    }
  }
}

const shared = {
  sdk: undefined as SkillsClient | undefined,
  cache: undefined as ReturnType<typeof createCatalogCache<SkillInfo>> | undefined,
}

function catalogFor(sdk: SkillsClient) {
  if (shared.sdk === sdk && shared.cache) return shared.cache
  shared.sdk = sdk
  shared.cache = createCatalogCache(async () => {
    const res = await sdk.client.app.skills()
    return ((res.data ?? []) as SkillInfo[]).slice().sort((a, b) => a.name.localeCompare(b.name))
  })
  return shared.cache
}

export function peekSkillCatalog() {
  return shared.cache?.peek()
}

export function invalidateSkillCatalog() {
  shared.cache?.invalidate()
}

export function loadSkillCatalog(sdk: SkillsClient) {
  return catalogFor(sdk).get()
}
