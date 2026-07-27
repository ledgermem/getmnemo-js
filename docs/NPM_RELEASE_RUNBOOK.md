# getmnemo npm release runbook

Use this runbook to update and publish the official Mnemo JavaScript SDK.

Last verified: July 28, 2026  
Package at verification: `getmnemo@0.3.1`

## Package map

| Item | Location |
| --- | --- |
| Local repository | `/Users/shahhussain/Desktop/ai-agency/clients/personal/Mnemo/Org-repo/ledgermem-js` |
| GitHub repository | `git@github.com:ledgermem/getmnemo-js.git` |
| GitHub page | <https://github.com/ledgermem/getmnemo-js> |
| npm package | <https://www.npmjs.com/package/getmnemo> |
| Live API contract | <https://mnemohq.com/openapi.json> |
| Mnemo documentation | <https://mnemohq.com/docs> |
| CI workflow | `.github/workflows/ci.yml` |
| npm workflow | `.github/workflows/publish.yml` |
| Production smoke test | `scripts/prod-smoke.mjs` |
| OpenAPI contract check | `scripts/contract-check.mjs` |

The package supports ESM and CommonJS. It requires Node.js 18 or later and has
no runtime dependencies.

## Release rules

Follow these rules for every release:

1. Start from an up-to-date `main`.
2. Work on a separate branch.
3. Use a patch version for compatible fixes or documentation updates.
4. Use a minor version for backward-compatible public API additions.
5. Use a major version for breaking public API changes.
6. Keep internal backend controls out of the public SDK.
7. Match every documented request field to the live OpenAPI contract.
8. Do not publish unless local verification, CI, and the production smoke test
   pass.
9. Publish from GitHub Actions. Do not publish from a developer laptop.
10. Never commit an npm token, Mnemo API key, workspace ID, or `.env` file.

## Files that carry the version

Update all of the following files to the same version:

| File | Field |
| --- | --- |
| `package.json` | `version` |
| `package-lock.json` | Top-level `version` |
| `package-lock.json` | Root package `packages[""].version` |
| `src/client.ts` | `SDK_VERSION` |

Check for missed values:

```bash
rg -n "0\.3\.1|SDK_VERSION" \
  package.json package-lock.json src README.md
```

Replace `0.3.1` with the version being released.

## Step 1: prepare the branch

```bash
cd /Users/shahhussain/Desktop/ai-agency/clients/personal/Mnemo/Org-repo/ledgermem-js

git switch main
git pull --ff-only origin main
git status --short --branch
git switch -c feat/sdk-X.Y.Z
```

Use `docs/sdk-X.Y.Z` for a documentation-only release.

Stop if `main` is dirty. Do not discard changes until their owner and purpose
are understood.

## Step 2: choose the version

Confirm that the target version does not already exist:

```bash
npm view getmnemo@X.Y.Z version
```

The expected result for a new version is an npm `E404`.

Do not reuse or overwrite a published version. npm releases are immutable.

## Step 3: make the change

Keep the release focused. Avoid unrelated refactors.

For a public API change:

1. Update the exported request and response types.
2. Update the client or resource method.
3. Add tests for the request body, response, validation, and errors.
4. Update the README with a copyable example.
5. Run the live contract check.

For a README-only change:

1. Keep the quickstart near the top.
2. Organize examples by developer task.
3. Use short sentences and one idea per paragraph.
4. Explain a concept immediately before its example.
5. Keep maintainer-only CI details out of the npm README.
6. Verify that every code example matches the exported SDK.

The npm package page updates its README only when a new package version is
published. A README-only update therefore needs a patch release.

## Step 4: run the local release gate

