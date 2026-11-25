# Developing and publishing ManyCords

Building from source, the checks, the README images, and how a release reaches the stores.
What the code does is in [How it works](how-it-works.md).

## Load the extension from source

Use Node.js 20 or newer to prepare browser-specific manifests:

```sh
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome/`.

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Temporary add-ons disappear when Firefox restarts. Use Firefox 128 or newer; permanent installation requires Firefox signing.

## Development

The extension is plain JavaScript with no build step or runtime dependencies. Edit a source file, run `npm run build`, reload the extension on the browser’s extension management page, then reload the Discord tab so the page hook and relay are replaced. Reload any open reader pages too. `design/prototype.html` is the approved visual reference and is not shipped.

## Checks and packaging

Unit tests require only Node, without installing dependencies:

```sh
npm test
```

`test/mine.test.mjs` covers the mine rules; `test/capture.test.mjs` also covers the badge, notification rate limit and notification clicks with fake `action` and `notifications` APIs. They preserve the original gateway and conversation assertions, exercise the production IndexedDB wrapper against a small asynchronous in-memory fake, and check translations, revision batching, deduplication, partial edits, retained deleted text, active collection queries, unread counts, cleanup and schema resets. `test/viewer.test.mjs` covers lane stability and branching, explicit reply arcs, chronological reading and high-water boundaries, formatting tokens, safe links, theme contrast and the absence of HTML injection sinks.

Browser tests need Playwright and its Chromium binaries:

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

The E2E command builds first. `test/e2e/chrome.mjs` launches full Chromium with the unpacked extension and intercepts `https://discord.com` with a fake page that parses gateway frames. It checks the hook → relay → background → IndexedDB → reader pipeline, including edits and deletes, and the toolbar badge and local notification for a captured mention. It makes no connection to a live Discord account. `test/e2e/viewer.mjs` serves the reader locally with a fake browser API and real IndexedDB, checks English/light and Spanish/dark rendering, collection save/create/cancel flows, revision handling and overflow at 400 px, welcome and consent, guided collection creation, the unread block, `j` / `n`, sheet focus wrapping/restoration, formatting and arrival scroll stability. These tests require permission to launch a browser and bind a loopback HTTP listener. CDN avatars are stubbed in the viewer harness.

Build and lint the distributable Firefox source:

```sh
npm run build
npm run lint
```

`lint` invokes `npx web-ext`, which may need to download that development CLI. The build script uses only Node built-ins. It copies an explicit allowlist of extension files into `dist/chrome/` and `dist/firefox/`; it excludes design references, tests, scripts, package metadata and documentation. Chrome uses a service worker; Firefox uses an ordered background script list. If the `zip` CLI is available, the build also creates `dist/discord-feed-<browser>-<version>.zip`.

## The README images

`docs/images/reader.svg` and `docs/images/anatomy.svg` are generated, not drawn by hand:

```sh
python3 tools/reader-svg.py
python3 tools/anatomy-svg.py
```

Both are standard-library Python. `tools/source.py` reads the dark-theme colours from `viewer.html`, every visible word from `_locales/en/messages.json`, the lane colour rule from `threads.js`, and the fictional servers and messages from the browser-test fixture `test/e2e/viewer-shim.js`; it stops with an error when one of those no longer has the shape it expects. Rerun both scripts after changing the reader’s layout, palette, copy or that fixture, or the README starts showing a reader that no longer exists. Before committing, compare the result with the real reader showing the same fixture, as `test/e2e/viewer.mjs` loads it.

## Publishing to the stores

Bump `version` in `manifest.json` and `package.json`, run `npm run build`, publish a GitHub release tagged `v<version>` with both zips from `dist/` attached, then upload each zip by hand in the Chrome Web Store and Firefox Add-ons dashboards and submit it for review.

The automatic route below is disabled because uploads are manual; turn it on with `gh workflow enable publish-stores.yml` after setting its secrets. When enabled, `.github/workflows/publish-stores.yml` sends a published release's zips to both stores for review. It stops if the zip's version does not match the tag, and each store runs as its own job, so one failing does not block the other. Each store rejects a version it already has, so a re-run only succeeds for the store that failed.

