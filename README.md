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
