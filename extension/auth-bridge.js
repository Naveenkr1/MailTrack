// Auth Bridge between Mail Track Web Dashboard & Chrome Extension
(() => {
  // 1. Announce presence immediately to the companion web dashboard
  function announceExtension() {
    try {
      document.documentElement.setAttribute('data-mailtrack-extension-installed', 'true');
      document.documentElement.setAttribute('data-mailtrack-extension-version', '1.0.6');
      window.postMessage({ type: 'MAILTRACK_EXTENSION_PONG', version: '1.0.6' }, '*');
    } catch (e) {}
  }

  // Announce immediately at document_start
  announceExtension();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceExtension);
  }

  // 2. Listen for messages from dashboard (pings, auth tokens, etc.)
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'MAILTRACK_PING_EXTENSION') {
      announceExtension();
    }

    if (event.data.type === 'MAILTRACK_AUTH_SUCCESS' || event.data.type === 'MAILTRACK_TOKEN_SYNC') {
      try {
        chrome.runtime.sendMessage({
          action: 'AUTH_SUCCESS_BRIDGE',
          apiKey: event.data.apiKey,
          email: event.data.email,
          name: event.data.name,
          token: event.data.token
        });
      } catch (e) {}
    }
  });

  // 3. Check if page has meta tags or window globals with credentials
  try {
    const metaApiKey = document.querySelector('meta[name="mailtrack-api-key"]')?.content;
    const metaEmail = document.querySelector('meta[name="mailtrack-user-email"]')?.content;
    if (metaApiKey && metaEmail) {
      chrome.runtime.sendMessage({
        action: 'AUTH_SUCCESS_BRIDGE',
        apiKey: metaApiKey,
        email: metaEmail
      });
    }
  } catch (e) {}
})();