- A release marked as a pre-release stays off the stores.
- To send an existing release, run the workflow by hand: `gh workflow run publish-stores.yml -f tag=v0.2.0`. This starts a real submission.

Secrets, set with `gh secret set <NAME>`:

| Secret | Where it comes from |
|---|---|
| `CWS_EXTENSION_ID` | The item's ID in the Chrome Web Store developer dashboard |
| `CWS_PUBLISHER_ID` | The publisher ID in the dashboard's account settings |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | A Google Cloud OAuth client with the Chrome Web Store API enabled ([guide](https://github.com/fregante/chrome-webstore-upload-keys)) |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/) |

Publish the OAuth consent screen to **In production** before generating the refresh token: while it is in Testing, the token reportedly expires after 7 days.

## Release checklist

The product is **ManyCords**. Its runtime name comes only from `appName` in each locale file. The original mark shows coloured cords merging into one reader stream; use the simplified mark for small sizes. ManyCords is not affiliated with or endorsed by Discord Inc.

1. **Check release behaviour before publishing.** The privacy pages and store copy say all captured data can be deleted from the reader’s menu, but **Delete all messages** keeps collections and channel metadata. Resolve this difference before certifying the disclosures. Verify CDN image requests, the requested permissions and all privacy claims against the final build.
2. **Render the icons.** With Node.js 20 or newer, run:

   ```sh
   npm install
   npx playwright install chromium
   node scripts/render-icons.mjs
   ```

   The renderer uses local SVGs and Playwright Chromium to create `icons/icon-16.png`, `icon-32.png`, `icon-48.png` and `icon-128.png`. Sizes 16 and 32 use `icons/icon-small.svg`; larger sizes use `icons/icon.svg`. Inspect them at actual size. SVGs are the editable source, with a 128 × 128 viewBox.
3. **Validate and build.** Run `npm test`, then `node scripts/build.mjs`. The build copies available PNGs into both browser packages. Missing PNGs produce a warning so development builds still work; render all four before uploading. Load both unpacked builds using the instructions above, then run the browser checks. Use the resulting `dist/discord-feed-chrome-<version>.zip` and `dist/discord-feed-firefox-<version>.zip` (archive names follow the manifest version). Install `zip` if the build reports folders without archives.
4. **Capture screenshots.** Use the real reader with fictional messages and no personal data. Follow `docs/screenshots/README.md`: capture `reader-light.png`, `reader-dark.png`, `collections.png` and `reader-es.png` at 1280 × 800. Save them in `docs/screenshots/` and inspect the product page in both colour schemes and at mobile widths. Do not use prototype images as screenshots of the shipped extension.
5. **GitHub Pages.** The product page is served from `/docs` on `main` at <https://mariopayan.github.io/manycords/>. Verify `index.html`, `privacy.html`, `privacy.es.html`, screenshots and fonts there. The site uses `docs/fonts/`, copied from the two bundled WOFF2 files; no external font service is required. Store the real privacy-policy URL in each store dashboard.
6. **Upload to Chrome Web Store.** In the [developer dashboard](https://chrome.google.com/webstore/devconsole), create the item and upload the Chrome ZIP. Copy the English and Spanish fields from `docs/store/chrome.en.md` and `chrome.es.md`; include the 128 px icon, screenshots, privacy-policy URL, single-purpose statement, permission justifications and data-use declarations. Recheck the short descriptions (both are within 132 characters). Complete distribution and submit for review.
7. **Upload to Firefox Add-ons.** In the [developer hub](https://addons.mozilla.org/developers/), submit the Firefox ZIP for listing and signing. Use `docs/store/firefox.en.md` and `firefox.es.md`, upload the icon and screenshots, link the privacy policy, and disclose CDN image loads in reviewer notes. Provide source and reproduction instructions if requested; the build only copies plain source files and adjusts browser manifest fields. Complete review before offering a permanent install.
8. **Connect the install links.** After approval, replace the two pending store-link destinations in `docs/index.html` (`#chrome-install` and `#firefox-install`) with the actual listing URLs and update their pending labels and status text, and add the listings to the README’s “Get it”. Publish the updated `docs/` and test both links. Review the honest terms-of-service risk and non-affiliation notice in every listing.
