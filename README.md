# Local Discord reader

A Chrome and Firefox Manifest V3 extension that captures gateway messages while a Discord browser tab is open and presents them in a local reader. Collections choose the server channels to capture; the capture set is the union of all collections, including threads under selected channels. DMs are never saved. The initial “All” collection captures every server channel visible to the gateway. Remove it to restrict capture to your chosen collections.

Capturing Discord from the browser is not authorised by Discord and may violate Discord’s terms of service. Use at your own risk.

The reader keeps the approved collection sidebar, source filters, conversation lanes, search, theme settings and collection editor. It supports English and Spanish through the browser’s UI language. Marking something as read affects only this reader.

## Load the extension

Use Node.js 20 or newer to prepare browser-specific manifests:

```sh
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome/`.

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Temporary add-ons disappear when Firefox restarts. Use Firefox 128 or newer; permanent installation requires Firefox signing.

Open or reload a Discord tab and click the extension’s toolbar action to open the reader. Keep Discord open to capture new activity. Existing channel history is not fetched. A new gateway session records a possible coverage gap; a resumed session records that Discord replayed missed events. The listening indicator and hourly coverage chart describe what the extension observed, not guaranteed complete history.

## Development

The extension is plain JavaScript with no build step or runtime dependencies. Edit a source file, run `npm run build`, reload the extension on the browser’s extension management page, then reload the Discord tab so the page hook and relay are replaced. Reload any open reader pages too. `design/prototype.html` is the approved visual reference and is not shipped.

Storage is a prototype: changing the `SCHEMA` constant in `background.js` clears IndexedDB and local settings on startup. There are no migrations. Current schema: 3. Messages, channels and coverage events live in the extension-origin IndexedDB database; collections, theme, last signal, schema and revision remain in `storage.local`.

## Checks and packaging

Unit tests require only Node, without installing dependencies:

```sh
npm test
```

They preserve the original gateway and conversation assertions, exercise the production IndexedDB wrapper against a small asynchronous in-memory fake, and check translations, revision batching, deduplication, partial edits, retained deleted text, active collection queries, unread counts, cleanup and schema resets.

Browser tests need Playwright and its Chromium binaries:

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

The E2E command builds first. `test/e2e/chrome.mjs` launches full Chromium with the unpacked extension and intercepts `https://discord.com` with a fake page that parses gateway frames. It checks the hook → relay → background → IndexedDB → reader pipeline, including edits and deletes. It makes no connection to a live Discord account. `test/e2e/viewer.mjs` serves the reader locally with a fake browser API and real IndexedDB, checks English/light and Spanish/dark rendering, collection save/create/cancel flows, revision handling and overflow at 400 px. These tests require permission to launch a browser and bind a loopback HTTP listener. CDN avatars are stubbed in the viewer harness.

Build and lint the distributable Firefox source:

```sh
npm run build
npm run lint
```

`lint` invokes `npx web-ext`, which may need to download that development CLI. The build script uses only Node built-ins. It copies an explicit allowlist of extension files into `dist/chrome/` and `dist/firefox/`; it excludes design references, tests, scripts, package metadata and documentation. Chrome uses a service worker; Firefox uses an ordered background script list. If the `zip` CLI is available, the build also creates `dist/discord-feed-<browser>-<version>.zip`.

## Architecture

`manifest.json` declares the two content scripts, permissions, browser backgrounds and localized extension metadata. The source manifest contains both background forms; the build selects the appropriate form for each browser.

`hook.js` runs in Discord’s MAIN world and wraps `JSON.parse` to observe gateway frames. It picks message and channel fields, session events and a throttled liveness signal, then posts them to the isolated relay. It does not open a gateway connection or request message history.

`relay.js` forwards the hook’s window messages to the background using the shared `globalThis.browser ?? chrome` API pattern.

`background.js` serializes capture and cleanup operations, rejects DMs, enforces the collection union and parent-channel inheritance, records coverage events, and resets storage on a schema mismatch. After writes commit it publishes a revision in local storage, coalescing bursts into windows of at least 500 ms.

`db.js` defines the shared IndexedDB wrapper as a plain script. Its `messages` store has channel, guild and timestamp indexes; supporting numeric channel/time and capture-time indexes make unread and coverage counts independent of message body reads. `channels` has a guild index; auto-incremented `events` has a time index. Message updates deduplicate by ID, merge defined fields and retain text when deleted. Both background and reader use the same extension-origin database.

`threads.js` is a pure conversation grouper shared with the reader. Replies, Discord threads, recent mentions or author follow-ups, and silence determine conversation membership. The reader supplies the localized empty-text title.

`viewer.html` contains the reader layout, locally bundled fonts and styles. Static text and accessibility labels use `data-i18n` attributes populated at startup.

`viewer.js` handles collections, sources, search, conversation lanes, themes and the collection sheet. A changed revision re-queries the active collection’s most recent 400 messages by timestamp. Selecting a collection or saving settings also refreshes the relevant state. Sidebar counts cover the complete database through indexed aggregation without retaining all message bodies in the reader. Search, source filters and conversation grouping operate within the active collection’s latest 400 messages; the limit notice reports the collection’s complete count.

`_locales/en/messages.json` and `_locales/es/messages.json` hold all shipped interface text, including count/name placeholders, singular/plural variants and the single `appName` key used for the product name.

`scripts/build.mjs` creates clean browser folders and optional ZIP archives. `test/unit.test.mjs`, `test/locales.test.mjs` and their helpers provide dependency-free verification; `test/e2e/` holds the Playwright harnesses.

## Privacy

All captured records and settings stay local to the browser profile. There is no telemetry, backend, external database or sync. The reader requests server icons and author avatars from Discord’s CDN when available; clicking a message link opens Discord. Message text and attachment names are stored locally; attachment files and embed contents are not downloaded or analyzed. The extension does not store Discord tokens. Only activity delivered to the open Discord tab can be captured, and the reader keeps captured text even if the source message is later deleted. Use the reader’s settings menu to delete messages outside all collections or wipe all captured messages and coverage events while keeping collections and channel metadata.
