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

## Capture

Capture remains passive: the extension only observes JSON already parsed by the user's Discord client. It never navigates, scrolls, clicks, opens a gateway connection or requests history. History arrays delivered while the user browses Discord are captured using the same collection union and inherited thread selection as gateway messages. DMs are excluded.

The reader must set `storage.local.consentedAt` to a positive epoch-millisecond number before any messages, channels or coverage events are stored. Fresh installation opens `viewer.html#welcome`; updates do not. Capture health and tab telemetry may be stored before consent. Removing consent immediately blocks subsequent capture writes without erasing existing records.

`storage.local.health` is `{ state, since, detail }`. `since` is an epoch-millisecond timestamp that changes only when `state` changes. The state priority is `not-consented`, `no-tab`, `broken`, `multi-tab`, then `ok`:

- `not-consented`: no valid `consentedAt` value.
- `no-tab`: no live tab remains after three minutes without its relay page ping.
- `broken`: the leader has gone five minutes without a reported gateway frame while continuously visible and online, or more than 20% of its latest up-to-50 message-create payloads are malformed. If there is no elected leader, a visible, online page without gateway evidence also becomes broken after five minutes. Hidden or offline time resets the five-minute observation window.
- `multi-tab`: more than one live tab pings. This is informational; the leader continues capturing. A detected capture failure takes priority over this state.
- `ok`: a live page exists and neither failure condition applies. This reports observations, not guaranteed complete history.

`detail` contains `{ frameMinutes, malformed, messages, tabs, leaderTabId }`. `frameMinutes` is a nonnegative number, or `null` when no live page exists; before a first gateway frame it measures time since the page was first observed. `malformed` and `messages` are the leader's malformed and sampled message-create counts, with at most 50 samples. `tabs` counts live relay pages and `leaderTabId` is the numeric capture leader or `null`. Missing `id`, `channel_id` or a valid `timestamp` makes a create payload malformed. The relay sends `{ visible, online }` immediately, every 60 seconds, and on visibility/connectivity changes; `alive` is emitted only on gateway frames, at most once per minute. A one-minute alarm checks deadlines even when there are no incoming messages.

The first tab reporting `ready` or `alive` becomes leader. Other tabs contribute only page/liveness telemetry for election; their channel, message, history and session payloads are ignored. The oldest observed eligible live standby is promoted when the leader closes or misses page pings for three minutes. `storage.local.captureSession` persists `{ leaderId, tabs, order }` across service-worker suspension. Each tab holds numeric `id`, `firstAt`, `pageAt`, `order`, optional `frameAt`, `activeSince`, `readySignal`, sampled `malformed`/`messages` counts, and boolean `eligible`, `visible`, `online` flags. It contains no message bodies. `lastSignal` records only accepted leader gateway observations; history and page pings never advance it.

`storage.local.retentionDays` defaults to 14. Zero keeps messages forever; positive values prune records strictly older than that many days by their original `captured_at`, regardless of Discord's message timestamp. Coverage events are always pruned after 30 days. Pruning runs at background startup, on retention-setting changes and through the six-hour `capture-retention` alarm. The manifest requires `alarms`. Database changes still publish the existing debounced `rev` after commit.

Attachments retain `filename`, `url`, `proxy_url`, `content_type`, `width`, `height` and `size` when supplied. Existing rows containing only `filename`/`url` remain readable. History records carry `source: 'history'`; missing REST `guild_id` is filled from stored channel metadata. An incoming older edit never replaces a newer stored edit. Partial gateway updates and retained deleted text continue to work.

Gap events now contain `{ type: 'gap', at, from, to, covered: { [channelId]: true } }`, with all times in epoch milliseconds. A channel becomes covered only when one history response spans both boundaries, or overlapping responses share message IDs and together span them. Disconnected responses are never joined merely because their timestamps bracket a gap. Overlap evidence remains in memory; worker suspension loses incomplete runs and conservatively requires fresh evidence, while completed coverage remains in IndexedDB.

