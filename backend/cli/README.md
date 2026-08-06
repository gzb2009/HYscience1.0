# @hysci/hyscience

HYscience is a model-agnostic, open-source AI research agent for scientific and ML engineering work. It runs a workspace in your browser where the agent plans tasks, writes and runs code, drives experiments, queries scientific databases, and writes up results. Bring your own API key or sign in with Atlas, use any frontier or open-weight model, and work with the bundled science skills.

Part of the [HYscience](https://github.com/HYscience/HYscience) repository.

## Install

```bash
npm install -g @hysci/hyscience
```

The command is `hyscience`.

## Quick start

```bash
hyscience                     # open the workspace in your browser
hyscience ~/code/project      # open it in a specific directory
hyscience connect login       # sign in to Atlas (optional; BYOK works without an account)
hyscience run "..."           # run a one-shot task
```

Configuration lives in `~/.config/hyscience/hyscience.json`. Provider keys can be set in the workspace (bring your own key) or synced from Atlas.

## Docs

See the [repository README](https://github.com/HYscience/HYscience#readme) for the full layout, provider setup, agent and skill architecture, and contribution guide.

## License

Apache License 2.0. See [LICENSE](https://github.com/HYscience/HYscience/blob/main/LICENSE). Not affiliated with Anthropic.
