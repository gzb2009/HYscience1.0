# Release process

HYscience ships as native binaries and an npm package
(`@hysci/hyscience`). Releases are cut from `main` — never from a feature
branch.

## Cutting a release

1. Make sure `main` is green (the required checks are Typecheck, Test, and
   Build (web)).
2. Trigger the `publish` workflow with a bump level:

   ```bash
   gh workflow run publish.yml --ref main -f bump=patch   # or minor / major
   ```

   The next version is derived from the current npm `latest`, so there is no
   manual version editing in `package.json` and no risk of a tag collision.

3. The workflow then, in order: computes the version and opens a draft GitHub
   release → builds the platform binaries → publishes to npm (with provenance)
   and updates the Homebrew tap → records an npm deployment.

## Conventions

- The repo bundles features into **patch** bumps unless a change is breaking —
  a feature release does not automatically imply a minor bump here.
- `bump` accepts `patch`, `minor`, or `major`; a `version` input can override
  the computed value explicitly.
- The tag (`vX.Y.Z`) points at the exact tree that was published.

## Verifying a release

```bash
npm view @hysci/hyscience version     # equals the new version once npm propagates
gh release view vX.Y.Z --json assets     # binaries + checksums.txt attached
```

See [verification.md](verification.md) for the local gates to run before you
push to `main`.
