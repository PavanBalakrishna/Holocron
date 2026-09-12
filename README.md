# HOLOCRON

> *"Come to learn, you have. Good. Begin, we shall."*

A holocron is the Star Wars device that stores a master's knowledge and manifests their personality to answer you. This one is powered by Claude, runs entirely in your browser, and holds five of them.

| Character | You are their | Register |
|---|---|---|
| **Lord Vader** | Emperor — he serves *you* | cold, absolute, obedient |
| **Master Yoda** | student | teaches as well as answers |
| **Obi-Wan Kenobi** | Padawan | warm, exacting, dryly amused |
| **Luke Skywalker** | fellow pilot | plain, earnest, no ceremony |
| **Chewbacca** | cub | pure Shyriiwook — no English, no answer |

Pick one from the header and the console follows: system prompt, how you are addressed, palette, emblem, greeting, and the pitch and rate of the voice. Switching clears the conversation — a holocron holds one personality at a time, and replaying one character's words as another's would be a lie to the model as much as to you.

**Chewbacca is a gag, and only a gag.** He replies in Shyriiwook and nothing else: no translation, no bracketed gloss, no helpful note at the end. Length and heat are his only instruments — a short "Wgh." is a different answer from a long rolling roar. He will not help you, and that is the point.

He is the one character who does not inherit the shared substance rules, because "the persona is delivery, accuracy is not negotiable" directly contradicts answering in growls. What he inherits instead keeps the two things that matter: **ask him to speak English or drop the act and he complies immediately and fully**, and if someone is in genuine distress he drops the character entirely. A joke nobody can escape stops being one.

---

## What this is

**A static browser app. There is no server anywhere in it.**

