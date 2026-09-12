/**
 * Two ways to reach Claude. Both expose the same async-generator contract:
 *
 *   for await (const ev of transport.stream(messages, { signal })) { ... }
 *   ev = { type: 'thinking'|'text'|'notice', text } | { type: 'done' }
 *
 * HOLONET  — browser talks straight to api.anthropic.com with the user's own
 *            credential. No server, nothing for the host to see. Requires
 *            Anthropic to allow direct browser access for the credential.
 * BRIDGE   — browser talks to a Node process running the Claude Agent SDK,
 *            which brings tools, sessions and real OAuth. That process may be
 *            on the visitor's own machine, or it may be the very server that
 *            served this page (the container image does both jobs).
 */

import {
  requestShape,
  ANTHROPIC_BASE_URL,
  BRIDGE_CANDIDATES,
  BRIDGE_TOKEN,
} from './config.js';
import { SYSTEM_PROMPT } from './persona.js';
import { CredentialStore, ensureFresh } from './auth.js';
import {
  CLIENT_TOOLS,
  CLIENT_TOOL_NAMES,
  MAX_TOOL_USES,
  runTool,
  serverTools,
  toolBrief,
} from './tools.js';
import { currentModel, networkMode } from './config.js';

/**
 * The Anthropic SDK is vendored into this repo and served from our own origin
 * rather than pulled from a CDN at runtime.
 *
 * This is a security decision, not a preference. The SDK executes with full
 * access to the visitor's credential in browser storage, so loading it from a
 * third party would mean every visitor's key depends on that third party not
 * being compromised — and SRI cannot cover a CDN's dynamically generated ESM
 * bundles. Serving it ourselves lets the CSP be `script-src 'self'`.
 *
 * Regenerate with `npm run vendor` after bumping the dependency.
 */
let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= import('./vendor/anthropic-sdk.js').then((m) => m.default ?? m.Anthropic);
  return sdkPromise;
}

/* --------------------------------------------------------------- holonet -- */

export const holonet = {
  id: 'holonet',
  label: 'HOLONET DIRECT',

  async available() {
    return Boolean(CredentialStore.load());
  },

  async *stream(messages, { signal } = {}) {
    const Anthropic = await loadSdk();
    const cred = await ensureFresh(CredentialStore.load());
    if (!cred) throw new Error('No credential. Authenticate first.');

    const headers = CredentialStore.authHeaders(cred);
    const client = new Anthropic({
      baseURL: ANTHROPIC_BASE_URL,
      ...(cred.kind === 'oauth'
        ? { authToken: cred.access_token }
        : { apiKey: cred.value }),
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-dangerous-direct-browser-access': 'true',
        ...(headers['anthropic-beta'] ? { 'anthropic-beta': headers['anthropic-beta'] } : {}),
      },
    });

    yield* runTurn(client, messages, signal);
  },
};

/**
 * One user turn, which may take several API round trips.
 *
 * The model answers, and if it asked for a tool we run it, hand back the
 * result, and ask again — until it stops asking or hits MAX_TOOL_USES.
 *
 * `working` is local to this turn and deliberately thrown away afterwards.
 * app.js keeps only the final text in `conversation`, which is what makes
 * mid-conversation model switching safe: the tool_use/tool_result/thinking
 * blocks below must be replayed verbatim within a turn, but thinking blocks
 * are bound to the model that produced them, so persisting them across turns
 * would break a switch. The cost is that the model does not remember having
 * fetched something two turns ago — only what it said about it.
 */
async function* runTurn(client, messages, signal) {
  const working = [...messages];

  for (let used = 0; used <= MAX_TOOL_USES; used++) {
    const final = yield* runMessages(client, working, signal);

    // runMessages yields `done` itself on a terminal stop reason.
    if (!final) return;

    // A long server-tool run can pause the turn. Nothing is owed in reply —
    // the assistant content goes back as-is and the model picks up where it
    // left off. Without this the turn ends mid-search.
    if (final.stop_reason === 'pause_turn') {
      working.push({ role: 'assistant', content: final.content });
      continue;
    }

    if (final.stop_reason !== 'tool_use') return;

    // Only client tools need executing. A `web_search` that ran server-side is
    // already resolved in the content above, and answering it with a
    // tool_result would be a protocol error.
    const calls = final.content.filter(
      (b) => b.type === 'tool_use' && CLIENT_TOOL_NAMES.has(b.name),
    );
    if (!calls.length) {
      // stop_reason said tool_use but nothing addressed to us is in the
      // content. Returning beats looping on an identical request forever.
      yield { type: 'done' };
      return;
    }

    if (used === MAX_TOOL_USES) {
      yield {
        type: 'notice',
        text: `Datalink budget spent — ${MAX_TOOL_USES} requests in one turn is the ceiling.`,
      };
      yield { type: 'done' };
      return;
    }

    // Echo the assistant turn back verbatim, thinking blocks included.
    working.push({ role: 'assistant', content: final.content });

    const results = [];
    for (const call of calls) {
      if (signal?.aborted) return;
      yield { type: 'tool', phase: 'start', name: call.name, input: call.input };

      const output = await runTool(call.name, call.input ?? {});
      const failed = output.startsWith('ERROR:');

      yield {
        type: 'tool',
        phase: failed ? 'error' : 'done',
        name: call.name,
        input: call.input,
        // First line only: enough for the operator to see what happened
        // without dumping a fetched page into the transcript.
        summary: output.split('\n', 1)[0].slice(0, 160),
      };

      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: output,
        ...(failed ? { is_error: true } : {}),
      });
    }

    // Every result for a parallel batch goes back in ONE user message.
    // Splitting them teaches the model to stop calling tools in parallel.
    working.push({ role: 'user', content: results });
  }
}

