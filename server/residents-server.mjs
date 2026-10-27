/** Local proxy, atomic world saves and metadata-only call accounting. */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults, keyNames, priceTable, costFor } from './residents-config.mjs';
import { mockDecisions } from '../js/residents/policy.js';
import { createProvider, getKey } from './llm-providers.mjs';
import { buildPrompt, parseDecisions, validateSnapshot } from './residents-prompt.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
await fs.mkdir(dataDir, { recursive: true });
let selected = Object.hasOwn(defaults, process.env.LLM_PROVIDER)
  ? process.env.LLM_PROVIDER
  : 'mock';
let model = process.env.LLM_MODEL || defaults[selected];
let busy = false;
let records = [];
const totals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, wouldCostUsd: 0 };
try {
  for (const line of (await fs.readFile(path.join(dataDir, 'llm-calls.jsonl'), 'utf8')).split(
    '\n',
  )) {
    try {
      const record = JSON.parse(line);
      records.push(record);
      addTotals(record);
    } catch {}
  }
  records = records.slice(-50);
} catch {}
function addTotals(record) {
  totals.calls++;
  totals.inputTokens += record.usage.inputTokens;
  totals.outputTokens += record.usage.outputTokens;
  totals.costUsd += record.costUsd || 0;
  totals.wouldCostUsd += record.wouldCostUsd || 0;
}
function config() {
  const fallback = !!keyNames[selected] && !getKey(selected);
  return {
    provider: fallback ? 'mock' : selected,
    model: fallback ? 'mock' : model,
    selectedProvider: selected,
    selectedModel: model,
    fallback: fallback ? 'Selected provider has no key; using mock' : null,
    providers: Object.entries(defaults).map(([id, model]) => ({
      id,
      model,
      hasKey: !!getKey(id),
      needsKey: !!keyNames[id],
    })),
    tickMinutes: Number(process.env.RESIDENTS_TICK_MINUTES) || 60,
    tickRealSeconds: Number(process.env.RESIDENTS_TICK_MINUTES) || 60,
    minRealSeconds: Number(process.env.RESIDENTS_MIN_REAL_SECONDS) || 3,
    residentCount: Math.max(5, Math.min(10, Number(process.env.RESIDENTS_COUNT) || 8)),
    mockReferenceModel: process.env.MOCK_REFERENCE_MODEL || 'gemini-2.5-flash-lite',
    priceTable,
  };
}
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request) {
  let size = 0;
  let chunks = [];
  for await (const candidate of request) {
    size += candidate.length;
    if (size > 262144) throw Error('Body too large');
    chunks.push(candidate);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Error('Invalid JSON');
  }
}
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const route = url.pathname;
    // Reject foreign browser origins for API writes; keys never leave this process.
    if (
      route.startsWith('/api/') &&
      request.method !== 'GET' &&
      request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`
    )
      return json(response, 403, { error: 'Foreign origin' });
    if (route === '/api/config') {
      if (request.method === 'POST') {
        const second = await body(request);
        if (
          !Object.hasOwn(defaults, second.provider) ||
          typeof second.model !== 'string' ||
          !second.model.trim() ||
          second.model.length > 160
        )
          return json(response, 400, { error: 'Invalid provider or model' });
        selected = second.provider;
        model = second.model;
      } else if (request.method !== 'GET')
        return json(response, 405, { error: 'Method not allowed' });
      return json(response, 200, config());
    }
    if (route === '/api/costs' && request.method === 'GET')
      return json(response, 200, { totals, records });
    if (route === '/api/state') {
      if (request.method === 'GET') {
        let state = null;
        try {
          state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
        } catch {}
        return json(response, 200, state);
      }
      if (request.method === 'DELETE') {
        await fs.rm(path.join(dataDir, 'state.json'), { force: true });
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST') {
        const second = await body(request);
        const tmp = path.join(dataDir, `state-${crypto.randomUUID()}.tmp`);
        await fs.writeFile(tmp, JSON.stringify(second));
        await fs.rename(tmp, path.join(dataDir, 'state.json'));
        return json(response, 200, { ok: true });
      }
    }
    if (route === '/api/tick' && request.method === 'POST') {
      if (busy) return json(response, 429, { busy: true });
      busy = true;
      try {
        const world = await body(request);
        if (!validateSnapshot(world))
          return json(response, 400, { error: 'Invalid world snapshot' });
        const candidate = config();
        const start = Date.now();
        const prompt = buildPrompt(world);
        let result;
        try {
          result = await createProvider(candidate.provider, world).complete({
            ...prompt,
            model: candidate.model,
            maxTokens: 900,
            signal: AbortSignal.timeout(45000),
          });
        } catch {
          return json(response, 502, { error: 'Provider unavailable or timed out' });
        }
        const parsed = parseDecisions(result.text, world);
        const costUsd = costFor(candidate.provider, candidate.model, result.usage);
        const wouldCostUsd =
          candidate.provider === 'mock'
            ? costFor('google', candidate.mockReferenceModel, result.usage)
            : undefined;
        const record = {
          timestamp: new Date().toISOString(),
          provider: candidate.provider,
          model: candidate.model,
          usage: result.usage,
          costUsd,
          wouldCostUsd,
          latencyMs: Date.now() - start,
          parseError: parsed.parseError,
          ...(parsed.parseError ? { fallback: 'mock' } : {}),
          ...(costUsd === null ? { warning: 'Unknown model price' } : {}),
        };
        await fs.appendFile(path.join(dataDir, 'llm-calls.jsonl'), JSON.stringify(record) + '\n');
        addTotals(record);
        records.push(record);
        records = records.slice(-50);
        return json(response, 200, {
          ...record,
          decisions: parsed.parseError ? mockDecisions(world).decisions : parsed.decisions,
          totals,
        });
      } finally {
        busy = false;
      }
    }
    if (route.startsWith('/api/')) return json(response, 404, { error: 'Not found' });
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return json(response, 405, { error: 'Method not allowed' });
    let decoded;
    try {
      decoded = decodeURIComponent(request.url.split('?')[0]);
    } catch {
      return json(response, 400, { error: 'Invalid path' });
    }
    const parts = decoded.replaceAll('\\', '/').split('/');
    if (
      parts.some(
        (place) =>
          place === '..' ||
          place.startsWith('.') ||
          ['data', 'node_modules', 'server', 'tests'].includes(place),
      )
    )
      return json(response, 403, { error: 'Forbidden' });
    const target = path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
    if (!target.startsWith(root + path.sep)) return json(response, 403, { error: 'Forbidden' });
    let real;
    try {
      real = await fs.realpath(target);
    } catch {
      return json(response, 404, { error: 'Not found' });
    }
    if (
      !real.startsWith(root + path.sep) ||
      path
        .relative(root, real)
        .split(path.sep)
        .some(
          (place) =>
            place.startsWith('.') || ['data', 'server', 'tests', 'node_modules'].includes(place),
        ) ||
      real.startsWith(dataDir + path.sep)
    )
      return json(response, 403, { error: 'Forbidden' });
    try {
      const bytes = await fs.readFile(real);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(real)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      json(response, 404, { error: 'Not found' });
    }
  } catch (event) {
    json(response, 400, {
      error: event.message === 'Body too large' ? 'Body too large' : 'Invalid request',
    });
  }
});
server.listen(
  process.env.PORT === undefined ? 8787 : Number(process.env.PORT),
  process.env.HOST || '127.0.0.1',
  () =>
    console.log(
      `Residents server listening on ${server.address().address}:${server.address().port}`,
    ),
);
