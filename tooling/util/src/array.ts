export function findLast<T>(
  items: readonly T[],
  predicate: (item: T, index: number, items: readonly T[]) => boolean,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (predicate(item, i, items)) return item
  }
  return undefined
}

/** Reference-identity shallow equality for use as a SolidJS `createMemo` equals option. */
export function shallowEqual<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}