Run every command from the SDK repository:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run contract
npm run build
npm audit --omit=dev
git diff --check
```

The release must have:

- Zero failed tests.
- Zero type errors.
- Zero lint errors.
- A passing live OpenAPI contract check.
- A successful ESM, CommonJS, and type declaration build.
- Zero known production dependency vulnerabilities.
- No whitespace errors.

Do not delete, skip, or weaken a failing test to make a release pass.

## Step 5: inspect the package npm will receive

Create the tarball without publishing:

```bash
pack_dir="$(mktemp -d)"
npm pack --json --pack-destination "$pack_dir"
tar -tzf "$pack_dir/getmnemo-X.Y.Z.tgz"
```

The package should contain only the intended public files:

- `LICENSE`
- `README.md`
- `package.json`
- `dist/index.js`
- `dist/index.cjs`
- Source maps
- Type declarations

It must not contain `.env` files, tests, local scripts, credentials, logs, or
unrelated workspace files.

Verify both module formats:

```bash
mkdir "$pack_dir/unpacked"
tar -xzf "$pack_dir/getmnemo-X.Y.Z.tgz" -C "$pack_dir/unpacked"

node -e "import('$pack_dir/unpacked/package/dist/index.js').then((m) => {
  if (typeof m.Mnemo !== 'function') throw new Error('ESM export missing')
  console.log('ESM OK')
})"

node -e "const m = require('$pack_dir/unpacked/package/dist/index.cjs')
if (typeof m.Mnemo !== 'function') throw new Error('CJS export missing')
console.log('CJS OK')"
```

## Step 6: commit and open the PR

```bash
git status --short
git diff --check
git add <only-the-release-files>
git commit -m "feat: release getmnemo X.Y.Z"
git push -u origin HEAD
```

Use `docs: simplify npm package guide` or another accurate `docs:` message for
a documentation-only patch.

The pull request should state:

- What changed.
- Why developers need the change.
- Whether runtime behavior changed.
- Which checks passed.
- Which public API fields were added, changed, or deliberately kept private.

Wait for every CI job on Node.js 20 and 22 to pass before merging.

## Step 7: merge and tag the exact commit

After the PR is merged:

```bash
git switch main
git pull --ff-only origin main
git status --short --branch
git log -1 --oneline
```

Confirm that:

- The worktree is clean.
- Local `main` matches `origin/main`.
- The version in `package.json` is correct.
- The latest commit contains the intended release.

Create one annotated tag on that exact commit:

```bash
git tag -a vX.Y.Z -m "getmnemo X.Y.Z"
git push origin vX.Y.Z
```

Pushing a `v*` tag starts `.github/workflows/publish.yml`.

Do not also trigger the manual workflow for the same version. Two release runs
can race, and npm accepts a version only once.

## Step 8: watch the production release

The publish workflow has two jobs:

1. `smoke`
2. `publish`

The `smoke` job:

- Installs from the lockfile.
- Checks the live OpenAPI contract.
- Builds the package.
- Adds and searches real test memories in production.
- Checks cross-container isolation.
- Cleans up the test memories.

The `publish` job cannot start unless `smoke` passes.

The workflow uses the following GitHub secrets:

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | Publishes `getmnemo` to npm. |
| `MNEMO_API_KEY` | Writes, searches, and deletes smoke-test memories. |
| `MNEMO_WORKSPACE_ID` | Selects the isolated smoke-test workspace. |
| `MNEMO_TEST_CONTAINER` | Provides the base tag for unique test containers. |

Keep these as organization-level secrets. Do not create a repository-level
secret with the same name because it can shadow the organization secret.

Do not disable npm two-factor authentication for a normal release. GitHub
Actions publishes with the configured token and provenance.

## Step 9: verify npm independently

Do not treat a green workflow as the final check. Verify the registry:

```bash
npm view getmnemo@X.Y.Z \
  version description dist.shasum dist.integrity gitHead time --json
