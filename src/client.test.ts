import { describe, expect, it } from 'vitest'

import { Mnemo, MnemoHTTPError } from './index.js'

function fakeFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return Promise.resolve(handler(req))
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function addResponse(statuses: Array<'created' | 'deduplicated'>): Record<string, unknown> {
  const created = statuses.filter((status) => status === 'created').length
  return {
    scopeKey: 'customer:acme',
    scope: { type: 'customer', id: 'acme' },
    items: statuses.map((_, index) => ({ id: `mem_${index + 1}` })),
    stats: {
      total: statuses.length,
      created,
      deduplicated: statuses.length - created,
    },
    receipt: {
      writeId: '22222222-2222-4222-8222-222222222222',
      status: 'searchable',
      searchableAt: '2026-07-28T09:15:00.000Z',
      items: statuses.map((status, inputIndex) => ({
        inputIndex,
        memoryId: `mem_${inputIndex + 1}`,
        status,
      })),
    },
  }
}

describe('Mnemo', () => {
  describe('auth headers', () => {
    it('sends the API key without a caller-selected workspace header', async () => {
      let seen: Headers | undefined
      const client = new Mnemo({
        apiKey: 'prfly_live_abc',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch((req) => {
          seen = req.headers
          return json({ results: [] })
        }),
      })
      await client.search({ q: 'x' })
      expect(seen?.get('authorization')).toBe('Bearer prfly_live_abc')
      expect(seen?.get('x-workspace-id')).toBeNull()
    })
  })

  describe('search', () => {
    it('sends POST /v1/search with q + limit + containerTag', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          expect(req.method).toBe('POST')
          expect(new URL(req.url).pathname).toBe('/v1/search')
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({ q: 'rice', limit: 5, containerTag: 'user:jane' })
          return json({
            results: [
              {
                resultType: 'memory',
                memoryId: 'mem_1',
                scopeKey: 'user:jane',
                content: 'User prefers Japanese rice.',
                metadata: null,
                memoryType: 'preference',
                polarity: 'positive',
                score: 0.91,
                createdAt: '2026-06-16T00:00:00.000Z',
                updatedAt: '2026-06-16T00:00:00.000Z',
                sources: {
                  provenance: {
                    filePath: 'notes/preferences.md',
                    commitHash: 'abc123',
                  },
                },
              },
            ],
            positivePreferences: [],
            hardConstraints: [],
            searchMode: 'hybrid',
            queryIntent: 'lookup',
            queryIntentConfidence: 0.95,
            abstained: false,
            reranked: true,
            rawBestVectorSim: 0.82,
            latency: {
              parallelMs: 1,
              strategyMs: 2,
              fusionMs: 3,
              rerankerMs: 4,
              totalMs: 10,
            },
          })
        }),
      })
      const res = await client.search({ q: 'rice', limit: 5, containerTag: 'user:jane' })
      expect(res.results).toHaveLength(1)
      expect(res.results[0]?.score).toBe(0.91)
      expect(res.results[0]?.scopeKey).toBe('user:jane')
      expect(res.results[0]?.sources?.provenance?.commitHash).toBe('abc123')
    })

    it('sends scope instead of containerTag when scope is given', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({
            q: 'rice',
            limit: 8,
            scope: { type: 'user', id: 'jane' },
          })
          return json({ results: [] })
        }),
      })
      await client.search({ q: 'rice', scope: { type: 'user', id: 'jane' } })
    })

    it('passes agent-selected strategies and excludeIds through to /v1/search', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({
            q: 'dentist timeline',
            limit: 8,
            containerTag: 'user:jane',
            strategies: ['temporal', 'graph'],
            excludeIds: ['mem_1', 'doc_2'],
          })
          return json({
            results: [],
            strategiesRan: ['vector', 'lexical', 'fact', 'temporal', 'graph'],
          })
        }),
      })

      const res = await client.search({
        q: 'dentist timeline',
        containerTag: 'user:jane',
        strategies: ['temporal', 'graph'],
        excludeIds: ['mem_1', 'doc_2'],
      })

      expect(res.strategiesRan).toEqual([
        'vector',
        'lexical',
        'fact',
        'temporal',
        'graph',
      ])
    })

    it('passes stable public search controls without internal routing flags', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({
            q: 'support policy',
            limit: 8,
            scope: { type: 'team', id: 'support', tags: ['org:acme'] },
            searchMode: 'documents',
            includeSources: true,
            filters: { department: 'support' },
          })
          expect(body).not.toHaveProperty('mode')
          expect(body).not.toHaveProperty('intentOverride')
          expect(body).not.toHaveProperty('agentic')
          return json({ results: [] })
        }),
      })

      await client.search({
        q: 'support policy',
        scope: { type: 'team', id: 'support', tags: ['org:acme'] },
        searchMode: 'documents',
        includeSources: true,
        filters: { department: 'support' },
      })
    })

    it('falls back to defaultContainerTag', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:default',
        fetch: fakeFetch(async (req) => {
          const body = (await req.json()) as Record<string, unknown>
          expect(body.containerTag).toBe('user:default')
          return json({ results: [] })
        }),
      })
      await client.search({ q: 'rice' })
    })

    it('throws when no container is available', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(() => json({ results: [] })),
      })
      await expect(client.search({ q: 'rice' })).rejects.toThrow(/container is required/)
    })
  })

  describe('add', () => {
    it('wraps content into items[] with containerTag and memoryType', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          expect(req.method).toBe('POST')
          expect(new URL(req.url).pathname).toBe('/v1/memories')
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({
            items: [
              {
                content: 'User prefers rice.',
                memoryType: 'preference',
                metadata: { source: 'test' },
              },
            ],
            containerTag: 'user:jane',
          })
          return json({
            scopeKey: 'user:jane',
            scope: { type: 'user', id: 'jane' },
            items: [
              {
                id: 'mem_123',
                content: 'User prefers rice.',
                container: {
                  id: 'c1',
                  tag: 'user:jane',
                  containerType: 'user',
                  displayName: 'Jane',
                },
                contentHash: 'h1',
              },
            ],
            receipt: {
              writeId: '11111111-1111-4111-8111-111111111111',
              status: 'searchable',
              searchableAt: '2026-07-28T09:14:22.442Z',
              items: [
                {
                  inputIndex: 0,
                  memoryId: 'mem_123',
                  status: 'created',
                },
              ],
            },
          })
        }),
      })
      const res = await client.add({
        content: 'User prefers rice.',
        memoryType: 'preference',
        containerTag: 'user:jane',
        metadata: { source: 'test' },
      })
      expect(res.scopeKey).toBe('user:jane')
      expect(res.items[0]?.id).toBe('mem_123')
      expect(res.receipt).toEqual({
        writeId: '11111111-1111-4111-8111-111111111111',
        status: 'searchable',
        searchableAt: '2026-07-28T09:14:22.442Z',
        items: [
          {
            inputIndex: 0,
            memoryId: 'mem_123',
            status: 'created',
          },
        ],
      })
    })

    it('throws when no container is available', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(() => json({})),
      })
      await expect(client.add({ content: 'x' })).rejects.toThrow(/container is required/)
    })

    it('preserves idempotency and provenance on one memory', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({
            items: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                content: 'Customer renewed.',
                idempotencyKey: 'hubspot:deal:42:v7',
                source: { provider: 'hubspot', recordId: '42' },
              },
            ],
            scope: { type: 'customer', id: 'acme' },
          })
          return json(addResponse(['created']))
        }),
      })

      await client.add({
        id: '11111111-1111-4111-8111-111111111111',
        content: 'Customer renewed.',
        idempotencyKey: 'hubspot:deal:42:v7',
        source: { provider: 'hubspot', recordId: '42' },
        scope: { type: 'customer', id: 'acme' },
      })
    })
  })

  describe('addMany', () => {
    it('supports verbatim governed imports without sending a workspace selector', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'legacy-value',
        fetch: fakeFetch(async (req) => {
          expect(req.headers.get('x-workspace-id')).toBeNull()
          expect(await req.json()).toMatchObject({ enrichmentMode: 'skip' })
          return json(addResponse(['created']))
        }),
      })

      await client.addMany({
        scope: { type: 'customer', id: 'acme' },
        enrichmentMode: 'skip',
        items: [{ content: 'Source of truth.' }],
      })
    })

    it('sends up to 100 memory items in one request', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          const body = (await req.json()) as {
            items: Array<Record<string, unknown>>
            source?: Record<string, unknown>
          }
          expect(new URL(req.url).pathname).toBe('/v1/memories')
          expect(body.items).toEqual([
            {
              content: 'First fact',
              idempotencyKey: 'import:1',
              memoryType: 'fact',
            },
            { content: 'Second fact', metadata: { row: 2 } },
          ])
          expect(body.source).toEqual({ importId: 'run_1' })
          expect(body.enrichmentMode).toBe('skip')
          return json({
            scopeKey: 'customer:acme',
            scope: { type: 'customer', id: 'acme' },
            items: [{ id: 'mem_1' }, { id: 'mem_2' }],
            stats: { total: 2, created: 2, deduplicated: 0 },
            receipt: {
              writeId: '22222222-2222-4222-8222-222222222222',
              status: 'searchable',
              searchableAt: '2026-07-28T09:15:00.000Z',
              items: [
                { inputIndex: 0, memoryId: 'mem_1', status: 'created' },
                { inputIndex: 1, memoryId: 'mem_2', status: 'created' },
              ],
            },
          })
        }),
      })

      const result = await client.addMany({
        scope: { type: 'customer', id: 'acme' },
        source: { importId: 'run_1' },
        enrichmentMode: 'skip',
        items: [
          { content: 'First fact', idempotencyKey: 'import:1', memoryType: 'fact' },
          { content: 'Second fact', metadata: { row: 2 } },
        ],
      })

      expect(result.stats).toEqual({ total: 2, created: 2, deduplicated: 0 })
      expect(result.receipt.status).toBe('searchable')
      expect(result.receipt.items).toHaveLength(2)
    })

    it('rejects empty and oversized batches before sending', async () => {
      let calls = 0
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => {
          calls += 1
          return json({})
        }),
      })

      await expect(client.addMany({ items: [] })).rejects.toThrow(/between 1 and 100/)
      await expect(
        client.addMany({
          items: Array.from({ length: 101 }, (_, index) => ({
            content: `fact ${index}`,
          })),
        }),
      ).rejects.toThrow(/between 1 and 100/)
      expect(calls).toBe(0)
    })

    it('rejects a successful response that omits an input receipt', async () => {
      const response = addResponse(['created', 'created'])
      ;(response.receipt as { items: unknown[] }).items.pop()
      const client = new Mnemo({
        apiKey: 'test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => json(response)),
      })

      await expect(
        client.addMany({ items: [{ content: 'first' }, { content: 'second' }] }),
      ).rejects.toThrow(/receipt/i)
    })

    it('rejects duplicate receipt indexes instead of guessing their inputs', async () => {
      const response = addResponse(['created', 'deduplicated'])
      const receiptItems = (response.receipt as { items: Array<{ inputIndex: number }> }).items
      receiptItems[1]!.inputIndex = 0
      const client = new Mnemo({
        apiKey: 'test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => json(response)),
      })

      await expect(
        client.addMany({ items: [{ content: 'first' }, { content: 'second' }] }),
      ).rejects.toThrow(/receipt/i)
    })

    it('rejects a receipt whose memory id disagrees with the returned item', async () => {
      const response = addResponse(['created'])
      ;(
        (response.receipt as { items: Array<{ memoryId: string }> }).items[0]!
      ).memoryId = 'mem_different'
      const client = new Mnemo({
        apiKey: 'test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => json(response)),
      })

      await expect(
        client.addMany({ items: [{ content: 'first' }] }),
      ).rejects.toThrow(/receipt/i)
    })

    it('retries a timed-out atomic batch when every item has an idempotency key', async () => {
      let calls = 0
      const client = new Mnemo({
        apiKey: 'test',
        defaultContainerTag: 'user:jane',
        maxRetries: 1,
        fetch: fakeFetch(() => {
          calls += 1
          if (calls === 1) {
            const error = new Error('request timed out')
            error.name = 'AbortError'
            throw error
          }
          return json(addResponse(['created']))
        }),
      })

      await expect(
        client.addMany({
          items: [{ content: 'safe retry', idempotencyKey: 'import:stable:1' }],
        }),
      ).resolves.toMatchObject({ receipt: { status: 'searchable' } })
      expect(calls).toBe(2)
    })
  })

  describe('workspace exports', () => {
    it('uses the tenant-bound export endpoints', async () => {
      const paths: string[] = []
      const client = new Mnemo({
        apiKey: 'test',
        fetch: fakeFetch((req) => {
          paths.push(new URL(req.url).pathname)
          if (req.method === 'POST') return json({ id: 'export_1', status: 'queued' })
          if (paths.length === 2) return json({ items: [{ id: 'export_1' }] })
          return json({ id: 'export_1', status: 'completed' })
        }),
      })

      await client.createWorkspaceExport()
      await client.listWorkspaceExports()
      await client.getWorkspaceExport('export_1')
      expect(paths).toEqual(['/v1/exports', '/v1/exports', '/v1/exports/export_1'])
    })
  })

  describe('update', () => {
    it('sends PATCH /v1/memories/{memoryId} with the patch body', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          expect(req.method).toBe('PATCH')
          expect(new URL(req.url).pathname).toBe('/v1/memories/mem_1')
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({ content: 'new' })
          return json({ id: 'mem_1', content: 'new' })
        }),
      })
      const res = await client.update('mem_1', { content: 'new' })
      expect(res.id).toBe('mem_1')
    })

    it('requires at least one field', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(() => json({})),
      })
      await expect(client.update('mem_1', {})).rejects.toThrow(/at least one of/)
    })

    it('supports structured source and explicit metadata clearing', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          expect(await req.json()).toEqual({
            metadata: null,
            source: { provider: 'notion', pageId: 'p1' },
          })
          return json({ id: 'mem_1' })
        }),
      })

      await client.update('mem_1', {
        metadata: null,
        source: { provider: 'notion', pageId: 'p1' },
      })
    })
  })

  describe('get', () => {
    it('sends GET /v1/memories/{memoryId}', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          expect(req.method).toBe('GET')
          expect(new URL(req.url).pathname).toBe('/v1/memories/mem_1')
          return json({ id: 'mem_1', content: 'hi' })
        }),
      })
      const res = await client.get('mem_1')
      expect(res.id).toBe('mem_1')
    })
  })

  describe('delete', () => {
    it('returns the recoverable deletion receipt', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          expect(req.method).toBe('DELETE')
          expect(new URL(req.url).pathname).toBe('/v1/memories/mem_1')
          expect(new URL(req.url).search).toBe('')
          return json({
            id: 'mem_1',
            deleted: true,
            receipt: {
              id: 'receipt_1',
              eventId: 'event_1',
              status: 'restorable',
              completedAt: '2026-07-27T00:00:00.000Z',
              restorableUntil: '2026-07-27T01:00:00.000Z',
              purged: { memories: 1 },
            },
          })
        }),
      })
      const result = await client.delete('mem_1')
      expect(result.receipt?.status).toBe('restorable')
    })

    it('adds permanent=true only when explicitly requested', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          expect(new URL(req.url).searchParams.get('permanent')).toBe('true')
          return json({ id: 'mem_1', deleted: true })
        }),
      })
      await client.delete('mem_1', { permanent: true })
    })
  })

  describe('restore', () => {
    it('restores a recoverably deleted memory', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          expect(req.method).toBe('POST')
          expect(new URL(req.url).pathname).toBe('/v1/memories/mem_1/restore')
          return json({
            id: 'mem_1',
            restored: true,
            receiptId: 'receipt_1',
            restoredAt: '2026-07-27T00:10:00.000Z',
          })
        }),
      })
      const result = await client.restore('mem_1')
      expect(result.restored).toBe(true)
    })
  })

  describe('protected memories', () => {
    it('sends privileged policy when adding a protected memory', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(async (req) => {
          expect(req.method).toBe('POST')
          expect(new URL(req.url).pathname).toBe('/v1/memories')
          expect(await req.json()).toMatchObject({
            items: [
              {
                content: 'Never disclose the recovery phrase.',
                mutationPolicy: 'privileged',
              },
            ],
          })
          return json(addResponse(['created']))
        }),
      })

      await client.add({
        content: 'Never disclose the recovery phrase.',
        mutationPolicy: 'privileged',
      })
    })

    it('protects and unprotects through the policy endpoint', async () => {
      const policies: string[] = []
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          expect(req.method).toBe('PATCH')
          expect(new URL(req.url).pathname).toBe(
            '/v1/memories/mem_1/protection',
          )
          const body = (await req.json()) as { mutationPolicy: string }
          policies.push(body.mutationPolicy)
          return json({
            id: 'mem_1',
            mutationPolicy: body.mutationPolicy,
            protectedAt:
              body.mutationPolicy === 'privileged'
                ? '2026-07-28T00:00:00.000Z'
                : null,
          })
        }),
      })

      await client.protect('mem_1')
      await client.unprotect('mem_1')
      expect(policies).toEqual(['privileged', 'standard'])
    })
  })

  describe('documents', () => {
    it('creates a document with the default container', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'customer:acme',
        fetch: fakeFetch(async (req) => {
          expect(req.method).toBe('POST')
          expect(new URL(req.url).pathname).toBe('/v1/documents')
          expect(await req.json()).toEqual({
            content: 'Meeting transcript',
            contentType: 'conversation',
            customId: 'meeting-42',
            containerTag: 'customer:acme',
          })
          return json({
            documentId: 'doc_1',
            jobId: 'job_1',
            status: 'queued',
            reused: false,
          })
        }),
      })

      const result = await client.documents.create({
        content: 'Meeting transcript',
        contentType: 'conversation',
        customId: 'meeting-42',
      })
      expect(result.jobId).toBe('job_1')
    })

    it('creates a batch while resolving each document scope', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'customer:default',
        fetch: fakeFetch(async (req) => {
          expect(new URL(req.url).pathname).toBe('/v1/documents/batch')
          expect(await req.json()).toEqual({
            documents: [
              {
                content: 'A',
                contentType: 'text',
                containerTag: 'customer:default',
              },
              {
                content: 'B',
                contentType: 'text',
                scope: { type: 'customer', id: 'beta' },
              },
            ],
          })
          return json({ success: 2, failed: 0, results: [] })
        }),
      })

      await client.documents.createBatch({
        documents: [
          { content: 'A', contentType: 'text' },
          {
            content: 'B',
            contentType: 'text',
            scope: { type: 'customer', id: 'beta' },
          },
        ],
      })
    })

    it('lists, fetches, updates, and deletes documents', async () => {
      const requests: string[] = []
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(async (req) => {
          const url = new URL(req.url)
          requests.push(`${req.method} ${url.pathname}${url.search}`)
          if (req.method === 'PATCH') {
            expect(await req.json()).toEqual({ metadata: null, reprocess: true })
            return json({ document: { id: 'doc/1' }, job: { id: 'job_2' } })
          }
          if (req.method === 'DELETE') {
            return json({ id: 'doc/1', deleted: true, forgottenMemories: 2, failedJobs: 0 })
          }
          if (url.pathname === '/v1/documents') {
            return json({ items: [], nextCursor: null })
          }
          return json({ id: 'doc/1' })
        }),
      })

      await client.documents.list({
        scope: { type: 'customer', id: 'acme' },
        status: 'completed',
        limit: 10,
      })
      await client.documents.get('doc/1')
      await client.documents.update('doc/1', { metadata: null, reprocess: true })
      await client.documents.delete('doc/1')

      expect(requests).toEqual([
        'GET /v1/documents?limit=10&scopeType=customer&scopeId=acme&status=completed',
        'GET /v1/documents/doc%2F1',
        'PATCH /v1/documents/doc%2F1',
        'DELETE /v1/documents/doc%2F1',
      ])
    })

    it('rejects document batches outside the API limit', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => json({})),
      })
      await expect(client.documents.createBatch({ documents: [] })).rejects.toThrow(
        /between 1 and 50/,
      )
    })
  })

  describe('jobs', () => {
    it('gets one job with bounded server-side waiting', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          const url = new URL(req.url)
          expect(url.pathname).toBe('/v1/jobs/job%2F1')
          expect(url.searchParams.get('wait')).toBe('30')
          return json({ id: 'job/1', status: 'completed' })
        }),
      })
      const result = await client.jobs.get('job/1', { waitSeconds: 99 })
      expect(result.status).toBe('completed')
    })

    it('lists at most 50 job IDs', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          expect(new URL(req.url).searchParams.get('ids')).toBe('job_1,job_2')
          return json({ items: [] })
        }),
      })
      await client.jobs.list(['job_1', 'job_2'])
      await expect(client.jobs.list([])).rejects.toThrow(/between 1 and 50/)
    })

    it('waits until a job reaches a terminal state', async () => {
      let calls = 0
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(() => {
          calls += 1
          return json({
            id: 'job_1',
            status: calls === 1 ? 'processing' : 'completed',
          })
        }),
      })
      const result = await client.jobs.wait('job_1', {
        timeoutMs: 100,
        pollIntervalMs: 1,
      })
      expect(result.status).toBe('completed')
      expect(calls).toBe(2)
    })
  })

  describe('profile', () => {
    it('does not enable expensive search unless the caller opts in', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(async (req) => {
          expect(new URL(req.url).pathname).toBe('/v1/profile')
          const body = (await req.json()) as Record<string, unknown>
          expect(body).toEqual({
            containerTag: 'user:jane',
            staticLimit: 5,
          })
          expect(body).not.toHaveProperty('includeSearch')
          return json({
            scopeKey: 'user:jane',
            scope: { type: 'user', id: 'jane' },
            profile: {
              static: [],
              dynamic: [],
              positivePreferences: [],
              hardConstraints: { facts: [], memories: [] },
            },
            promptGuidance: { hardConstraintsNotice: 'Avoid constraints.' },
            stats: {
              staticTotal: 0,
              dynamicTotal: 0,
              truncatedItems: 0,
              cached: false,
            },
          })
        }),
      })
      const result = await client.profile({ staticLimit: 5 })
      expect(result.stats.cached).toBe(false)
    })

    it('requires a query when includeSearch is true', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => json({})),
      })
      await expect(client.profile({ includeSearch: true })).rejects.toThrow(
        /q is required/,
      )
    })
  })

  describe('list', () => {
    it('sends GET /v1/memories with containerTag + paging params, no actorId', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          const url = new URL(req.url)
          expect(url.pathname).toBe('/v1/memories')
          expect(url.searchParams.get('containerTag')).toBe('user:jane')
          expect(url.searchParams.get('limit')).toBe('10')
          expect(url.searchParams.has('actorId')).toBe(false)
          return json({ items: [], nextCursor: null })
        }),
      })
      const res = await client.list({ containerTag: 'user:jane', limit: 10 })
      expect(res.items).toEqual([])
    })

    it('uses the client default container and rejects an unscoped call without one', async () => {
      const withDefault = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:default',
        fetch: fakeFetch((req) => {
          expect(new URL(req.url).searchParams.get('containerTag')).toBe(
            'user:default',
          )
          return json({ items: [], nextCursor: null })
        }),
      })
      await withDefault.list()

      const withoutDefault = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(() => json({ items: [], nextCursor: null })),
      })
      await expect(withoutDefault.list()).rejects.toThrow(
        /a container is required/,
      )
    })
  })

  describe('errors', () => {
    it('throws MnemoHTTPError with status + body on non-2xx', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        defaultContainerTag: 'user:jane',
        fetch: fakeFetch(() => json({ message: 'invalid api key' }, 401)),
      })
      await expect(client.search({ q: 'x' })).rejects.toMatchObject({
        name: 'MnemoHTTPError',
        status: 401,
      })
      try {
        await client.search({ q: 'x' })
      } catch (err) {
        expect(err).toBeInstanceOf(MnemoHTTPError)
        expect((err as MnemoHTTPError).status).toBe(401)
      }
    })
  })
})
