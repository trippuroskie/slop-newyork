/** Prompt, tolerant parser and cost arithmetic regression coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisions, buildPrompt } from '../server/residents-prompt.mjs';
import { costFor, priceTable } from '../server/residents-config.mjs';
const world = {
  clock: 480,
  places: [{ id: 'home', label: 'Home', kind: 'home' }],
  residents: [
    { id: 'r1', name: 'Maya', home: 'home', needs: { hunger: 80, work: 20, social: 20 } },
  ],
};
test('fences, prose, thought clamping, unknown destinations and residents', () => {
  const place = parseDecisions(
    'Here:\n```json\n' +
      JSON.stringify({
        decisions: [
          { id: 'r1', action: 'eat', destination: 'missing', thought: 'a'.repeat(120) },
          { id: 'intruder', action: 'idle', destination: 'home' },
        ],
      }) +
      '\n```',
    world,
  );
  assert.equal(place.decisions.length, 1);
  assert.equal(place.decisions[0].destination, 'home');
  assert.equal(place.decisions[0].thought.length, 100);
  assert.ok(place.parseError);
  assert.match(buildPrompt(world).user, /Maya/);
});
test('garbage and absent residents preserve current plans', () => {
  assert.deepEqual(parseDecisions('garbage', world).decisions, []);
  assert.ok(parseDecisions('garbage', world).parseError);
  assert.deepEqual(parseDecisions('{"decisions":[]}', world).decisions, []);
  assert.equal(
    parseDecisions('{"decisions":[{"id":"r1","action":"fly","destination":"home"}]}', world)
      .decisions[0].action,
    'idle',
  );
});
test('price math and unknown model', () => {
  assert.equal(costFor('openai', 'gpt-5-nano', { inputTokens: 1e6, outputTokens: 1e6 }), 0.45);
  for (const [provider, models] of Object.entries(priceTable))
    for (const [model, place] of Object.entries(models))
      assert.ok(
        Math.abs(
          costFor(provider, model, { inputTokens: 2e6, outputTokens: 3e6 }) -
            (2 * place.input + 3 * place.output),
        ) < 1e-10,
      );
  assert.equal(costFor('google', 'unknown', { inputTokens: 1, outputTokens: 1 }), null);
});

test('local model envelopes, names and extra fields', () => {
  for (const envelope of [
    (decisions) => decisions,
    (decisions) => ({ decisions }),
    (decisions) => ({ residents: decisions }),
  ]) {
    const parsed = parseDecisions(
      JSON.stringify(
        envelope([
          { name: 'mAyA', action: 'idle', destination: 'home', thought: 'Hello', extra: true },
        ]),
      ),
      world,
    );
    assert.equal(parsed.parseError, null);
    assert.equal(parsed.decisions[0].id, 'r1');
  }
  assert.ok(parseDecisions('null', world).parseError);
  assert.ok(parseDecisions('{"decisions":[null]}', world).parseError);
});

test('compact aliases, readable time and schedule hints map back to real ids', () => {
  const snapshot = {
    ...world, clock: 651,
    places: [...world.places, { id: 'office-real', label: 'Office tower', kind: 'office' }],
    residents: [{ ...world.residents[0], id: 'person-real', workplace: 'office-real' }],
  };
  const prompt = buildPrompt(snapshot);
  assert.match(prompt.user, /Day 1, 10:51 \(Tuesday morning\)/);
  assert.match(prompt.user, /P2 Office tower \[office\]/);
  assert.match(prompt.user, /should be at work now/);
  assert.ok(!prompt.user.includes('office-real'));
  for (const id of ['r1', 'Maya', 'person-real']) {
    const parsed = parseDecisions(JSON.stringify({ decisions: [
      { id, action: 'work', destination: 'P2', thought: "I've got sketches to finish." },
    ] }), snapshot);
    assert.equal(parsed.parseError, null);
    assert.equal(parsed.decisions[0].id, 'person-real');
    assert.equal(parsed.decisions[0].destination, 'office-real');
  }
  for (const destination of ['missing', 'P1', 'office-real']) {
    const parsed = parseDecisions(JSON.stringify([{ id: 'r1', action: 'work', destination,
      thought: "I've got sketches to finish." }]), snapshot);
    assert.equal(parsed.decisions[0].action, 'work');
    assert.equal(parsed.decisions[0].destination, 'office-real');
  }
});

test('schema echoes and third-person name openings get first-person mock thoughts', () => {
  for (const thought of ['first person, 100 chars', 'max 100 chars', '<=12 words',
    'The resident is hungry', 'Maya needs to eat', 'Maya is hungry']) {
    const parsed = parseDecisions(JSON.stringify([{ id: 'r1', action: 'eat',
      destination: 'home', thought }]), world);
    assert.ok(parsed.parseError);
    assert.match(parsed.decisions[0].thought, /^I/);
    assert.notEqual(parsed.decisions[0].thought, thought);
  }
});

test('provider requests bound output and configure local context and temperature', async () => {
  const { createProvider } = await import('../server/llm-providers.mjs');
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({}) };
  };
  try {
    await createProvider('ollama', world).complete({ system: '', user: '', model: 'qwen2.5:1.5b' });
    assert.deepEqual(body.options, { temperature: 0.4, num_ctx: 4096, num_predict: 900 });
    for (const provider of ['openai', 'openrouter', 'gateway']) {
      for (const model of ['gpt-4.1-nano', 'gpt-5-nano', 'openai/gpt-5-nano']) {
        await createProvider(provider, world).complete({ system: '', user: '', model });
        assert.equal(body.temperature, model.includes('gpt-5') ? undefined : 0.4);
        assert.equal(body.max_tokens ?? body.max_completion_tokens, 900);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
