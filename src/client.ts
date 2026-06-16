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
 * await memory.add({ content: 'User prefers Japanese rice.' })
 * const { hits } = await memory.search({ query: 'what rice does the user like?' })
 * ```
 */

import { MnemoHTTPError, MnemoTimeoutError } from './errors.js'
import type {
  ClientConfig,
  Memory,
  PaginatedMemories,
  SearchResponse,
} from './types.js'

const DEFAULT_BASE_URL = 'https://api.mnemohq.com'
const DEFAULT_TIMEOUT_MS = 30_000
const SDK_VERSION = '0.1.0'
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
  readonly #defaultActorId: string | undefined

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
    if (cfg.actorId) this.#headers['x-actor-id'] = cfg.actorId
    this.#defaultActorId = cfg.actorId
    this.#fetch = cfg.fetch ?? fetch
    this.#timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#maxRetries = Math.max(0, cfg.maxRetries ?? DEFAULT_MAX_RETRIES)
  }

  async search(input: {
    query: string
    limit?: number
    actorId?: string
  }): Promise<SearchResponse> {
    return this.#request<SearchResponse>('POST', '/v1/search', {
      query: input.query,
      limit: input.limit ?? 8,
      ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    })
  }

  async add(input: {
    content: string
    metadata?: Record<string, unknown>
    actorId?: string
  }): Promise<Memory> {
    return this.#request<Memory>('POST', '/v1/memories', {
      content: input.content,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    })
  }

  async update(
    id: string,
    input: { content?: string; metadata?: Record<string, unknown> },
  ): Promise<Memory> {
    if (input.content === undefined && input.metadata === undefined) {
      throw new Error('Mnemo.update: at least one of content/metadata must be provided')
    }
    return this.#request<Memory>('PATCH', `/v1/memories/${encodeURIComponent(id)}`, input)
  }

  async get(id: string): Promise<Memory> {
    return this.#request<Memory>('GET', `/v1/memories/${encodeURIComponent(id)}`)
  }

  async delete(id: string): Promise<void> {
    await this.#request<unknown>('DELETE', `/v1/memories/${encodeURIComponent(id)}`)
  }

  async list(input?: {
    limit?: number
    cursor?: string
    actorId?: string
  }): Promise<PaginatedMemories> {
    const params = new URLSearchParams()
    if (input?.limit !== undefined) params.set('limit', String(input.limit))
    if (input?.cursor !== undefined) params.set('cursor', input.cursor)
    if (input?.actorId !== undefined) params.set('actorId', input.actorId)
    const qs = params.toString()
    return this.#request<PaginatedMemories>('GET', `/v1/memories${qs ? `?${qs}` : ''}`)
  }

  /** Echoed back for debugging — never sent to the wire. */
  get defaultActorId(): string | undefined {
    return this.#defaultActorId
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
