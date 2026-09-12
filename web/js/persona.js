/**
 * HOLOCRON — shared prompt material.
 *
 * The characters themselves live in characters.js. What stays here is what
 * every one of them needs regardless of who is speaking: the operator's clock.
 */

export function clockBlock() {
  const now = new Date();
  let zone = 'unknown';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    // Ancient or locked-down engine; the ISO stamp below still carries offset.
  }

  return [
    'CURRENT TIME',
    `- The operator's local time is ${now.toLocaleString(undefined, {
      dateStyle: 'full',
      timeStyle: 'long',
    })}.`,
    `- Their time zone is ${zone}. UTC now is ${now.toISOString()}.`,
    '- This is read from the operator\'s own device at the moment they sent the message, so it is authoritative. Answer questions about the date or time from it directly. Never search the web for the current time: pages that display a clock build it in the browser, so their text contains no time at all, and you will come back with nothing.',
    '- Use it to reason about recency too — whether a thing you recall is stale, how old a search result is.',
  ].join('\n');
}
