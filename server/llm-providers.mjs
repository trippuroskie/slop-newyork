/** Provider adapters normalize text and usage. Credentials remain in process memory. */
import { keyNames } from './residents-config.mjs';
import { mockDecisions } from '../js/residents/policy.js';
export function getKey(provider) {
  return (keyNames[provider] || []).map((key) => process.env[key]).find(Boolean);
}
export function createProvider(provider, world) {
  return {
    async complete({ system, user, model, maxTokens = 900, signal }) {
      if (provider === 'mock') {
        const text = JSON.stringify(mockDecisions(world));
        return {
          text,
          usage: {
            inputTokens: Math.ceil((system.length + user.length) / 4),
            outputTokens: Math.ceil(text.length / 4),
            estimated: true,
          },
        };
      }
      let url;
      let headers = { 'Content-Type': 'application/json' };
      let body;
      const key = getKey(provider);
      if (provider === 'anthropic') {
        url = 'https://api.anthropic.com/v1/messages';
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        body = {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        };
      } else if (provider === 'google') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        headers['x-goog-api-key'] = key;
        body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
        };
      } else if (provider === 'ollama') {
        url = `${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/chat`;
        body = {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          format: 'json',
          stream: false,
          options: { temperature: 0.4, num_ctx: 4096, num_predict: maxTokens },
        };
      } else {
        url = {
          openai: 'https://api.openai.com/v1/chat/completions',
          openrouter: 'https://openrouter.ai/api/v1/chat/completions',
          gateway: 'https://ai-gateway.vercel.sh/v1/chat/completions',
        }[provider];
        headers.Authorization = `Bearer ${key}`;
        if (provider === 'openrouter') {
          headers['HTTP-Referer'] = 'http://localhost:8787';
          headers['X-Title'] = 'Slop New York Residents';
        }
        body = {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          ...(/(?:^|\/)gpt-5/i.test(model) ? {} : { temperature: 0.4 }),
          ...(provider === 'openai' && /^gpt-5/.test(model)
            ? { max_completion_tokens: maxTokens, reasoning_effort: 'minimal' }
            : { max_tokens: maxTokens }),
        };
      }
      let response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (provider === 'openai' && response.status === 400) {
        await response.arrayBuffer();
        delete body.reasoning_effort;
        delete body.response_format;
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        });
      }
      if (!response.ok) throw new Error('Provider request failed');
      const payload = await response.json();
      const text =
        provider === 'anthropic'
          ? payload.content
              ?.filter((candidate) => candidate.type === 'text')
              .map((candidate) => candidate.text)
              .join('')
          : provider === 'google'
            ? payload.candidates?.[0]?.content?.parts?.map((place) => place.text || '').join('')
            : provider === 'ollama'
              ? payload.message?.content
              : payload.choices?.[0]?.message?.content;
      const usage = payload.usage || payload.usageMetadata || {};
      return {
        text: text || '',
        usage: {
          inputTokens:
            Number(
              usage.prompt_tokens ??
                usage.input_tokens ??
                usage.promptTokenCount ??
                payload.prompt_eval_count,
            ) || 0,
          outputTokens:
            Number(
              usage.completion_tokens ??
                usage.output_tokens ??
                usage.candidatesTokenCount ??
                payload.eval_count,
            ) || 0,
        },
      };
    },
  };
}
