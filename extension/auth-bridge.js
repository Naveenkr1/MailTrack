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
  window.addEventListener('load', announceExtension);

  function forwardAuth(data) {
    if (!data) return;
    const apiKey = data.apiKey || data.api_key;
    const email = data.email;
    const name = data.name;
    const token = data.token;
    if (!apiKey && !token && !email) return;

    try {
      chrome.runtime.sendMessage({
        action: 'AUTH_SUCCESS_BRIDGE',
        apiKey: apiKey,
        email: email,
        name: name,
        token: token
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    } catch (e) {}
  }

  // 2. Listen for window messages (from /auth/extension-success or dashboard)
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'MAILTRACK_PING_EXTENSION') {
      announceExtension();
    }

    if (event.data.type === 'MAILTRACK_AUTH_SUCCESS' || event.data.type === 'MAILTRACK_TOKEN_SYNC') {
      forwardAuth(event.data);
    }
  });

  // 3. Check if page has meta tags or window globals with credentials
  function checkMetaAndGlobals() {
    try {
      const metaApiKey = document.querySelector('meta[name="mailtrack-api-key"]')?.content;
      const metaEmail = document.querySelector('meta[name="mailtrack-user-email"]')?.content;
      const metaName = document.querySelector('meta[name="mailtrack-user-name"]')?.content;
      if (metaApiKey || metaEmail) {
        forwardAuth({ apiKey: metaApiKey, email: metaEmail, name: metaName });
      }
    } catch (e) {}

    try {
      if (window.__MAILTRACK_AUTH__) {
        forwardAuth(window.__MAILTRACK_AUTH__);
      }
    } catch (e) {}
  }

  checkMetaAndGlobals();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkMetaAndGlobals);
  }
  window.addEventListener('load', checkMetaAndGlobals);
  setTimeout(checkMetaAndGlobals, 300);
  setTimeout(checkMetaAndGlobals, 1000);
})();
