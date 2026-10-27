# ManyCords — Chrome Web Store (English)

## Name

ManyCords

## Short description

Bring your server channels into one local reader, with collections and conversation lanes.

## Full description

Bring the Discord server channels you choose into one local reader. Build collections across servers, filter by source, search recent captured messages, and follow related messages through coloured conversation lanes. Read in English or Spanish, with light and dark themes. Marking a collection as read affects only this reader.

Keep your own Discord browser tab open to receive new activity. The extension saves only activity that tab receives for channels in your collections; it does not fetch existing history or save direct messages. The initial “All” collection includes all server channels your tab receives. Remove it to capture only a narrower selection. Capture can have gaps and is not a guaranteed archive.

Messages, author names and IDs, avatar identifiers, and channel and server names stay in browser extension storage on your device. Captured data is never sent to us or any third party. The only network requests made by the extension are image loads from cdn.discordapp.com and media.discordapp.net for avatars, server icons and thumbnails. No analytics, and no additional account. Retention is configurable, with a default of 14 days; delete all captured data from the reader’s menu. Uninstalling deletes all stored data.

Capturing activity from the browser is not authorised by Discord and may violate its terms of service. Your account could be restricted or suspended. Use at your own risk. Read [Discord’s terms](https://discord.com/terms).

ManyCords is not affiliated with or endorsed by Discord Inc.

## Category suggestion

Productivity / Workflow & Planning

## Single-purpose statement

Provide a local reader for messages the user’s own Discord tab receives from channels selected in the user’s collections.

## Permission justifications

- `storage`: saves collections, reader preferences and local state on the device using the browser extension storage API.
- `unlimitedStorage`: allows the local message archive in extension-origin IndexedDB to grow beyond normal storage quotas. It does not upload or sync data.
- Host access to `https://discord.com/*`: observes messages and channel/server information already received by the user’s own Discord tab and relays collection-selected activity to the local reader. Access is not requested for other websites.
- `alarms`: not requested in the current manifest and not used by this build. For a release that implements scheduled retention cleanup, the justification is: “Schedules on-device deletion of captured records older than the user’s configured retention period, without sending data over the network.” Only use that justification after the feature and permission are actually present.

No remote executable code is loaded; scripts and fonts are bundled with the extension.

## Data-usage disclosures

- Purpose: local reading of the channels selected by the user’s collections.
- Data handled on the device: messages (personal communications and website content), author names and IDs, avatar identifiers (personally identifiable information), and channel and server names (website content). Do not equate local processing with an absence of user data handling.
- Storage: browser extension storage on the device only, including extension-origin IndexedDB; no server storage or sync.
- Transmission: captured data is never sent to the developer or any third party. The only extension network requests are image loads from Discord’s CDN (cdn.discordapp.com and media.discordapp.net) for avatars, server icons and thumbnails. These image requests reach Discord; captured messages are not uploaded.
- Retention and deletion: configurable retention, 14 days by default; full captured-data deletion from the reader’s menu; uninstalling removes all stored data.
- No analytics or extension accounts. No selling, advertising use, unrelated use or creditworthiness use of data. Data is used only for the single purpose above.
- Privacy policy: publish docs/privacy.html on GitHub Pages and enter its actual public URL in the store’s privacy-policy field. Spanish translation: docs/privacy.es.html. Contact: CONTACT_EMAIL.

Submission check: the policy and listing describe the retention and full-deletion behaviour required by the release brief. This checkout does not yet implement configurable retention, and its wipe action preserves collections and channel metadata. Resolve that mismatch before submission; do not certify the listed behaviour against the current build.

For data-type disclosures, declare personally identifiable information, personal communications and website content. Certify the use limitations above only after verifying the build being uploaded. Remote code: no. The [official Chrome privacy guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) explains the fields and requires consistency with the privacy policy.