`gaps.js` defines the pure globals `mergeHistoryRuns(runs, messages)`, `coverGap(gap, runs)`, `recoveryTargets(gap, collections, channelsById)` and `isGapCovered(gap, channelIds)`, and exports the same functions through `module.exports` for tests. The reader should load this script before calling the latter two. `isGapCovered` requires every requested channel to be covered; an empty channel list is covered. Recovery targets deduplicate the collection union, exclude DMs, categories and independently unselectable threads, and return `{ channelId, guildId, url }` for each uncovered selectable channel. URLs use `https://discord.com/channels/<guild>/<channel>/<snowflake>`, where the synthetic snowflake is `(BigInt(gap.to) - 1420070400000n) << 22n`. Jumping to a synthetic snowflake remains unverified against live Discord.

Packaging integration requires `gaps.js` in the explicit file allowlist in `scripts/build.mjs`; the reader must also load it. The capture-only edit boundary leaves those integration changes to their owners. The original unit and browser fixtures also need explicit consent and a sending tab before they can exercise capture under this contract.

## Reader

The reader now uses one lane per channel, with a stable colour derived from its ID. Labels show the server icon, channel and server name. Discord threads have their own lane branching from the parent; only explicit replies between visible messages get secondary arcs. Hover isolates a lane and its focus control filters to that channel. This replaces the conversation inference described above.

Opening a collection starts at its oldest unread message, with earlier read messages collapsed above it. Expanding that control loads the complete read history on demand and reveals it in chronological order. With no unread messages, the latest 50 read messages appear, ending at the bottom. Incoming messages append without automatically moving the scroll position. The reader normally loads the latest 400 messages, increasing that window to include every unread predecessor plus 50 read messages so it cannot silently skip unread history. The initial query window stays at least that large for the current collection session as reading progresses. Search and source/channel filters operate within the loaded window; automatic reading still checks all loaded collection messages, including those hidden by filters.

A message counts as seen when its bottom stays inside the feed viewport for at least one second while the page is visible and no dialog is open. The collection's `readAt` advances only through consecutive seen messages; all messages sharing a timestamp must be seen together. The reading block stays in place while this happens. **Mark as read** marks the entire collection locally, without changing Discord.

Messages are rendered with DOM nodes, including HTTP(S) links, bold, italic, underline, strikethrough, inline and fenced code, quotes, revealable spoilers, mentions and custom emoji names. Message text is never interpreted as HTML. Image attachments load lazily from Discord's image CDN at up to 320 by 240 pixels, trying the sized proxy, the original URL, then a file card on failure. Other attachments remain file cards. Clicking an attachment opens its original URL; all external links use a new tab with opener/referrer protection.

Keyboard controls work outside text inputs: `j` / `k` move between messages, `n` moves to the next unread message, `m` marks the collection read, `/` focuses search, `e` opens the editor, `Esc` closes the current dialog or settings menu, and `?` shows the shortcut list. The editor traps keyboard focus and restores it on close. Feed entries expose their positions to assistive technology; the lane SVG is decorative. Both themes have contrast tests for text, tinted lane labels and UI glyphs.

The settings menu includes theme, retention (7, 14, 30 days or forever), JSON export of the current collection or the complete database, cleanup, wipe, shortcuts and Welcome. Export includes messages, relevant channel metadata, collections and coverage events, using a local Blob download. Cleanup and wipe retain their confirmation prompts.

`viewer.html#welcome` explains the limited capture, local storage, image CDN requests and Discord terms risk. **I understand** records `storage.local.consentedAt`, then guides the user through opening Discord, waiting for the green signal and creating a collection. Welcome is also shown when consent is absent and remains reachable from settings.

The status card consumes the capture agent's `storage.local.health` contract (`ok`, `no-tab`, `broken`, `multi-tab`, `not-consented`) and explains how to fix each unhealthy state. Gaps from the last 24 hours have recovery links and turn green when covered. The viewer loads `gaps.js` before `viewer.js`, and guards its `recoveryTargets` / `isGapCovered` calls until the capture changes land. The capture branch must supply and package `gaps.js` (the current build allowlist does not yet include it), enforce consent, publish health, and apply the saved `retentionDays` setting (default 14; zero means forever). The reader intentionally does not modify those sibling-owned capture files or the build script.

