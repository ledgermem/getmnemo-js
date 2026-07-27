#!/usr/bin/env node

const OPENAPI_URL = 'https://mnemohq.com/openapi.json'

function fail(message) {
  throw new Error(`[contract] ${message}`)
}

function requirePath(spec, path, method) {
  if (!spec.paths?.[path]?.[method]) {
    fail(`missing ${method.toUpperCase()} ${path}`)
  }
}

function requireProperties(spec, schemaName, properties) {
  const schema = spec.components?.schemas?.[schemaName]
  if (!schema) fail(`missing schema ${schemaName}`)
  for (const property of properties) {
    if (!schema.properties?.[property]) {
      fail(`${schemaName} is missing property ${property}`)
    }
  }
}

const response = await fetch(OPENAPI_URL)
if (!response.ok) {
  fail(`could not fetch ${OPENAPI_URL}: HTTP ${response.status}`)
}
const spec = await response.json()

for (const [path, method] of [
  ['/v1/memories', 'post'],
  ['/v1/memories/{memoryId}', 'delete'],
  ['/v1/memories/{memoryId}/restore', 'post'],
  ['/v1/documents', 'post'],
  ['/v1/documents/batch', 'post'],
  ['/v1/jobs', 'get'],
  ['/v1/jobs/{jobId}', 'get'],
  ['/v1/search', 'post'],
  ['/v1/profile', 'post'],
]) {
  requirePath(spec, path, method)
}

requireProperties(spec, 'MemoryItemDto', [
  'id',
  'content',
  'idempotencyKey',
  'memoryType',
  'metadata',
  'source',
])
requireProperties(spec, 'CreateMemoryScopeDto', ['type', 'id', 'tags'])
requireProperties(spec, 'SearchRequestDto', [
  'searchMode',
  'filters',
  'includeSources',
  'strategies',
  'excludeIds',
])
requireProperties(spec, 'CreateDocumentDto', [
  'content',
  'contentType',
  'customId',
  'metadata',
  'entityContext',
])

const modes = spec.components.schemas.SearchRequestDto.properties.searchMode.enum
const expectedModes = ['hybrid', 'memories', 'documents']
if (
  !Array.isArray(modes) ||
  expectedModes.some((mode) => !modes.includes(mode))
) {
  fail(`unexpected searchMode enum: ${JSON.stringify(modes)}`)
}

console.log(`[contract] PASS: getmnemo public surface matches ${OPENAPI_URL}`)
