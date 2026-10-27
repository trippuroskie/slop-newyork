/** Resident simulation, wall-time scheduling, scene markers and compact debug panel. */
import { createWallClock, isTickDue } from './clock.js';
import * as THREE from 'three/webgpu';
import { makePlaces, routeBetween } from './places.js';
import { mockDecisions, parseDecisions } from './policy.js';
const storageKey = 'nyc-llm-residents-v1';
const names = ['Maya', 'Leo', 'Inez', 'Sam', 'Noor', 'Theo', 'June', 'Alex', 'Ada', 'Max'];
export async function initResidents({ scene, cameraSystem, cityBlocks, controllerManager }) {
  if (new URLSearchParams(location.search).get('residents') === '0') return { update() {} };
  let config = {
    provider: 'mock',
    model: 'mock',
    tickMinutes: 60,
    minRealSeconds: 3,
    residentCount: 8,
    providers: [],
  };
  let online = true;
  let speed = 1;
  let inFlight = false;
  let lastCall = -Infinity;
  let lastSave = performance.now();
  let lastUsage = null;
  let status = '';
  async function api(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw Error(`Proxy ${response.status}`);
    return response.json();
  }
  try {
    config = await api('/api/config');
  } catch {
    online = false;
    status = 'offline mock (no proxy)';
  }
  const places = makePlaces(cityBlocks);
  let state = {
    version: 1,
    clock: 8 * 60,
    tickCount: 0,
    lastTick: 8 * 60,
    places,
    residents: Array.from({ length: config.residentCount }, (_, index) => {
      const home = places[index % 8];
      return {
        id: `r${index + 1}`,
        name: names[index],
        age: 23 + index * 3,
        personality: [
          'Designer who loves quiet parks',
          'Analyst and enthusiastic cook',
          'Teacher who enjoys company',
        ][index % 3],
        job: ['designer', 'analyst', 'teacher'][index % 3],
        home: home.id,
        workplace: places[8 + (index % 3)].id,
        needs: { hunger: 35 + index * 3, work: 30, social: 25 },
        schedule: { wake: 7, workStart: 9, workEnd: 17, meals: [8, 13, 19], evening: 18 },
        action: 'idle',
        destination: home.id,
        location: home.id,
        position: { ...home.door },
        thought: 'A new day in Manhattan.',
        route: [],
      };
    }),
    events: [],
    totals: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, wouldCostUsd: 0 },
  };
  try {
    const saved = online ? await api('/api/state') : JSON.parse(localStorage.getItem(storageKey));
    if (
      saved?.version === 1 &&
      Array.isArray(saved.residents) &&
      saved.residents.length >= 5 &&
      saved.places?.length
    ) {
      const currentIds = new Set(places.map((place) => place.id));
      if (saved.places.every((place) => currentIds.has(place.id))) {
        state = saved;
        lastUsage = saved.lastCall || null;
      } else {
        console.info('LLM residents: place set changed; resetting saved residents.');
      }
    }
  } catch {}
  if (online)
    try {
      state.totals = (await api('/api/costs')).totals;
    } catch {}
  const panel = document.createElement('aside');
  panel.id = 'residents-panel';
  panel.innerHTML = `
    <button class="residents-toggle">Residents · R</button>
    <div class="residents-body">
      <strong>LLM residents</strong>
      <div class="clock"></div>
      <div class="speeds"></div>
      <button class="tick">Tick now</button>
      <div class="status"></div>
      <div class="people"></div>
      <div class="thought-log" aria-label="Recent resident thoughts"></div>
      <div class="cost"></div>
      <details>
        <summary>Provider settings</summary>
        <label>Provider <select class="provider"></select></label>
        <label>Model <input class="model" aria-label="Model"></label>
        <button class="apply">Apply provider</button>
      </details>
    </div>
  `;
  document.body.append(panel);
  const queryPanel = (selector) => panel.querySelector(selector);
  const money = (value) => (value === null ? 'unknown' : `$${Number(value || 0).toFixed(6)}`);
  for (const value of [0, 1, 5, 20]) {
    const button = document.createElement('button');
    button.textContent = value ? `${value}x` : 'Pause';
    button.onclick = () => setSpeed(value);
    queryPanel('.speeds').append(button);
  }
  function setSpeed(value) {
    update();
    if (Number.isFinite(value) && value >= 0 && value <= 100) speed = value;
  }
  const toggle = () => panel.classList.toggle('collapsed');
  queryPanel('.residents-toggle').onclick = toggle;
  window.addEventListener('keydown', (event) => {
    if (
      event.code === 'KeyR' &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
    )
      toggle();
  });
  function providerUI() {
    queryPanel('.provider').replaceChildren();
    for (const place of config.providers.length
      ? config.providers
      : [{ id: 'mock', needsKey: false }]) {
      const option = document.createElement('option');
      option.value = place.id;
      option.textContent = `${place.id}${place.needsKey ? (place.hasKey ? ' · key available' : ' · no key') : ''}`;
      queryPanel('.provider').append(option);
    }
    queryPanel('.provider').value = config.selectedProvider || config.provider;
    queryPanel('.model').value = config.selectedModel || config.model;
  }
  providerUI();
  queryPanel('.provider').onchange = () => {
    queryPanel('.model').value =
      config.providers.find((place) => place.id === queryPanel('.provider').value)?.model || 'mock';
  };
  queryPanel('.apply').onclick = async () => {
    if (!online) return;
    try {
      config = await api('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: queryPanel('.provider').value,
          model: queryPanel('.model').value,
        }),
      });
      providerUI();
      status = '';
    } catch {
      status = 'Could not change provider';
    }
  };
  const visuals = new Map();
  const bubbleRoot = document.createElement('div');
  bubbleRoot.id = 'resident-bubbles';
  document.body.append(bubbleRoot);
  for (const [index, resident] of state.residents.entries()) {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(index / state.residents.length, 0.85, 0.6),
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.1, 4, 8), material);
    body.position.y = 1.3;
    group.add(body);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 35, 5),
      new THREE.MeshBasicMaterial({
        color: material.color,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    beam.position.y = 18;
    group.add(beam);
    scene.add(group);
    const bubble = document.createElement('div');
    bubble.className = 'resident-bubble';
    bubbleRoot.append(bubble);
    visuals.set(resident.id, { group, body, bubble });
    const button = document.createElement('button');
    button.className = 'resident-person';
    button.style.borderLeft = `4px solid #${material.color.getHexString()}`;
    button.onclick = () => {
      controllerManager.setMode('person');
      controllerManager.teleportActiveTo(resident.position.x + 3, resident.position.z + 3);
    };
    queryPanel('.people').append(button);
    visuals.get(resident.id).button = button;
  }
  function save(beacon = false) {
    const payload = JSON.stringify(state);
    try {
      localStorage.setItem(storageKey, payload);
    } catch {}
    if (online) {
      if (beacon)
        navigator.sendBeacon('/api/state', new Blob([payload], { type: 'application/json' }));
      else
        fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => {});
    }
  }
  window.addEventListener('pagehide', () => save(true));
  const placeById = (id) => state.places.find((place) => place.id === id);
  async function tickNow() {
    if (inFlight || performance.now() - lastCall < config.minRealSeconds * 1000) return;
    inFlight = true;
    lastCall = performance.now();
    state.lastTick = state.clock;
    const snapshot = {
      clock: state.clock,
      residents: state.residents.map(({ route, position, ...resident }) => resident),
      places: state.places.map(({ id, label, kind }) => ({ id, label, kind })),
      events: state.events.slice(-8),
    };
    try {
      let result;
      if (online)
        result = await api('/api/tick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        });
      else {
        const text = JSON.stringify(mockDecisions(snapshot));
        const usage = {
          inputTokens: Math.ceil(JSON.stringify(snapshot).length / 4),
          outputTokens: Math.ceil(text.length / 4),
          estimated: true,
        };
        const wouldCostUsd = (usage.inputTokens * 0.1 + usage.outputTokens * 0.4) / 1e6;
        result = {
          ...parseDecisions(text, snapshot),
          usage,
          costUsd: 0,
          wouldCostUsd,
          provider: 'mock',
          model: 'mock',
          totals: {
            calls: state.totals.calls + 1,
            inputTokens: state.totals.inputTokens + usage.inputTokens,
            outputTokens: state.totals.outputTokens + usage.outputTokens,
            costUsd: 0,
            wouldCostUsd: (state.totals.wouldCostUsd || 0) + wouldCostUsd,
          },
        };
      }
      for (const decision of result.decisions) {
        const resident = state.residents.find((resident) => resident.id === decision.id);
        const destinationPlace = placeById(decision.destination);
        if (!resident || !destinationPlace) continue;
        if (resident.destination !== destinationPlace.id || resident.action !== decision.action) {
          const from =
            placeById(resident.location) ||
            placeById(resident.destination) ||
            placeById(resident.home);
          resident.route = [
            ...(!resident.location ? resident.route || [] : []),
            ...routeBetween(from, destinationPlace),
          ];
          resident.location = null;
        }
        Object.assign(resident, decision);
        state.events.push({
          clock: state.clock,
          name: resident.name,
          action: resident.action,
          destination: destinationPlace.label,
          thought: resident.thought,
        });
      }
      state.events.push({
        clock: state.clock,
        call: true,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs || 0,
        fallback: result.fallback,
      });
      state.events = state.events.slice(-200);
      state.lastCall = result;
      state.totals = result.totals;
      state.tickCount++;
      lastUsage = result;
      status = result.parseError || '';
      save();
      renderLog();
    } catch {
      status = 'Tick failed; current plans continue. Retry with Tick now.';
    } finally {
      inFlight = false;
    }
  }
  queryPanel('.tick').onclick = tickNow;
  function renderLog() {
    queryPanel('.thought-log').replaceChildren();
    for (const event of state.events.slice(-50).reverse()) {
      const row = document.createElement('p');
      row.textContent = event.call
        ? `${formatTime(event.clock)} · ${event.provider}/${event.model} · ${event.usage.inputTokens} in / ${event.usage.outputTokens} out · ${money(event.costUsd)} · ${event.latencyMs} ms${event.fallback ? ' · fallback: mock' : ''}`
        : `${formatTime(event.clock)} · ${event.name} · ${event.action} → ${event.destination} · “${event.thought}”`;
      queryPanel('.thought-log').append(row);
    }
  }
  function formatTime(gameMinutes) {
    return `Day ${Math.floor(gameMinutes / 1440) + 1} ${String(Math.floor(gameMinutes / 60) % 24).padStart(2, '0')}:${String(Math.floor(gameMinutes) % 60).padStart(2, '0')}`;
  }
  renderLog();
  const projected = new THREE.Vector3();
  const elapsedSeconds = createWallClock();
  function update() {
    const realSeconds = elapsedSeconds();
    const minutes = realSeconds * speed;
    const bubblePositions = [];
    state.clock += minutes;
    for (const resident of state.residents) {
      resident.needs.hunger = Math.min(100, resident.needs.hunger + minutes * 0.12);
      resident.needs.social = Math.min(100, resident.needs.social + minutes * 0.045);
      resident.needs.work = Math.min(100, resident.needs.work + minutes * 0.06);
      let distance = realSeconds * Math.min(84 * speed, 140);
      // Walking uses wall seconds too; accelerated movement is capped at 140 m/s.
      resident.route ||= [];
      while (resident.route.length && distance > 0) {
        const place = resident.route[0];
        const deltaX = place.x - resident.position.x;
        const deltaZ = place.z - resident.position.z;
        const segmentLength = Math.hypot(deltaX, deltaZ);
        if (segmentLength <= distance) {
          resident.position = { ...place };
          resident.route.shift();
          distance -= segmentLength;
        } else {
          resident.position.x += (deltaX / segmentLength) * distance;
          resident.position.z += (deltaZ / segmentLength) * distance;
          distance = 0;
        }
      }
      if (!resident.route.length) {
        resident.location = resident.destination;
        const kind = placeById(resident.location)?.kind;
        const need =
          resident.action === 'eat' && ['food', 'cafe'].includes(kind)
            ? 'hunger'
            : resident.action === 'work' && kind === 'office'
              ? 'work'
              : resident.action === 'socialize' && ['bar', 'park', 'cafe'].includes(kind)
                ? 'social'
                : null;
        if (need) resident.needs[need] = Math.max(0, resident.needs[need] - minutes * 0.9);
      }
      const visual = visuals.get(resident.id);
      visual.group.position.set(resident.position.x, 0.3, resident.position.z);
      visual.body.visible = true;
      visual.body.scale.setScalar(resident.route.length ? 1 : 0.45);
      visual.button.textContent = `${resident.name} · ${resident.action}${resident.route.length ? ' ↗' : ''}`;
      projected.set(resident.position.x, 5, resident.position.z).project(cameraSystem.camera);
      const visible =
        projected.z > -1 &&
        projected.z < 1 &&
        Math.abs(projected.x) < 1 &&
        Math.abs(projected.y) < 1 &&
        cameraSystem.camera.position.distanceTo(visual.group.position) < 600;
      let screenX = (projected.x * 0.5 + 0.5) * innerWidth;
      let screenY = (-projected.y * 0.5 + 0.5) * innerHeight;
      if (visible) {
        while (
          bubblePositions.some(
            (point) => Math.abs(point.x - screenX) < 160 && Math.abs(point.y - screenY) < 40,
          )
        )
          screenY -= 44;
        bubblePositions.push({ x: screenX, y: screenY });
      }
      visual.bubble.hidden = !visible;
      visual.bubble.style.transform = `translate(${screenX}px,${screenY}px)`;
      visual.bubble.textContent = `${resident.name} · ${resident.action}\n${resident.thought}`;
    }
    if (speed && isTickDue(state, config.tickMinutes)) void tickNow();
    if (performance.now() - lastSave > 30000) {
      lastSave = performance.now();
      save();
    }
    queryPanel('.clock').textContent =
      `${formatTime(state.clock)} · ${speed ? speed + 'x' : 'Paused'}`;
    queryPanel('.status').textContent =
      `${online ? `${config.provider} / ${config.model}` : 'offline mock (no proxy)'}${config.fallback ? ' · ' + config.fallback : ''}${inFlight ? ' · thinking…' : ''}${status ? ' · ' + status : ''}`;
    // Average billed call × calls per game-day, independent of render FPS.
    const totals = state.totals;
    queryPanel('.cost').textContent =
      `Last: ${lastUsage ? `${lastUsage.usage.inputTokens} in / ${lastUsage.usage.outputTokens} out${lastUsage.usage.estimated ? ' (estimated)' : ''} · ${money(lastUsage.costUsd)}` : '—'}\nTotal: ${totals.calls} calls · ${totals.inputTokens}/${totals.outputTokens} tokens · ${money(totals.costUsd)}${config.provider === 'mock' || !online ? `\nLast would cost ${money(lastUsage?.wouldCostUsd)} on ${config.mockReferenceModel || 'gemini-2.5-flash-lite'}\nTotal would cost ${money(totals.wouldCostUsd)} on ${config.mockReferenceModel || 'gemini-2.5-flash-lite'}` : ''}\nEstimated / game-day: ${totals.calls ? money(((config.provider === 'mock' || !online ? totals.wouldCostUsd : totals.costUsd) / totals.calls) * (1440 / config.tickMinutes)) : '—'} (average call × ${(1440 / config.tickMinutes).toFixed(1)})`;
  }
  window.__residents = {
    get state() {
      return structuredClone(state);
    },
    get clock() {
      return state.clock;
    },
    get residents() {
      return state.residents.map((resident) => ({
        ...structuredClone(resident),
        x: resident.position.x,
        z: resident.position.z,
        inside: !resident.route?.length && Boolean(placeById(resident.location)?.footprint),
      }));
    },
    get day() {
      return Math.floor(state.clock / 1440) + 1;
    },
    get speed() {
      return speed;
    },
    get lastCall() {
      return structuredClone(lastUsage);
    },
    get log() {
      return structuredClone(state.events.slice(-20));
    },
    save,
    get tickCount() {
      return state.tickCount;
    },
    get totals() {
      return { ...state.totals };
    },
    setSpeed,
    tickNow,
  };
  // Timer and renderer share a cursor, so each wall-clock interval is consumed once.
  setInterval(update, 250);
  update();
  if (isTickDue(state, config.tickMinutes)) void tickNow();
  return { update };
}