```

Confirm that:

- `version` is `X.Y.Z`.
- `gitHead` matches the commit tagged and merged to `main`.
- npm reports a publication time.
- The description is correct.

Download the public package, not the local build:

```bash
verify_dir="$(mktemp -d)"
cd "$verify_dir"
npm pack getmnemo@X.Y.Z --silent
mkdir unpacked
tar -xzf getmnemo-X.Y.Z.tgz -C unpacked
```

Check the public README and repeat the ESM and CommonJS import tests against
`unpacked/package`.

The release is complete only after the registry package passes these checks.

## If a release fails

### CI or smoke fails before npm publish

Do not rerun blindly.

1. Read the failed job and step.
2. Reproduce the failure locally when possible.
3. Fix it on a branch.
4. Run the complete local release gate again.
5. Merge the fix.
6. Move to a new version if npm already received the old one.

Never move an existing public tag to a different commit.

### npm publish fails

Check:

- Whether `getmnemo@X.Y.Z` already exists.
- Whether `NPM_TOKEN` is active and allowed to publish.
- Whether npm trusted publishing, provenance, or 2FA settings changed.
- Whether `package.json` and the git tag use the same version.

Fix the cause before rerunning the workflow.

### A bad version reaches npm

npm packages are immutable. Fix forward:

1. Stop recommending the affected version.
2. Deprecate it when users should avoid it:

   ```bash
   npm deprecate getmnemo@X.Y.Z "Use getmnemo@A.B.C instead."
   ```

3. Prepare and publish a new patch version.
4. Explain any user-visible risk in the release notes.

Do not unpublish a version unless there is a serious security or legal reason
and npm policy permits it.

## Mistakes to avoid

These lessons come from the `0.3.0` and `0.3.1` releases.

### Do not put competitor names into Mnemo release material

A competitor name was previously used while describing a provider contract.
That wording did not belong in Mnemo's package, changelog, or customer email.

Use neutral capability names such as `document import`, `batch migration`, or
`provider export`. Mention another company only when Mnemo has an explicit
integration with it and the name is necessary.

### Do not retry a GitHub connector after a permission failure

The GitHub connector returned `403 Resource not accessible by integration` for
PR creation and merging. Retrying the same operation did not change its
permissions.

After the first permission failure:

1. Record the failure.
2. Switch to an authorized GitHub path.
3. Do not claim a PR or merge succeeded until GitHub shows the final state.

### Do not finalize the browser before the release is complete

During `0.3.1`, the browser session was finalized before the PR and release
steps were finished. That removed the available signed-in GitHub UI path.

Keep the release tab available until:

- The PR is merged.
- The release workflow has started.
- No more authenticated browser actions are needed.

### Do not infer success from a click

GitHub can update a page asynchronously. A merge or workflow button click is
not proof that the action completed.

After every external action, verify an authoritative result:

- The PR says `merged`.
- The workflow has a run ID.
- Both workflow jobs say `success`.
- npm returns the new version.

### Quote shell commands that contain Markdown backticks

An early README syntax-check command used double quotes around a script that
contained Markdown fences. The shell interpreted the backticks and broke the
command.

Use a single-quoted script, a checked-in validation script, or another
shell-safe approach. Do not keep retrying the same broken quoting.

### Keep the npm README for package users

The earlier README mixed developer onboarding with internal release secrets,
CI implementation details, and long explanations. That made the package harder
to scan and sounded machine-written.

The public README should answer these questions in order:

1. What does this package do?
2. How do I install it?
3. How do I make one successful request?
4. How do containers isolate my data?
5. How do I perform the common tasks?
6. Where is the full reference?
7. How do I get help?

Keep this runbook, not the public README, as the home for release operations.

### Do not publish from the laptop

Local publication can depend on a temporary npm login, WebAuthn prompt, or
disabled 2FA. It also skips the production smoke gate and GitHub provenance.

Use `.github/workflows/publish.yml`.

### Do not optimize the SDK for a benchmark

Public SDK controls must serve real applications and match stable backend
contracts. Do not expose internal routing flags or dataset-specific switches
only because they improve one benchmark.

## Release completion checklist

- [ ] Started from clean, current `main`.
- [ ] Used a separate branch.
- [ ] Chose an unpublished semantic version.
- [ ] Updated every version location.
- [ ] Added or updated tests.
- [ ] Updated the public README when behavior changed.
- [ ] Passed lint, typecheck, tests, contract, build, audit, and diff checks.
- [ ] Inspected the npm tarball.
- [ ] Tested packed ESM and CommonJS imports.
- [ ] Opened a focused PR.
- [ ] Waited for CI on Node.js 20 and 22.
- [ ] Merged to `main`.
- [ ] Tagged the exact merged commit once.
- [ ] Passed the production smoke job.
- [ ] Passed the publish job.
- [ ] Verified npm metadata and `gitHead`.
- [ ] Downloaded and tested the public package.
- [ ] Confirmed the local worktree is clean and synced.