| | |
|---|---|
| Runtime | Anthropic Messages API via `@anthropic-ai/sdk`, vendored into `web/js/vendor/` |
| Auth | the visitor's own key or bearer token, stored in *their* browser |
| Tools | `web_search` + `web_fetch` (hosted by Anthropic) and `http_request` (this browser's `fetch`) |
| Build step | none — `web/` is dependency-free ES modules |
| Hosting | anything that serves files: GitHub Pages, Render static, S3, a USB stick |

Every request goes from the visitor's browser straight to `api.anthropic.com`. Whoever hosts the page never sees a credential, never pays for a turn, and runs no code.

> **Previously** this repo also shipped an "Imperial Bridge" — a local Node process running the Claude Agent SDK, with filesystem tools, OAuth and a Docker/Render deployment. That half has been removed. If you want it, it is in the git history: `git log -- server/`.

### What you give up without the bridge

Worth knowing, since it is a real trade and not a free simplification:

- **No filesystem tools.** The Agent SDK's `Read`/`Glob`/`Grep` are gone. The model can read the web, not your disk.
- **No server-side OAuth.** Only the browser PKCE flow remains, and it stays dormant until you supply endpoints (see *OAuth, honestly* below).
- **No sessions.** Conversation state lives in the page and dies with the tab.
- **`http_request` is CORS-bound.** A browser fetch only reads sites that allow it. The hosted `web_search`/`web_fetch` have no such limit, which is why both exist.

---

## Quick start

```bash
npm install          # esbuild + the SDK, both build-time only
npm run web          # → http://127.0.0.1:8080
```

`npm run web` is a ~50-line zero-dependency static file server (`scripts/serve.js`), serving `web/` exactly as a host will. Nothing in `node_modules` is needed at runtime — `npm install` exists only so `npm run vendor` can rebuild the SDK bundle after a version bump.

Then click **Credentials** and paste an Anthropic API key. It is stored in `sessionStorage` by default, or `localStorage` if you tick "remember", and is sent only to Anthropic.

---

## Deploying

### Render (static)

`render.yaml` declares a **static site**, not a container. Render → New → Blueprint → pick the repo.

Being static rather than a web service is a real upgrade over the Docker deployment this replaces: **no spin-down, so no cold start**, no instance hours consumed, and it is served from Render's CDN. The blueprint also sets the CSP and a couple of hardening headers at the edge, mirroring the page's own meta tag.

### GitHub Pages

`.github/workflows/deploy-pages.yml` publishes `web/` verbatim on every push to `main`. There is no build step, and it publishes `web/` specifically rather than the repository root, so `scripts/` and `package.json` stay off the public site.

**Two things to do, once each:**

1. **Settings → Pages → Source: GitHub Actions.** Until you do this the workflow runs and fails at the deploy step, because there is no Pages site to deploy to.
2. **Get your work onto `main`.** The workflow only triggers on `main` (plus manual runs from the Actions tab). A feature branch will not publish.

Your site lands at `https://YOURNAME.github.io/YOURREPO/`. The console uses relative paths throughout, so it works from that subdirectory with no configuration.

### Anywhere else

`web/` is a folder of static files. Any host will do. Nothing in it reads an environment variable, so there is nothing to configure per host.

### The one caveat worth setting expectations on

The page sends requests to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`. **If Anthropic does not permit direct browser access for a given credential, the request fails CORS** — and with no bridge to fall back to, that is the end of the road for that credential. The app detects this specific failure and says so in those words rather than showing a generic error, and suggests trying an API key instead of an OAuth token.

**Test it with your own key before telling people the hosted page works.** This is account-dependent and not something the code can fix.

## OAuth, honestly

The app implements a complete, standards-correct OAuth 2.1 Authorization Code + PKCE flow in the browser (`web/js/auth.js`). PKCE is precisely the flow that needs no client secret, which is what makes it viable on a page whose source everybody can read.

What it does **not** ship with is endpoints, because **Anthropic does not currently publish self-serve OAuth client registration for third-party apps.** The `client_id` that Claude Code itself uses is a first-party client; pointing this app at it would mean impersonating Claude Code, so this repo does not do that.

So the OAuth path is wired and waiting. Fill in the `OAUTH` block in `web/js/config.js` if you are issued a client, or if you point it at your own gateway fronting the Anthropic API — the "Sign in with OAuth" button un-greys itself automatically, and you will also need to add your token endpoint to `connect-src`. Until then the working path is the credential box.

---

## Layout

```
web/                      ← the whole application
  index.html
  css/styles.css
  js/characters.js        ← THE five characters: prompts, labels, palettes, voices
  js/persona.js           ← the operator's clock, shared by all of them
  js/config.js            ← models, depths, network + voice settings
  js/auth.js              ← credential store + browser PKCE
  js/tools.js             ← hosted search/fetch defs + the browser fetch tool
  js/transport.js         ← the request and the tool loop
  js/voice.js             ← speechSynthesis + SpeechRecognition
  js/app.js               ← DOM, streaming, markdown
  js/vendor/              ← generated by `npm run vendor`, commit it
scripts/
  serve.js                ← zero-dependency local preview
  vendor-entry.js         ← bundle entry point
render.yaml               ← Render static-site blueprint
.github/workflows/        ← Pages deploy
```

## Model configuration

**On Holonet Direct the visitor picks.** Two selectors sit in the header — model, and how deeply it reasons. The visitor's own credential pays for the turn, so the choice and its cost belong to them. Both persist per browser (`v4d3r.model`, `v4d3r.level`).

| Model | Depths offered | Depth default |
|---|---|---|
| `claude-haiku-4-5` **← default** | Shallow → Deep | Measured |
| `claude-sonnet-5` | Shallow → Absolute | Shallow |
| `claude-opus-5` | Shallow → Absolute (`low`…`max` effort) | Shallow |

**Haiku 4.5 is the default** because every turn is billed to whoever is visiting, and a Star Wars character holding a conversation is not work that repays a frontier model. Anyone who wants more is one dropdown away. The reasoning itself is rendered in a collapsible **MEDITATION** panel, which is why adaptive thinking is requested with `display: "summarized"` — the API default, `"omitted"`, streams empty thinking blocks and reads as a dead pause.

**The request shape is not portable between models, which is why `MODELS` in `web/js/config.js` is a table rather than one shared params object.** Send Opus 5's parameters to Haiku 4.5 and you get a 400, not a worse answer: Haiku rejects `output_config.effort` outright, and has no adaptive thinking — reasoning there is the older fixed `budget_tokens` ceiling. So each row declares the depths it supports and how they translate, and `requestShape()` assembles the body. Adding a model is one row. Haiku also offers no Profound/Absolute, because those are effort levels and it has no effort parameter; a stored depth that a newly selected model can't accept is coerced at selection time, not at request time.

Switching model mid-conversation is safe and needs no reset. Thinking blocks are bound to the model that produced them and are silently dropped if replayed elsewhere — but the transcript sent back to the API holds plain text only, so there is nothing to lose.

The selectors are greyed out until a credential exists, since there is nothing to spend until then.

## Live network access

Two kinds, and the difference is **where the request comes from**:

| | Runs on | Reaches | Costs | Reveals |
|---|---|---|---|---|
| `web_search`, `web_fetch` | Anthropic's servers | anything — CORS does not apply | billed per search, on top of tokens | Anthropic's address |
| `http_request` | the visitor's browser | CORS-enabled URLs only | tokens only | the **visitor's own IP** to whatever it reads |

The **DATALINK** selector in the header chooses between them: `full` (both), `search` (hosted only — the web without handing your address to it), `off` (neither). Whatever is off is stripped from both the tools array *and* the system briefing, so the model never describes a search it could not have run.

Every call appears in the transcript, amber for hosted and blue for browser-side, with its query or URL and the outcome.

### Why both

`web_search` is the answer to "can it Google things" — yes, because no browser is involved. `web_fetch` then retrieves any URL already named in the conversation.

`http_request` earns its place for APIs, and for anything where the visitor's own network position is the point. It is defined in `web/js/tools.js`: HTML is reduced to text, bodies cap at 120K characters, requests time out at 15s, and a turn allows at most 8 calls.

### CORS decides what `http_request` can read

A browser `fetch()` only succeeds if the target sends `Access-Control-Allow-Origin`. Public JSON APIs usually do. Ordinary web pages usually do not — `google.com/search` and `example.com` both refuse. **This is the browser's rule and no code here changes it.**

Measured, for calibration: `api.github.com/rate_limit` sends `ACAO: *` and works; `api.github.com/zen` sends none and fails. Same host, different endpoint.

The tool therefore tells the model, in the failure string itself, that a failed fetch means the page is unreadable from a browser and that it should reach for `web_fetch` instead — and must never invent the contents. That instruction is load-bearing: the alternative failure mode is a confident summary of a page nobody read.

### The model is told the time

`clockBlock()` in `web/js/persona.js` puts the operator's local date, time and time zone into every request, as a second system block after the persona.

This is not a nicety — without it the model has **no clock at all**, and "what time is it" cannot be answered. Search does not rescue it either: pages that display a clock build it in JavaScript, so the text a search returns contains no time. The browser already knows the answer exactly, so it hands it over and the prompt tells the model never to search for it.

It is a separate block on purpose. The persona is stable for a session and the clock changes every request, so when a `cache_control` breakpoint is eventually added to the persona block, the volatile half is already on the correct side of it.

A turn that spends tool calls and then returns no text now says so, rather than rendering an ellipsis that looks like a broken app.

### Model-gated tool versions

The hosted tools are versioned types, not assumed capabilities. `web_search_20260209` / `web_fetch_20260209` (with dynamic filtering) need Opus 4.6+ or Sonnet 4.6+; Haiku 4.5 takes the earlier `web_search_20250305` / `web_fetch_20250910`. Naming a version a model does not accept is a request error, so the pair lives in the same `MODELS` table as everything else model-specific. The 20260209 variants run code execution internally, which is why `code_execution` is deliberately *not* declared alongside them.

### What this costs you, stated plainly

`http_request` required widening the CSP from `connect-src 'self' https://api.anthropic.com …` to include `https:`. That directive was the control that left an injected script with **nowhere to send a stolen API key**, and a wildcard removes it. There is no version of browser-side fetch that keeps it.

Note the asymmetry: **the hosted tools cost you none of this.** They need no CSP change at all, because the page only ever talks to `api.anthropic.com`. If you want search without giving that up, set `connect-src` back to `https://api.anthropic.com` and run the selector on `search` — `web_search` and `web_fetch` keep working and `http_request` fails closed.

What still stands:

- **`script-src` is still `'self'`.** No third-party script can get onto the page to begin with; `connect-src` was defence in depth behind that, not the front line.
- **`https:` only** — no plaintext exfiltration, and `http://` targets are refused by the CSP.
- **The tool refuses `api.anthropic.com`**, so it cannot be turned into a way to replay the visitor's own credential.
- **The tool refuses loopback and private address space** (`127.0.0.0/8`, `10/8`, `192.168/16`, `172.16/12`, `169.254/16`, `*.local`). A visitor's own network is not the web: a router admin page or an unauthenticated dev server is exactly what fetched text should not be able to reach through them. It is a hostname check, so a DNS name resolving into private space still gets through — the browser's CORS rules are the real defence; this is the cheap first line.
- **No credentials are ever attached.** `credentials: 'omit'`, and the only header the model can influence is `Content-Type` on a POST.
- **Fetched content is never rendered as the assistant's own words.** Tool rows are built with `textContent`, and the body never reaches the markdown renderer.

**Prompt injection is the honest residual risk**, and it applies to search results as much as to fetched pages: untrusted text entering the context of a model that can fetch again. The persona prompt tells it to treat retrieved content as data and to report any instructions it finds rather than obey them, which is mitigation, not a guarantee. The blast radius is bounded by the fact that every tool the model has is an outbound request that never carries a credential.

If you do not want any of this: set the DATALINK selector to `off`, or set `connect-src` back to `https://api.anthropic.com` in `web/index.html` to disable the browser half specifically. Either way it fails closed — the model is told the request failed, and nothing else breaks.

## Voice

Off by default. The **VOICE** selector offers `speak` (the construct talks) and `speak + listen` (a microphone button appears in the composer). Both halves use only what the browser already has — no extra service, no second API key, no CSP change.

**Set expectations before you enable it: this is not Vader's voice.** `speechSynthesis` uses the voices your operating system ships, and none of them is James Earl Jones. The default is pitch `0.1` and rate `0.85` on the deepest voice available, which reads as a slow, ominous android. Atmospheric, and honestly labelled as such in the UI. The rasp, the timbre and the breathing are not reachable from a browser.

### Tuning it — the VOCODER panel

Because the voice list is machine-specific, the right settings are too, so they are the visitor's to choose rather than hardcoded. A **Vocoder** button appears beside the selector whenever voice is on, opening a panel with:

- every voice the machine reports, English first, each labelled with its language — a German voice reading English is unintelligible, and the name alone does not always give that away
- **pitch** (0–2) and **rate** (0.5–2) sliders
- a line spoken on every change, so you tune by ear rather than by guessing

**Tune the voice first, then the pitch.** A floored pitch on a bright voice sounds *damaged*, not deep — if the best your system offers is cheerful, try `0.4`–`0.5` rather than `0.1`. Reset restores the defaults.

Choices persist per browser (`v4d3r.voiceName`, `v4d3r.voicePitch`, `v4d3r.voiceRate`). A stored voice that is missing on the current machine stays visible in the list as "not installed here" rather than silently reverting, and speech falls back to the automatic pick so it never goes mute. If the system reports no voices at all — a bare Linux box — the panel says so, and says what is usually missing.

`Automatic` uses the name-matching in `web/js/voice.js`, which is only a default; an explicit choice always wins.

Every utterance carries `lang` as well as `voice`. That is not redundant: **Chrome for Android ignores `voice` on its own** and speaks with the engine default unless the utterance also has a matching `lang`, which makes a hand-picked voice look like it did nothing.

### When the voice will not change

The panel has a **Diagnostics** block (what the engine reports, what is stored, what resolved, and every English voice tagged M/F/unknown) and an **A/B test** button that speaks one line in two deliberately different voices.

That button is the decisive check. **If both sound identical, the browser is ignoring the page's choice** and using the system default — a known behaviour of Chrome on Android, and not something a web page can override. The voice then lives in the OS: Android Settings → Accessibility (or General management) → Text-to-speech output. If they sound different, voice switching works and the problem is the selection, which Diagnostics will show.

**Some devices expose no gender at all.** Samsung's TTS engine — the default on Samsung phones — ships a single voice per language and reports them by locale alone: "English Australia", "English United Kingdom". No marker, nothing to infer from, and no male alternative on offer; its settings screen has no voice picker either, only rate and pitch. Switching the device's preferred engine to Google Text-to-speech is the actual fix, after which voices arrive labelled by gender and the automatic pick works. When the panel detects this it says so plainly instead of implying the picker can fix it: the accent is selectable, the speaker is not, and the real setting is Android's own *Text-to-speech output → Install voice data*. (Those devices also report locales with underscores, `en_AU` rather than `en-AU`, so locale comparisons are normalised — otherwise every locale test fails on exactly the devices that need it.)

**A caveat for Android:** Chrome there reports voices by engine id — `en-us-x-sfg#male_1-local` — so the gender marker is in the id rather than a human name. Those are matched by regex, not substring, because *"female" contains "male"* and a naive `includes('male')` ranks every feminine Android voice as masculine. Some Android setups report only a locale (`English (United States)`) with no marker at all; nothing can be inferred there, so pick from the panel.

**On gender: the Web Speech API does not expose it.** A voice has a name, a language and a `default` flag — no gender field, no hint. So matching a masculine voice for a character who has one can only be guessed from names, which is what `MASCULINE` and `FEMININE` in `voice.js` are for. The first list ranks known male voices across macOS, Windows, Chrome, Android and espeak; the second exists only so the fallback steps *over* names like Samantha and Zira instead of taking the first English voice, which is how a Vader console ended up sounding like a woman. Neither list filters the picker — every voice your system has stays selectable, and likely-masculine ones are simply sorted to the top, since you cannot tell gender from a name you have never heard either.

### Speaking

Spoken per sentence as the reply streams, so the voice starts on the first complete clause instead of after the whole answer. Markdown is reduced before speaking — `**bold**` read aloud is "asterisk asterisk bold", and a URL is a minute of punctuation — and **fenced code blocks are skipped entirely**, because nobody wants forty lines of JavaScript recited. Halt, Purge, a new message, or switching the selector all cut the voice off immediately.

### Conversation mode

`Voice conversation` is hands-free. Tap the microphone once and:

1. you speak, and the transcript appears in the composer as you go
2. **two seconds of silence sends it** — no button
3. the microphone closes for the whole turn
4. the reply streams and is spoken
5. the microphone reopens, and you carry on

The microphone closing during the turn is not incidental. Speech synthesis and recognition running together means the page transcribes the character's own voice straight back as your next question, so the loop only reopens once the speech queue has drained — which is also why `speak()` counts outstanding utterances rather than guessing from a timer.

Two seconds is measured from the last *result*, interim ones included, so a pause for breath mid-sentence does not send. Anything that ends the loop ends it properly: tapping the microphone, Halt, Purge, switching character, or changing the voice setting. If three reopenings hear nothing at all it gives up and says so, rather than leaving a live microphone open indefinitely.

**Auto-send means a misheard sentence is transmitted without review, and billed to your credential.** That is the trade for hands-free, and the consent line says so before the first use.

### Listening

**Dictation is the one part of this page that is not local.** Chrome implements `SpeechRecognition` by sending the recorded audio to Google for transcription. On a page whose whole claim is that your credential never leaves your browser, that deserves saying out loud, so the console prints a one-time warning the first time you enable it.

Firefox has never implemented `SpeechRecognition`, so the microphone hides itself there rather than sitting dead. Speaking still works.

In `Voice speak` the transcript lands in the composer for you to review and send yourself. In `Voice conversation` it is sent automatically after the pause — see above.

## Security notes

The threat that matters on a public deployment: **the page holds each visitor's API key in their browser, so any script execution on the page is credential theft.** Three things guard that.

- **No third-party JavaScript.** The Anthropic SDK is vendored into `web/js/vendor/` and served from your own origin. Loading it from a CDN would mean every visitor's key depends on that CDN not being compromised, and SRI can't cover a CDN's dynamically generated ESM bundles. Regenerate with `npm run vendor` after bumping the dependency.
- **CSP with `script-src 'self'`** and `default-src 'none'`. An injected script cannot load code from anywhere, which is the control that actually matters. This is why the page carries no inline `style=` attributes — keeping `unsafe-inline` out of `style-src`. If you configure OAuth, add your token endpoint to `connect-src`.
  **Note the honest limit here:** `connect-src` also allows `https:`, because the `http_request` tool fetches URLs chosen at runtime. So unlike earlier versions of this page, CSP no longer denies an injected script somewhere to send a stolen key — see [What this costs you](#what-this-costs-you-stated-plainly). `script-src` is what stands between you and that, not `connect-src`.
- **Model output is escaped before rendering**, quotes included. That last part is not optional: the link rule interpolates a URL into `href="..."`, and HTML5 parsers recover from `href="x"onmouseover=…` by starting a *new* attribute. Escaping only `<`/`>`/`&` leaves a working XSS.

Residual risks worth telling your users about: they are trusting *you* not to ship a malicious update, and an Anthropic API key is account-wide with billing attached — advise a dedicated key with a spend limit.

## Costs

Every message is billed to whoever's credential is in use. On the hosted page that is each visitor's own account, never yours — you are paying for static file hosting and nothing else.

Two things cost more than plain tokens, and both are the visitor's choice in the header: **hosted `web_search` is billed per search** on top of tokens, and **reasoning depth** multiplies the tokens a turn spends. The defaults are the cheap end — Haiku 4.5 at Measured — and `Datalink off` removes the search cost entirely.

---

*Fan project. Not affiliated with, endorsed by, or connected to Lucasfilm Ltd. or The Walt Disney Company. Star Wars and Darth Vader are their trademarks. Ship it as a parody/fan work and don't charge for it.*
