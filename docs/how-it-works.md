# How ManyCords works

The [README](../README.md) says what ManyCords is and how to install it. This page is the
detail: what each file does, what is captured and stored, and every rule the reader follows.

## Architecture

`manifest.json` declares the two content scripts, permissions, browser backgrounds and localized extension metadata. The source manifest contains both background forms; the build selects the appropriate form for each browser.

`hook.js` runs in Discord’s MAIN world and wraps `JSON.parse` to observe gateway frames. It picks message and channel fields, session events and a throttled liveness signal, then posts them to the isolated relay. It does not open a gateway connection or request message history.

`relay.js` forwards the hook’s window messages to the background using the shared `globalThis.browser ?? chrome` API pattern.

`background.js` serializes capture and cleanup operations, rejects DMs, enforces the collection union and parent-channel inheritance, records coverage events, and resets storage on a schema mismatch. After writes commit it publishes a revision in local storage, coalescing bursts into windows of at least 500 ms.

`db.js` defines the shared IndexedDB wrapper as a plain script. Its `messages` store has channel, guild and timestamp indexes; supporting numeric channel/time and capture-time indexes make unread and coverage counts independent of message body reads. `channels` has a guild index; auto-incremented `events` has a time index. Message updates deduplicate by ID, merge defined fields and retain text when deleted. Both background and reader use the same extension-origin database.

`mine.js` holds the pure “concerns me” rules shared by the background (badge, notifications) and the reader (filter, marker): `isMine`, keyword matching, keyword cleanup, badge text and notification plain text. It exports them through `module.exports` for tests.

`threads.js` holds the pure helpers shared with the reader: `assignConversations` (one lane per channel, a thread’s lane carrying its parent, and the explicit replies between loaded messages), `laneIndex` (a channel’s stable lane colour), the reading-order and read high-water rules, the Markdown tokenizer and `safeLink`.

