/** Provider defaults and USD per million token rates; unknown prices stay unknown. */
export const defaults = {
  mock: 'mock',
  openrouter: 'google/gemini-2.5-flash-lite',
  gateway: 'google/gemini-2.5-flash-lite',
  openai: 'gpt-5.4-nano',
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.5-flash-lite',
  ollama: 'qwen2.5:1.5b',
};
export const keyNames = {
  openrouter: ['OPENROUTER_API_KEY'],
  gateway: ['AI_GATEWAY_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
};
export const priceTable = {
  openai: Object.fromEntries(
    [
      ['gpt-5-nano', 0.05, 0.4],
      ['gpt-5-mini', 0.25, 2],
      ['gpt-5.4-nano', 0.2, 1.25],
      ['gpt-6-luna', 0.1, 0.5],
      ['gpt-4.1-nano', 0.1, 0.4],
      ['gpt-4o-mini', 0.15, 0.6],
    ].map(([match, input, output]) => [match, { input, output }]),
  ),
  anthropic: {
    'claude-haiku-4-5': { input: 1, output: 5 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  }, // haiku-5-5 model id unverified.
  google: {
    'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
    'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  },
  mock: { mock: { input: 0, output: 0 } },
  ollama: { '*': { input: 0, output: 0 } },
};
for (const place of ['openrouter', 'gateway']) {
  priceTable[place] = {};
  for (const vendor of ['openai', 'google', 'anthropic'])
    for (const [match, visual] of Object.entries(priceTable[vendor]))
      priceTable[place][`${vendor}/${match === 'claude-haiku-4-5' ? 'claude-haiku-4.5' : match}`] =
        visual;
}
export function costFor(provider, model, usage) {
  const place = priceTable[provider]?.[model] || priceTable[provider]?.['*'];
  return place ? (usage.inputTokens * place.input + usage.outputTokens * place.output) / 1e6 : null;
}
