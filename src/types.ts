/**
 * Public types for the Mnemo SDK.
 *
 * Request types are derived from the OpenAPI spec at
 * `https://api.mnemohq.com/openapi.json` ("Mnemo API" v0.2.0).
 *
 * Response types are confirmed against real prod payloads captured 2026-06-16
 * (the spec does NOT annotate response schemas — every memories/search op
 * returns `{}` — so these shapes were finalized from live responses).
 */

/**
 * Structured container scope. The alternative to the `containerTag` string —
 * e.g. `{ type: 'user', id: 'jane' }` is equivalent to `containerTag: 'user:jane'`.
 */
export type Scope = {
  type: string
  id: string
}

// ---------------------------------------------------------------------------
// Response types — confirmed against prod 2026-06-16
// ---------------------------------------------------------------------------

/** The container a memory belongs to. */
// confirmed against prod 2026-06-16
export type Container = {
  id: string
  tag: string
  containerType: string
  displayName: string
}

/**
 * A single memory as returned by `get`/`update`, and the per-item shape inside
 * `list` and `add` responses.
 */
// confirmed against prod 2026-06-16
export type Memory = {
  id: string
  scope: Scope
  scopeKey: string
  container: Container
  content: string
  contentHash: string
  idempotencyKey: string | null
  memoryType: string
  metadata: Record<string, unknown> | null
  // `source` shape is still loosely typed — UNCONFIRMED against a real payload.
  source: unknown | null
  sourceDocumentId: string | null
  eventId: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * One stored item in an `add` response. Same fields as a `Memory`.
 */
// confirmed against prod 2026-06-16
export type AddedItem = Memory

/** Response shape of `add()`. */
// confirmed against prod 2026-06-16
export type AddResponse = {
  scopeKey: string
  scope: Scope
  items: AddedItem[]
}

/** One retrieval hit in a `search` response. */
// confirmed against prod 2026-06-16
export type SearchHit = {
  resultType: string
  memoryId: string
  scopeKey: string
  content: string
  metadata: Record<string, unknown> | null
  memoryType: string
  polarity: string
  score: number
  createdAt: string
  updatedAt: string
}

/** Per-stage timing breakdown returned by `search`. */
// confirmed against prod 2026-06-16
export type SearchLatency = {
  parallelMs: number
  strategyMs: number
  fusionMs: number
  rerankerMs: number
  totalMs: number
}

/**
 * Response shape of `search()`. The primary results live in `results`; the
 * `positivePreferences` and `hardConstraints` arrays carry the same `SearchHit`
 * shape, alongside retrieval metadata.
 */
// confirmed against prod 2026-06-16
export type SearchResponse = {
  results: SearchHit[]
  positivePreferences: SearchHit[]
  hardConstraints: SearchHit[]
  searchMode: string
  queryIntent: string
  queryIntentConfidence: number
  abstained: boolean
  reranked: boolean
  rawBestVectorSim: number
  latency: SearchLatency
}

/** Cursor-paginated list of memories. */
// confirmed against prod 2026-06-16
export type PaginatedMemories = {
  items: Memory[]
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export type ClientConfig = {
  /**
   * Required. Full-access by default — keep server-side. For client-exposed
   * contexts, mint a scoped read-only key. Get one at
   * https://app.mnemohq.com/settings/api-keys.
   */
  apiKey: string
  /** Required. Workspace ID — sent as the `x-workspace-id` header on every call. */
  workspaceId: string
  /**
   * Optional default container tag (e.g. `"user:jane"`). When set, `add` and
   * `search` fall back to it if no per-call `containerTag`/`scope` is given.
   */
  defaultContainerTag?: string
  /** Defaults to https://api.mnemohq.com. */
  baseUrl?: string
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number
  /** Inject a custom fetch — handy for testing or proxying. */
  fetch?: typeof fetch
  /** Max retry attempts on 429/5xx and transient network errors (default 3). */
  maxRetries?: number
}
