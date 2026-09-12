/**
 * LORD-V4D3R — voice, using only what the browser already has.
 *
 * Two halves, with very different properties, and the difference is worth
 * knowing before you enable either:
 *
 *   SPEAKING (speechSynthesis) runs entirely on the operator's machine with
 *   their OS voices. No network, no cost, no third party. Supported
 *   everywhere, though a bare Linux install may have no voices installed at
 *   all, in which case there is nothing to do but say so.
 *
 *   LISTENING (SpeechRecognition) is NOT local in Chrome: the audio is sent to
 *   Google for transcription. On a page whose whole claim is that the
 *   operator's credential never leaves their browser, that deserves an
 *   explicit opt-in rather than a quiet toggle. Firefox does not implement it
 *   at all.
 *
 * On the voice itself: this is a deep, slow, synthetic rasp, not an impression
 * of Darth Vader. The browser cannot do the timbre, the rasp or the breathing.
 * Pitch floored and rate slowed is the whole trick.
 */

import { voiceSettings } from './config.js';

const SYNTH = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const Recognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
    : null;

export const canSpeak = Boolean(SYNTH);
export const canListen = Boolean(Recognition);

/* ----------------------------------------------------------------- voice -- */

/**
 * The Web Speech API does not expose a voice's gender. There is no flag, no
 * hint, nothing — only a name, a language and a `default` boolean. So matching
 * a masculine voice for a character who has one can only ever be a guess made
 * from names, which is why these lists exist and why the picker still shows
 * everything.
 *
 * MASCULINE: known male English voices across macOS, Windows, Chrome, Android
 * and espeak, best first. Substrings, because vendors decorate names
 * ("Microsoft David Desktop - English (United States)").
 */
const MASCULINE = [
  'Google UK English Male',
  'Microsoft David',
  'Microsoft Mark',
  'Microsoft Guy',
  'Microsoft Ryan',
  'Microsoft George',
  'Microsoft Christopher',
  'Microsoft Eric',
  'Microsoft Roger',
  'Microsoft Liam',
  'Microsoft William',
  'Microsoft Thomas',
  'Daniel',
  'Alex',
  'Oliver',
  'Rishi',
  'Aaron',
  'Gordon',
  'Reed',
  'Lee',
  'Tom',
  'Fred',
  'Rocko',
  'Arthur',
  // Android's TTS engine names voices like `en-us-x-sfg#male_1-local`, so the
  // gender marker is in the id rather than a human name. This must be a regex,
  // not the substring 'male': "female" CONTAINS "male", and as a plain
  // substring this entry matched every feminine Android voice and ranked it
  // masculine — which is exactly how Chrome on Android kept picking one.
  // `[^a-z]` under /i excludes A-Z too, so the 'e' of "female" blocks it.
  /(?:^|[^a-z])male/i,
];

/**
 * FEMININE: names to step over when falling back, so "the first English voice"
 * does not hand a Vader console Samantha or Zira — which is exactly what it did
 * before this list existed. Only used to DEPRIORITISE; every voice stays
 * selectable in the picker.
 */
const FEMININE = [
  'Samantha', 'Victoria', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Allison', 'Ava',
  'Susan', 'Vicki', 'Kathy', 'Nicky', 'Joana', 'Serena', 'Catherine',
  'Microsoft Zira', 'Microsoft Hazel', 'Microsoft Eva', 'Microsoft Aria',
  'Microsoft Jenny', 'Microsoft Michelle', 'Microsoft Sonia', 'Microsoft Natasha',
  'Microsoft Clara', 'Microsoft Libby', 'Microsoft Maisie', 'Microsoft Ana',
  'Google UK English Female', 'Google US English',
  /(?:^|[^a-z])female/i,
];

/** Entries may be a substring or a regex; both are matched case-insensitively. */
const matches = (name, token) =>
  token instanceof RegExp ? token.test(name) : name.toLowerCase().includes(token.toLowerCase());

const isFeminine = (v) => FEMININE.some((t) => matches(v.name, t));

