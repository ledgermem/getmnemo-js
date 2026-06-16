#!/usr/bin/env node
/**
 * CI prod smoke gate for the `getmnemo` SDK.
 *
 * Runs a real round-trip against PRODUCTION using the built local SDK in
 * `./dist`, then asserts the cross-container tenant-isolation boundary. The
 * publish workflow gates `publish` on `needs: smoke`, so a red run here blocks
 * the release.
 *
 * Exit codes:
 *   0  happy-path round-trip + BOTH isolation assertions passed.
 *   1  missing env, round-trip failure, or — loudest of all — a tenant
 *      isolation leak (a live-server security finding, NOT a flaky test).
 *
 * Per SDK_RECONCILIATION_0.2.0.md: a leak is a production tenant-isolation
 * security finding (cross-container leakage), not an SDK bug. It outranks the
 * launch — fix the server, do not iterate the SDK around it.
 *
 * Required env:
 *   MNEMO_API_KEY        scoped test key (needs delete scope for cleanup)
 *   MNEMO_WORKSPACE_ID   throwaway test workspace id
 *   MNEMO_TEST_CONTAINER base containerTag, e.g. "ci-smoke"
 */

import { Mnemo } from '../dist/index.js'

const PROPAGATION_WAIT_MS = 3_000

function fail(msg) {
  console.error(`\n[smoke] FAIL: ${msg}`)
  process.exit(1)
}

/** LOUD failure for a server-side tenant-isolation leak. */
function isolationFailure(detail) {
  const banner = '='.repeat(72)
  console.error(`\n${banner}`)
  console.error('TENANT ISOLATION FAILURE')
  console.error(banner)
  console.error(
    'A search scoped to one container returned a memory written to a DIFFERENT\n' +
      'container. This is a PRODUCTION tenant-isolation security finding\n' +
      '(cross-container leakage), NOT a flaky test and NOT an SDK bug.\n\n' +
      'Per SDK_RECONCILIATION_0.2.0.md this outranks the launch: STOP, fix the\n' +
      'server, and do NOT iterate the SDK around it. Publish is correctly blocked.',
  )
  console.error(`\nDetail: ${detail}`)
  console.error(`${banner}\n`)
  process.exit(1)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True if any search hit's content contains `needle`. */
function resultsContain(response, needle) {
  const results = response?.results
  if (!Array.isArray(results)) return false
  return results.some((hit) => typeof hit?.content === 'string' && hit.content.includes(needle))
}

async function main() {
  const apiKey = process.env.MNEMO_API_KEY
  const workspaceId = process.env.MNEMO_WORKSPACE_ID
  const base = process.env.MNEMO_TEST_CONTAINER

  if (!apiKey) fail('MNEMO_API_KEY is not set')
  if (!workspaceId) fail('MNEMO_WORKSPACE_ID is not set')
  if (!base) fail('MNEMO_TEST_CONTAINER is not set')

  // Unique per-run nonce so concurrent / re-run smokes never collide and so a
  // leaked memory from a prior run can't masquerade as this run's data.
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const containerA = `${base}-a-${nonce}`
  const containerB = `${base}-b-${nonce}`
  const alphaContent = `${nonce} codeword ALPHA`
  const bravoContent = `${nonce} codeword BRAVO`

  const m = new Mnemo({ apiKey, workspaceId })

  console.log('[smoke] run nonce:', nonce)
  console.log('[smoke] container A:', containerA)
  console.log('[smoke] container B:', containerB)

  // Track created ids so cleanup runs even if assertions throw.
  const createdIds = []

  try {
    // ---- HAPPY PATH: add to two distinct containers --------------------
    const addA = await m.add({ content: alphaContent, containerTag: containerA })
    const addB = await m.add({ content: bravoContent, containerTag: containerB })

    for (const item of addA?.items ?? []) if (item?.id) createdIds.push(item.id)
    for (const item of addB?.items ?? []) if (item?.id) createdIds.push(item.id)

    if (createdIds.length < 2) {
      fail(
        `add did not return ids for both writes — got ${createdIds.length} ` +
          `(addA.items=${addA?.items?.length ?? 0}, addB.items=${addB?.items?.length ?? 0})`,
      )
    }

    // Give the indexer a moment to make the writes searchable.
    await sleep(PROPAGATION_WAIT_MS)

    // Round-trip: ALPHA must be retrievable in its OWN container.
    const ownA = await m.search({ q: 'codeword ALPHA', containerTag: containerA })
    if (!resultsContain(ownA, alphaContent)) {
      fail(
        'happy-path round-trip failed: searching container A for "codeword ALPHA" ' +
          'did not return the ALPHA memory in response.results. ' +
          `results=${JSON.stringify(ownA?.results ?? null)}`,
      )
    }
    console.log('[smoke] OK happy-path: add + search round-trip via response.results')

    // ---- ISOLATION ASSERTION (the security gate) -----------------------
    // ALPHA was written to A; a search scoped to B must NOT see it.
    const crossA = await m.search({ q: 'codeword ALPHA', containerTag: containerB })
    if (resultsContain(crossA, alphaContent)) {
      isolationFailure(
        `ALPHA (written to container "${containerA}") leaked into a search ` +
          `scoped to container "${containerB}".`,
      )
    }

    // BRAVO was written to B; a search scoped to A must NOT see it.
    const crossB = await m.search({ q: 'codeword BRAVO', containerTag: containerA })
    if (resultsContain(crossB, bravoContent)) {
      isolationFailure(
        `BRAVO (written to container "${containerB}") leaked into a search ` +
          `scoped to container "${containerA}".`,
      )
    }

    console.log('[smoke] OK isolation: A↛B and B↛A — no cross-container leakage')
  } finally {
    // ---- CLEANUP: best-effort delete; failure warns, never fatal -------
    for (const id of createdIds) {
      try {
        await m.delete(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[smoke] WARN: cleanup delete failed for memory ${id}: ${msg}`)
      }
    }
  }

  console.log('\n[smoke] PASS: happy-path + both isolation assertions green.')
  process.exit(0)
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  fail(`unexpected error during smoke run:\n${msg}`)
})
