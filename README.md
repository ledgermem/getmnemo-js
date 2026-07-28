# getmnemo

Store and retrieve long-term memory for AI agents with TypeScript or JavaScript.

- [Documentation](https://mnemohq.com/docs)
- [API keys](https://app.mnemohq.com/settings/api-keys)
- [API reference](https://mnemohq.com/openapi.json)

## Install

```bash
npm install getmnemo
```

Requires Node.js 18 or later. The package has no runtime dependencies and
supports both ESM and CommonJS.

## Quickstart

Create a client, add a memory, and search the same container:

```ts
import { Mnemo } from 'getmnemo'

const mnemo = new Mnemo({
  apiKey: process.env.MNEMO_API_KEY!,
  workspaceId: process.env.MNEMO_WORKSPACE_ID!,
})

await mnemo.add({
  containerTag: 'user:jane',
  content: 'Jane prefers Japanese short-grain rice for onigiri.',
  memoryType: 'preference',
})

const { results } = await mnemo.search({
  containerTag: 'user:jane',
  q: 'What kind of rice does Jane prefer?',
})

console.log(results)
```

Keep the API key on your server. Do not expose a full-access key in browser
code.

## Containers

A container keeps one user, customer, project, or agent separate from the
others.

Use a readable `containerTag`:

```ts
await mnemo.add({
  containerTag: 'customer:acme',
  content: 'Acme renewed through December.',
})
```

Or use the equivalent structured scope:

```ts
await mnemo.add({
  scope: { type: 'customer', id: 'acme' },
  content: 'Acme renewed through December.',
})
```

Set a default when most calls use the same container:

```ts
const mnemo = new Mnemo({
  apiKey: process.env.MNEMO_API_KEY!,
  workspaceId: process.env.MNEMO_WORKSPACE_ID!,
  defaultContainerTag: 'user:jane',
})

await mnemo.add({ content: 'Jane likes onigiri.' })
await mnemo.search({ q: 'What food does Jane like?' })
```

The SDK stops the request if a required container is missing.

## Add memories

### Add one memory

```ts
const response = await mnemo.add({
  containerTag: 'user:jane',
  content: 'Jane avoids shellfish.',
  memoryType: 'preference',
  metadata: { source: 'onboarding' },
})

console.log(response.items[0].id)
console.log(response.receipt.status) // "searchable"
```

### Add many memories

`addMany()` accepts up to 100 memories:

```ts
const response = await mnemo.addMany({
  scope: { type: 'customer', id: 'acme' },
  source: { provider: 'hubspot', importId: 'run_42' },
  items: [
    {
      content: 'Acme renewed through December.',
      idempotencyKey: 'hubspot:deal:123:v9',
      metadata: { objectType: 'deal' },
    },
    {
      content: 'The account owner is Priya.',
      idempotencyKey: 'hubspot:company:456:owner:v3',
    },
  ],
})

console.log(response.stats)
console.log(response.receipt.items)
```

Use a stable `idempotencyKey` when an import may be retried. Repeating the same
write will not create another copy.

Every successful `add()` and `addMany()` response includes a receipt:

```ts
{
  writeId: 'e5bf3f0f-16e2-4a5d-9c7f-98e437cf86c4',
  status: 'searchable',
  searchableAt: '2026-07-28T09:14:22.442Z',
  items: [
    {
      inputIndex: 0,
      memoryId: '8a8a4f8c-cf91-43e4-9a0e-7c2bb2c4d3f2',
      status: 'created',
    },
  ],
}
```

Receipt items follow input order. A `deduplicated` item reused an equivalent
memory already present in the same container. Both outcomes are searchable
when the API returns.

## Search memories

```ts
const { results } = await mnemo.search({
  containerTag: 'user:jane',
  q: 'What changed after the dentist appointment?',
  limit: 10,
  includeSources: true,
})

for (const result of results) {
  console.log(result.score, result.content, result.source)
}
```

Use the following options only when your application needs more control:

| Option | Values | Purpose |
| --- | --- | --- |
| `searchMode` | `hybrid`, `memories`, `documents` | Select the content to search. |
| `filters` | `Record<string, unknown>` | Restrict results by metadata. |
| `includeSources` | `boolean` | Return provenance with each result. |
| `strategies` | `temporal`, `graph`, `rerank`, `agentic` | Add a retrieval strategy to the normal search. |
| `excludeIds` | `string[]` | Leave out results already in the agent's context. |

For example:

```ts
const result = await mnemo.search({
  containerTag: 'user:jane',
  q: 'What changed after the dentist appointment?',
  strategies: ['temporal'],
  excludeIds: ['mem_123'],
})

console.log(result.strategiesRan)
```

`temporal` usually adds little latency. `graph` may add moderate latency.
`rerank` and `agentic` may add model cost and take longer.

## Ingest documents

Use documents for conversations, notes, transcripts, and other raw text. Mnemo
processes documents asynchronously.

### Ingest one document

```ts
const accepted = await mnemo.documents.create({
  containerTag: 'customer:acme',
  content: meetingTranscript,
  contentType: 'conversation',
  customId: 'meeting-2026-07-27',
})

const job = await mnemo.jobs.wait(accepted.jobId)
console.log(job.status)
```

### Ingest a batch

`createBatch()` accepts up to 50 documents. Every result is reported separately,
so one invalid document does not hide the others.

```ts
const batch = await mnemo.documents.createBatch({
  documents: [
    {
      scope: { type: 'customer', id: 'acme' },
      content: meetingTranscript,
      contentType: 'conversation',
      customId: 'meeting-2026-07-27',
    },
    {
      scope: { type: 'customer', id: 'acme' },
      content: accountNotes,
      contentType: 'note',
      customId: 'account-notes-2026-07-27',
    },
  ],
})

for (const item of batch.results) {
  if (item.status === 'accepted') {
    await mnemo.jobs.wait(item.jobId)
  } else {
    console.error(`Document ${item.index} failed: ${item.error}`)
  }
}
```

## Read and update memories

```ts
const memory = await mnemo.get('mem_123')

await mnemo.update(memory.id, {
  content: 'Jane now prefers brown rice.',
  metadata: { changedBy: 'user' },
})

const page = await mnemo.list({
  containerTag: 'user:jane',
  limit: 20,
})

console.log(page.items, page.nextCursor)
```

## Delete and restore memories

Deletion is recoverable when recovery is enabled for the workspace:

```ts
const deleted = await mnemo.delete('mem_123')

console.log(deleted.receipt?.restorableUntil)

await mnemo.restore('mem_123')
```

Skip the recovery window only when permanent deletion is intentional:

```ts
await mnemo.delete('mem_123', { permanent: true })
```

## Build prompt context

`profile()` returns prompt-ready facts, recent context, preferences, and hard
constraints for one container:

```ts
const context = await mnemo.profile({
  containerTag: 'user:jane',
  staticLimit: 12,
  dynamicLimit: 10,
})
```

Search is off by default. To include search results, provide both
`includeSearch` and `q`:

```ts
const context = await mnemo.profile({
  containerTag: 'user:jane',
  includeSearch: true,
  q: 'What should I know before replying?',
})
```

## Memory types

`memoryType` is optional. Supported values include:

- `memory`
- `preference`
- `fact`
- `observation`
- `event`
- `note`
- `reminder`
- `goal`

The API stores an unknown value as `memory` instead of rejecting the write.

## Error handling

The SDK throws:

- `MnemoHTTPError` for an unsuccessful API response.
- `MnemoTimeoutError` when a request reaches its timeout.
- `MnemoError` as the base class for SDK errors.

```ts
import { MnemoHTTPError } from 'getmnemo'

try {
  await mnemo.search({
    containerTag: 'user:jane',
    q: 'rice preference',
  })
} catch (error) {
  if (error instanceof MnemoHTTPError) {
    console.error(error.status, error.body)
  } else {
    throw error
  }
}
```

The client retries transient network errors, `429` responses, and `5xx`
responses. Set `maxRetries: 0` to disable retries.

## Client configuration

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | Yes | - | Mnemo API key. |
| `workspaceId` | Yes | - | Workspace sent in the `x-workspace-id` header. |
| `defaultContainerTag` | No | - | Container used when a call does not provide one. |
| `baseUrl` | No | `https://api.mnemohq.com` | API base URL. |
| `timeoutMs` | No | `30000` | Request timeout in milliseconds. |
| `maxRetries` | No | `3` | Retries for transient failures. |
| `fetch` | No | `globalThis.fetch` | Custom fetch implementation for tests or proxies. |

API keys are full-access by default. You can create a key with only the
`read`, `write`, `delete`, or `billing` scopes it needs. Use a read-only scoped
key or a server proxy when a key may reach client code.

## Method reference

| Method | What it does |
| --- | --- |
| `add(input)` | Add one memory. |
| `addMany(input)` | Add up to 100 memories. |
| `search(input)` | Search memories, documents, or both. |
| `get(memoryId)` | Get one memory. |
| `list(input)` | List memories with cursor pagination. |
| `update(memoryId, input)` | Update one memory. |
| `delete(memoryId, options?)` | Delete one memory. |
| `restore(memoryId)` | Restore a recoverable deletion. |
| `profile(input)` | Build context for a prompt. |
| `documents.create(input)` | Start one document ingestion job. |
| `documents.createBatch(input)` | Start up to 50 document ingestion jobs. |
| `documents.get(documentId)` | Get one document. |
| `documents.list(input)` | List documents. |
| `documents.update(documentId, input)` | Update and optionally reprocess a document. |
| `documents.delete(documentId)` | Delete a document. |
| `jobs.get(jobId, options?)` | Get one ingestion job. |
| `jobs.list()` | List ingestion jobs. |
| `jobs.wait(jobId, options?)` | Wait for an ingestion job to finish. |

All request and response types are exported from `getmnemo`.

## Help

- Read the [Mnemo documentation](https://mnemohq.com/docs).
- Report SDK problems in [GitHub Issues](https://github.com/ledgermem/getmnemo-js/issues).

## License

MIT
