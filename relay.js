// Isolated world: forwards what hook.js posts to the background script.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.['discord-feed']) return;
  (globalThis.browser ?? chrome).runtime.sendMessage({ kind: e.data.kind, data: e.data.data })
    .catch((err) => console.warn('[discord-feed] not delivered:', err.message)); // e.g. extension reloaded: reload this tab
});
