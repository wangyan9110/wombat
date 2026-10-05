import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredCandidateJobs, validateCiCandidate } from './ci-release-candidate.ts';

test('reuses only a complete successful exact-source push candidate with a current artifact', () => {
  const source = 'a'.repeat(40), repository = 'owner/repo';
  const run = {id: 123, run_attempt: 1, head_sha: source, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success',
    path: '.github/workflows/ci.yml', repository: {full_name: repository}, html_url: 'https://example.test/run'};
  const asset = {id: 456, name: 'github-candidate', expired: false, expires_at: '2030-01-01T00:00:00Z',
    digest: `sha256:${'b'.repeat(64)}`, workflow_run: {id: 123, head_sha: source}};
  const listing = {total_count: 1, artifacts: [asset]};
  const jobs = {total_count: requiredCandidateJobs.length, jobs: requiredCandidateJobs.map(name => ({name, run_attempt: 1, status: 'completed', conclusion: 'success'}))};
  const check = (r = run, l = listing, j = jobs) => validateCiCandidate(r, l, j, repository, source, 'main', Date.parse('2026-01-01'));
  assert.deepEqual(check(), {runId: 123, artifactId: 456, url: run.html_url});
  for (const change of [{head_sha: 'b'.repeat(40)}, {event: 'pull_request'}, {event: 'workflow_dispatch'},
    {conclusion: 'failure'}, {status: 'in_progress'}, {path: '.github/workflows/other.yml'}, {repository: {full_name: 'other/repo'}}]) {
    assert.throws(() => check({...run, ...change}), /successful push CI/);
  }
  assert.throws(() => check(run, {...listing, total_count: 2}), /incomplete/);
  assert.throws(() => check(run, {total_count: 2, artifacts: [asset, asset]}), /exactly one/);
  assert.throws(() => check(run, listing, {...jobs, total_count: 100}), /job evidence is incomplete/);
  assert.throws(() => check(run, listing, {total_count: jobs.total_count + 1, jobs: [...jobs.jobs, {...jobs.jobs[0], conclusion: 'skipped'}]}), /Required candidate acceptance/);
  assert.throws(() => check({...run, run_attempt: 2}), /Required candidate acceptance/);
  for (const conclusion of ['skipped', 'failure', 'cancelled']) {
    assert.throws(() => check(run, listing, {...jobs, jobs: [{...jobs.jobs[0], conclusion}, ...jobs.jobs.slice(1)]}), /Required candidate acceptance/);
  }
  for (const change of [{expired: true}, {expires_at: '2025-01-01'}, {digest: ''}, {workflow_run: {id: 124, head_sha: source}}]) {
    assert.throws(() => check(run, {total_count: 1, artifacts: [{...asset, ...change}]}), /expired or has a different identity/);
  }
});
