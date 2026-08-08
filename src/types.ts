/**
 * Public types for the Mnemo SDK.
 *
 * Request types track the public OpenAPI contract at
 * `https://mnemohq.com/openapi.json`. Response types are maintained from the
 * corresponding API service return values until response schemas are emitted.
 */

export type Scope = {
  type: string
  id: string
  tags?: string[]
}

export type Source = Record<string, unknown>
export type SearchMode = 'hybrid' | 'memories' | 'documents'
export type SearchStrategy = 'temporal' | 'graph' | 'rerank' | 'agentic'
export type SearchFilters = Record<string, unknown>
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type DocumentStatus = JobStatus
export type MemoryMutationPolicy = 'standard' | 'privileged'
export type EnrichmentMode = 'sync' | 'deferred' | 'skip'
export type YouTubeIngestionMode = 'transcript' | 'transcript_and_visuals'

export type Container = {
  id: string
  tag: string
  containerType: string
  displayName: string | null
}

export type Memory = {
  id: string
  scope: Scope
  scopeKey: string
  container: Container
  content: string
  contentHash: string | null
  idempotencyKey: string | null
  memoryType: string
  mutationPolicy: MemoryMutationPolicy
  protectedAt: string | null
  metadata: Record<string, unknown> | null
  source: Source | null
  sourceDocumentId: string | null
  eventId: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type MemoryItemInput = {
  id?: string
  content: string
  idempotencyKey?: string
  memoryType?: string
  mutationPolicy?: MemoryMutationPolicy
  metadata?: Record<string, unknown>
  source?: Source
}

export type AddMemoryInput = MemoryItemInput & {
  containerTag?: string
  scope?: Scope
  enrichmentMode?: EnrichmentMode
}

export type AddManyInput = {
  items: MemoryItemInput[]
  containerTag?: string
  scope?: Scope
  containerType?: string
  metadata?: Record<string, unknown>
  source?: Source
  /** Keep submitted content verbatim and skip derived LLM enrichment. */
  enrichmentMode?: EnrichmentMode
}

export type AddedItem = Memory

export type MemoryWriteReceiptItem = {
  inputIndex: number
  memoryId: string
  status: 'created' | 'deduplicated'
}

export type MemoryWriteReceipt = {
  writeId: string
  status: 'searchable'
  searchableAt: string
  items: MemoryWriteReceiptItem[]
}

export type AddResponse = {
  scopeKey: string
  scope: Scope
  items: AddedItem[]
  stats?: {
    total: number
    created: number
    deduplicated: number
  }
  receipt: MemoryWriteReceipt
}

export type UpdateMemoryInput = {
  content?: string
  memoryType?: string
  metadata?: Record<string, unknown> | null
  source?: Source | null
}

export type UpdateMemoryProtectionInput = {
  mutationPolicy: MemoryMutationPolicy
}

export type DeleteMemoryOptions = {
  permanent?: boolean
}

export type DeleteMemoryReceipt = {
  id: string
  eventId: string
  status: 'restorable' | 'completed'
  completedAt: string
  purged: Record<string, number>
  recoveryId?: string
  restorableUntil?: string
}

export type DeleteMemoryResponse = {
  id: string
  deleted: true
  receipt?: DeleteMemoryReceipt
}

export type RestoreMemoryResponse = {
  id: string
  restored: true
  receiptId: string
  restoredAt: string
}

export type SearchInput = {
  q: string
  containerTag?: string
  scope?: Scope
  limit?: number
  searchMode?: SearchMode
  filters?: SearchFilters
  includeSources?: boolean
  strategies?: SearchStrategy[]
  excludeIds?: string[]
}

export type SearchProvenance = {
  filePath?: string
  section?: string
  commitHash?: string
  sourceId?: string
  sourceChunkId?: string
  sourceChunkText?: string
  transformation?: string
}

export type SearchHitSources = {
  provenance?: SearchProvenance | null
  vectorSimilarity?: number | null
  lexicalScore?: number | null
  temporalBoosted?: boolean
  kind?: string
  customId?: string | null
  contentType?: string
}

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
  source?: Source | null
  sources?: SearchHitSources | null
}

export type SearchLatency = {
  parallelMs: number
  strategyMs: number
  fusionMs: number
  rerankerMs: number
  totalMs: number
}

export type SearchResponse = {
  results: SearchHit[]
  positivePreferences: SearchHit[]
  hardConstraints: SearchHit[]
  searchMode: SearchMode
  queryIntent: string
  queryIntentConfidence: number
  strategiesRan?: string[]
  abstained: boolean
  reranked: boolean
  rawBestVectorSim: number
  latency: SearchLatency
}

export type ListMemoriesInput = {
  containerTag?: string
  scope?: Scope
  limit?: number
  cursor?: string
  /** @deprecated Use scope instead. */
  scopeType?: string
  /** @deprecated Use scope instead. */
  scopeId?: string
}

export type PaginatedMemories = {
  items: Memory[]
  nextCursor: string | null
  total?: number
}

