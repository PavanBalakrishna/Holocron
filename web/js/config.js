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
 */
export const MODELS = {
  'claude-opus-5': {
    label: 'Opus 5',
    blurb: 'Deepest reasoning',
    thinking: 'adaptive',
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultLevel: 'low',
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

/** Model id the visitor has chosen, falling back to the default. */
export function currentModel() {
  const stored = localStorage.getItem('v4d3r.model');
  return stored && MODELS[stored] ? stored : DEFAULT_MODEL;
}

/**
 * Depth the visitor has chosen, coerced to something the current model
 * actually accepts — a stored `max` must not survive a switch to Haiku.
 */
export function currentLevel(model = currentModel()) {
  const spec = MODELS[model];
  const stored = localStorage.getItem('v4d3r.level');
  return stored && spec.levels.includes(stored) ? stored : spec.defaultLevel;
}

export function setModel(model) {
  if (MODELS[model]) localStorage.setItem('v4d3r.model', model);
}

export function setLevel(level) {
  localStorage.setItem('v4d3r.level', level);
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
 *   1. the user pastes their own key / bearer token (stays in their browser)
 *   2. IMPERIAL BRIDGE — a local Node process doing real OAuth (see server/)
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

/**
 * Where to look for an Agent SDK bridge, in order.
 *
 * A pinned `v4d3r.bridgeUrl` wins outright and nothing else is probed — if you
 * named a bridge, silently answering from a different one would be wrong.
 * Otherwise we try this page's own origin first, which is how the container
 * image serves things (one process, console and bridge, no CORS), and fall
 * back to a bridge on the visitor's own machine, which is how a GitHub Pages
 * deployment reaches one.
 */
export const BRIDGE_CANDIDATES = (() => {
  const pinned = localStorage.getItem('v4d3r.bridgeUrl');
  if (pinned) return [pinned.replace(/\/+$/, '')];

  const candidates = ['http://127.0.0.1:8787'];
  // file:// has origin "null", and a page served over https must not be sent
  // looking for an http bridge on its own host.
  if (/^https?:$/.test(window.location.protocol)) {
    // The directory this page sits in, not the domain root: on a GitHub Pages
    // *project* site the console lives at /REPO/, and probing the root would
    // be knocking on a different repo's site. A bridge that serves this page
    // serves it from its own base, so this is right in both deployments.
    candidates.unshift(new URL('.', window.location.href).href.replace(/\/+$/, ''));
  }
  return [...new Set(candidates)];
})();

/** First candidate — what the UI names before anything has been probed. */
export const BRIDGE_URL = BRIDGE_CANDIDATES[0];

/**
 * Optional shared secret for a bridge that requires one (any bridge exposed
 * beyond loopback should). Stored per-browser, sent as a bearer token, never
 * committed anywhere: this file ships publicly.
 */
export const BRIDGE_TOKEN = localStorage.getItem('v4d3r.bridgeToken') || '';
