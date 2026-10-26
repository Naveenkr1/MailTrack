// Auth Bridge between Mail Track Web Dashboard & Chrome Extension
(() => {
  // 1. Listen for postMessage from auth pages (e.g. /auth/extension-success or dashboard)
  window.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'MAILTRACK_AUTH_SUCCESS' || event.data.type === 'MAILTRACK_TOKEN_SYNC')) {
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

  // 2. Check if page has meta tags or window globals with credentials
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
