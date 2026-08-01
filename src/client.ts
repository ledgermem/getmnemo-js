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
import { DocumentsResource, JobsResource } from './resources.js'
import type {
  AddManyInput,
  AddMemoryInput,
  AddResponse,
  ClientConfig,
  DeleteMemoryOptions,
  DeleteMemoryResponse,
  ListMemoriesInput,
  Memory,
  MemoryMutationPolicy,
  PaginatedMemories,
  ProfileInput,
  ProfileResponse,
  RestoreMemoryResponse,
  Scope,
  SearchInput,
  SearchResponse,
  UpdateMemoryInput,
  WorkspaceExport,
} from './types.js'

const DEFAULT_BASE_URL = 'https://api.mnemohq.com'
const DEFAULT_TIMEOUT_MS = 30_000
const SDK_VERSION = '0.4.4'
const DEFAULT_SEARCH_LIMIT = 8
const USER_AGENT = `getmnemo/${SDK_VERSION}`
const DEFAULT_MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 200
const RETRY_MAX_DELAY_MS = 5_000

// Browsers reject `user-agent` as a forbidden header — setting it via fetch
// throws or warns. Detect a browser-like environment so we can skip it there.
const IS_BROWSER_LIKE =
  typeof window !== 'undefined' && typeof document !== 'undefined'

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
  readonly documents: DocumentsResource
  readonly jobs: JobsResource

  constructor(cfg: ClientConfig) {
    if (!cfg.apiKey) throw new Error('Mnemo: apiKey is required')
    this.#baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.#headers = {
      authorization: `Bearer ${cfg.apiKey}`,
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

    const request = <T>(method: string, path: string, body?: unknown): Promise<T> =>
      this.#request<T>(method, path, body)
    const resolveContainer = (
      method: string,
      input: { containerTag?: string; scope?: Scope },
    ): { containerTag: string } | { scope: Scope } =>
      this.#resolveContainer(method, input)
    this.documents = new DocumentsResource(request, resolveContainer)
    this.jobs = new JobsResource(request)
  }

  /**
   * Resolve the container for a call into the request fields the API expects.
   * A structured `scope` wins over a `containerTag` string; both fall back to
   * the constructor's `defaultContainerTag`. Throws if none is available.
   */
  #resolveContainer(
    method: string,
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
  async search(input: SearchInput): Promise<SearchResponse> {
    const container = this.#resolveContainer('search', input)
    return this.#request<SearchResponse>('POST', '/v1/search', {
      q: input.q,
      limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
      ...(input.searchMode !== undefined ? { searchMode: input.searchMode } : {}),
      ...(input.filters !== undefined ? { filters: input.filters } : {}),
      ...(input.includeSources !== undefined
        ? { includeSources: input.includeSources }
        : {}),
      ...(input.strategies !== undefined ? { strategies: input.strategies } : {}),
      ...(input.excludeIds !== undefined ? { excludeIds: input.excludeIds } : {}),
      ...container,
    })
  }

  /**
   * Store an atomic fact. Requires a container — pass `containerTag` (e.g.
   * `"user:jane"`) or `scope`, or set `defaultContainerTag` on the client.
   *
   * Sends `POST /v1/memories` with body
   * `{ items: [{ content, memoryType?, metadata? }], containerTag|scope }`.
   */
  async add(input: AddMemoryInput): Promise<AddResponse> {
    const {
      containerTag,
      scope,
      id,
      content,
      idempotencyKey,
      memoryType,
      mutationPolicy,
      metadata,
      source,
      enrichmentMode,
    } = input
    return this.addMany({
      containerTag,
      scope,
      enrichmentMode,
      items: [
        {
          id,
          content,
          idempotencyKey,
          memoryType,
          mutationPolicy,
          metadata,
          source,
        },
      ],
    })
  }

  /**
   * Store between 1 and 100 atomic memories in one synchronous request.
   * Per-item IDs and idempotency keys make imports safe to retry.
   */
  async addMany(input: AddManyInput): Promise<AddResponse> {
    if (input.items.length < 1 || input.items.length > 100) {
      throw new Error('Mnemo.addMany: batch size must be between 1 and 100')
    }
    const container = this.#resolveContainer('addMany', input)
    const response = await this.#request<unknown>('POST', '/v1/memories', {
      items: input.items,
      ...(input.containerType !== undefined
        ? { containerType: input.containerType }
        : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.enrichmentMode !== undefined
        ? { enrichmentMode: input.enrichmentMode }
        : {}),
      ...container,
    }, {
      retryAmbiguousFailure: input.items.every((item) => Boolean(item.idempotencyKey)),
    })
    return validateAddResponse(response, input.items.length)
  }

  /** Start a tenant-bound export for audit, drift checking, or rebuilds. */
  async createWorkspaceExport(): Promise<WorkspaceExport> {
    return this.#request<WorkspaceExport>('POST', '/v1/exports')
  }

  /** List export jobs for the API-key workspace. */
  async listWorkspaceExports(): Promise<WorkspaceExport[]> {
    const response = await this.#request<{ items: WorkspaceExport[] }>(
      'GET',
      '/v1/exports',
    )
    return response.items
  }

  /** Read one tenant-bound export job. */
  async getWorkspaceExport(exportId: string): Promise<WorkspaceExport> {
    return this.#request<WorkspaceExport>(
      'GET',
      `/v1/exports/${encodeURIComponent(exportId)}`,
    )
  }

  /**
   * Patch an existing memory by id.
   * Sends `PATCH /v1/memories/{memoryId}` with body `UpdateMemoryDto`
   * `{ content?, memoryType?, metadata?, source? }` (none required).
   */
  async update(
    memoryId: string,
    input: UpdateMemoryInput,
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

  /**
   * Change the mutation policy for a memory. Privileged policy changes require
   * a server-issued API key with the `memories:protect` scope.
   */
  async setProtection(
    memoryId: string,
    mutationPolicy: MemoryMutationPolicy,
  ): Promise<Memory> {
    return this.#request<Memory>(
      'PATCH',
      `/v1/memories/${encodeURIComponent(memoryId)}/protection`,
      { mutationPolicy },
    )
  }

  /** Require a privileged credential for future mutations of this memory. */
  async protect(memoryId: string): Promise<Memory> {
    return this.setProtection(memoryId, 'privileged')
  }

  /** Return a protected memory to the standard mutation policy. */
  async unprotect(memoryId: string): Promise<Memory> {
    return this.setProtection(memoryId, 'standard')
  }

  /**
   * Delete a memory. Deletion is recoverable by default when the workspace has
   * the recovery window enabled. Pass `permanent: true` only for an immediate purge.
   */
  async delete(
    memoryId: string,
    options: DeleteMemoryOptions = {},
  ): Promise<DeleteMemoryResponse> {
    const query = options.permanent === true ? '?permanent=true' : ''
    return this.#request<DeleteMemoryResponse>(
      'DELETE',
      `/v1/memories/${encodeURIComponent(memoryId)}${query}`,
    )
  }

  /** Restore a memory during its recoverable deletion window. */
  async restore(memoryId: string): Promise<RestoreMemoryResponse> {
    return this.#request<RestoreMemoryResponse>(
      'POST',
      `/v1/memories/${encodeURIComponent(memoryId)}/restore`,
    )
  }

  /**
   * Cursor-paginated list of memories within one required container.
   * Sends `GET /v1/memories` with query
   * `limit?, cursor?, scopeType+scopeId|containerTag`.
   */
  async list(input: ListMemoriesInput = {}): Promise<PaginatedMemories> {
    const params = new URLSearchParams()
    if (input.limit !== undefined) params.set('limit', String(input.limit))
    if (input.cursor !== undefined) params.set('cursor', input.cursor)
    if (input.scopeType !== undefined || input.scopeId !== undefined) {
      if (!input.scopeType || !input.scopeId) {
        throw new Error(
          'Mnemo.list: legacy scopeType and scopeId must be supplied together',
        )
      }
      params.set('scopeType', input.scopeType)
      params.set('scopeId', input.scopeId)
    } else {
      const container = this.#resolveContainer('list', input)
      if ('scope' in container) {
        params.set('scopeType', container.scope.type)
        params.set('scopeId', container.scope.id)
      } else {
        params.set('containerTag', container.containerTag)
      }
    }
    const qs = params.toString()
    return this.#request<PaginatedMemories>('GET', `/v1/memories${qs ? `?${qs}` : ''}`)
  }

  /**
   * Return a prompt-ready profile for one scope. Search augmentation is
   * deliberately opt-in because it adds retrieval latency and compute.
   */
  async profile(input: ProfileInput = {}): Promise<ProfileResponse> {
    if (input.includeSearch === true && !input.q?.trim()) {
      throw new Error('Mnemo.profile: q is required when includeSearch is true')
    }
    const container = this.#resolveContainer('profile', input)
    const { containerTag: _containerTag, scope: _scope, ...profile } = input
    return this.#request<ProfileResponse>('POST', '/v1/profile', {
      ...container,
      ...profile,
    })
  }

  /** Echoed back for debugging — never sent to the wire. */
  get defaultContainerTag(): string | undefined {
    return this.#defaultContainerTag
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { retryAmbiguousFailure?: boolean } = {},
  ): Promise<T> {
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
          if (options.retryAmbiguousFailure && attempt < this.#maxRetries) {
            lastErr = new MnemoTimeoutError(this.#timeoutMs)
            await sleep(retryDelayMs(attempt))
            continue
          }
          throw new MnemoTimeoutError(this.#timeoutMs)
        }
        if (err instanceof MnemoHTTPError) throw err
        lastErr = err
        if (options.retryAmbiguousFailure !== false && attempt < this.#maxRetries) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidReceipt(reason: string): Error {
  return new Error(`Mnemo.addMany: invalid write receipt (${reason})`)
}

function validateAddResponse(value: unknown, inputCount: number): AddResponse {
  if (!isRecord(value)) throw invalidReceipt('response is not an object')
  if (!Array.isArray(value.items) || value.items.length !== inputCount) {
    throw invalidReceipt(`expected ${inputCount} returned memories`)
  }

  const receipt = value.receipt
  if (!isRecord(receipt) || receipt.status !== 'searchable') {
    throw invalidReceipt('missing searchable status')
  }
  if (typeof receipt.writeId !== 'string' || receipt.writeId.length === 0) {
    throw invalidReceipt('missing write id')
  }
  if (
    typeof receipt.searchableAt !== 'string' ||
    Number.isNaN(Date.parse(receipt.searchableAt))
  ) {
    throw invalidReceipt('invalid searchable timestamp')
  }
  if (!Array.isArray(receipt.items) || receipt.items.length !== inputCount) {
    throw invalidReceipt(`expected ${inputCount} receipt items`)
  }

  const seen = new Set<number>()
  let created = 0
  let deduplicated = 0
  for (const item of receipt.items) {
    if (!isRecord(item)) throw invalidReceipt('receipt item is not an object')
    const index = item.inputIndex
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= inputCount ||
      seen.has(index)
    ) {
      throw invalidReceipt('receipt indexes are incomplete or duplicated')
    }
    seen.add(index)
    if (typeof item.memoryId !== 'string' || item.memoryId.length === 0) {
      throw invalidReceipt(`item ${index} has no memory id`)
    }
    const returnedMemory = value.items[index]
    if (!isRecord(returnedMemory) || returnedMemory.id !== item.memoryId) {
      throw invalidReceipt(`item ${index} memory id does not match the response`)
    }
    if (item.status === 'created') created += 1
    else if (item.status === 'deduplicated') deduplicated += 1
    else throw invalidReceipt(`item ${index} has an unknown status`)
  }

  if (value.stats !== undefined) {
    if (!isRecord(value.stats)) throw invalidReceipt('stats are not an object')
    if (
      value.stats.total !== inputCount ||
      value.stats.created !== created ||
      value.stats.deduplicated !== deduplicated
    ) {
      throw invalidReceipt('stats do not match item outcomes')
    }
  }

  return value as AddResponse
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
