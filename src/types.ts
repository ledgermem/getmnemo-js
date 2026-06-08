/**
 * Public types for the Mnemo SDK.
 *
 * These mirror the REST API response shapes one-to-one. We deliberately keep
 * them as plain interfaces (no zod runtime cost) — runtime validation is the
 * caller's responsibility if they need it.
 */

export type Memory = {
  id: string
  content: string
  metadata?: Record<string, unknown>
  workspaceId: string
  actorId?: string | null
  createdAt: string
  updatedAt: string
}

export type SearchSource = {
  documentId?: string
  chunkId?: string
}

export type SearchHit = {
  memoryId: string
  content: string
  score: number
  metadata?: Record<string, unknown>
  source?: SearchSource | null
}

export type SearchResponse = {
  hits: SearchHit[]
  query: string
  latencyMs: number
}

export type PaginatedMemories = {
  items: Memory[]
  nextCursor: string | null
}

export type ClientConfig = {
  /** Required. Get one at https://app.mnemohq.com/settings/api-keys. */
  apiKey: string
  /** Required. Workspace ID from the dashboard URL. */
  workspaceId: string
  /** Optional default actor scope for all calls (overridable per-method). */
  actorId?: string
  /** Defaults to https://api.mnemohq.com. */
  baseUrl?: string
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number
  /** Inject a custom fetch — handy for testing or proxying. */
  fetch?: typeof fetch
  /** Max retry attempts on 429/5xx and transient network errors (default 3). */
  maxRetries?: number
}