`test/viewer.test.mjs` covers lane stability and branching, explicit reply arcs, chronological reading and high-water boundaries, formatting tokens, safe links, theme contrast and the absence of HTML injection sinks. `test/e2e/viewer.mjs` retains the existing collection/revision/layout checks and adds welcome and consent, guided collection creation, the unread block, `j` / `n`, sheet focus wrapping/restoration, formatting and arrival scroll stability. Run `npm test`, `npm run build`, `npm run lint`, and `node test/e2e/viewer.mjs` to verify. The browser harness requires a permitted loopback listener and Chromium launch.

## Publishing

The product is **ManyCords**. Its runtime name comes only from `appName` in each locale file. The original mark shows coloured cords merging into one reader stream; use the simplified mark for small sizes. ManyCords is not affiliated with or endorsed by Discord Inc.

1. **Check release behaviour before publishing.** The privacy pages and store copy describe the brief’s configurable retention (14 days by default) and full captured-data deletion from the menu. This checkout does not yet implement retention, and its wipe action keeps collections and channel metadata. Resolve these differences in the application before publishing or certifying the disclosures. The current manifest also does not request `alarms`; the store notes explicitly distinguish a future scheduled-cleanup justification from currently requested permissions. Verify CDN image requests and all privacy claims against the final build.
2. **Render the icons.** With Node.js 20 or newer, run:

   ```sh
   npm install
   npx playwright install chromium
   node scripts/render-icons.mjs
   ```

   The renderer uses local SVGs and Playwright Chromium to create `icons/icon-16.png`, `icon-32.png`, `icon-48.png` and `icon-128.png`. Sizes 16 and 32 use `icons/icon-small.svg`; larger sizes use `icons/icon.svg`. Inspect them at actual size. SVGs are the editable source, with a 128 × 128 viewBox.
3. **Validate and build.** Run `npm test`, then `node scripts/build.mjs`. The build copies available PNGs into both browser packages. Missing PNGs produce a warning so development builds still work; render all four before uploading. Load both unpacked builds using the instructions above, then run the browser checks. Use the resulting `dist/discord-feed-chrome-0.1.0.zip` and `dist/discord-feed-firefox-0.1.0.zip` for version 0.1.0 (archive names follow the manifest version). Install `zip` if the build reports folders without archives.
4. **Capture screenshots.** Use the real reader with fictional messages and no personal data. Follow `docs/screenshots/README.md`: capture `reader-light.png`, `reader-dark.png`, `collections.png` and `reader-es.png` at 1280 × 800. Save them in `docs/screenshots/` and inspect the product page in both colour schemes and at mobile widths. Do not use prototype images as screenshots of the shipped extension.
5. **Prepare GitHub Pages.** Replace every `CONTACT_EMAIL` in `docs/` with your contact address. In the repository’s GitHub **Settings → Pages**, choose **Deploy from a branch**, select the branch containing these files, and select `/docs` as the folder. When the files are published, open the reported Pages URL and verify `index.html`, `privacy.html`, `privacy.es.html`, screenshots and fonts. The site uses `docs/fonts/`, copied from the two bundled WOFF2 files; no external font service is required. Store the real privacy-policy URL in each store dashboard.
6. **Upload to Chrome Web Store.** In the [developer dashboard](https://chrome.google.com/webstore/devconsole), create the item and upload the Chrome ZIP. Copy the English and Spanish fields from `docs/store/chrome.en.md` and `chrome.es.md`; include the 128 px icon, screenshots, privacy-policy URL, single-purpose statement, permission justifications and data-use declarations. Recheck the short descriptions (both are within 132 characters). Complete distribution and submit for review.
7. **Upload to Firefox Add-ons.** In the [developer hub](https://addons.mozilla.org/developers/), submit the Firefox ZIP for listing and signing. Use `docs/store/firefox.en.md` and `firefox.es.md`, upload the icon and screenshots, link the privacy policy, and disclose CDN image loads in reviewer notes. Provide source and reproduction instructions if requested; the build only copies plain source files and adjusts browser manifest fields. Complete review before offering a permanent install.
8. **Connect the install links.** After approval, replace the two pending store-link destinations in `docs/index.html` (`#chrome-install` and `#firefox-install`) with the actual listing URLs and update their pending labels and status text. Publish the updated `docs/` and test both links. Review the honest terms-of-service risk and non-affiliation notice in every listing.
