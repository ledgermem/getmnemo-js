/**
 * Mnemo Memory client.
 *
 * Zero runtime dependencies — uses the global `fetch` (Node 18+, Bun, browsers,
 * Cloudflare Workers, Deno, etc).
 *
 * @example
 * ```ts
 * import { Mnemo } from 'getmnemo'
 *
 * const memory = new Mnemo({
 *   apiKey: process.env.GETMNEMO_API_KEY!,
 *   workspaceId: process.env.GETMNEMO_WORKSPACE_ID!,
 * })
 *
 * await memory.add({ content: 'User prefers Japanese rice.', containerTag: 'user:jane' })
 * const { results } = await memory.search({ q: 'what rice does the user like?', containerTag: 'user:jane' })
 * ```
 */

import { MnemoHTTPError, MnemoTimeoutError } from './errors.js'
import type {
  AddResponse,
  ClientConfig,
  Memory,
  PaginatedMemories,
  Scope,
  SearchResponse,
} from './types.js'

const DEFAULT_BASE_URL = 'https://api.mnemohq.com'
const DEFAULT_TIMEOUT_MS = 30_000
const SDK_VERSION = '0.2.0'
const DEFAULT_SEARCH_LIMIT = 8
const USER_AGENT = `getmnemo/${SDK_VERSION}`
const DEFAULT_MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 200
const RETRY_MAX_DELAY_MS = 5_000

// Browsers reject `user-agent` as a forbidden header — setting it via fetch
// throws or warns. Detect a browser-like environment so we can skip it there.
const IS_BROWSER_LIKE =
  typeof globalThis !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).window !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).document !== 'undefined'

function retryDelayMs(attempt: number): number {
  const capped = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS)
  // Full jitter.
  return Math.floor(Math.random() * capped)
}

function isRetryableStatus(status: number): boolean {
  // 501 Not Implemented is a permanent failure — retrying just wastes round-trips.
  if (status === 501) return false
  return status === 429 || (status >= 500 && status < 600)
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  // Delta-seconds form.
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_MAX_DELAY_MS)
  }
  // HTTP-date form.
  const epoch = Date.parse(trimmed)
  if (!Number.isNaN(epoch)) {
    const delta = epoch - Date.now()
    return Math.max(0, Math.min(delta, RETRY_MAX_DELAY_MS))
  }
  return null
}

