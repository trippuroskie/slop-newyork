# Slop New York

A New York City simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Explore Manhattan on foot, by car, by bicycle, or by helicopter.

[Try it live](https://mrdoob.github.io/slop-newyork/)

## Make it your own

Fork it, remix it, improve it, break it. Make games, animations, films, experiments, or something completely different. Use it as a starting point and take it wherever you want. Have fun!

Explore other cities and community remixes in [Slop Cities](https://github.com/zz85/slop-cities).

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: NYC Open Data, [MTA subway entrances](https://data.ny.gov/Transportation/MTA-Subway-Entrances-and-Exits-2024/i9wp-a4ja), and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Third-party data and dependencies retain their respective licenses.

<!-- // LLM residents -->
## LLM residents (experimental)

Eight colourful residents live in seeded, separated generated buildings between 6th/Lexington Avenues and 34th/42nd Streets, walk the street grid, and maintain hunger, work and social needs. One batched LLM call chooses everyone's next plan each simulated hour. Between calls, movement and needs run locally. This is an experimental schedule simulation; doors and routes are approximate and residents do not have collision avoidance.

Run Node 20+ with `npm start`, then open http://127.0.0.1:8787/. No install or build is required. The default provider is free mock. Use the right-side panel (toggle **R**) to pause, select 1x/5x/20x, tick now, or change provider/model. Click a resident to teleport the walking player nearby. At 1x, one real second advances one game minute. The first tick runs immediately; overdue saves tick after load. A shared wall clock and 250 ms fallback timer keep time moving at low FPS without double counting; each elapsed step is capped at five seconds after tab sleeps. Calls are separated by at least three real seconds even at 20x. `?residents=0` disables the layer. A plain static host uses offline mock and localStorage. Coloured beams mark residents; door markers stay visible indoors. Bubbles show nearby thoughts. The compact panel keeps 50 recent log entries visible and persists 200. `window.__residents` exposes clock, day, speed, ticks, residents, costs, recent log and `setSpeed`, `tickNow`, `save` controls.

Export environment variables in your shell before starting the server. `.env.example` lists names; the server does **not** load `.env` files. `LLM_PROVIDER` defaults to `mock`; `LLM_MODEL` overrides the selected provider's default. Keys are `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`). `OLLAMA_HOST` defaults to http://127.0.0.1:11434. A provider without its key falls back to mock, with a notice in the panel.

| Provider | Default model | Input / output USD per million tokens |
| --- | --- | --- |
| mock | mock | 0 / 0 |
| OpenRouter | google/gemini-2.5-flash-lite | 0.10 / 0.40 |
| Vercel AI Gateway | google/gemini-2.5-flash-lite | 0.10 / 0.40 |
| OpenAI | gpt-5.4-nano | 0.20 / 1.25 |
| Anthropic | claude-haiku-4-5 | 1.00 / 5.00 |
| Google | gemini-2.5-flash-lite | 0.10 / 0.40 |
| Ollama | qwen2.5:1.5b | 0 / 0 (local compute) |

The supplied list-price table is in `server/residents-config.mjs` (2026-10-27); OpenRouter/Gateway may add fees. It also includes GPT-5 nano/mini, GPT-6 Luna, GPT-4.1 nano, GPT-4o mini, Gemini 3.1 Flash Lite, and an explicitly unverified Haiku 5.5 model id. Unknown model prices are reported as unknown and logged with a warning; running dollar totals sum known prices only. Cost = `(inputTokens × inputPrice + outputTokens × outputPrice) / 1,000,000`. Mock estimates tokens with `ceil(characters / 4)` and shows hypothetical cost against `MOCK_REFERENCE_MODEL` (default `gemini-2.5-flash-lite`, using the Google price table).

Run `node scripts/residents-prompt-size.mjs` to reproduce the eight-resident budget using the real prompt builder: system **521 characters / ~131 tokens**, user **2,193 characters / ~549 tokens**, expected mock output **839 characters / ~210 tokens**. With ~680 input and ~210 output tokens, the reference Flash Lite estimate is **$0.000152/call**, or **$0.003648/game-day** at 24 calls/day. These character/4 estimates vary with places, thoughts and tokenizer; actual model output can be longer than mock output. The output limit is 900 tokens (eight decisions × roughly 40 tokens plus JSON overhead). The panel reports last-call usage/cost, running totals, mock reference costs and average-call cost × `1440 / tickMinutes` per game-day.

Tiny local models (≤3B) work but make weak decisions. Gemini Flash-Lite / gpt-5-nano class models are the recommended cheap cloud options. Prompts use short place/resident aliases, readable time and schedule hints; parsing maps aliases back to saved ids and replaces schema-like thoughts with short first-person mock lines.

`RESIDENTS_TICK_MINUTES` defaults to 60; `RESIDENTS_MIN_REAL_SECONDS` to 3; `RESIDENTS_COUNT` to 8 (clamped to 5–10, applies to new state). `MOCK_REFERENCE_MODEL`, `DATA_DIR`, `PORT` (8787) and `HOST` (127.0.0.1) are optional. State resumes from `data/state.json`; deleting that file while the server is stopped resets residents. `DELETE /api/state` clears the server save (reload after clearing the browser's `nyc-llm-residents-v1` localStorage entry). Old saves with incompatible place IDs reset with a console notice. Calls append metadata, usage, cost and parse errors to `data/llm-calls.jsonl`. Unusable model JSON falls back to mock for that tick, logging `parseError` and `fallback: "mock"` while retaining real usage/cost. Prompts, raw responses and keys are not persisted. Server totals resume from the call log.

Keys stay in server environment variables and never reach the browser. The proxy binds localhost by default; overriding `HOST` exposes a paid-call API without authentication, so keep it on a trusted network. Static serving blocks hidden files, data, server sources and traversal. State writes use a temporary file followed by rename. Pagehide saving uses a beacon; normal saves happen after ticks and every 30 real seconds.

Run `npm run test:residents` for parser, pricing and HTTP smoke tests. Existing upstream tests run with `node --test tests/*.test.cjs`.