/**
 * Issue one request, degrading gracefully if this account/endpoint does not
 * yet accept the newer beta parameters.
 *
 * The model and thinking depth are resolved per call rather than captured
 * once, so a visitor switching either takes effect on their next message.
 *
 * Returns the final message (for runTurn to inspect) and yields `done` itself
 * only on a terminal stop reason — a `tool_use` stop is the caller's to
 * continue, so emitting `done` there would close the UI mid-turn.
 *
 * @returns {Promise<object|null>} the final message, or null if it degraded
 *   and a recursive call already handled the turn.
 */
async function* runMessages(client, messages, signal, allowBetas = true) {
  const shape = requestShape();
  const mode = networkMode();
  const web = mode !== 'off' ? serverTools(currentModel()) : [];
  const client_ = mode === 'full' ? CLIENT_TOOLS : [];
  const tools = [...web, ...client_];

  const body = {
    ...shape.body,
    system: SYSTEM_PROMPT + toolBrief({ web: web.length > 0, client: client_.length > 0 }),
    messages,
    ...(tools.length ? { tools } : {}),
    ...(allowBetas && shape.betas.length ? { betas: shape.betas } : {}),
  };
  if (!allowBetas) delete body.fallbacks;

  // Only the refusal-fallback models need the beta endpoint; everything else
  // goes through the stable one, so a model without betas never pays for a
  // rejected beta round-trip.
  const useBeta = allowBetas && shape.betas.length > 0;

  let stream;
  try {
    stream = useBeta
      ? client.beta.messages.stream(body, { signal })
      : client.messages.stream(body, { signal });
  } catch (err) {
    if (useBeta && isBetaRejection(err)) {
      yield { type: 'notice', text: 'Refusal-fallback beta unavailable; proceeding without it.' };
      return yield* runMessages(client, messages, signal, false);
    }
    throw err;
  }

  // Server tools resolve inside the response, so the only way to show them as
  // they happen is to follow the block stream. Their arguments arrive as
  // input_json_delta like any other tool call, so accumulate per index and
  // report once the block closes.
  const serverCalls = new Map();

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const cb = event.content_block;
        if (cb?.type === 'server_tool_use') {
          serverCalls.set(event.index, { name: cb.name, json: '' });
        } else if (cb?.type === 'web_search_tool_result') {
          // Success content is a list of results; an error is a single object.
          // Indexing without checking would read `.length` off the error.
          const c = cb.content;
          yield Array.isArray(c)
            ? { type: 'tool', phase: 'done', name: 'web_search', server: true,
                summary: `${c.length} result${c.length === 1 ? '' : 's'}` }
            : { type: 'tool', phase: 'error', name: 'web_search', server: true,
                summary: c?.error_code ?? 'search failed' };
        } else if (cb?.type === 'web_fetch_tool_result') {
          const c = cb.content;
          yield c?.error_code
            ? { type: 'tool', phase: 'error', name: 'web_fetch', server: true,
                summary: c.error_code }
            : { type: 'tool', phase: 'done', name: 'web_fetch', server: true,
                summary: c?.url ?? 'retrieved' };
        }
        continue;
      }

      if (event.type === 'content_block_stop') {
        const call = serverCalls.get(event.index);
        if (call) {
          serverCalls.delete(event.index);
          let input = {};
          try {
            input = call.json ? JSON.parse(call.json) : {};
          } catch {
            // Partial JSON on an interrupted block: report the call anyway.
          }
          yield { type: 'tool', phase: 'start', name: call.name, server: true, input };
        }
        continue;
      }

      if (event.type !== 'content_block_delta') continue;
      const d = event.delta;
      if (d.type === 'thinking_delta') yield { type: 'thinking', text: d.thinking };
      else if (d.type === 'text_delta') yield { type: 'text', text: d.text };
      else if (d.type === 'input_json_delta' && serverCalls.has(event.index)) {
        serverCalls.get(event.index).json += d.partial_json ?? '';
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      yield {
        type: 'notice',
        text: 'The Dark Side clouds this request — it was declined by a safety classifier.',
      };
    }
    // Only a turn that is actually over gets `done`; runTurn continues both a
    // tool_use stop and a pause_turn, and emits it once the loop finishes.
    if (final.stop_reason !== 'tool_use' && final.stop_reason !== 'pause_turn') {
      yield { type: 'done' };
    }
    return final;
  } catch (err) {
    if (useBeta && isBetaRejection(err)) {
      yield { type: 'notice', text: 'Refusal-fallback beta unavailable; proceeding without it.' };
      return yield* runMessages(client, messages, signal, false);
    }
    throw decorate(err);
  }
}

