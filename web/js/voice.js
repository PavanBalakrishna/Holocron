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

const SYNTH = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const Recognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
    : null;

export const canSpeak = Boolean(SYNTH);
export const canListen = Boolean(Recognition);

/* ----------------------------------------------------------------- voice -- */

/**
 * Voices the OS is most likely to make sound imposing, best first. Matched as
 * substrings because vendors decorate the names ("Microsoft David Desktop").
 * A miss is not a failure: we fall through to any English voice, then to the
 * browser default, which still gets pitch and rate applied.
 */
const PREFERRED = [
  'Google UK English Male',
  'Microsoft David',
  'Microsoft Guy',
  'Daniel',
  'Alex',
  'Rishi',
  'Oliver',
  'Fred',
];

let chosen = null;
let voicesReady = false;

function pickVoice() {
  if (!SYNTH) return null;
  const all = SYNTH.getVoices();
  if (!all.length) return null;

  voicesReady = true;
  for (const want of PREFERRED) {
    const hit = all.find((v) => v.name.includes(want));
    if (hit) return hit;
  }
  // Anything English beats a voice speaking English text in another language's
  // phonology.
  return all.find((v) => /^en/i.test(v.lang)) ?? all[0] ?? null;
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
  // The floor of the allowed range, and slow. This is the entire effect.
  u.pitch = 0.1;
  u.rate = 0.85;
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