const masculineRank = (v) => {
  // Feminine wins outright. Belt and braces alongside the regex above: a voice
  // that somehow satisfies both lists must not be ranked masculine.
  if (isFeminine(v)) return Number.MAX_SAFE_INTEGER;
  const i = MASCULINE.findIndex((t) => matches(v.name, t));
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

let chosen = null;
let voicesReady = false;

function pickVoice() {
  if (!SYNTH) return null;
  const all = SYNTH.getVoices();
  if (!all.length) return null;

  voicesReady = true;

  // An explicit choice wins outright. If that voice has since disappeared —
  // a different machine, an uninstalled language pack — fall through rather
  // than go silent.
  const { name } = voiceSettings();
  if (name) {
    const exact = all.find((v) => v.name === name);
    if (exact) return exact;
  }

  const english = all.filter((v) => /^en/i.test(v.lang));

  // A named masculine voice, in preference order.
  const ranked = english
    .filter((v) => masculineRank(v) !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => masculineRank(a) - masculineRank(b));
  if (ranked.length) return ranked[0];

  // Otherwise any English voice NOT on the feminine list. This step is the
  // whole point: the previous version took english[0], which on macOS is
  // Samantha and on Windows is Zira.
  const neutral = english.find((v) => !isFeminine(v));
  if (neutral) return neutral;

  // Out of options. An English voice of any kind still beats a voice applying
  // another language's phonology to English text.
  return english[0] ?? all[0] ?? null;
}

/**
 * Voices worth offering, English first.
 *
 * The full list on some systems runs to a hundred entries in languages the
 * console does not speak, so English leads and the rest follow rather than
 * being hidden — somebody may genuinely want a different one.
 */
export function listVoices() {
  if (!SYNTH) return [];
  const all = SYNTH.getVoices();
  const english = all.filter((v) => /^en/i.test(v.lang));
  const rest = all.filter((v) => !/^en/i.test(v.lang));

  // Likely-masculine English voices first, then the other English ones, then
  // everything else. The operator cannot tell gender from a name they have
  // never heard either, so ordering the list is the only help available.
  const score = (v) => (masculineRank(v) !== Number.MAX_SAFE_INTEGER ? 0 : isFeminine(v) ? 2 : 1);
  english.sort((a, b) => score(a) - score(b) || masculineRank(a) - masculineRank(b));

  return [...english, ...rest];
}

/**
 * Call back once the engine has published its voice list.
 *
 * getVoices() is empty on first call in most browsers, so any UI that lists
 * voices has to be built twice: once optimistically, once when this fires.
 */
export function onVoicesReady(cb) {
  if (!SYNTH) return;
  if (SYNTH.getVoices().length) {
    cb();
    return;
  }
  SYNTH.addEventListener?.('voiceschanged', () => cb(), { once: true });
  // Safari has been known not to fire the event at all.
  setTimeout(() => {
    if (SYNTH.getVoices().length) cb();
  }, 1500);
}

/** Re-resolve the voice after the operator changes their choice. */
export function refreshVoice() {
  chosen = pickVoice();
  return chosen;
}

if (SYNTH) {
  chosen = pickVoice();
  // getVoices() is empty until the engine has loaded on most browsers.
  SYNTH.addEventListener?.('voiceschanged', () => {
    chosen = pickVoice();
  });
}

/** What the operator's machine will actually use, for display. */
export function voiceName() {
  if (!SYNTH) return 'unsupported';
  if (!chosen) chosen = pickVoice();
  if (!chosen) return voicesReady ? 'none installed' : 'loading…';
  return chosen.name;
}

/* ------------------------------------------------------------- speak text -- */

/**
 * Reduce markdown to something worth hearing.
 *
 * Read aloud, `**bold**` becomes "asterisk asterisk bold" and a URL becomes a
 * minute of punctuation. Link text is kept and the target dropped, headings
 * lose their hashes, and fenced code is removed entirely by the caller —
 * nobody wants forty lines of JavaScript recited.
 */
export function speakable(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when an odd number of fences precede this point, i.e. inside code. */
function insideFence(text, index) {
  let count = 0;
  for (let i = text.indexOf('```'); i !== -1 && i < index; i = text.indexOf('```', i + 3)) {
    count += 1;
  }
  return count % 2 === 1;
}

let speaking = false;

/** Queue one utterance. Silently does nothing when there is no engine. */
export function speak(text) {
  if (!SYNTH) return;
  const words = speakable(text);
  if (!words) return;

  const u = new SpeechSynthesisUtterance(words);
  if (!chosen) chosen = pickVoice();
  if (chosen) u.voice = chosen;
  // Low and slow is the entire effect. Both are the operator's to tune — a
  // floored pitch on a bright voice sounds damaged rather than deep, so the
  // right value depends on which voice their machine actually has.
  const { pitch, rate } = voiceSettings();
  u.pitch = pitch;
  u.rate = rate;
  u.volume = 1;
  u.onstart = () => {
    speaking = true;
  };
  u.onend = u.onerror = () => {
    speaking = SYNTH.speaking;
  };
  SYNTH.speak(u);
}

export function stopSpeaking() {
  if (SYNTH) SYNTH.cancel();
  speaking = false;
}

export function isSpeaking() {
  return Boolean(SYNTH?.speaking) || speaking;
}

/* ------------------------------------------------- streaming sentence feed -- */

/**
 * Speaks a streaming reply sentence by sentence, so the voice starts with the
 * first full clause instead of after the whole answer.
 *
 * Chunking happens on the RAW markdown and stripping happens per chunk, which
 * keeps the index arithmetic honest — stripping first would shift every offset
 * and desynchronise the cursor from the text being appended.
 */
export function createSpeechFeed() {
  let raw = '';
  let spoken = 0;

  return {
    /** Add newly streamed text and speak any complete sentences it finished. */
    push(delta) {
      raw += delta;
      // Scan only the unspoken tail, and take the LAST boundary in it so a
      // burst of deltas carrying several sentences speaks as one utterance
      // rather than a stutter of fragments.
      const tail = raw.slice(spoken);
      const re = /[.!?](?=\s)|\n\n/g;
      let cut = -1;
      let m;
      while ((m = re.exec(tail)) !== null) cut = m.index + m[0].length;
      if (cut <= 0) return;

      const chunk = tail.slice(0, cut);
      const at = spoken;
      spoken += cut;
      if (!insideFence(raw, at)) speak(chunk);
    },

    /** Speak whatever is left once the turn is over. */
    flush() {
      const rest = raw.slice(spoken);
      spoken = raw.length;
      if (rest.trim() && !insideFence(raw, raw.length - rest.length)) speak(rest);
    },
  };
}

/* --------------------------------------------------------------- listening -- */

/**
 * One dictation session.
 *
 * Resolves with the transcript rather than submitting it: a misheard phrase
 * sent automatically costs the operator a real API call, so the text lands in
 * the composer for review instead.
 */
export function listen({ onInterim, onEnd } = {}) {
  if (!Recognition) {
    return { start() {}, stop() {}, supported: false };
  }

  const rec = new Recognition();
  rec.lang = navigator.language || 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim?.((finalText + interim).trim());
  };

  rec.onerror = (ev) => onEnd?.({ error: ev.error, text: finalText.trim() });
  rec.onend = () => onEnd?.({ text: finalText.trim() });

  return {
    supported: true,
    start() {
      try {
        rec.start();
      } catch {
        // start() throws if already running; harmless.
      }
    },
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
