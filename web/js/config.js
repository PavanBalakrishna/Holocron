import { CHARACTERS, DEFAULT_CHARACTER } from './characters.js';

/**
 * Deployment configuration for the static client.
 *
 * Everything here is PUBLIC — this file ships to GitHub Pages. Never put a
 * client secret in it. The OAuth flow below is PKCE precisely so that no
 * secret is required.
 */

export const DEFAULT_MODEL = 'claude-opus-5';

/** Ceiling for one reply. Also bounds Haiku's thinking budget below. */
export const MAX_TOKENS = 16000;

/**
 * The models a visitor may pick, and how to ask each one for reasoning.
 *
 * This is a table rather than one shared params object because the request
 * shape is NOT portable across models — sending Opus 5's parameters to Haiku
 * 4.5 is a 400, not a degraded answer:
 *
 *   • `output_config.effort` is rejected outright by Haiku 4.5
 *   • adaptive thinking does not exist there either; reasoning on that model
 *     is a fixed `budget_tokens` ceiling, the older mechanism
 *
 * So each entry declares which levels it supports and how they translate, and
 * `requestShape()` below assembles the body. Adding a model means adding a row
 * here and nothing else.
 *
 * `levels` is ordered cheapest → most thorough and drives the picker directly.
 *
 * `web` names the Anthropic-hosted search/fetch tool versions this model
 * accepts. These are versioned types, not capabilities you can assume: the
 * 20260209 pair (with dynamic filtering) needs Opus 4.6+ or Sonnet 4.6+, and
 * older models take the earlier basic variants. Naming a version a model does
 * not support is a request error, so this belongs in the table too.
 */
export const MODELS = {
  'claude-opus-5': {
    label: 'Opus 5',
    blurb: 'Deepest reasoning',
    thinking: 'adaptive',
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultLevel: 'low',
    web: { search: 'web_search_20260209', fetch: 'web_fetch_20260209' },
    // Server-side refusal fallback: if a safety classifier declines, the API
    // reroutes to a suitable model instead of handing back a dead turn.
    // Documented for the Opus 5 / Fable tier, so it is not claimed elsewhere.
    refusalFallback: true,
  },

  'claude-sonnet-5': {
    label: 'Sonnet 5',
    blurb: 'Fast, capable, cheaper',
    thinking: 'adaptive',
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultLevel: 'low',
    web: { search: 'web_search_20260209', fetch: 'web_fetch_20260209' },
    refusalFallback: false,
  },

  'claude-haiku-4-5': {
    label: 'Haiku 4.5',
    blurb: 'Cheapest; 200K context',
    thinking: 'budget',
    // No `xhigh`/`max`: those are effort levels, and this model has no effort
    // parameter. The three below map onto thinking-token budgets instead.
    levels: ['low', 'medium', 'high'],
    defaultLevel: 'medium',
    // Must stay under MAX_TOKENS, and the API floor is 1024.
    budgets: { low: 1024, medium: 4096, high: 8192 },
    // Predates dynamic filtering; the basic variants are what it takes.
    web: { search: 'web_search_20250305', fetch: 'web_fetch_20250910' },
    refusalFallback: false,
  },
};

/** Human-facing names for the depth picker. */
export const LEVEL_LABELS = {
  low: 'Shallow',
  medium: 'Measured',
  high: 'Deep',
  xhigh: 'Profound',
  max: 'Absolute',
};

/**
 * How much of the network the model may reach. Three settings, because the two
 * kinds of access differ in a way worth choosing between:
 *
 *   full   — hosted search and fetch, plus http_request from this browser
 *   search — hosted search and fetch only
 *   off    — no network tools at all
 *
 * Hosted tools run on Anthropic's servers: CORS does not apply, so they can
 * read pages a browser cannot, and each search is billed on top of tokens.
 * `http_request` runs here, which is free but CORS-bound and exposes the
 * visitor's own IP address to whatever is fetched. "search" is the setting for
 * someone who wants the web without handing their address to it.
 *
 * Whatever is off is removed from both the tools array and the briefing, so
 * the model never claims an ability it does not have.
 */
export function networkMode() {
  const stored = store.get('network');
  if (stored === 'off' || stored === 'search' || stored === 'full') return stored;
  // Honour the older boolean key so an existing visitor's choice survives.
  return store.get('tools') === 'off' ? 'off' : 'full';
}

export function setNetworkMode(mode) {
  store.set('network', mode);
}

/**
 * Voice setting: 'off', 'speak' (the construct talks), or 'both' (and listens).
 *
 * Default off. Speaking aloud is not something to start doing to someone who
 * did not ask, and listening needs informed consent besides — in Chrome the
 * audio goes to Google for transcription, which is not local the way the rest
 * of this page is.
 */
export function voiceMode() {
  const v = store.get('voice');
  return v === 'speak' || v === 'both' ? v : 'off';
}

export function setVoiceMode(mode) {
  store.set('voice', mode);
}

/**
 * Stored settings, namespaced to the project.
 *
 * Reads fall back to the old `v4d3r.*` keys so the rename does not silently
 * reset the settings of anyone who used the console before it. Writes only
 * ever use the new prefix, so the old keys fade out on first change.
 */
const store = {
  get(key) {
    return localStorage.getItem(`holocron.${key}`) ?? localStorage.getItem(`v4d3r.${key}`);
  },
  set(key, value) {
    localStorage.setItem(`holocron.${key}`, String(value));
  },
  remove(key) {
    localStorage.removeItem(`holocron.${key}`);
    localStorage.removeItem(`v4d3r.${key}`);
  },
};

