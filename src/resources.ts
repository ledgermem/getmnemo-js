import { MnemoTimeoutError } from './errors.js'
import type {
  CreateDocumentInput,
  CreateDocumentResponse,
  CreateDocumentsBatchInput,
  CreateDocumentsBatchResponse,
  DeleteDocumentResponse,
  Document,
  GetJobOptions,
  Job,
  JobListResponse,
  ListDocumentsInput,
  PaginatedDocuments,
  Scope,
  UpdateDocumentInput,
  UpdateDocumentResponse,
  WaitForJobOptions,
} from './types.js'

type Requester = <T>(method: string, path: string, body?: unknown) => Promise<T>
type ContainerInput = { containerTag?: string; scope?: Scope }
type ContainerResolver = (
  method: string,
  input: ContainerInput,
) => { containerTag: string } | { scope: Scope }

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertBatchSize(label: string, size: number, max: number): void {
  if (size < 1 || size > max) {
    throw new Error(`${label}: batch size must be between 1 and ${max}`)
  }
}

export class DocumentsResource {
  constructor(
    private readonly request: Requester,
    private readonly resolveContainer: ContainerResolver,
  ) {}

  async create(input: CreateDocumentInput): Promise<CreateDocumentResponse> {
    const container = this.resolveContainer('documents.create', input)
    const { containerTag: _containerTag, scope: _scope, ...document } = input
    return this.request<CreateDocumentResponse>('POST', '/v1/documents', {
      ...document,
      ...container,
    })
  }

  async createBatch(
    input: CreateDocumentsBatchInput,
  ): Promise<CreateDocumentsBatchResponse> {
    assertBatchSize('Mnemo.documents.createBatch', input.documents.length, 50)
    const documents = input.documents.map((item) => {
      const container = this.resolveContainer('documents.createBatch', item)
      const { containerTag: _containerTag, scope: _scope, ...document } = item
      return { ...document, ...container }
    })
    return this.request<CreateDocumentsBatchResponse>(
      'POST',
      '/v1/documents/batch',
      { documents },
    )
  }

  async get(documentId: string): Promise<Document> {
    return this.request<Document>(
      'GET',
      `/v1/documents/${encodeURIComponent(documentId)}`,
    )
  }

  async list(input: ListDocumentsInput = {}): Promise<PaginatedDocuments> {
    const params = new URLSearchParams()
    if (input.limit !== undefined) params.set('limit', String(input.limit))
    if (input.cursor !== undefined) params.set('cursor', input.cursor)
    if (input.scope !== undefined) {
      params.set('scopeType', input.scope.type)
      params.set('scopeId', input.scope.id)
    } else if (input.containerTag !== undefined) {
      params.set('containerTag', input.containerTag)
    }
    if (input.status !== undefined) params.set('status', input.status)
    const query = params.toString()
    return this.request<PaginatedDocuments>(
      'GET',
      `/v1/documents${query ? `?${query}` : ''}`,
    )
  }

  async update(
    documentId: string,
    input: UpdateDocumentInput,
  ): Promise<UpdateDocumentResponse> {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new Error('Mnemo.documents.update: at least one field must be provided')
    }
    return this.request<UpdateDocumentResponse>(
      'PATCH',
      `/v1/documents/${encodeURIComponent(documentId)}`,
      input,
    )
  }

  async delete(documentId: string): Promise<DeleteDocumentResponse> {
    return this.request<DeleteDocumentResponse>(
      'DELETE',
      `/v1/documents/${encodeURIComponent(documentId)}`,
    )
  }
}

export class JobsResource {
  constructor(private readonly request: Requester) {}

  async get(jobId: string, options: GetJobOptions = {}): Promise<Job> {
    const params = new URLSearchParams()
    if (options.waitSeconds !== undefined) {
      const waitSeconds = Math.min(30, Math.max(0, Math.floor(options.waitSeconds)))
      params.set('wait', String(waitSeconds))
    }
    const query = params.toString()
    return this.request<Job>(
      'GET',
      `/v1/jobs/${encodeURIComponent(jobId)}${query ? `?${query}` : ''}`,
    )
  }

  async list(jobIds: string[]): Promise<JobListResponse> {
    assertBatchSize('Mnemo.jobs.list', jobIds.length, 50)
    const params = new URLSearchParams({ ids: jobIds.join(',') })
    return this.request<JobListResponse>('GET', `/v1/jobs?${params.toString()}`)
  }

  async wait(jobId: string, options: WaitForJobOptions = {}): Promise<Job> {
    const timeoutMs = options.timeoutMs ?? 120_000
    const pollIntervalMs = options.pollIntervalMs ?? 500
    if (timeoutMs <= 0) {
      throw new Error('Mnemo.jobs.wait: timeoutMs must be greater than 0')
    }
    if (pollIntervalMs < 0) {
      throw new Error('Mnemo.jobs.wait: pollIntervalMs cannot be negative')
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now()
      const waitSeconds = Math.min(25, Math.max(0, Math.floor(remainingMs / 1000)))
      const job = await this.get(
        jobId,
        waitSeconds > 0 ? { waitSeconds } : undefined,
      )
      if (TERMINAL_JOB_STATUSES.has(job.status)) return job

      const sleepMs = Math.min(pollIntervalMs, deadline - Date.now())
      if (sleepMs > 0) await sleep(sleepMs)
    }

    throw new MnemoTimeoutError(timeoutMs)
  }
}
