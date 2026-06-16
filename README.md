# getmnemo

Official TypeScript / JavaScript SDK for [Mnemo Memory](https://mnemohq.com) — long-term memory infrastructure for AI agents.

```bash
npm install getmnemo
```

Zero runtime dependencies. Works in Node 18+, Bun, Deno, Cloudflare Workers, and any other modern server or edge JS runtime with `fetch`.

A default `apiKey` is **full-access** — keep it server-side. Scoped keys **do** exist: the key-mint dialog lets you grant `read` / `write` / `delete` / `billing` scopes individually. For browser or client-exposed contexts, mint a **scoped read-only key** (or proxy through a server route) rather than shipping a full-access key.

## Quickstart

```ts
import { Mnemo } from 'getmnemo'

const memory = new Mnemo({
  apiKey: process.env.GETMNEMO_API_KEY!,
  workspaceId: process.env.GETMNEMO_WORKSPACE_ID!,
})

// Store an atomic fact, scoped to a container (e.g. a user)
await memory.add({
  content: 'User prefers Japanese short-grain rice for onigiri.',
  containerTag: 'user:jane',
})

// Retrieve relevant facts from the same container
const { results } = await memory.search({
  q: 'what kind of rice does the user like?',
  containerTag: 'user:jane',
})
for (const hit of results) {
  console.log(hit.score.toFixed(2), hit.content)
}
```

## Containers

Memories live in **containers**. Identify a container two ways:

- `containerTag` — a string like `"user:jane"` (the simplest, recommended form)
- `scope` — the structured equivalent `{ type: 'user', id: 'jane' }`

`add` and `search` require a container. Set one per call, or set `defaultContainerTag`
on the client once so every call falls back to it:

```ts
const memory = new Mnemo({
  apiKey: process.env.GETMNEMO_API_KEY!,
  workspaceId: process.env.GETMNEMO_WORKSPACE_ID!,
  defaultContainerTag: 'user:jane',
})

await memory.add({ content: 'Likes onigiri.' }) // uses user:jane
await memory.search({ q: 'food preferences?' })  // uses user:jane
```

If neither a per-call container nor a default is set, `add`/`search` throw before
hitting the network.

## API surface

| Method | Purpose |
|---|---|
| `search({ q, containerTag?, scope?, limit?, searchMode? })` | Hybrid retrieval. Returns `SearchResponse`. |
| `add({ content, containerTag?, scope?, metadata? })` | Store an atomic fact. Returns `AddResponse`. |
| `update(memoryId, { content?, memoryType?, metadata?, source? })` | Patch an existing memory. |
| `get(memoryId)` | Fetch a single memory. |
| `delete(memoryId)` | Remove a memory. |
| `list({ containerTag?, limit?, cursor?, scopeType?, scopeId? })` | Cursor-paginated list. |

> Response types (`SearchResponse`, `AddResponse`, `Memory`, …) are **provisional** —
> reconstructed from observed live payloads pending a fully-annotated API spec.

## Errors

All HTTP failures throw `MnemoHTTPError` with `.status` and `.body`. Aborted requests throw `MnemoTimeoutError`. Both inherit from `MnemoError`.

```ts
import { Mnemo, MnemoHTTPError } from 'getmnemo'

try {
  await memory.search({ q: 'rice', containerTag: 'user:jane' })
} catch (err) {
  if (err instanceof MnemoHTTPError && err.status === 401) {
    console.error('API key rejected:', err.body)
  } else {
    throw err
  }
}
```

## Configuration

| Option | Default | Notes |
|---|---|---|
| `apiKey` | (required) | from <https://app.mnemohq.com/settings/api-keys> |
| `workspaceId` | (required) | sent as the `x-workspace-id` header |
| `defaultContainerTag` | none | fallback container for `add`/`search` |
| `baseUrl` | `https://api.mnemohq.com` | override for self-hosted |
| `timeoutMs` | `30000` | per-request abort timeout |
| `fetch` | global `fetch` | inject for testing or proxying |

## Develop

```bash
npm install
npm test
npm run build
```

## CI smoke gate

The publish workflow (`.github/workflows/publish.yml`) will **not** publish to
npm unless a real production round-trip passes first. A `smoke` job runs on the
same `v*` tag trigger and the `publish` job depends on it via `needs: smoke`, so
a failed smoke blocks the release.

`npm run smoke` (`scripts/prod-smoke.mjs`) writes a memory to container **A** and
another to container **B** against prod, confirms the add/search round-trip via
`response.results`, then asserts **tenant isolation**: a search scoped to B must
not return A's memory, and vice versa. A leak exits non-zero with a loud
`TENANT ISOLATION FAILURE` — treat that as a production security finding, not a
flaky test. Created memories are deleted on cleanup (cleanup failure only warns).

It needs three secrets, which **must be ORG-level (no repo-level twin)** — a
repo-level twin shadows the org secret, which is exactly the failure mode that
broke an earlier publish:

| Secret | Purpose |
|---|---|
| `MNEMO_API_KEY` | Scoped test key. **Needs `delete` scope** so the smoke can clean up the memories it creates (plus `write` + `search`). |
| `MNEMO_WORKSPACE_ID` | Throwaway test workspace id. |
| `MNEMO_TEST_CONTAINER` | Base `containerTag` (e.g. `ci-smoke`); the script derives unique per-run A/B containers from it. |

## License

MIT
