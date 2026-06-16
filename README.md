# getmnemo

Official TypeScript / JavaScript SDK for [Mnemo Memory](https://mnemohq.com) — long-term memory infrastructure for AI agents.

```bash
npm install getmnemo
```

Zero runtime dependencies. Works in Node 18+, Bun, Deno, Cloudflare Workers, and any other modern server or edge JS runtime with `fetch`. The `apiKey` is a full-access credential — keep it server-side; for browser or client UIs, proxy through a server route.

## Quickstart

```ts
import { Mnemo } from 'getmnemo'

const memory = new Mnemo({
  apiKey: process.env.GETMNEMO_API_KEY!,
  workspaceId: process.env.GETMNEMO_WORKSPACE_ID!,
})

// Store an atomic fact
await memory.add({ content: 'User prefers Japanese short-grain rice for onigiri.' })

// Retrieve relevant facts
const { hits } = await memory.search({ query: 'what kind of rice does the user like?' })
for (const hit of hits) {
  console.log(hit.score.toFixed(2), hit.content)
}
```

## API surface

| Method | Purpose |
|---|---|
| `search({ query, limit?, actorId? })` | Hybrid 7-strategy retrieval. Returns `SearchResponse`. |
| `add({ content, metadata?, actorId? })` | Store an atomic fact. Returns `Memory`. |
| `update(id, { content?, metadata? })` | Patch existing memory. |
| `delete(id)` | Remove a memory. |
| `list({ limit?, cursor?, actorId? })` | Cursor-paginated list. |

## Errors

All HTTP failures throw `MnemoHTTPError` with `.status` and `.body`. Aborted requests throw `MnemoTimeoutError`. Both inherit from `MnemoError`.

```ts
import { Mnemo, MnemoHTTPError } from 'getmnemo'

try {
  await memory.search({ query: 'rice' })
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
| `workspaceId` | (required) | from the dashboard URL |
| `actorId` | none | optional default actor scope |
| `baseUrl` | `https://api.mnemohq.com` | override for self-hosted |
| `timeoutMs` | `30000` | per-request abort timeout |
| `fetch` | global `fetch` | inject for testing or proxying |

## Develop

```bash
npm install
npm test
npm run build
```

## License

MIT
