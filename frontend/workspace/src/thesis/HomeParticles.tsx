/**
 * Full-screen clustered particle field.
 * Particles are grouped into clusters. All particles in a cluster share
 * the same animation timing so the patch glows and fades as one unit.
 * Clusters are staggered across the viewport with different phase offsets,
 * producing a flowing wave-like shimmer.
 */
import { type JSX } from "solid-js"

const CLUSTERS = 10
const PER_CLUSTER = 18

function pseudo(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

export function HomeParticles(): JSX.Element {
  const all: JSX.Element[] = []
  for (let c = 0; c < CLUSTERS; c++) {
    const r = pseudo(c * 101 + 53)
    // Cluster center — spread across the full viewport
    const cx = 5 + r() * 90
    const cy = 5 + r() * 90
    const spread = 14 + r() * 18

    // Shared timing for this cluster — all particles breathe together
    const dur = 4 + r() * 4
    const delay = -(r() * dur) // negative to start mid-cycle, cluster gets a unique phase

    for (let p = 0; p < PER_CLUSTER; p++) {
      const angle = r() * Math.PI * 2
      const dist = r() * spread
      const left = cx + Math.cos(angle) * dist
      const top = cy + Math.sin(angle) * dist
      const sz = 2 + r() * 4

      all.push(
        <div
          class="cs-home-dot"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${sz}px`,
            height: `${sz}px`,
            "animation-duration": `${dur}s`,
            "animation-delay": `${delay}s`,
          }}
        />,
      )
    }
  }

  return (
    <div class="cs-home-bg" aria-hidden="true">
      <div class="cs-home-bg-particles">{all}</div>
    </div>
  )
}
