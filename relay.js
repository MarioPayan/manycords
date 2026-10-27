// Isolated world: forwards passive observations and proves the page is still live.
(() => {
  const api = globalThis.browser ?? chrome;
  const send = (kind, data) => api.runtime.sendMessage({ kind, data })
    .catch((error) => console.warn('[discord-feed] not delivered:', error.message));
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data?.['discord-feed']) return;
    // Page health is measured here, never accepted from the MAIN-world bridge.
    if (!['ready', 'alive', 'resumed', 'channels', 'message', 'delete', 'validation', 'history'].includes(event.data.kind)) return;
    send(event.data.kind, event.data.data);
  });
  const ping = () => send('page', { visible: document.visibilityState === 'visible', online: navigator.onLine === true });
  ping();
  setInterval(ping, 60e3);
  document.addEventListener('visibilitychange', ping);
  window.addEventListener('online', ping);
  window.addEventListener('offline', ping);
})();