function isBetaRejection(err) {
  if (err?.status !== 400) return false;
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes('fallback') || msg.includes('beta') || msg.includes('output_config');
}

/** Turn opaque network failures into something a user can act on. */
function decorate(err) {
  const msg = String(err?.message ?? err);
  if (err?.status === 401) {
    return new Error('Credential rejected. Your key or token is invalid or expired.');
  }
  if (err?.status === 429) {
    return new Error('Rate limited by the Imperial fleet. Wait, then try again.');
  }
  if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
    return new Error(
      'The browser could not reach api.anthropic.com — this is almost certainly CORS. ' +
        'Direct browser access may not be permitted for this credential. ' +
        'Switch to IMPERIAL BRIDGE mode (see README) and try again.',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/* ---------------------------------------------------------------- bridge -- */

export const bridge = {
  id: 'bridge',
  label: 'IMPERIAL BRIDGE',

  /**
   * The Agent SDK keeps conversation state server-side, so the bridge only
   * needs the newest turn plus this resume token. Without it every message
   * would start a fresh session and the construct would have no memory.
   */
  sessionId: undefined,

  /** Which candidate answered, once one has. */
  baseUrl: null,

  /** Whether that bridge demands a token — set by available(). */
  authRequired: false,

  /**
   * The model the bridge is configured with. The visitor cannot change this:
   * the bridge answers on the operator's credential, and the model lives in
   * its own config. The picker goes read-only and displays this instead.
   */
  model: null,

  reset() {
    this.sessionId = undefined;
  },

  /**
   * Probe the candidates in order and keep the first that reports it can
   * actually run a turn.
   *
   * `chat: false` matters as much as a failed request: a static deployment
   * serves this same console and answers /health, but has no agent behind it,
   * and treating that as a bridge would strand the visitor on a transport
   * that returns 501 for every message. The container image in static mode is
   * exactly that case.
   */
  async available() {
    for (const base of BRIDGE_CANDIDATES) {
      try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) continue;
        const info = await res.json();
        // `chat` is absent on bridges predating the static/bridge split; those
        // always had an agent, so treat undefined as yes.
        if (info?.chat === false) continue;
        this.baseUrl = base;
        this.authRequired = Boolean(info?.authRequired);
        this.model = info?.model ?? null;
        return true;
      } catch {
        // Unreachable, wrong protocol, timed out — try the next candidate.
      }
    }
    this.baseUrl = null;
    return false;
  },

  async *stream(messages, { signal } = {}) {
    const base = this.baseUrl ?? BRIDGE_CANDIDATES[0];
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // A bridge reachable beyond loopback requires this; a local one
        // ignores it. Sending it unconditionally keeps the two paths identical.
        ...(BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ messages, sessionId: this.sessionId }),
      signal,
    });
    if (res.status === 401) {
      throw new Error(
        'The bridge rejected your access token. Set it with ' +
          "localStorage.setItem('v4d3r.bridgeToken', '…') and reload.",
      );
    }
    if (!res.ok || !res.body) {
      throw new Error(`Bridge refused the transmission (${res.status}): ${await res.text()}`);
    }

    for await (const ev of readSse(res.body, signal)) {
      if (ev.type === 'session') {
        this.sessionId = ev.sessionId;
        continue;
      }
      yield ev;
    }
  },
};

/** Minimal SSE reader — the bridge speaks `data: {json}\n\n`. */
async function* readSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!frame.startsWith('data:')) continue;

        const payload = frame.slice(5).trim();
        if (payload === '[DONE]') {
          yield { type: 'done' };
          return;
        }
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch {
          continue;
        }
        if (ev.type === 'error') throw new Error(ev.message);
        yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const TRANSPORTS = { holonet, bridge };