function delayForResponse(res: Response, attempt: number): number {
  const hint = parseRetryAfterMs(res.headers.get('retry-after'))
  return hint !== null ? hint : retryDelayMs(attempt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class Mnemo {
  readonly #baseUrl: string
  readonly #headers: Record<string, string>
  readonly #fetch: typeof fetch
  readonly #timeoutMs: number
  readonly #maxRetries: number
  readonly #defaultContainerTag: string | undefined

  constructor(cfg: ClientConfig) {
    if (!cfg.apiKey) throw new Error('Mnemo: apiKey is required')
    if (!cfg.workspaceId) throw new Error('Mnemo: workspaceId is required')
    this.#baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.#headers = {
      authorization: `Bearer ${cfg.apiKey}`,
      'x-workspace-id': cfg.workspaceId,
      'content-type': 'application/json',
    }
    // `user-agent` is on the forbidden header list in browsers — setting it
    // via fetch is silently dropped or throws. Send `x-getmnemo-client` as
    // an SDK identifier in browsers, and the standard User-Agent on Node.
    if (IS_BROWSER_LIKE) {
      this.#headers['x-getmnemo-client'] = USER_AGENT
    } else {
      this.#headers['user-agent'] = USER_AGENT
    }
    this.#defaultContainerTag = cfg.defaultContainerTag
    this.#fetch = cfg.fetch ?? fetch
    this.#timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#maxRetries = Math.max(0, cfg.maxRetries ?? DEFAULT_MAX_RETRIES)
  }

  /**
   * Resolve the container for a call into the request fields the API expects.
   * A structured `scope` wins over a `containerTag` string; both fall back to
   * the constructor's `defaultContainerTag`. Throws if none is available.
   */
  #resolveContainer(
    method: 'add' | 'search',
    input: { containerTag?: string; scope?: Scope },
  ): { containerTag: string } | { scope: Scope } {
    if (input.scope) return { scope: input.scope }
    const tag = input.containerTag ?? this.#defaultContainerTag
    if (tag) return { containerTag: tag }
    throw new Error(
      `Mnemo.${method}: a container is required — pass containerTag (e.g. "user:jane") ` +
        'or scope ({ type, id }) per call, or set defaultContainerTag on the client.',
    )
  }

  /**
   * Hybrid retrieval. Requires a container — pass `containerTag` (e.g.
   * `"user:jane"`) or `scope`, or set `defaultContainerTag` on the client.
   *
   * Sends `POST /v1/search` with body `{ q, limit, containerTag|scope }`.
   */
  async search(input: {
    q: string
    containerTag?: string
    scope?: Scope
    limit?: number
    searchMode?: string
  }): Promise<SearchResponse> {
    const container = this.#resolveContainer('search', input)
    return this.#request<SearchResponse>('POST', '/v1/search', {
      q: input.q,
      limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
      ...(input.searchMode !== undefined ? { searchMode: input.searchMode } : {}),
      ...container,
    })
  }

  /**
   * Store an atomic fact. Requires a container — pass `containerTag` (e.g.
   * `"user:jane"`) or `scope`, or set `defaultContainerTag` on the client.
   *
   * Sends `POST /v1/memories` with body
   * `{ items: [{ content, metadata? }], containerTag|scope }`.
   */
  async add(input: {
    content: string
    containerTag?: string
    scope?: Scope
    metadata?: Record<string, unknown>
  }): Promise<AddResponse> {
    const container = this.#resolveContainer('add', input)
    return this.#request<AddResponse>('POST', '/v1/memories', {
      items: [
        {
          content: input.content,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        },
      ],
      ...container,
    })
  }

  /**
   * Patch an existing memory by id.
   * Sends `PATCH /v1/memories/{memoryId}` with body `UpdateMemoryDto`
   * `{ content?, memoryType?, metadata?, source? }` (none required).
   */
  async update(
    memoryId: string,
    input: {
      content?: string
      memoryType?: string
      metadata?: Record<string, unknown>
      source?: string
    },
  ): Promise<Memory> {
    if (
      input.content === undefined &&
      input.memoryType === undefined &&
      input.metadata === undefined &&
      input.source === undefined
    ) {
      throw new Error(
        'Mnemo.update: at least one of content/memoryType/metadata/source must be provided',
      )
    }
    return this.#request<Memory>(
      'PATCH',
      `/v1/memories/${encodeURIComponent(memoryId)}`,
      input,
    )
  }

  /** Fetch a single memory by id. Sends `GET /v1/memories/{memoryId}`. */
  async get(memoryId: string): Promise<Memory> {
    return this.#request<Memory>('GET', `/v1/memories/${encodeURIComponent(memoryId)}`)
  }

  /** Remove a memory by id. Sends `DELETE /v1/memories/{memoryId}`. */
  async delete(memoryId: string): Promise<void> {
    await this.#request<unknown>(
      'DELETE',
      `/v1/memories/${encodeURIComponent(memoryId)}`,
    )
  }

  /**
   * Cursor-paginated list of memories, optionally filtered by container.
   * Sends `GET /v1/memories` with query
   * `limit?, cursor?, scopeType?, scopeId?, containerTag?`.
   */
  async list(input?: {
    containerTag?: string
    limit?: number
    cursor?: string
    scopeType?: string
    scopeId?: string
  }): Promise<PaginatedMemories> {
    const params = new URLSearchParams()
    if (input?.limit !== undefined) params.set('limit', String(input.limit))
    if (input?.cursor !== undefined) params.set('cursor', input.cursor)
    if (input?.scopeType !== undefined) params.set('scopeType', input.scopeType)
    if (input?.scopeId !== undefined) params.set('scopeId', input.scopeId)
    if (input?.containerTag !== undefined) params.set('containerTag', input.containerTag)
    const qs = params.toString()
    return this.#request<PaginatedMemories>('GET', `/v1/memories${qs ? `?${qs}` : ''}`)
  }

  /** Echoed back for debugging — never sent to the wire. */
  get defaultContainerTag(): string | undefined {
    return this.#defaultContainerTag
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const serializedBody = body === undefined ? undefined : JSON.stringify(body)
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs)
      try {
        const res = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: { ...this.#headers },
          body: serializedBody,
          signal: ctrl.signal,
        })
        if (isRetryableStatus(res.status) && attempt < this.#maxRetries) {
          // Capture Retry-After before draining; some runtimes invalidate
          // headers once the body is consumed.
          const wait = delayForResponse(res, attempt)
          // Drain body so the underlying connection can be reused.
          await res.text().catch(() => undefined)
          await sleep(wait)
          continue
        }
        const text = await res.text()
        const parsed: unknown = text ? safeJson(text) : undefined
        if (!res.ok) {
          const message =
            (parsed && typeof parsed === 'object' && 'message' in parsed
              ? String((parsed as { message: unknown }).message)
              : null) ?? `HTTP ${res.status} ${res.statusText}`
          throw new MnemoHTTPError(message, res.status, parsed)
        }
        return parsed as T
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new MnemoTimeoutError(this.#timeoutMs)
        }
        if (err instanceof MnemoHTTPError) throw err
        lastErr = err
        if (attempt < this.#maxRetries) {
          await sleep(retryDelayMs(attempt))
          continue
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastErr ?? new Error('Mnemo: request failed')
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
