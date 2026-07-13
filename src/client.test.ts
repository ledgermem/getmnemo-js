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

describe('Mnemo', () => {
  describe('auth headers', () => {
    it('sends Bearer apiKey + x-workspace-id on every call', async () => {
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
      expect(seen?.get('x-workspace-id')).toBe('ws_test')
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
    })

    it('throws when no container is available', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch(() => json({})),
      })
      await expect(client.add({ content: 'x' })).rejects.toThrow(/container is required/)
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
    it('sends DELETE /v1/memories/{memoryId}', async () => {
      const client = new Mnemo({
        apiKey: 'test',
        workspaceId: 'ws_test',
        fetch: fakeFetch((req) => {
          expect(req.method).toBe('DELETE')
          expect(new URL(req.url).pathname).toBe('/v1/memories/mem_1')
          return new Response(null, { status: 204 })
        }),
      })
      await expect(client.delete('mem_1')).resolves.toBeUndefined()
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
