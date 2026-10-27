/** Local mock proxy, persistence and static access boundary integration coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
test('mock proxy, costs, persistence and static protection', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.residents-test-'));
  const localModel = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        message: { content: 'invalid JSON' },
        prompt_eval_count: 321,
        eval_count: 17,
      }),
    );
  });
  localModel.listen(0, '127.0.0.1');
  await once(localModel, 'listening');
  const child = spawn(process.execPath, ['server/residents-server.mjs'], {
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dir,
      LLM_PROVIDER: 'mock',
      HOST: '127.0.0.1',
      OLLAMA_HOST: `http://127.0.0.1:${localModel.address().port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Startup timeout')), 10000);
      child.stdout.on('data', (decision) => {
        const match = String(decision).match(/:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on('exit', () => {
        clearTimeout(timer);
        reject(Error('Early exit'));
      });
    });
    const base = `http://127.0.0.1:${ready}`;
    const request = (place, method = 'GET', data) =>
      fetch(base + place, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    const candidate = await (await request('/api/config')).json();
    assert.equal(candidate.provider, 'mock');
    assert.ok(candidate.providers.length >= 7);
    assert.equal(JSON.stringify(candidate).includes('API_KEY'), false);
    const world = {
      clock: 780,
      places: [
        { id: 'h', kind: 'home', label: 'Home on Madison' },
        { id: 'f', kind: 'food', label: 'Deli' },
        { id: 'o', kind: 'office', label: 'Office' },
      ],
      residents: Array.from({ length: 8 }, (_, index) => ({
        id: `r${index + 1}`,
        name: `Person ${index}`,
        home: 'h',
        workplace: 'o',
        action: 'idle',
        location: 'h',
        needs: { hunger: 80, work: 50, social: 30 },
      })),
    };
    const tick = await request('/api/tick', 'POST', world);
    assert.equal(tick.status, 200);
    const result = await tick.json();
    assert.equal(result.decisions.length, 8);
    assert.equal(result.costUsd, 0);
    assert.ok(result.wouldCostUsd > 0);
    assert.equal(result.usage.estimated, true);
    const costs = await (await request('/api/costs')).json();
    assert.equal(costs.totals.calls, 1);
    assert.equal(costs.records.length, 1);
    assert.ok((await readFile(path.join(dir, 'llm-calls.jsonl'), 'utf8')).endsWith('\n'));
    assert.equal((await request('/api/state', 'POST', { clock: 123 })).status, 200);
    assert.deepEqual(await (await request('/api/state')).json(), { clock: 123 });
    await request('/api/state', 'DELETE');
    assert.equal(await (await request('/api/state')).json(), null);
    for (const place of [
      '/.env',
      '/.env.example',
      '/.git/config',
      '/data/state.json',
      '/%2e%2e%2f.env',
    ])
      assert.notEqual((await request(place)).status, 200);
    assert.equal((await request('/js/residents/policy.js')).status, 200);
    assert.equal((await request('/api/tick', 'POST', {})).status, 400);
    assert.equal((await fetch(base + '/api/tick', { method: 'POST', body: 'bad' })).status, 400);
    await request('/api/config', 'POST', { provider: 'ollama', model: 'qwen2.5:1.5b' });
    const failedParse = await (await request('/api/tick', 'POST', world)).json();
    assert.equal(failedParse.decisions.length, 8);
    assert.equal(failedParse.fallback, 'mock');
    assert.ok(failedParse.parseError);
    assert.equal(failedParse.usage.inputTokens, 321);
    assert.equal(failedParse.usage.outputTokens, 17);
    const log = (await readFile(path.join(dir, 'llm-calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(log.at(-1).fallback, 'mock');
    assert.equal(log.at(-1).provider, 'ollama');
  } finally {
    localModel.close();
    child.kill();
    await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});