`gaps.js` holds the pure coverage-gap rules (see [Capture](#capture)).

`viewer.html` contains the reader layout, locally bundled fonts and styles. Static text and accessibility labels use `data-i18n` attributes populated at startup.

`viewer.js` handles collections, sources, search, channel lanes, themes and the collection sheet. A changed revision re-queries the active collection’s most recent messages by timestamp (see [Reader](#reader) for the window). Selecting a collection or saving settings also refreshes the relevant state. Sidebar counts cover the complete database through indexed aggregation without retaining all message bodies in the reader.

`_locales/en/messages.json` and `_locales/es/messages.json` hold all shipped interface text, including count/name placeholders, singular/plural variants and the single `appName` key used for the product name.

`scripts/build.mjs` creates clean browser folders and optional ZIP archives. `test/*.test.mjs` and their helpers provide dependency-free verification; `test/e2e/` holds the Playwright harnesses.

Storage is a prototype: changing the `SCHEMA` constant in `background.js` clears IndexedDB and local settings on startup. There are no migrations. Current schema: 3. Messages, channels and coverage events live in the extension-origin IndexedDB database; collections, theme, last signal, schema and revision remain in `storage.local`.

## Privacy

All captured records and settings stay local to the browser profile. There is no telemetry, backend, external database or sync. The reader requests server icons, author avatars and embed images from Discord’s CDN and image proxies (`cdn.discordapp.com`, `media.discordapp.net`, `images-ext-1.discordapp.net`, `images-ext-2.discordapp.net`) when available, and never from a third-party image address; clicking a message link opens Discord. Message text, attachment names and the text of link embeds are stored locally; attachment files are not downloaded or analyzed. The extension does not store Discord tokens. Only activity delivered to the open Discord tab can be captured, and the reader keeps captured text even if the source message is later deleted. Use the reader’s settings menu to delete messages outside all collections or wipe all captured messages and coverage events while keeping collections and channel metadata.

From Discord’s READY event the extension keeps only your own user id (`storage.local.selfId`), to recognise mentions of you and replies to you; no other account data is stored. Notifications are local system notifications built from already captured text, with the packaged extension icon; they never load a remote image and nothing is sent anywhere. The `notifications` permission exists only for them, and **Notify me** in the settings menu turns them off.

The published privacy policy is [docs/privacy.html](https://mariopayan.github.io/manycords/privacy.html) ([Spanish](https://mariopayan.github.io/manycords/privacy.es.html)).

## Capture

Capture remains passive: the extension only observes JSON already parsed by the user's Discord client. It never navigates, scrolls, clicks, opens a gateway connection or requests history. History arrays delivered while the user browses Discord are captured using the same collection union and inherited thread selection as gateway messages. DMs are excluded.

Collections choose the server channels to capture; the capture set is the union of all collections, including threads under selected channels. The initial “All” collection captures every server channel visible to the gateway. Remove it to restrict capture to your chosen collections.

The reader must set `storage.local.consentedAt` to a positive epoch-millisecond number before any messages, channels or coverage events are stored. Fresh installation opens `viewer.html#welcome`; updates do not. Capture health and tab telemetry may be stored before consent. Removing consent immediately blocks subsequent capture writes without erasing existing records.

A new gateway session records a possible coverage gap; a resumed session records that Discord replayed missed events. The listening indicator and hourly coverage chart describe what the extension observed, not guaranteed complete history.

`storage.local.health` is `{ state, since, detail }`. `since` is an epoch-millisecond timestamp that changes only when `state` changes. The state priority is `not-consented`, `no-tab`, `broken`, `multi-tab`, then `ok`:

- `not-consented`: no valid `consentedAt` value.
- `no-tab`: no live tab remains after three minutes without its relay page ping.
- `broken`: the leader has gone five minutes without a reported gateway frame while continuously visible and online, or more than 20% of its latest up-to-50 message-create payloads are malformed. If there is no elected leader, a visible, online page without gateway evidence also becomes broken after five minutes. Hidden or offline time resets the five-minute observation window.
- `multi-tab`: more than one live tab pings. This is informational; the leader continues capturing. A detected capture failure takes priority over this state.
- `ok`: a live page exists and neither failure condition applies. This reports observations, not guaranteed complete history.

`detail` contains `{ frameMinutes, malformed, messages, tabs, leaderTabId }`. `frameMinutes` is a nonnegative number, or `null` when no live page exists; before a first gateway frame it measures time since the page was first observed. `malformed` and `messages` are the leader's malformed and sampled message-create counts, with at most 50 samples. `tabs` counts live relay pages and `leaderTabId` is the numeric capture leader or `null`. Missing `id`, `channel_id` or a valid `timestamp` makes a create payload malformed. The relay sends `{ visible, online }` immediately, every 60 seconds, and on visibility/connectivity changes; `alive` is emitted only on gateway frames, at most once every 15 seconds. A one-minute alarm checks deadlines even when there are no incoming messages.

The first tab reporting `ready` or `alive` becomes leader. Other tabs contribute only page/liveness telemetry for election; their channel, message, history and session payloads are ignored. The oldest observed eligible live standby is promoted when the leader closes or misses page pings for three minutes. `storage.local.captureSession` persists `{ leaderId, tabs, order }` across service-worker suspension. Each tab holds numeric `id`, `firstAt`, `pageAt`, `order`, optional `frameAt`, `activeSince`, `readySignal`, sampled `malformed`/`messages` counts, and boolean `eligible`, `visible`, `online` flags. It contains no message bodies. `lastSignal` records only accepted leader gateway observations; history and page pings never advance it.

`storage.local.retentionDays` defaults to 14. Zero keeps messages forever; positive values prune records strictly older than that many days by their original `captured_at`, regardless of Discord's message timestamp. Coverage events are always pruned after 30 days. Pruning runs at background startup, on retention-setting changes and through the six-hour `capture-retention` alarm. The manifest requires `alarms` (also used by `mine-notify`) and `notifications`. Database changes still publish the existing debounced `rev` after commit.

Gateway and history messages also keep `reply_to_author` (only the id of the replied message's author, from `referenced_message`) and `mention_everyone`. READY's `user.id` reaches the background as `ready` data `{ self }`; the leader stores it as `selfId` after consent, when it is a numeric id.

Attachments retain `filename`, `url`, `proxy_url`, `content_type`, `width`, `height` and `size` when supplied. Existing rows containing only `filename`/`url` remain readable. Embeds (at most 10 per message) retain only `type`, `url`, `title`, `description` (2,000 characters), `color`, `author: { name, url }`, `provider: { name }`, `footer: { text }`, `fields: [{ name, value, inline }]` (at most 10) and `image`, `thumbnail` and `video` as `{ proxy_url, width, height }`, plus `url` for a video. A `proxy_url` is kept only on the four Discord image hosts above; icons and third-party image URLs are dropped. A `MESSAGE_UPDATE` that carries `embeds` (Discord unfurls links a few seconds after the message) replaces the stored list; one without the key keeps it. Replies also retain `reply_author`, the original author's display name, but not the original text. Rows captured before this held only an embed count, which the reader still labels. History records carry `source: 'history'`; missing REST `guild_id` is filled from stored channel metadata. An incoming older edit never replaces a newer stored edit. Partial gateway updates and retained deleted text continue to work.

Gap events contain `{ type: 'gap', at, from, to, covered: { [channelId]: true } }`, with all times in epoch milliseconds. A channel becomes covered only when one history response spans both boundaries, or overlapping responses share message IDs and together span them. Disconnected responses are never joined merely because their timestamps bracket a gap. Overlap evidence remains in memory; worker suspension loses incomplete runs and conservatively requires fresh evidence, while completed coverage remains in IndexedDB.

`gaps.js` defines the pure globals `mergeHistoryRuns(runs, messages)`, `coverGap(gap, runs)` and `isGapCovered(gap, channelIds)`, and exports the same functions through `module.exports` for tests. `scripts/build.mjs` packages it, and the reader loads it before calling `isGapCovered`, which requires every requested channel to be covered; an empty channel list is covered.

## Reader

The reader keeps the collection sidebar, source filters, channel lanes, search, theme settings and collection editor. It supports English and Spanish through the browser’s UI language. Marking something as read affects only this reader.

The reader uses one lane per channel, with a stable colour derived from its ID. Labels show the server icon, channel and server name. Discord threads have their own lane branching from the parent; only explicit replies between visible messages get secondary arcs. Hovering a message highlights only that message; its focus control filters to the channel.

A collection opens newest first, at the top, with earlier read messages collapsed behind a control at the bottom. Expanding that control loads the complete read history on demand. With no unread messages, the latest 50 read messages appear, and they stay visible as new messages arrive; older ones remain behind the same control.

`storage.local.readingDirection` sets where new messages arrive: `top` (default, newest first, RSS style; a missing or unknown value means this) or `bottom` (chat style: oldest to newest, opening at the oldest unread message, or at the end when nothing is unread, with the earlier control above). If the reader is at the newest edge (within about 80 pixels), new messages keep that edge in view with a smooth scroll, or instantly when the page is hidden or reduced motion is requested. Anyone who scrolled away stays exactly where they are, in both directions, through native scroll anchoring. Only messages newer than the newest one shown animate into place.

Re-renders reuse existing nodes: a revision or read-state change with no new message keeps every message and image node, revealed spoilers, focus and the search text, and touches only the `unread` class and counters. Thumbnails reserve their height from the captured `width` and `height`.

The reader normally loads the latest 400 messages, increasing that window to include every unread predecessor plus 50 read messages so it cannot silently skip unread history. The initial query window stays at least that large for the current collection session as reading progresses. Search and source/channel filters operate within the loaded window; automatic reading still checks all loaded collection messages, including those hidden by filters. The limit notice reports the collection’s complete count.

A message counts as seen when its bottom stays inside the feed viewport for at least one second while the page is visible and no dialog is open. The collection's `readAt` advances only through consecutive seen messages; all messages sharing a timestamp must be seen together. The reading block stays in place while this happens. **Mark as read** marks the entire collection locally, without changing Discord. In `top` mode, with no filter active and the reader at the top of the feed, a seen message also settles every older one, seen or not.

Messages are rendered with DOM nodes, including HTTP(S) links, bold, italic, underline, strikethrough, inline and fenced code, quotes, revealable spoilers, mentions and custom emoji names. Message text is never interpreted as HTML. Image attachments load lazily from Discord's image CDN at up to 320 by 240 pixels, trying the sized proxy, the original URL, then a file card on failure. Embeds render as cards under the text: a left rule in the embed colour, provider, author, title link, formatted description, inline fields, then the image (up to 400 pixels wide, its box reserved from the captured size) or a small thumbnail. A video or GIF shows only a still frame; a video links out, and no player or iframe is created. Embed images load only from Discord's image hosts and otherwise are left out; a bare link already visible in the text shows no card. A reply shows a one-line quote of the original above its header; activating it scrolls to the original and briefly highlights it. If the original is not loaded, the quote names its author and is not clickable. Other attachments remain file cards. Clicking an attachment opens its original URL; all external links use a new tab with opener/referrer protection.

Keyboard controls work outside text inputs: `j` / `k` move between messages, `n` moves to the next unread message, `m` marks the collection read, `/` focuses search, `e` opens the editor, `Esc` closes the current dialog or settings menu, and `?` shows the shortcut list. The editor traps keyboard focus and restores it on close. Feed entries expose their positions to assistive technology; the lane SVG is decorative. Both themes have contrast tests for text, tinted lane labels and UI glyphs.

The settings menu includes theme, retention (7, 14, 30 days or forever), where new messages arrive, keywords, **Notify me**, **Count @everyone/@here**, JSON export of the current collection or the complete database, cleanup, wipe, shortcuts and Welcome. Export includes messages, relevant channel metadata, collections and coverage events, using a local Blob download. Cleanup and wipe retain their confirmation prompts.

`viewer.html#welcome` explains the limited capture, local storage, image CDN requests and Discord terms risk. **I understand** records `storage.local.consentedAt`, then guides the user through opening Discord, waiting for the green signal and creating a collection. Welcome is also shown when consent is absent and remains reachable from settings.

The capture status is a strip along the sidebar's bottom edge showing only a dot; its tooltip gives the state and the age of the last signal, and clicking it opens a panel above it (the open state lasts until the reader reloads). The dot is green (pulsing) for `ok`, yellow for `multi-tab` or a last signal older than two minutes, and red for `no-tab`, `broken`, `not-consented` or a last signal older than three minutes. `lastSignal` advances on any leader gateway frame, heartbeat acknowledgements included, at most once every 15 seconds, so a quiet healthy channel still refreshes it about every 41 seconds. The panel explains how to fix each unhealthy state and shows the 24-hour capture bars; gap bars are red, turn green when covered, and name their time range on hover. The viewer loads `gaps.js` before `viewer.js` and falls back to its own check if `isGapCovered` is missing.

### Things that concern you

A captured message is **mine** when someone else wrote it (never your own, by `selfId`) and any of these holds: its `mentions` include `selfId`; it replies to you (`reply_to_author` is `selfId`, or the stored message it replies to has you as author); one of your keywords appears in its content or in an embed's title or description (only when `embeds` is an array; a count is ignored) as a whole word, ignoring case and accents; or, only with **Count @everyone/@here** on, its `mention_everyone` flag is true. Role mentions do not count. Keywords work before `selfId` is known; mentions and replies need it, so the keyword editor asks you to open Discord once until then. Being captured already means being in a collection.

Settings in `storage.local`: `keywords` (array of strings, trimmed, case- and accent-insensitive duplicates removed, at most 50 of 40 characters), `notify` (default on; only `false` disables) and `mineEveryone` (default off; only `true` enables). The settings menu has a **Keywords** editor (an overlay that saves on every add or remove) and both toggles.

The toolbar badge shows how many mine messages are unread, with the same read model as the reader: a message is unread when its timestamp is newer than the `readAt` of every collection that contains its channel (or its thread's parent). It is empty at zero, caps at `99+`, uses the accent colour and refreshes after captures, deletes, cleanup, pruning and changes to collections (read state), `selfId`, `keywords` or `mineEveryone`. Only unread message bodies are read to count it.

A notification appears for a mine message only when it is a live gateway create: kind `message`, not stored before, without `edited_timestamp`, with an author and a timestamp within ten minutes of now. History, edits, deletes and anything before consent never notify. Its title is “author in #channel (server)” and its body the first 140 characters of plain text, with Discord markup removed. Each channel gets at most one notification per 30 seconds: later mine messages in that window are summarised as “N new messages for you in #channel” when it closes, through the `mine-notify` alarm. The window lives in background memory, so a suspended worker may drop a pending summary; the badge still counts those messages. Clicking a notification asks open readers to show the message (the first one answering is focused) or opens `viewer.html?m=<message id>`, which selects a collection holding the message, clears filters, expands earlier messages if needed and scrolls to it.

**Only mine** in the reader head filters the feed to mine messages. It combines with the source, channel and search filters and belongs to the feed key, so toggling it resets the reading order like the other filters, and it keeps automatic reading from settling unseen messages. In the normal feed, mine messages carry a small accent bar before the author name.
