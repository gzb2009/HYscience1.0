# landing

Marketing site for HYscience — the source behind [hyscience.sh](https://hyscience.sh).

Standalone Vite + React + Tailwind project (not part of the monorepo bun
workspace, so its deps stay isolated). The whole page is one file:
`src/pages/Landing.tsx`, styled by `src/index.css` (warm-dark palette,
self-hosted CMU Concrete, dither/grain/atmosphere utilities, scroll reveals).

```bash
bun install
bun run dev              # local preview
bun run build            # production build → dist/
```

`public/install` is served at `hyscience.sh/install`, so
`curl -fsSL https://hyscience.sh/install | bash` works. Screenshots in
`src/assets/` are captured from the real workspace UI.

Deployed via Vercel (project `hyscience-landing-page`, which owns the
`hyscience.sh` domain): `vercel deploy --prod`.