export type Job = {
  id: string
  status: JobStatus
  documentId: string
  scopeKey?: string
  scope?: Scope
  retryable: boolean
  attempts: {
    current: number
    max: number
  }
  error: {
    code: string | null
    message: string | null
  } | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type JobListResponse = {
  items: Job[]
}

export type GetJobOptions = {
  waitSeconds?: number
}

export type WaitForJobOptions = {
  timeoutMs?: number
  pollIntervalMs?: number
}

export type CreateDocumentInput = {
  content: string
  contentType: string
  customId?: string
  metadata?: Record<string, unknown>
  entityContext?: Record<string, unknown>
  containerType?: string
  containerTag?: string
  scope?: Scope
}

export type Document = {
  id: string
  scopeKey: string
  scope: Scope
  contentType: string
  contentPreview: string
  content: string
  customId: string | null
  metadata: Record<string, unknown> | null
  entityContext: Record<string, unknown> | null
  status: DocumentStatus
  processedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  latestJob: Job | null
}

export type CreateDocumentResponse = {
  documentId: string
  jobId: string
  status: JobStatus
  reused: boolean
  document?: Document
  job?: Job
}

export type CreateDocumentsBatchInput = {
  documents: CreateDocumentInput[]
}

export type DocumentBatchResult =
  | {
      index: number
      customId?: string
      status: 'accepted'
      documentId: string
      jobId: string
      ingestionStatus: JobStatus
      reused: boolean
    }
  | {
      index: number
      customId?: string
      status: 'failed'
      error: string
    }

export type CreateDocumentsBatchResponse = {
  success: number
  failed: number
  results: DocumentBatchResult[]
}

export type ListDocumentsInput = {
  containerTag?: string
  scope?: Scope
  limit?: number
  cursor?: string
  status?: DocumentStatus
}

export type PaginatedDocuments = {
  items: Document[]
  nextCursor: string | null
}

export type WorkspaceExport = {
  id: string
  kind: 'workspace_export'
  status: JobStatus
  downloadUrl?: string | null
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
}

export type UpdateDocumentInput = {
  content?: string
  contentType?: string
  customId?: string | null
  metadata?: Record<string, unknown> | null
  entityContext?: Record<string, unknown> | null
  reprocess?: boolean
}

export type UpdateDocumentResponse = {
  document: Document
  job: Job | null
}

export type DeleteDocumentResponse = {
  id: string
  deleted: true
  forgottenMemories: number
  failedJobs: number
}

export type YouTubeEstimateInput = {
  url: string
  mode: YouTubeIngestionMode
}

export type CreateYouTubeIngestionInput = YouTubeEstimateInput & {
  containerTag?: string
  scope?: Scope
  customId?: string
  metadata?: Record<string, unknown>
}

export type YouTubeQuotaEstimate = {
  used: number
  limit: number
  remaining: number
  requested: number
  willFit: boolean
}

export type YouTubeEstimate = {
  videoId: string
  canonicalUrl: string
  title: string
  durationSeconds: number
  durationMinutes: number
  mode: YouTubeIngestionMode
  meter: 'youtube_transcript_seconds' | 'youtube_visual_seconds'
  quota: YouTubeQuotaEstimate
}

export type YouTubeIngestion = {
  id: string
  videoId: string
  sourceUrl: string
  title: string
  durationSeconds: number
  mode: YouTubeIngestionMode
  status: JobStatus
  sourceDocumentId: string
  jobId: string
  scopeKey: string
  scope: Scope
  transcriptSegmentCount: number
  visualObservationCount: number
  error: { code: string | null; message: string | null } | null
  reused: boolean
  createdAt: string
  updatedAt: string
}

export type ProfileStaticFact = {
  key: string
  value: unknown
  confidence: number | null
  polarity: string
}

export type ProfileDynamicItem =
  | {
      resultType: 'memory'
      id: string
      content: string
      memoryType: string
      polarity: string
      metadata: Record<string, unknown> | null
      createdAt: string
      updatedAt: string
    }
  | {
      resultType: 'document'
      id: string
      content: string
      contentType: string
      metadata: Record<string, unknown> | null
      createdAt: string
      updatedAt: string
    }

export type ProfileInput = {
  containerTag?: string
  scope?: Scope
  q?: string
  threshold?: number
  includeSearch?: boolean
  staticLimit?: number
  dynamicLimit?: number
  itemMaxBytes?: number
}

export type ProfileResponse = {
  scopeKey: string
  scope: Scope
  profile: {
    static: ProfileStaticFact[]
    dynamic: ProfileDynamicItem[]
    positivePreferences: ProfileStaticFact[]
    hardConstraints: {
      facts: ProfileStaticFact[]
      memories: Array<{
        id: string
        content: string
        createdAt: string
        updatedAt: string
      }>
    }
  }
  promptGuidance: {
    hardConstraintsNotice: string
  }
  stats: {
    staticTotal: number
    dynamicTotal: number
    truncatedItems: number
    cached: boolean
  }
  searchResults?: SearchHit[]
  searchPositivePreferences?: SearchHit[]
  searchHardConstraints?: SearchHit[]
}

export type ClientConfig = {
  /**
   * Required. Full-access by default, so keep it server-side. For exposed
   * clients, mint a scoped read-only key.
   */
  apiKey: string
  /** @deprecated Workspace identity is now taken from the API key. */
  workspaceId?: string
  /** Default container tag used by add, search, documents, and profile. */
  defaultContainerTag?: string
  /** Defaults to https://api.mnemohq.com. */
  baseUrl?: string
  /** Per-request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number
  /** Custom fetch implementation for tests, proxies, or edge runtimes. */
  fetch?: typeof fetch
  /** Retry attempts for 429, 5xx, and transient network errors. Defaults to 3. */
  maxRetries?: number
}