/**
 * Which character is speaking.
 *
 * Stored, so a visitor who came for Yoda gets Yoda on their next visit.
 */
export function currentCharacter() {
  const stored = store.get('character');
  return stored && CHARACTERS[stored] ? stored : DEFAULT_CHARACTER;
}

export function setCharacter(id) {
  if (CHARACTERS[id]) store.set('character', id);
}

/**
 * Which voice to speak with, and how.
 *
 * An empty name means "decide automatically" — voice.js keeps a preference list
 * for that. Storing the name rather than an index matters because the voice
 * list is machine-specific and its order is not stable between browsers.
 *
 * Pitch and rate are clamped on read, not on write: a value that arrives from
 * an older build or a hand-edited localStorage must not be able to produce an
 * utterance the speech engine rejects.
 */
export function voiceSettings(id = currentCharacter()) {
  const spec = CHARACTERS[id] ?? CHARACTERS[DEFAULT_CHARACTER];

  const num = (key, fallback, lo, hi) => {
    const raw = store.get(key);
    // An absent key must be tested before conversion: Number(null) is 0, which
    // is perfectly finite, so a isFinite() check alone silently turns "unset"
    // into "zero" — and a zero pitch is not the default, it is a monotone.
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  return {
    // The voice NAME is global: it is a property of the machine, and there is
    // rarely more than one good one installed. Pitch and rate are per
    // character, because they are what makes the same voice read as a Sith
    // Lord or as a Wookiee — tuning Vader must not leave Yoda in a monotone.
    name: store.get('voiceName') ?? '',
    // The spec allows pitch 0–2 and rate 0.1–10; the useful range is narrower.
    pitch: num(`voicePitch.${id}`, spec.voice.pitch, 0, 2),
    rate: num(`voiceRate.${id}`, spec.voice.rate, 0.5, 2),
  };
}

export function setVoiceSettings({ name, pitch, rate }, id = currentCharacter()) {
  if (name !== undefined) store.set('voiceName', name);
  if (pitch !== undefined) store.set(`voicePitch.${id}`, pitch);
  if (rate !== undefined) store.set(`voiceRate.${id}`, rate);
}

/** Drop this character's tuning so it falls back to the character default. */
export function clearVoiceTuning(id = currentCharacter()) {
  store.remove('voiceName');
  store.remove(`voicePitch.${id}`);
  store.remove(`voiceRate.${id}`);
}

/** Whether the operator has been told where dictation audio goes. */
export function micConsented() {
  return store.get('micConsent') === 'yes';
}

export function setMicConsented() {
  store.set('micConsent', 'yes');
}

/** Model id the visitor has chosen, falling back to the default. */
export function currentModel() {
  const stored = store.get('model');
  return stored && MODELS[stored] ? stored : DEFAULT_MODEL;
}

/**
 * Depth the visitor has chosen, coerced to something the current model
 * actually accepts — a stored `max` must not survive a switch to Haiku.
 */
export function currentLevel(model = currentModel()) {
  const spec = MODELS[model];
  const stored = store.get('level');
  return stored && spec.levels.includes(stored) ? stored : spec.defaultLevel;
}

export function setModel(model) {
  if (MODELS[model]) store.set('model', model);
}

export function setLevel(level) {
  store.set('level', level);
}

/**
 * Build the per-request body fragment and beta list for a model and depth.
 *
 * @returns {{body: object, betas: string[]}}
 */
export function requestShape(model = currentModel(), level = currentLevel(model)) {
  const spec = MODELS[model] ?? MODELS[DEFAULT_MODEL];
  const depth = spec.levels.includes(level) ? level : spec.defaultLevel;

  const body = { model, max_tokens: MAX_TOKENS };

  if (spec.thinking === 'adaptive') {
    // `display: summarized` is what fills the MEDITATION panel — the default
    // is `omitted`, which streams empty thinking blocks and reads as a dead
    // pause while the model works.
    body.thinking = { type: 'adaptive', display: 'summarized' };
    body.output_config = { effort: depth };
  } else {
    // The pre-effort mechanism: a hard ceiling, no `display` field.
    body.thinking = { type: 'enabled', budget_tokens: spec.budgets[depth] };
  }

  const betas = [];
  if (spec.refusalFallback) {
    body.fallbacks = 'default';
    betas.push('server-side-fallback-2026-07-01');
  }

  return { body, betas };
}

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * OAuth 2.1 + PKCE.
 *
 * Anthropic does not currently publish a self-serve OAuth client registration
 * for third-party browser apps, so these are intentionally blank. If you have
 * been issued a client (or you point this at your own gateway that fronts the
 * Anthropic API), fill them in and the LOGIN button lights up automatically.
 *
 * With them blank the client falls back to two working modes:
 * With them blank the working path is the credential box: the user pastes their
 * own key or bearer token and it stays in their browser.
 */
export const OAUTH = {
  authorizeUrl: '',
  tokenUrl: '',
  clientId: '',
  scopes: 'user:inference',
  // Loopback/Pages redirect. Defaults to this very page.
  get redirectUri() {
    return window.location.origin + window.location.pathname;
  },
  get configured() {
    return Boolean(this.authorizeUrl && this.tokenUrl && this.clientId);
  },
};
