// Mail Track — Ultra-Lightweight Content Script (Zero Impact on Gmail Performance)
(function () {
  'use strict';

  console.log('[Mail Track] ⚡ Activating Ultra-Fast Gmail Tracking...');

  const DEFAULT_PROD_URL = 'https://mailtrack.in';
  let trackedEmails = [];
  let publicTrackingUrl = DEFAULT_PROD_URL;
  let ws = null;
  let currentAuthUser = null;

  function sanitizeServerUrl(url) {
    if (!url || typeof url !== 'string' || 
        url.includes('trycloudflare.com') || 
        url.includes('loca.lt') || 
        url.includes('ngrok')) {
      return DEFAULT_PROD_URL;
    }
    return url.replace(/\/+$/, '');
  }

  function getServerUrl() {
    return sanitizeServerUrl(publicTrackingUrl);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['mt_server_mode', 'mt_active_server_url', 'mt_custom_server_url'], (items) => {
      if (items.mt_server_mode === 'localhost') {
        publicTrackingUrl = 'http://localhost:4000';
      } else if (items.mt_custom_server_url && !items.mt_custom_server_url.includes('trycloudflare.com')) {
        publicTrackingUrl = sanitizeServerUrl(items.mt_custom_server_url);
      } else {
        publicTrackingUrl = DEFAULT_PROD_URL;
      }
      if (items.mt_active_server_url && items.mt_active_server_url.includes('trycloudflare.com')) {
        chrome.storage.local.set({ mt_active_server_url: DEFAULT_PROD_URL, mt_custom_server_url: '' });
      }
    });
  }

  // Immediately query active public URL from background service worker
  if (isAlive()) {
    try {
      chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (res) => {
        if (res && res.success) {
          if (res.serverMode === 'localhost' || res.activeServerUrl?.includes('localhost')) {
            publicTrackingUrl = 'http://localhost:4000';
          } else {
            publicTrackingUrl = sanitizeServerUrl(res.activeServerUrl || (res.config && res.config.publicUrl));
          }
        }
      });
    } catch { }

    // Listen for live tunnel updates from server watchdog
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'CONFIG_UPDATED') {
        if (msg.serverMode === 'localhost' || msg.activeServerUrl?.includes('localhost')) {
          publicTrackingUrl = 'http://localhost:4000';
        } else {
          publicTrackingUrl = sanitizeServerUrl(msg.activeServerUrl || (msg.config && msg.config.publicUrl));
        }
        console.log('[Mail Track] Live public tracking URL synchronized:', publicTrackingUrl);
      }
    });
  }

  // -------------------------------------------------------------------------
  // AUTHENTICATION & LOGIN STATE
  // -------------------------------------------------------------------------
  function isUserAuthenticated() {
    return !!(currentAuthUser && (currentAuthUser.apiKey || currentAuthUser.id));
  }

  // Load cached auth immediately from local extension storage
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(['mt_user', 'mt_api_key', 'mt_is_logged_out'], (items) => {
      if (items && items.mt_is_logged_out) {
        currentAuthUser = null;
        updateTopNavBtnAuthState();
        updateComposeButtonsAuthState();
        checkAndShowAuthPrompt();
        return;
      }
      if (items && items.mt_user) {
        currentAuthUser = items.mt_user;
        if (items.mt_api_key && !currentAuthUser.apiKey) {
          currentAuthUser.apiKey = items.mt_api_key;
        }
      }
      updateTopNavBtnAuthState();
      updateComposeButtonsAuthState();
    });
  }

  // Listen for storage changes in real time (e.g. user logged in or out in another tab)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.mt_user || changes.mt_api_key || changes.mt_is_logged_out)) {
        chrome.storage.local.get(['mt_user', 'mt_api_key', 'mt_is_logged_out'], (items) => {
          if (items && (items.mt_is_logged_out || !items.mt_user)) {
            currentAuthUser = null;
            try { sessionStorage.removeItem('mt_auth_alert_dismissed'); } catch {}
          } else if (items && items.mt_user) {
            currentAuthUser = items.mt_user;
            if (items.mt_api_key && !currentAuthUser.apiKey) {
              currentAuthUser.apiKey = items.mt_api_key;
            }
          } else {
            currentAuthUser = null;
          }
          updateTopNavBtnAuthState();
          updateComposeButtonsAuthState();
          if (isUserAuthenticated()) {
            dismissAuthModal();
          } else {
            showAuthPromptModal(true);
          }
          if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
            renderNotificationsDropdown();
          }
        });
      }
    });
  }

  function fetchAuthStatus() {
    if (!isAlive()) return;
    try {
      chrome.runtime.sendMessage({ action: 'GET_AUTH_STATUS' }, (res) => {
        if (!isAlive() || chrome.runtime.lastError) return;
        if (res && res.authenticated && res.user) {
          currentAuthUser = res.user;
          if (!currentAuthUser.apiKey && res.apiKey) {
            currentAuthUser.apiKey = res.apiKey;
          }
        } else if (res && res.authenticated === false) {
          currentAuthUser = null;
        }
        updateTopNavBtnAuthState();
        updateComposeButtonsAuthState();
        if (isUserAuthenticated()) {
          dismissAuthModal();
        } else {
          checkAndShowAuthPrompt();
        }
      });
    } catch {}
  }

  function dismissAuthModal() {
    const existing = document.querySelector('mailtrack-prompt-container');
    if (existing) {
      existing.style.opacity = '0';
      existing.style.transition = 'opacity 0.18s ease';
      setTimeout(() => {
        if (existing.parentElement) existing.remove();
      }, 180);
    }
    const legacy = document.getElementById('mt-auth-prompt-modal');
    if (legacy) legacy.remove();
  }

  function showAuthPromptModal(force = false) {
    if (!force) {
      if (isUserAuthenticated()) return;
      try {
        if (sessionStorage.getItem('mt_auth_alert_dismissed') === 'true') return;
      } catch {}
    }

    if (document.querySelector('mailtrack-prompt-container') || document.getElementById('mt-auth-prompt-modal')) return;
    if (!document.body) {
      setTimeout(() => showAuthPromptModal(force), 300);
      return;
    }

    // Immune to adblockers: Mount using custom element with Shadow DOM encapsulation
    const host = document.createElement('mailtrack-prompt-container');
    host.style.cssText = [
      'position: fixed !important',
      'inset: 0 !important',
      'width: 100vw !important',
      'height: 100vh !important',
      'z-index: 2147483647 !important',
      'display: flex !important',
      'align-items: center !important',
      'justify-content: center !important',
      'visibility: visible !important',
      'opacity: 1 !important',
      'pointer-events: auto !important',
      'margin: 0 !important',
      'padding: 16px !important',
      'border: none !important',
      'box-sizing: border-box !important',
      'background: rgba(15, 23, 42, 0.6) !important',
      'backdrop-filter: blur(4px) !important',
      '-webkit-backdrop-filter: blur(4px) !important'
    ].join('; ');

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
      }
      * {
        box-sizing: border-box !important;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      }
      .card {
        position: relative !important;
        width: 440px !important;
        max-width: 95vw !important;
        background: #ffffff !important;
        border-radius: 20px !important;
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.06) !important;
        padding: 32px 28px 24px 28px !important;
        text-align: center !important;
        color: #0f172a !important;
        animation: mtScaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      @keyframes mtScaleUp {
        0% { transform: scale(0.93); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      .close-btn {
        position: absolute !important;
        top: 16px !important;
        right: 16px !important;
        width: 32px !important;
        height: 32px !important;
        border-radius: 50% !important;
        border: none !important;
        background: #f1f5f9 !important;
        color: #64748b !important;
        font-size: 15px !important;
        line-height: 1 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
      }
      .close-btn:hover {
        background: #e2e8f0 !important;
        color: #0f172a !important;
        transform: scale(1.06) !important;
      }
      .icon-box {
        width: 56px !important;
        height: 56px !important;
        background: #059669 !important;
        border-radius: 14px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 8px 20px rgba(5, 150, 105, 0.3) !important;
        margin-bottom: 16px !important;
      }
      .pill {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: #ecfdf5 !important;
        color: #059669 !important;
        border: 1px solid #a7f3d0 !important;
        font-size: 11.5px !important;
        font-weight: 700 !important;
        padding: 3px 12px !important;
        border-radius: 20px !important;
        margin-bottom: 14px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.04em !important;
      }
      .title {
        font-size: 21px !important;
        font-weight: 700 !important;
        color: #0f172a !important;
        letter-spacing: -0.4px !important;
        line-height: 1.25 !important;
        margin-bottom: 10px !important;
      }
      .desc {
        font-size: 14px !important;
        color: #64748b !important;
        line-height: 1.55 !important;
        margin-bottom: 24px !important;
        padding: 0 8px !important;
      }
      .desc strong {
        color: #dc2626 !important;
        font-weight: 700 !important;
      }
      .btn-group {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        margin-bottom: 18px !important;
      }
      .connect-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 10px !important;
        width: 100% !important;
        padding: 13px 20px !important;
        background: #059669 !important;
        color: #ffffff !important;
        font-size: 15px !important;
        font-weight: 600 !important;
        border-radius: 10px !important;
        text-decoration: none !important;
        box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3) !important;
        transition: all 0.15s ease !important;
        cursor: pointer !important;
        border: none !important;
      }
      .connect-btn:hover {
        background: #047857 !important;
        box-shadow: 0 6px 16px rgba(5, 150, 105, 0.4) !important;
        transform: translateY(-1px) !important;
      }
      .later-btn {
        background: none !important;
        border: none !important;
        color: #64748b !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        cursor: pointer !important;
        padding: 6px 12px !important;
        border-radius: 6px !important;
        transition: color 0.15s ease !important;
      }
      .later-btn:hover {
        color: #0f172a !important;
        text-decoration: underline !important;
      }
      .footer-note {
        font-size: 11.5px !important;
        color: #94a3b8 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
      }
    `;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <button class="close-btn" id="mtCloseBtn" title="Close" aria-label="Close">✕</button>
      
      <div class="icon-box">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 12.6111L8.92308 17.5L20 6.5" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M11 12.6111L15.9231 17.5" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div style="display:flex; justify-content:center;">
        <span class="pill">Action Required • Please Log In</span>
      </div>

      <h2 class="title">Please Log In to Enable Email Tracking</h2>
      <p class="desc">
        Email tracking is currently <strong>disabled</strong> because you are logged out. Connect your Google account to enable live email read receipts, link click notifications, and double checkmarks in Gmail.
      </p>

      <div class="btn-group">
        <a href="${getServerUrl()}/auth/google?flow_src=extension" target="_blank" class="connect-btn" id="mtConnectBtn">
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Log In with Google</span>
        </a>
        <button class="later-btn" id="mtLaterBtn">Remind me later</button>
      </div>

      <p class="footer-note">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>Official Google OAuth 2.0 • Secure & Private</span>
      </p>
    `;

    shadow.appendChild(style);
    shadow.appendChild(card);

    function closePrompt(sessionDismiss = true) {
      if (sessionDismiss) {
        try { sessionStorage.setItem('mt_auth_alert_dismissed', 'true'); } catch {}
      }
      dismissAuthModal();
    }

    shadow.querySelector('#mtCloseBtn').onclick = (e) => {
      e.stopPropagation();
      closePrompt(true);
    };

    shadow.querySelector('#mtLaterBtn').onclick = (e) => {
      e.stopPropagation();
      closePrompt(true);
    };

    shadow.querySelector('#mtConnectBtn').onclick = () => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove(['mt_is_logged_out']);
      }
      setTimeout(() => {
        closePrompt(false);
      }, 500);
    };

    host.onclick = (e) => {
      if (e.target === host) {
        closePrompt(true);
      }
    };

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', handleKeydown);
        closePrompt(true);
      }
    };
    window.addEventListener('keydown', handleKeydown);

    document.body.appendChild(host);
  }

  function checkAndShowAuthPrompt() {
    if (isUserAuthenticated()) return;
    try {
      if (sessionStorage.getItem('mt_auth_alert_dismissed') === 'true') return;
    } catch {}
    showAuthPromptModal(false);
  }

  function updateTopNavBtnAuthState() {
    const navBtn = document.getElementById('mt-topnav-btn');
    if (!navBtn) return;
    const isAuth = isUserAuthenticated();
    const container = navBtn.querySelector('.mt-nav-container');
    const unlinkedDot = navBtn.querySelector('#mtNavUnlinkedDot');

    if (!isAuth) {
      navBtn.classList.add('unlinked');
      navBtn.title = 'Mail Track: Not Connected — Click to connect your Google account';
      if (container) {
        container.classList.add('unlinked');
        container.style.setProperty('background', '#94a3b8', 'important');
      }
      if (unlinkedDot) unlinkedDot.style.setProperty('display', 'block', 'important');
      updateNavBadgeCount(0);
    } else {
      navBtn.classList.remove('unlinked');
      navBtn.title = 'Mail Track Activity & Notifications';
      if (container) {
        container.classList.remove('unlinked');
        container.style.setProperty('background', '#059669', 'important');
      }
      if (unlinkedDot) unlinkedDot.style.setProperty('display', 'none', 'important');
      updateNavBadgeCount(unreadNotificationsCount);
    }
  }

  function updateComposeButtonsAuthState() {
    const isAuth = isUserAuthenticated();
    const composeButtons = document.querySelectorAll('.mt-compose-logo-btn');
    composeButtons.forEach((btn) => {
      const bgRect = btn.querySelector('.mt-logo-bg');
      if (!isAuth) {
        btn.className = 'mt-compose-logo-btn unlinked disabled';
        btn.title = 'Mail Track: Tracking Disabled — Please log in to connect your Google account';
        if (bgRect) bgRect.setAttribute('fill', '#94a3b8');
        const dialog = btn.closest('div[role="dialog"], div.M9, div.AD, div[role="region"], table.cf.An');
        if (dialog) {
          dialog.setAttribute('data-mt-track-mail', 'false');
          dialog.setAttribute('data-mt-track-links', 'false');
        }
      } else {
        btn.classList.remove('unlinked');
        const dialog = btn.closest('div[role="dialog"], div.M9, div.AD, div[role="region"], table.cf.An');
        let isTracking = true;
        let isTrackLinks = true;
        if (dialog) {
          if (dialog.getAttribute('data-mt-user-set') === 'true') {
            isTracking = dialog.getAttribute('data-mt-track-mail') !== 'false';
            isTrackLinks = dialog.getAttribute('data-mt-track-links') !== 'false';
          } else {
            dialog.setAttribute('data-mt-track-mail', 'true');
            dialog.setAttribute('data-mt-track-links', 'true');
          }
        }
        if (isTracking) {
          btn.className = 'mt-compose-logo-btn active';
          const linkNote = isTrackLinks ? 'Links ON' : 'Links OFF';
          btn.title = `Mail Track: Tracking ON (${linkNote}) — Click for options`;
          if (bgRect) bgRect.setAttribute('fill', '#059669');
        } else {
          btn.className = 'mt-compose-logo-btn disabled';
          btn.title = 'Mail Track: Tracking OFF — Click for options';
          if (bgRect) bgRect.setAttribute('fill', '#94a3b8');
        }
      }
    });
  }

  // Universal click protector & self-click bypass for tracked links inside Gmail
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="/trace/link"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;

    try {
      const u = new URL(href, window.location.origin);
      const dest = u.searchParams.get('url');
      const emailId = u.pathname.split('/trace/link/')[1] || u.searchParams.get('id');

      const currentUser = getCurrentGmailUser();
      const authEmail = (currentAuthUser && currentAuthUser.email) ? currentAuthUser.email.toLowerCase() : null;

      // 1. SELF-CLICK PROTECTION: Check if sender is clicking their own link in Gmail
      const isMyTrackedEmail = emailId && trackedEmails.some(t => t.id === emailId);
      const isSentOrDraftView = /#(sent|outbox|drafts|scheduled)/i.test(window.location.hash || '');
      let isSenderClick = isMyTrackedEmail || isSentOrDraftView;

      if (!isSenderClick && emailId) {
        const found = trackedEmails.find(t => t.id === emailId);
        if (found && found.sender) {
          const s = found.sender.toLowerCase();
          if (currentUser && s.includes(currentUser)) isSenderClick = true;
          if (authEmail && s.includes(authEmail)) isSenderClick = true;
        }
      }

      // If sender clicked their own link: bypass tracking entirely and open destination directly!
      if (isSenderClick && dest) {
        e.preventDefault();
        e.stopPropagation();
        console.log(`[Mail Track] 🛡️ Self-click prevented for email (${emailId}) -> Opening "${dest}" directly.`);
        window.open(dest, '_blank', 'noopener');
        return;
      }

      // 2. Legacy domain & offline tunnel rescue
      const isDeadDomain = !href.startsWith(publicTrackingUrl) && !href.includes('vercel.app') && !href.startsWith('http://localhost:4000');
      if (isDeadDomain && dest) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Mail Track] Rescuing click on legacy/offline link:', href);
        // Ping active tracking server in background to record the click
        if (isAlive()) {
          fetch(`${getServerUrl()}/trace/link/${emailId || ''}?url=${encodeURIComponent(dest)}`, { mode: 'no-cors' }).catch(() => { });
        }
        window.open(dest, '_blank', 'noopener,noreferrer');
      }
    } catch (err) { }
  }, true);

  // Authentic Mailsuite SVGs
  const SVG_SINGLE_CHECK = `
    <svg class="mt-tick-svg" width="18" height="11" viewBox="0 0 25 12">
      <g fill="none">
        <path fill="#C5C5C5" d="m10.898 8.996 2.122-2.121 1.459 1.414 7.084-6.866a1.5 1.5 0 1 1 2.087 2.154l-8.127 7.878a1.5 1.5 0 0 1-2.088 0z" />
        <path fill="#66CB87" d="m5.312 8.289 7.084-6.866a1.5 1.5 0 0 1 2.088 2.154l-8.128 7.878a1.5 1.5 0 0 1-2.088 0L.456 7.76a1.5 1.5 0 0 1 2.088-2.154z" />
      </g>
    </svg>
  `;

  const SVG_DOUBLE_CHECK = `
    <svg class="mt-tick-svg" width="18" height="11" viewBox="0 0 25 12">
      <path fill="#66CB87" d="m10.898 8.996 2.122-2.121 1.459 1.414 7.084-6.866a1.5 1.5 0 1 1 2.087 2.154l-8.127 7.878a1.5 1.5 0 0 1-2.088 0zM5.312 8.29l7.084-6.866a1.5 1.5 0 0 1 2.088 2.154l-8.128 7.878a1.5 1.5 0 0 1-2.088 0L.456 7.76a1.5 1.5 0 0 1 2.088-2.154z" />
    </svg>
  `;

  function generateId() {
    const arr = new Uint8Array(20);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function isAlive() {
    try {
      return typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function formatDeviceDisplay(client) {
    if (!client) return 'Desktop';
    const c = String(client).trim();
    if (/Google Proxy|Gmail|Desktop/i.test(c)) return 'Desktop';
    if (/iPhone/i.test(c)) return 'iPhone';
    if (/iPad/i.test(c)) return 'iPad';
    if (/Android/i.test(c)) return 'Android';
    if (/Mac/i.test(c)) return 'Mac';
    if (/Windows/i.test(c)) return 'Windows PC';
    if (/Linux/i.test(c)) return 'Linux PC';
    return c;
  }

  function formatDeviceName(client) {
    if (!client) return 'Gmail (Google Proxy)';
    const c = String(client).trim();
    if (/Google Proxy|Gmail|Desktop/i.test(c)) return 'Gmail (Google Proxy)';
    if (/iPhone/i.test(c)) return 'iPhone';
    if (/iPad/i.test(c)) return 'iPad';
    if (/Android/i.test(c)) return 'Android';
    if (/Mac/i.test(c)) return 'Mac';
    if (/Windows/i.test(c)) return 'Windows PC';
    if (/Linux/i.test(c)) return 'Linux PC';
    return c;
  }

  // Format last opened date and time for tooltip display
  function formatFullDateTime(timestamp) {
    if (!timestamp) return 'Not opened yet';
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return 'Not opened yet';
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

      if (isToday) {
        return `Today at ${timeStr}`;
      }
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) {
        return `Yesterday at ${timeStr}`;
      }
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${dateStr} at ${timeStr}`;
    } catch {
      return 'Not opened yet';
    }
  }

  // Get active logged-in Gmail user email in current tab
  function getCurrentGmailUser() {
    // 1. From document title: e.g. "Inbox - user@domain.com - Gmail"
    const titleMatch = document.title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (titleMatch) return titleMatch[1].toLowerCase();

    // 2. From top-right Google Account button / profile links strictly in header or banner
    const accSelectors = [
      'header a[aria-label*="Google Account:"]',
      'div[role="banner"] a[aria-label*="Google Account:"]',
      'a[aria-label*="Google Account:"]',
      'header a[href*="SignOutOptions"]',
      'div[role="banner"] a[href*="SignOutOptions"]',
      'header .gb_A[aria-label*="@"]',
      'div[role="banner"] .gb_A[aria-label*="@"]'
    ];
    for (const sel of accSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-identifier') || '') + ' ' + (el.title || '') + ' ' + (el.textContent || '');
        const m = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (m) return m[1].toLowerCase();
      }
    }

    // 3. From profile avatar image alt or title in header
    const avatar = document.querySelector('header img[alt*="@"], div[role="banner"] img[alt*="@"], header img[title*="@"]');
    if (avatar) {
      const m = (avatar.getAttribute('alt') || avatar.getAttribute('title') || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (m) return m[1].toLowerCase();
    }

    // 4. Fallback to active authenticated user session if available
    if (currentAuthUser && currentAuthUser.email) {
      return currentAuthUser.email.toLowerCase();
    }

    return null;
  }

  // Extract ALL recipients from compose dialog (To, Cc, Bcc chips and inputs)
  function extractAllRecipients(dialog) {
    const list = new Set();

    // 1. Email chips in To/Cc/Bcc
    dialog.querySelectorAll('[email]').forEach(el => {
      const val = el.getAttribute('email');
      if (val && val.includes('@')) list.add(val.trim().toLowerCase());
    });

    // 2. Hovercards with email
    dialog.querySelectorAll('[data-hovercard-id*="@"]').forEach(el => {
      const val = el.getAttribute('data-hovercard-id');
      if (val && val.includes('@')) list.add(val.trim().toLowerCase());
    });

    // 3. Inputs and textareas for to, cc, bcc
    dialog.querySelectorAll('input[name="to"], input[name="cc"], input[name="bcc"], textarea[name="to"], textarea[name="cc"], textarea[name="bcc"]').forEach(input => {
      const val = input.value;
      if (val) {
        val.split(/[,;\s]+/).forEach(part => {
          const cleaned = part.replace(/[<>]/g, '').trim().toLowerCase();
          if (cleaned.includes('@') && cleaned.includes('.')) list.add(cleaned);
        });
      }
    });

    // 4. Fallback: innerText of To/Cc containers
    if (list.size === 0) {
      const toAreas = dialog.querySelectorAll('div[name="to"], div[name="cc"], div[name="bcc"], tr[aria-label*="To"], tr[aria-label*="Cc"], div[aria-label*="To"], div[aria-label*="Cc"]');
      toAreas.forEach(area => {
        const text = area.innerText || '';
        const matches = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
        if (matches) matches.forEach(m => list.add(m.trim().toLowerCase()));
      });
    }

    const arr = Array.from(list);
    return arr.length > 0 ? arr : ['Recipient'];
  }

  // Fetch active server config & auth user
  function fetchConfig() {
    if (!isAlive()) return;
    try {
      chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (res) => {
        if (!isAlive() || chrome.runtime.lastError) return;
        if (res && res.success) {
          if (res.config && res.config.publicUrl) publicTrackingUrl = res.config.publicUrl;
          if (res.user) currentAuthUser = res.user;
          if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
            renderNotificationsDropdown();
          }
        }
      });
    } catch { }
  }

  // Fetch full email list from background with direct local fallback
  let isFetchingEmails = false;
  let lastFetchEmailsTime = 0;

  function fetchAllTrackedEmails(force = false) {
    const now = Date.now();
    if (isFetchingEmails && !force) return;
    if (!force && now - lastFetchEmailsTime < 1800) return;

    isFetchingEmails = true;
    lastFetchEmailsTime = now;
    const activeEmail = getCurrentGmailUser() || (currentAuthUser && currentAuthUser.email) || null;
    fetchConfig();

    function applyEmailsData(data) {
      isFetchingEmails = false;
      if (data && data.success && data.emails) {
        trackedEmails = data.emails;
        if (data.user) {
          currentAuthUser = data.user;
          if (ws && ws.readyState === WebSocket.OPEN && currentAuthUser.apiKey) {
            try { ws.send(JSON.stringify({ type: 'AUTH', token: currentAuthUser.apiKey })); } catch { }
          }
        }

        // Calculate unread count for activity that happened since last seen
        try {
          let lastSeenTime = parseInt(localStorage.getItem('mt_last_seen_activity_time') || '0', 10);
          if (!lastSeenTime) {
            lastSeenTime = Date.now();
            localStorage.setItem('mt_last_seen_activity_time', lastSeenTime.toString());
            unreadNotificationsCount = 0;
            updateNavBadgeCount(0);
          } else {
            let unseenCount = 0;
            trackedEmails.forEach(e => {
              const openTime = e.lastOpenedAt ? new Date(e.lastOpenedAt).getTime() : (e.opens && e.opens.length ? new Date(e.opens[e.opens.length - 1].timestamp).getTime() : 0);
              const createTime = e.createdAt ? new Date(e.createdAt).getTime() : 0;
              const latestTime = Math.max(openTime, createTime);
              if (latestTime > lastSeenTime) {
                unseenCount++;
                newOpenedEmailIds.add(e.id);
              }
            });
            unreadNotificationsCount = unseenCount;
            updateNavBadgeCount(unreadNotificationsCount);
          }
        } catch (e) { }

        updateAllRows();
        updateOpenThreadHeader();
        if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
          renderNotificationsDropdown();
        }
      }
    }

    function fetchDirect() {
      const q = activeEmail ? `?email=${encodeURIComponent(activeEmail)}` : '';
      fetch(`${getServerUrl()}/api/emails${q}`)
        .then(r => r.json())
        .then(applyEmailsData)
        .catch(() => { isFetchingEmails = false; });
    }

    if (isAlive()) {
      try {
        chrome.runtime.sendMessage({ action: 'GET_TRACKED_EMAILS', email: activeEmail }, (res) => {
          if (!chrome.runtime.lastError && res && res.success) {
            applyEmailsData(res);
          } else {
            fetchDirect();
          }
        });
        return;
      } catch { }
    }
    fetchDirect();
  }

  // -------------------------------------------------------------------------
  // ⚡ DIRECT WEBSOCKET CONNECTION & MESSAGE BUS (Zero Polling Needed)
  // -------------------------------------------------------------------------
  let wsConnecting = false;
  async function initDirectWebSocket() {
    if (wsConnecting) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    wsConnecting = true;

    try {
      const sUrl = getServerUrl();
      const res = await fetch(`${sUrl}/api/config`, { cache: 'no-store' });
      if (!res.ok) {
        wsConnecting = false;
        setTimeout(initDirectWebSocket, 6000);
        return;
      }

      const activeEmail = (currentAuthUser && currentAuthUser.email) || getCurrentGmailUser();
      const authQuery = currentAuthUser && currentAuthUser.apiKey
        ? `?apiKey=${encodeURIComponent(currentAuthUser.apiKey)}`
        : (activeEmail ? `?email=${encodeURIComponent(activeEmail)}` : '');
      const wsProto = sUrl.startsWith('https:') ? 'wss:' : 'ws:';
      const wsHost = sUrl.replace(/^https?:\/\//, '');
      const socket = new WebSocket(`${wsProto}//${wsHost}${authQuery}`);
      ws = socket;

      socket.onopen = () => {
        wsConnecting = false;
        console.log('[Mail Track] ⚡ WebSocket active for sub-second updates.');
        if (currentAuthUser && currentAuthUser.apiKey) {
          try {
            socket.send(JSON.stringify({ type: 'AUTH', token: currentAuthUser.apiKey }));
          } catch { }
        } else if (activeEmail) {
          try {
            socket.send(JSON.stringify({ type: 'AUTH', email: activeEmail }));
          } catch { }
        }
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'EMAIL_OPENED' && payload.data && payload.data.email) {
            handleInstantOpen(payload.data.email);
          } else if (payload.type === 'EMAIL_CREATED') {
            incrementUnreadCount();
            fetchAllTrackedEmails(true);
          } else if (payload.type === 'LINK_CLICKED') {
            if (payload.data && payload.data.email) {
              handleInstantOpen(payload.data.email);
            }
            incrementUnreadCount();
            fetchAllTrackedEmails(true);
          }
        } catch (e) { }
      };

      socket.onclose = () => {
        if (ws === socket) ws = null;
        wsConnecting = false;
        setTimeout(initDirectWebSocket, 4000);
      };

      socket.onerror = () => {
        try { socket.close(); } catch (e) { }
      };
    } catch (e) {
      wsConnecting = false;
      setTimeout(initDirectWebSocket, 4000);
    }
  }

  // Also listen for broadcasts forwarded from background service worker
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'EMAIL_OPENED' && (message.email || message.data?.email)) {
        // If direct WebSocket is connected and already handled this event, skip background duplicate
        if (ws && ws.readyState === WebSocket.OPEN) return;
        handleInstantOpen(message.email || message.data?.email);
      } else if (message.type === 'EMAIL_CREATED') {
        incrementUnreadCount();
        fetchAllTrackedEmails(true);
      } else if (message.type === 'LINK_CLICKED') {
        const email = message.email || message.data?.email;
        if (email) {
          handleInstantOpen(email);
        }
        incrementUnreadCount();
        fetchAllTrackedEmails(true);
      } else if (message.type === 'AUTH_UPDATED' || message.type === 'AUTH_STATUS_CHANGED') {
        if (message.user && message.authenticated !== false) {
          currentAuthUser = message.user;
          if (ws && ws.readyState === WebSocket.OPEN && currentAuthUser.apiKey) {
            try {
              ws.send(JSON.stringify({ type: 'AUTH', token: currentAuthUser.apiKey }));
            } catch { }
          }
        } else {
          currentAuthUser = null;
          try { sessionStorage.removeItem('mt_auth_alert_dismissed'); } catch {}
        }
        updateTopNavBtnAuthState();
        updateComposeButtonsAuthState();
        if (isUserAuthenticated()) {
          dismissAuthModal();
        } else {
          showAuthPromptModal(true);
        }
        if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
          renderNotificationsDropdown();
        }
        fetchAllTrackedEmails(true);
      } else if (message.type === 'CONFIG_UPDATED') {
        fetchAllTrackedEmails(true);
      }
    });
  } catch (e) { }

  // Listen for login broadcasts from /auth/extension-success
  window.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'MAILTRACK_AUTH_SUCCESS' || event.data.action === 'AUTH_SUCCESS_BRIDGE')) {
      console.log('[Mail Track] Authentication event captured from window postMessage:', event.data.user || event.data);
      const user = event.data.user || (event.data.apiKey ? { apiKey: event.data.apiKey, email: event.data.email, name: event.data.name } : null);
      if (user) {
        currentAuthUser = user;
        if (ws && ws.readyState === WebSocket.OPEN && currentAuthUser.apiKey) {
          try {
            ws.send(JSON.stringify({ type: 'AUTH', token: currentAuthUser.apiKey }));
          } catch { }
        }
      }
      updateTopNavBtnAuthState();
      updateComposeButtonsAuthState();
      dismissAuthModal();
      chrome.runtime.sendMessage({ action: 'GET_AUTH_STATUS' }, () => {
        fetchAllTrackedEmails(true);
      });
    }
  });

  // Handle instant open event in < 50ms
  function handleInstantOpen(openedEmail) {
    if (!openedEmail || !openedEmail.id) return;

    // Strict account isolation: verify event belongs to this logged-in account
    if (currentAuthUser && currentAuthUser.id && openedEmail.userId && openedEmail.userId !== currentAuthUser.id) {
      return;
    }
    const currentTabEmail = getCurrentGmailUser();
    if (currentTabEmail && openedEmail.sender && openedEmail.sender.includes('@')) {
      if (openedEmail.sender.toLowerCase().trim() !== currentTabEmail.toLowerCase().trim()) {
        return;
      }
    }

    console.log(`[Mail Track] 🔥 INSTANT READ DETECTED: "${openedEmail.subject}" (openCount: ${openedEmail.openCount})`);

    const idx = trackedEmails.findIndex(e => e.id === openedEmail.id);
    if (idx !== -1) {
      trackedEmails[idx] = openedEmail;
    } else {
      trackedEmails.unshift(openedEmail);
    }

    // Flag as new unread notification for red dot indication
    newOpenedEmailIds.add(openedEmail.id);
    readNotificationIds.delete(openedEmail.id);

    // Subtle audio chime (respects user sound preference)
    const soundEnabled = currentAuthUser?.settings?.soundNotifications !== false;
    if (soundEnabled) {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        const now = audioCtx.currentTime;
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.12, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start(now);
        osc1.stop(now + 0.25);

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.08);
        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.setValueAtTime(0.14, now + 0.08);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(now + 0.08);
        osc2.stop(now + 0.45);
      } catch { }
    }

    const openCount = openedEmail.openCount || (openedEmail.opens ? openedEmail.opens.length : 1);
    const countPill = openCount > 1 ? `<span class="mt-count-pill">${openCount}</span>` : '';

    // Find row on screen and pop to Double Green Tick + count pill
    const rows = document.querySelectorAll('tr.zA');
    const targetSubject = (openedEmail.subject || '').toLowerCase().trim();

    rows.forEach((row) => {
      const rowId = row.getAttribute('data-mt-id');
      const rowText = row.textContent.toLowerCase();
      const isMatch = (rowId && rowId === openedEmail.id) || 
                      (targetSubject && (rowText.includes(targetSubject) || targetSubject.includes(rowText.substring(0, 25))));
      if (isMatch) {
        row.setAttribute('data-mt-state', 'opened');
        row.setAttribute('data-mt-id', openedEmail.id);
        let badge = row.querySelector('.mt-tick-container');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'mt-tick-container';
          const mountCell = row.querySelector('.yX, .yW') || row.querySelector('.xY') || row.firstElementChild;
          if (mountCell) mountCell.insertBefore(badge, mountCell.firstChild);
        }
        if (badge) {
          badge.className = 'mt-tick-container opened pop-animation';
          badge.setAttribute('data-mt-id', openedEmail.id);
          badge.setAttribute('data-mt-count', openCount);
          badge.innerHTML = `${SVG_DOUBLE_CHECK}${countPill}`;
        }
      }
    });

    // Increment topnav notification badge on open event
    newOpenedEmailIds.add(openedEmail.id);
    incrementUnreadCount();

    if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
      renderNotificationsDropdown();
    }

    updateAllRows();
  }

  // -------------------------------------------------------------------------
  // 1. RENDER TICKS IN GMAIL ROWS (Inline Time, Zero Tooltips, Zero Lag)
  // -------------------------------------------------------------------------
  function updateAllRows() {
    const rows = document.querySelectorAll('tr.zA');
    if (!rows || rows.length === 0) return;

    const isSent = window.location.hash.includes('#sent') ||
      window.location.hash.includes('#all') ||
      document.title.toLowerCase().includes('sent');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const boundId = row.getAttribute('data-mt-id');
      const subjectEl = row.querySelector('.bog, .bqe, span[data-thread-id]');
      const recipientEl = row.querySelector('.yX, .yW, .yP, .zF');

      let subjectText = '';
      if (subjectEl) subjectText = subjectEl.textContent.trim().toLowerCase();

      let recipientText = '';
      if (recipientEl) recipientText = recipientEl.textContent.trim().toLowerCase();

      let matched = null;
      if (boundId) {
        matched = trackedEmails.find(e => e.id === boundId);
      }

      const rowThreadId = row.getAttribute('data-thread-id') || 
                          row.getAttribute('data-legacy-thread-id') ||
                          subjectEl?.getAttribute('data-thread-id') ||
                          subjectEl?.getAttribute('data-legacy-thread-id');

      if (!matched && rowThreadId) {
        matched = trackedEmails.find(e => e.threadId && (e.threadId === rowThreadId || rowThreadId.includes(e.threadId) || e.threadId.includes(rowThreadId)));
      }

      if (!matched && subjectText) {
        const cleanStr = (str) => (str || '').toLowerCase().replace(/^(re|fwd):\s*/ig, '').replace(/\s+/g, ' ').trim();
        const cleanSubText = cleanStr(subjectText);

        matched = trackedEmails.find(e => {
          if (!e.subject || e.subject === 'No Subject') return false;
          const cleanEmailSub = cleanStr(e.subject);
          return cleanSubText === cleanEmailSub || cleanSubText.includes(cleanEmailSub) || cleanEmailSub.includes(cleanSubText);
        });

        if (matched) {
          row.setAttribute('data-mt-id', matched.id);
        }
      }

      let isTracked = false;
      let isOpened = false;

      if (matched) {
        isTracked = true;
        isOpened = matched.status === 'opened' || (matched.opens && matched.opens.length > 0);
      } else if (isSent) {
        isTracked = true;
        isOpened = false;
      }

      const targetState = isTracked ? (isOpened ? 'opened' : 'unread') : 'none';
      const currentState = row.getAttribute('data-mt-state');
      let badge = row.querySelector('.mt-tick-container');

      // Hide duplicate native Gmail mobile labels (✓ and ✓✓) on desktop Gmail so only our clean extension checkmark displays
      row.querySelectorAll('.av, .ar, .at, span, div').forEach(el => {
        const txt = el.textContent ? el.textContent.trim() : '';
        if (txt === '✓' || txt === '✓✓' || el.getAttribute('title') === '✓' || el.getAttribute('title') === '✓✓' || el.getAttribute('data-label-name') === '✓' || el.getAttribute('data-label-name') === '✓✓') {
          const chip = el.closest('.av, .ar, .at') || el;
          chip.style.setProperty('display', 'none', 'important');
        }
      });

      const targetCount = matched ? (matched.openCount || (matched.opens ? matched.opens.length : 0)) : (isOpened ? 1 : 0);
      const currentCount = badge ? parseInt(badge.getAttribute('data-mt-count') || '0', 10) : 0;

      // Skip ONLY if badge is already present, state matches, AND open count matches
      if (badge && currentState === targetState && currentCount === targetCount) {
        if (matched && !badge.getAttribute('data-mt-id')) {
          badge.setAttribute('data-mt-id', matched.id);
        }
        const oldTime = badge.querySelector('.mt-open-time');
        if (oldTime) oldTime.remove();
        continue;
      }

      row.setAttribute('data-mt-state', targetState);

      if (isTracked) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'mt-tick-container';

          // Mount inside td.yX (recipient cell) or td.xY (subject cell) as firstChild
          const mountCell = row.querySelector('.yX, .yW') || row.querySelector('.xY') || row.firstElementChild;
          if (mountCell) {
            mountCell.insertBefore(badge, mountCell.firstChild);
          }
        }

        if (matched) {
          badge.setAttribute('data-mt-id', matched.id);
        }

        badge.setAttribute('data-mt-count', targetCount);

        if (isOpened) {
          badge.className = 'mt-tick-container opened';
          const countPill = targetCount > 1 ? `<span class="mt-count-pill">${targetCount}</span>` : '';
          badge.innerHTML = `${SVG_DOUBLE_CHECK}${countPill}`;
        } else {
          badge.className = 'mt-tick-container unread';
          badge.innerHTML = SVG_SINGLE_CHECK;
        }
      } else if (badge) {
        badge.remove();
      }
    }
  }

  // -------------------------------------------------------------------------
  // 1b. OPEN THREAD / EMAIL VIEW: NO STATUS PILL OR STATES INSIDE EMAIL
  // -------------------------------------------------------------------------
  function updateOpenThreadHeader() {
    // 1. Remove status pill from the email when opened in Gmail
    const statusPills = document.querySelectorAll('.mt-thread-status-pill');
    statusPills.forEach(p => p.remove());

    // 2. Neutralize any tracking pixels inside viewed email bodies to prevent desktop self-opens
    const viewImgs = document.querySelectorAll('div.a3s img[src*="/trace/mail/"], div.ii.gt img[src*="/trace/mail/"]');
    viewImgs.forEach(img => {
      if (!img.closest('div[role="dialog"], div.M9, div.AD')) {
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        img.removeAttribute('src');
        img.remove();
      }
    });
  }

  // -------------------------------------------------------------------------
  // 2. SYNCHRONOUS COMPOSE INJECTION WITH CLOUDFLARE BEACON
  // -------------------------------------------------------------------------
  // Universal compose tracking injector (called on mouse click, touch, or Cmd+Enter / Ctrl+Enter)
  function injectTrackingIntoCompose(dialog) {
    if (!dialog) return;

    // Hard block: do NOT enable or inject tracking until user logs in
    if (!isUserAuthenticated()) {
      untrackLinksInBody(dialog);
      const body = dialog.querySelector('div[role="textbox"][aria-label*="Message Body" i], div[contenteditable="true"]');
      if (body) {
        const img = body.querySelector('img[src*="/trace/mail/"]');
        if (img) img.remove();
      }
      showAuthPromptModal(true);
      return;
    }

    // Check if tracking is explicitly disabled via toggle or attribute
    if (dialog.getAttribute('data-mt-track-mail') === 'false') {
      untrackLinksInBody(dialog);
      const body = dialog.querySelector('div[role="textbox"][aria-label*="Message Body" i], div[contenteditable="true"]');
      if (body) {
        const img = body.querySelector('img[src*="/trace/mail/"]');
        if (img) img.remove();
      }
      return;
    }

    const logoBtn = dialog.querySelector('.mt-compose-logo-btn');
    if (logoBtn && logoBtn.classList.contains('disabled')) {
      return;
    }

    const body = dialog.querySelector('div[role="textbox"][aria-label*="Message Body" i], div[contenteditable="true"]');
    if (!body) return;

    // Prevent duplicate injection
    if (body.innerHTML.includes('/trace/mail/') || dialog.getAttribute('data-mt-injected') === 'true') {
      return;
    }
    dialog.setAttribute('data-mt-injected', 'true');

    // Extract subject (handles normal compose & inline replies)
    const subjectEl = dialog.querySelector('input[name="subjectbox"]');
    let subject = subjectEl ? subjectEl.value.trim() : '';
    if (!subject || subject === 'No Subject') {
      const threadHeading = document.querySelector('h2.hP');
      if (threadHeading && threadHeading.textContent.trim()) {
        subject = threadHeading.textContent.trim();
      } else if (document.title) {
        subject = document.title
          .replace(/\s*-\s*[^@]+@[^-\s]+\s*-\s*Gmail$/i, '')
          .replace(/\s*-\s*Gmail$/i, '')
          .trim();
      }
    }
    if (!subject) subject = 'No Subject';

    const recipients = extractAllRecipients(dialog);
    const recipient = recipients.join(', ');

    // Extract sender email - check the dialog's own "From" field ONLY if there is an explicit From row/selector
    let sender = null;
    const fromEl = dialog.querySelector(
      'tr[aria-label*="From" i] input, ' +
      'tr[aria-label*="From" i] select, ' +
      'tr[aria-label*="From" i] [role="combobox"], ' +
      'input[name="from"], ' +
      'select[name="from"], ' +
      '[aria-label*="Send mail as" i], ' +
      'div[aria-label*="From:" i]'
    );
    if (fromEl) {
      const fromVal = fromEl.value || fromEl.getAttribute('aria-label') || fromEl.textContent || '';
      const m = fromVal.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (m) sender = m[1].toLowerCase();
    }

    // Always prefer the active Gmail user of this tab over anything else
    const activeGmailUser = getCurrentGmailUser();
    if (!sender || (recipients.includes(sender) && activeGmailUser && !recipients.includes(activeGmailUser))) {
      sender = activeGmailUser;
    }
    if (!sender) sender = (currentAuthUser && currentAuthUser.email) || 'Me';

    const rootDialog = dialog.closest('div[role="dialog"]') || dialog;
    let trackingId = body.getAttribute('data-mt-tracking-id') ||
                     dialog.getAttribute('data-mt-tracking-id') ||
                     rootDialog.getAttribute('data-mt-tracking-id');
    if (!trackingId) {
      trackingId = generateId();
    }
    body.setAttribute('data-mt-tracking-id', trackingId);
    dialog.setAttribute('data-mt-tracking-id', trackingId);
    rootDialog.setAttribute('data-mt-tracking-id', trackingId);

    let activeTrackingUrl = getServerUrl();
    if (!activeTrackingUrl || activeTrackingUrl.includes('localhost') || !activeTrackingUrl.startsWith('https://')) {
      activeTrackingUrl = DEFAULT_PROD_URL;
    }

    // Auto-wrap links ONLY if Track Links option is enabled by user
    const trackLinksEnabled = dialog.getAttribute('data-mt-track-links') !== 'false';
    if (trackLinksEnabled) {
      const existingLinks = body.querySelectorAll('a[href]');
      existingLinks.forEach(a => {
        let href = a.getAttribute('href');
        if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
          return;
        }
        // Extract raw target URL if already wrapped
        let rawTargetUrl = href;
        if (href.includes('/trace/link')) {
          try {
            const parsed = new URL(href, window.location.origin);
            const u = parsed.searchParams.get('url');
            if (u) rawTargetUrl = u;
          } catch {}
        }
        // Re-wrap with current email's exact trackingId and metadata query parameters
        const newHref = `${activeTrackingUrl}/trace/link/${trackingId}?url=${encodeURIComponent(rawTargetUrl)}&s=${encodeURIComponent(subject)}&r=${encodeURIComponent(recipient)}&from=${encodeURIComponent(sender)}`;
        a.setAttribute('href', newHref);
      });
    } else {
      // If Track Links is OFF, revert any tracked links back to normal clean destination URLs!
      untrackLinksInBody(dialog);
    }

    const threadId = extractThreadIdFromContext(dialog);

    // Pre-register locally with status 'sent' (Single Tick)
    const localEmail = {
      id: trackingId,
      subject,
      recipient,
      recipients,
      sender,
      threadId,
      createdAt: new Date().toISOString(),
      status: 'sent',
      opens: [],
      clicks: [],
      openCount: 0
    };
    trackedEmails.unshift(localEmail);

    // Embed tracking pixel with metadata query parameters
    const qs = new URLSearchParams();
    if (subject && subject !== 'No Subject') qs.set('s', subject);
    if (recipient && recipient !== 'Recipient') qs.set('r', recipient);
    if (sender && sender.includes('@')) qs.set('from', sender);
    const qsStr = qs.toString() ? `?${qs.toString()}` : '';
    const pixelHtml = `<img src="${activeTrackingUrl}/trace/mail/${trackingId}.png${qsStr}" width="1" height="1" alt="" style="display:inline-block;width:1px;min-width:1px;height:1px;min-height:1px;margin:0;padding:0;border:0;outline:none;opacity:0.01;pointer-events:none;" />`;
    body.insertAdjacentHTML('beforeend', pixelHtml);
    try {
      body.dispatchEvent(new Event('input', { bubbles: true }));
      body.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
    console.log(`[Mail Track] ⚡ Tracking injected for "${subject}" (${trackingId}) using ${activeTrackingUrl} from ${sender} to:`, recipients);

    // Register with backend
    if (isAlive()) {
      try {
        chrome.runtime.sendMessage({
          action: 'CREATE_TRACKED_EMAIL',
          payload: { id: trackingId, subject, recipient, recipients, sender, threadId }
        }, (res) => {
          if (res && res.success && res.data && res.data.email) {
            const idx = trackedEmails.findIndex(e => e.id === trackingId);
            if (idx !== -1) {
              trackedEmails[idx] = res.data.email;
            }
            updateAllRows();
          }
        });

        // Watch for Gmail's "Message sent. View message" toast to capture threadId
        let toastPollCount = 0;
        const toastPollTimer = setInterval(() => {
          toastPollCount++;
          try {
            const toastLink = document.querySelector(
              'a#link_vmsg, span#link_vmsg a, div[role="alert"] a, div.vh a, .b8.UC a, a[href*="#sent/"], a[href*="#inbox/"], a[href*="#all/"]'
            );
            if (toastLink) {
              const href = toastLink.getAttribute('href') || '';
              const m = href.match(/#(?:sent|inbox|all)\/([a-zA-Z0-9]{12,})/i);
              if (m && m[1]) {
                clearInterval(toastPollTimer);
                const localItem = trackedEmails.find(e => e.id === trackingId);
                if (localItem) {
                  localItem.threadId = m[1];
                  updateAllRows();
                }
                if (isAlive()) {
                  chrome.runtime.sendMessage({
                    action: 'BIND_THREAD_ID',
                    emailId: trackingId,
                    threadId: m[1]
                  });
                }
              }
            }
          } catch { }
          if (toastPollCount > 25) clearInterval(toastPollTimer);
        }, 300);
      } catch { }
    }
  }

  // -------------------------------------------------------------------------
  // 2. SYNCHRONOUS COMPOSE INJECTION & SEND BUTTON SETUP
  // -------------------------------------------------------------------------
  function setupComposeButtons() {
    const dialogs = document.querySelectorAll('div[role="dialog"], div.M9, div.AD, div[role="region"], table.cf.An');

    dialogs.forEach((dialog) => {
      const sendBtn = dialog.querySelector(
        'div[role="button"][data-tooltip*="Send" i], ' +
        'div[role="button"][aria-label*="Send" i], ' +
        'div.T-I.J-J5-Ji.aoO.v7, ' +
        'div.aoO, ' +
        'div.T-I-atl, ' +
        'div[data-tooltip*="Enter" i]'
      );
      if (!sendBtn) return;

      // Attach send triggers (mousedown, pointerdown, click) to ensure injection runs regardless of speed
      if (!sendBtn.getAttribute('data-mt-bound')) {
        sendBtn.setAttribute('data-mt-bound', 'true');
        const handleSendAttempt = () => {
          if (!isUserAuthenticated()) {
            showAuthPromptModal(true);
            return;
          }
          injectTrackingIntoCompose(dialog);
        };
        sendBtn.addEventListener('mousedown', handleSendAttempt, true);
        sendBtn.addEventListener('pointerdown', handleSendAttempt, true);
        sendBtn.addEventListener('click', handleSendAttempt, true);
      }

      // Avoid injecting multiple logo buttons
      if (dialog.querySelector('.mt-compose-logo-btn')) return;

      const isAuth = isUserAuthenticated();
      let isTracking = isAuth;
      let isTrackLinks = isAuth;

      dialog.setAttribute('data-mt-track-mail', isAuth ? 'true' : 'false');
      dialog.setAttribute('data-mt-track-links', isAuth ? 'true' : 'false');

      if (isAuth && isAlive() && chrome.storage?.local) {
        chrome.storage.local.get(['mailtrack_track_mail', 'mailtrack_track_links'], (res) => {
          if (res) {
            if (typeof res.mailtrack_track_mail === 'boolean') {
              isTracking = res.mailtrack_track_mail;
            }
            if (typeof res.mailtrack_track_links === 'boolean') {
              isTrackLinks = res.mailtrack_track_links;
            }
            dialog.setAttribute('data-mt-track-mail', isTracking ? 'true' : 'false');
            dialog.setAttribute('data-mt-track-links', isTrackLinks ? 'true' : 'false');
            updateLogoBtnState();
          }
        });
      }

      const logoUrl = isAlive() && chrome.runtime?.getURL ? chrome.runtime.getURL('icons/logo-compose.png') : '';

      const logoBtn = document.createElement('div');
      logoBtn.className = isAuth ? 'mt-compose-logo-btn active' : 'mt-compose-logo-btn unlinked disabled';
      logoBtn.title = isAuth ? 'Mail Track: Tracking ON (Links ON) — Click for options' : 'Mail Track: Tracking Disabled — Please log in to connect your Google account';
      logoBtn.setAttribute('role', 'button');
      logoBtn.setAttribute('tabindex', '0');
      logoBtn.innerHTML = `
        <div class="mt-compose-logo-wrap" title="Mail Track">
          <svg class="mt-compose-logo-svg" width="24" height="24" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="36" height="36" rx="8" class="mt-logo-bg" fill="${isAuth ? '#059669' : '#94a3b8'}"/>
            <g transform="translate(5, 5)">
              <path d="M12.5688 14.9068L14.0985 16.4364L23.2695 7.26537L24.8016 8.79743L14.0985 19.5005L7.20417 12.6062L8.73623 11.0742L11.0381 13.376L12.5688 14.9068ZM12.5707 11.8434L17.936 6.47799L19.4638 8.0058L14.0985 13.3711L12.5707 11.8434ZM9.5084 17.9698L7.97762 19.5005L1.08333 12.6062L2.61539 11.0742L4.14617 12.605L4.14488 12.6062L9.5084 17.9698Z" fill="white"/>
            </g>
          </svg>
        </div>
      `;

      function updateLogoBtnState() {
        const currentIsAuth = isUserAuthenticated();
        const bgRect = logoBtn.querySelector('.mt-logo-bg');
        if (!currentIsAuth) {
          logoBtn.className = 'mt-compose-logo-btn unlinked disabled';
          logoBtn.title = 'Mail Track: Tracking Disabled — Please log in to connect your Google account';
          if (bgRect) bgRect.setAttribute('fill', '#94a3b8');
        } else if (isTracking) {
          logoBtn.className = 'mt-compose-logo-btn active';
          const linkNote = isTrackLinks ? 'Links ON' : 'Links OFF';
          logoBtn.title = `Mail Track: Tracking ON (${linkNote}) — Click for options`;
          if (bgRect) bgRect.setAttribute('fill', '#059669');
        } else {
          logoBtn.className = 'mt-compose-logo-btn disabled';
          logoBtn.title = 'Mail Track: Tracking OFF — Click for options';
          if (bgRect) bgRect.setAttribute('fill', '#94a3b8');
        }
      }

      logoBtn.onclick = (e) => {
        e.stopPropagation();
        if (!isUserAuthenticated()) {
          showAuthPromptModal(true);
          return;
        }
        toggleComposeDropdown(
          dialog,
          logoBtn,
          () => ({ isTracking, isTrackLinks }),
          (key, val) => {
            if (key === 'mail') {
              isTracking = val;
              dialog.setAttribute('data-mt-user-set', 'true');
              dialog.setAttribute('data-mt-track-mail', val ? 'true' : 'false');
              if (isAlive() && chrome.storage?.local) {
                chrome.storage.local.set({ mailtrack_track_mail: val });
              }
            } else if (key === 'links') {
              isTrackLinks = val;
              dialog.setAttribute('data-mt-user-set', 'true');
              dialog.setAttribute('data-mt-track-links', val ? 'true' : 'false');
              if (isAlive() && chrome.storage?.local) {
                chrome.storage.local.set({ mailtrack_track_links: val });
              }
              if (!val) {
                untrackLinksInBody(dialog);
              }
            }
            updateLogoBtnState();
          }
        );
      };

      const sendContainer = sendBtn.closest('.dC') || sendBtn.parentElement;
      if (sendContainer && sendContainer.parentElement) {
        sendContainer.parentElement.insertBefore(logoBtn, sendContainer.nextSibling);
      } else {
        sendBtn.parentElement.appendChild(logoBtn);
      }
    });
  }

  // Intercept keyboard shortcut sends (Cmd+Enter on Mac, Ctrl+Enter on Windows)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.keyCode === 13)) {
      if (!isUserAuthenticated()) {
        showAuthPromptModal(true);
        return;
      }
      const activeEl = document.activeElement;
      const dialog = activeEl ? activeEl.closest('div[role="dialog"], div.M9, div.AD, div[role="region"], table.cf.An') : null;
      if (dialog) {
        injectTrackingIntoCompose(dialog);
      } else {
        const anyDialog = document.querySelector('div[role="dialog"], div.M9, div.AD, table.cf.An');
        if (anyDialog) {
          injectTrackingIntoCompose(anyDialog);
        }
      }
    }
  }, true);

  // Global capture listeners to intercept clicks on ANY Send button across Gmail
  function handleUniversalSendCapture(e) {
    if (!e || !e.target) return;
    const target = e.target;
    const sendBtn = target.closest(
      'div[role="button"][data-tooltip*="Send" i], ' +
      'div[role="button"][aria-label*="Send" i], ' +
      'div.T-I.J-J5-Ji.aoO, ' +
      'div.aoO, ' +
      'div.T-I-atl, ' +
      'div[data-tooltip*="Enter" i], ' +
      '[aria-label*="Send ‪("], ' +
      '[aria-label*="Send ("]'
    );
    if (sendBtn) {
      if (!isUserAuthenticated()) {
        showAuthPromptModal(true);
        return;
      }
      const dialog = sendBtn.closest('div[role="dialog"], div.M9, div.AD, div[role="region"], table.cf.An') ||
                     document.querySelector('div[role="dialog"], div.M9, div.AD, table.cf.An');
      if (dialog) {
        injectTrackingIntoCompose(dialog);
      }
    }
  }

  document.addEventListener('pointerdown', handleUniversalSendCapture, true);
  document.addEventListener('mousedown', handleUniversalSendCapture, true);
  document.addEventListener('click', handleUniversalSendCapture, true);

  function extractThreadIdFromContext(dialog) {
    if (!dialog) return null;
    const attr = dialog.getAttribute('data-thread-id') || dialog.getAttribute('data-legacy-thread-id');
    if (attr) return attr;

    const parentThread = dialog.closest('[data-thread-id]');
    if (parentThread) return parentThread.getAttribute('data-thread-id');

    const hashMatch = window.location.hash.match(/#(?:inbox|sent|all|category\/[^/]+|label\/[^/]+)\/([a-zA-Z0-9]{12,})/i);
    if (hashMatch) return hashMatch[1];

    return null;
  }

  // -------------------------------------------------------------------------
  // COMPOSE LOGO DROPDOWN CONTROLLER
  // -------------------------------------------------------------------------
  let activeComposeDropdown = null;
  let composeDropdownEl = null;

  function closeComposeDropdown() {
    if (activeComposeDropdown) {
      activeComposeDropdown.classList.remove('visible');
      activeComposeDropdown = null;
    }
  }

  // Remove tracking wrappers from links in compose body when link tracking is turned OFF
  function untrackLinksInBody(dialog) {
    if (!dialog) return;
    const body = dialog.querySelector('div[role="textbox"][aria-label*="Message Body" i], div[contenteditable="true"]');
    if (!body) return;
    const links = body.querySelectorAll('a[href*="/trace/link"]');
    links.forEach(a => {
      try {
        const u = new URL(a.getAttribute('href'), window.location.origin);
        const originalUrl = u.searchParams.get('url');
        if (originalUrl) {
          a.setAttribute('href', originalUrl);
        }
      } catch {}
    });
  }

  function toggleComposeDropdown(dialog, logoBtn, getState, setState) {
    if (activeComposeDropdown && activeComposeDropdown._sourceBtn === logoBtn) {
      closeComposeDropdown();
      return;
    }

    closeComposeDropdown();

    if (!composeDropdownEl) {
      composeDropdownEl = document.createElement('div');
      composeDropdownEl.className = 'mt-compose-dropdown';
      document.body.appendChild(composeDropdownEl);

      composeDropdownEl.addEventListener('click', (e) => e.stopPropagation());
      composeDropdownEl.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const state = (typeof getState === 'function') ? getState() : { isTracking: true, isTrackLinks: true };
    const isTracking = (state && typeof state.isTracking === 'boolean') ? state.isTracking : true;
    const isTrackLinks = (state && typeof state.isTrackLinks === 'boolean') ? state.isTrackLinks : true;

    composeDropdownEl.innerHTML = `
      <div class="mt-cd-header">
        <span class="mt-cd-title">Mail Track Settings</span>
      </div>

      <div class="mt-cd-body">
        <!-- Option 1: Track Mail Toggle -->
        <div class="mt-cd-row mt-cd-toggle-row" id="mtCdToggleRow">
          <div class="mt-cd-row-texts">
            <div class="mt-cd-label">Track Mail</div>
            <div class="mt-cd-desc">Notify when email is opened</div>
          </div>
          <label class="mt-switch" title="Toggle Mail Tracking">
            <input type="checkbox" id="mtCdTrackSwitch" ${isTracking ? 'checked' : ''} />
            <span class="mt-switch-slider"></span>
          </label>
        </div>

        <div class="mt-cd-divider"></div>

        <!-- Option 2: Track Links Toggle (Active & Enabled) -->
        <div class="mt-cd-row mt-cd-toggle-row" id="mtCdLinksToggleRow">
          <div class="mt-cd-row-texts">
            <div class="mt-cd-label">Track Links</div>
            <div class="mt-cd-desc">Track clicks with real-time stats</div>
          </div>
          <label class="mt-switch" title="Toggle Link Tracking">
            <input type="checkbox" id="mtCdTrackLinksSwitch" ${isTrackLinks ? 'checked' : ''} />
            <span class="mt-switch-slider"></span>
          </label>
        </div>

        <div class="mt-cd-divider"></div>

        <!-- Option 3: Insert Tracked Link (Modal action) -->
        <div class="mt-cd-row mt-cd-action-row" id="mtCdAddLinkRow" title="Insert a tracked link with custom text">
          <div class="mt-cd-row-texts">
            <div class="mt-cd-label">Insert Tracked Link</div>
            <div class="mt-cd-desc">Add styled link with tracking</div>
          </div>
          <div class="mt-cd-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </div>
      </div>
    `;

    // Position dropdown smoothly above logoBtn
    const rect = logoBtn.getBoundingClientRect();
    const dropdownWidth = 240;
    const dropdownHeight = 205;

    let left = rect.left;
    if (left + dropdownWidth > window.innerWidth - 12) {
      left = window.innerWidth - dropdownWidth - 12;
    }
    if (left < 12) left = 12;

    let top = rect.top - dropdownHeight - 8;
    if (top < 10) {
      top = rect.bottom + 8;
    }

    composeDropdownEl.style.position = 'fixed';
    composeDropdownEl.style.left = `${Math.round(left)}px`;
    composeDropdownEl.style.top = `${Math.round(top)}px`;
    composeDropdownEl.style.right = 'auto';
    composeDropdownEl.classList.add('visible');
    composeDropdownEl._sourceBtn = logoBtn;
    activeComposeDropdown = composeDropdownEl;

    // 1. Mail Track switch handling
    const mailSwitch = composeDropdownEl.querySelector('#mtCdTrackSwitch');
    const mailRow = composeDropdownEl.querySelector('#mtCdToggleRow');
    if (mailRow) {
      mailRow.onclick = (e) => {
        if (e.target.closest('.mt-switch')) return;
        const currentVal = mailSwitch ? mailSwitch.checked : isTracking;
        const newVal = !currentVal;
        if (mailSwitch) mailSwitch.checked = newVal;
        if (typeof setState === 'function') setState('mail', newVal);
      };
    }
    if (mailSwitch) {
      mailSwitch.onchange = (e) => {
        e.stopPropagation();
        if (typeof setState === 'function') setState('mail', mailSwitch.checked);
      };
    }

    // 2. Links Track switch handling
    const linksSwitch = composeDropdownEl.querySelector('#mtCdTrackLinksSwitch');
    const linksRow = composeDropdownEl.querySelector('#mtCdLinksToggleRow');
    if (linksRow) {
      linksRow.onclick = (e) => {
        if (e.target.closest('.mt-switch')) return;
        const currentVal = linksSwitch ? linksSwitch.checked : isTrackLinks;
        const newVal = !currentVal;
        if (linksSwitch) linksSwitch.checked = newVal;
        if (typeof setState === 'function') setState('links', newVal);
      };
    }
    if (linksSwitch) {
      linksSwitch.onchange = (e) => {
        e.stopPropagation();
        if (typeof setState === 'function') setState('links', linksSwitch.checked);
      };
    }

    // 3. Insert Tracked Link modal trigger
    const addLinkRow = composeDropdownEl.querySelector('#mtCdAddLinkRow');
    if (addLinkRow) {
      addLinkRow.onclick = (e) => {
        e.stopPropagation();
        closeComposeDropdown();
        openTrackLinkModal(dialog, logoBtn);
      };
    }
  }

  // -------------------------------------------------------------------------
  // GMAIL SELECTION PRESERVATION HELPER
  // -------------------------------------------------------------------------
  function saveDialogSelection(dialog) {
    if (!dialog) return;
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const body = dialog.querySelector('div[role="textbox"][aria-label*="Message Body"], div[contenteditable="true"]');
      if (!body) return;
      const range = sel.getRangeAt(0);
      if (body.contains(range.commonAncestorContainer) || body === range.commonAncestorContainer) {
        const text = sel.toString();
        dialog._mtSavedRange = range.cloneRange();
        dialog._mtSavedText = text ? text.trim() : '';
      }
    } catch { }
  }

  // Globally track selection in active compose dialog
  document.addEventListener('selectionchange', () => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const node = sel.anchorNode;
      if (!node) return;
      const dialog = node.nodeType === Node.ELEMENT_NODE ? node.closest('div[role="dialog"]') : node.parentElement?.closest('div[role="dialog"]');
      if (dialog) {
        saveDialogSelection(dialog);
      }
    } catch { }
  });



  // -------------------------------------------------------------------------
  // TRACKABLE LINK MODAL CONTROLLER (Matching Gmail native Edit Link modal)
  // -------------------------------------------------------------------------
  let activeLinkModal = null;
  let activeLinkBackdrop = null;

  function calculateLinkDialogPosition(dialog, modalWidth, modalHeight) {
    // 1. If native Gmail dialog is currently in DOM, match its position
    const native = document.querySelector('.Kj-JD, div[role="dialog"].modal-dialog, div[aria-modal="true"][role="dialog"]');
    if (native) {
      const r = native.getBoundingClientRect();
      if (r.width > 120 && r.height > 60) {
        return {
          left: Math.max(16, Math.min(window.innerWidth - modalWidth - 16, Math.round(r.left))),
          top: Math.max(16, Math.min(window.innerHeight - modalHeight - 16, Math.round(r.top)))
        };
      }
    }

    // 2. Center directly over active compose window (dialog) where user is typing
    if (dialog && dialog.getBoundingClientRect) {
      const cRect = dialog.getBoundingClientRect();
      if (cRect.width > 200 && cRect.height > 150) {
        let left = Math.round(cRect.left + (cRect.width - modalWidth) / 2);
        let top = Math.round(cRect.top + (cRect.height - modalHeight) / 2 - 25);
        left = Math.max(16, Math.min(window.innerWidth - modalWidth - 16, left));
        top = Math.max(16, Math.min(window.innerHeight - modalHeight - 16, top));
        return { left, top };
      }
    }

    // 3. Fallback: Perfectly centered in the viewport
    return {
      left: Math.max(16, Math.round((window.innerWidth - modalWidth) / 2)),
      top: Math.max(20, Math.round((window.innerHeight - modalHeight) / 2 - 30))
    };
  }

  function openTrackLinkModal(dialog, triggerEl) {
    const body = dialog.querySelector('div[role="textbox"][aria-label*="Message Body"], div[contenteditable="true"]');
    if (!body) return;

    // Check active window selection first, then fall back to cached dialog selection
    let savedRange = null;
    let selectedText = '';

    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        if (body.contains(r.commonAncestorContainer) || body === r.commonAncestorContainer) {
          const t = sel.toString().trim();
          if (t) {
            savedRange = r.cloneRange();
            selectedText = t;
          }
        }
      }
    } catch { }

    if (!selectedText && dialog._mtSavedText) {
      selectedText = dialog._mtSavedText;
    }
    if (!savedRange && dialog._mtSavedRange) {
      savedRange = dialog._mtSavedRange;
    }

    if (!activeLinkBackdrop) {
      activeLinkBackdrop = document.createElement('div');
      activeLinkBackdrop.className = 'mt-link-modal-backdrop';
      document.body.appendChild(activeLinkBackdrop);
    }

    if (!activeLinkModal) {
      activeLinkModal = document.createElement('div');
      activeLinkModal.className = 'mt-link-modal';
      document.body.appendChild(activeLinkModal);

      activeLinkModal.addEventListener('click', (e) => e.stopPropagation());
      activeLinkModal.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // Gmail Native Edit Link layout:
    // 1. Text to display:
    // 2. To what URL should this link go? (URL input)
    // 3. Test this link & real-time tracking indicator
    // 4. Actions: OK and Cancel
    activeLinkModal.innerHTML = `
      <div class="mt-lm-container">
        <div class="mt-lm-header">
          <span class="mt-lm-title">Edit Link</span>
          <button class="mt-lm-close" id="mtLmCloseBtn" title="Close" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="mt-lm-body">
          <div class="mt-lm-field">
            <label class="mt-lm-label" for="mtLmText">Text to display:</label>
            <input type="text" class="mt-lm-input" id="mtLmText" autocomplete="off" spellcheck="false" value="${escapeHtml(selectedText)}" />
          </div>

          <div class="mt-lm-field" id="mtLmTargetGroup">
            <label class="mt-lm-label" for="mtLmUrl" id="mtLmUrlLabel">To what URL should this link go?</label>
            <input type="text" class="mt-lm-input" id="mtLmUrl" placeholder="https://" autocomplete="off" spellcheck="false" />
            <div class="mt-lm-helper-row">
              <a href="#" id="mtLmTestLink" class="mt-lm-test-link" target="_blank" rel="noopener noreferrer" style="visibility:hidden;">Test this link</a>
              <div class="mt-lm-track-badge" id="mtLmTrackBadge">
                ${(dialog.getAttribute('data-mt-track-links') !== 'false') ? `
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span style="color:#059669;">Mail Track real-time click tracking enabled</span>
                ` : `
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                  </svg>
                  <span style="color:#64748b;">Link tracking is turned off for this email</span>
                `}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-lm-footer">
          <button type="button" class="mt-lm-btn-ok" id="mtLmInsertBtn">OK</button>
          <button type="button" class="mt-lm-btn-cancel" id="mtLmCancelBtn">Cancel</button>
        </div>
      </div>
    `;

    // Position modal at the exact same location where Gmail's native dialog opens
    const modalWidth = Math.min(480, window.innerWidth - 32);
    const modalHeight = 240;
    const pos = calculateLinkDialogPosition(dialog, modalWidth, modalHeight);

    activeLinkModal.style.position = 'fixed';
    activeLinkModal.style.width = `${modalWidth}px`;
    activeLinkModal.style.left = `${pos.left}px`;
    activeLinkModal.style.top = `${pos.top}px`;
    activeLinkModal.classList.add('visible');
    activeLinkBackdrop.classList.add('visible');

    const textInput = activeLinkModal.querySelector('#mtLmText');
    const urlInput = activeLinkModal.querySelector('#mtLmUrl');
    const urlLabel = activeLinkModal.querySelector('#mtLmUrlLabel');
    const testLink = activeLinkModal.querySelector('#mtLmTestLink');
    const trackBadge = activeLinkModal.querySelector('#mtLmTrackBadge');
    const insertBtn = activeLinkModal.querySelector('#mtLmInsertBtn');
    const cancelBtn = activeLinkModal.querySelector('#mtLmCancelBtn');
    const closeBtn = activeLinkModal.querySelector('#mtLmCloseBtn');

    // When text is already selected: ask user to enter the URL immediately!
    setTimeout(() => {
      if (selectedText) {
        urlInput.focus();
        urlInput.select();
      } else {
        textInput.focus();
      }
    }, 50);

    let userEditedText = Boolean(selectedText);
    textInput.addEventListener('input', () => {
      userEditedText = textInput.value.length > 0;
    });

    urlInput.addEventListener('input', () => {
      const val = urlInput.value.trim();
      urlInput.style.borderColor = '';

      // If user hasn't typed custom display text, keep display text in sync with entered URL
      if (!userEditedText) {
        textInput.value = val;
      }

      // Update test link
      if (val) {
        let testUrl = val;
        if (!/^https?:\/\//i.test(testUrl)) testUrl = 'https://' + testUrl;
        testLink.href = testUrl;
        testLink.style.visibility = 'visible';
      } else {
        testLink.style.visibility = 'hidden';
      }
    });

    const closeModal = () => {
      if (activeLinkModal) activeLinkModal.classList.remove('visible');
      if (activeLinkBackdrop) activeLinkBackdrop.classList.remove('visible');
      document.removeEventListener('keydown', handleKeydown);
    };

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    document.addEventListener('keydown', handleKeydown);

    activeLinkBackdrop.onclick = closeModal;
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    const doInsert = () => {
      let targetVal = urlInput.value.trim();
      if (!targetVal) {
        urlInput.style.borderColor = '#d93025';
        urlInput.focus();
        return;
      }

      let linkHref = '';
      const displayText = textInput.value.trim() || targetVal;
      const isEmail = /^mailto:/i.test(targetVal);

      if (isEmail) {
        linkHref = targetVal;
      } else {
        if (!/^https?:\/\//i.test(targetVal)) {
          targetVal = 'https://' + targetVal;
        }
        const trackLinksEnabled = dialog.getAttribute('data-mt-track-links') !== 'false';
        if (trackLinksEnabled) {
          // Assign or reuse tracking ID for this email compose dialog across body and dialog
          const rootDialog = dialog.closest('div[role="dialog"]') || dialog;
          let trackingId = body.getAttribute('data-mt-tracking-id') ||
                           dialog.getAttribute('data-mt-tracking-id') ||
                           rootDialog.getAttribute('data-mt-tracking-id');
          if (!trackingId) {
            trackingId = generateId();
          }
          body.setAttribute('data-mt-tracking-id', trackingId);
          dialog.setAttribute('data-mt-tracking-id', trackingId);
          rootDialog.setAttribute('data-mt-tracking-id', trackingId);

          let activeTrackingUrl = getServerUrl();
          if (!activeTrackingUrl || activeTrackingUrl.includes('localhost') || !activeTrackingUrl.startsWith('https://')) {
            activeTrackingUrl = DEFAULT_PROD_URL;
          }
          linkHref = `${activeTrackingUrl}/trace/link/${trackingId}?url=${encodeURIComponent(targetVal)}`;
        } else {
          // Link tracking is turned OFF by user: insert clean direct link!
          linkHref = targetVal;
        }
      }

      const linkHtml = `<a href="${linkHref}" ${isEmail ? '' : 'target="_blank" rel="noopener noreferrer"'} style="color:#1a73e8;text-decoration:underline;">${escapeHtml(displayText)}</a>&nbsp;`;

      body.focus();
      const targetRange = savedRange || dialog._mtSavedRange;
      if (targetRange) {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(targetRange);

          // Replace highlighted range cleanly
          targetRange.deleteContents();
          const temp = document.createElement('div');
          temp.innerHTML = linkHtml;
          const frag = document.createDocumentFragment();
          let node;
          let lastNode = null;
          while ((node = temp.firstChild)) {
            lastNode = frag.appendChild(node);
          }
          targetRange.insertNode(frag);

          if (lastNode) {
            targetRange.setStartAfter(lastNode);
            targetRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(targetRange);
          }
        } catch (err) {
          try {
            document.execCommand('insertHTML', false, linkHtml);
          } catch {
            body.insertAdjacentHTML('beforeend', linkHtml);
          }
        }
      } else {
        body.insertAdjacentHTML('beforeend', linkHtml);
      }

      dialog._mtSavedRange = null;
      dialog._mtSavedText = '';

      body.dispatchEvent(new Event('input', { bubbles: true }));
      closeModal();

      if (triggerEl) {
        triggerEl.classList.add('success');
        setTimeout(() => triggerEl.classList.remove('success'), 2000);
      }
    };

    insertBtn.onclick = doInsert;
    urlInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doInsert();
      }
    };
    textInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
      }
    };
  }

  // -------------------------------------------------------------------------
  // 3. ZERO-OVERHEAD MUTATION LISTENER (Targeted to Gmail main + compose)
  // -------------------------------------------------------------------------
  let updateDebounceTimer = null;
  function triggerThrottledUpdate() {
    if (updateDebounceTimer) return;
    updateDebounceTimer = setTimeout(() => {
      updateDebounceTimer = null;
      if (isAlive()) {
        updateAllRows();
        updateOpenThreadHeader();
        setupComposeButtons();
        setupTopNavButton();
      }
    }, 200);
  }

  // Intercept tracked link clicks to attach recipient identifier
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href*="/trace/link/"]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    try {
      const isSentView = /#(sent|outbox|drafts|scheduled)/i.test(window.location.hash || '');
      const currentUser = getCurrentGmailUser();
      
      // If clicked inside Sent or Drafts folder, mark as sender click so it doesn't self-track
      if (isSentView) {
        if (!href.includes('sender=1')) {
          link.setAttribute('href', href + '&sender=1');
        }
        return;
      }
      
      // If clicked inside an Inbox or reading view, attribute to the active recipient!
      if (currentUser && !href.includes('&r=')) {
        link.setAttribute('href', href + '&r=' + encodeURIComponent(currentUser));
      }
    } catch {}
  }, true);

  // Attach observer to observe folder changes and compose window appearances
  function attachTargetedObserver() {
    const target = document.body;
    if (!target) {
      setTimeout(attachTargetedObserver, 500);
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (!isAlive()) {
        observer.disconnect();
        return;
      }
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          triggerThrottledUpdate();
          break;
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  // Folder navigation listener (fast & zero overhead)
  window.addEventListener('hashchange', () => {
    fetchAllTrackedEmails(true);
    triggerThrottledUpdate();
  });

  // ⚡ SUB-SECOND REAL-TIME LIVE PULSE (Checks every 800ms for instant < 1s read confirmation)
  let lastPulseTime = new Date(Date.now() - 30000).toISOString();
  let isPulsing = false;

  function runSubSecondPulse() {
    if (!isAlive() || document.hidden || isPulsing) return;
    const activeEmail = getCurrentGmailUser() || (currentAuthUser && currentAuthUser.email) || null;
    const q = activeEmail 
      ? `?email=${encodeURIComponent(activeEmail)}&since=${encodeURIComponent(lastPulseTime)}`
      : `?since=${encodeURIComponent(lastPulseTime)}`;

    isPulsing = true;
    fetch(`${getServerUrl()}/api/emails/pulse${q}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        isPulsing = false;
        if (data && data.success) {
          if (data.serverTime) lastPulseTime = data.serverTime;
          if (data.updated && Array.isArray(data.emails) && data.emails.length > 0) {
            data.emails.forEach(updatedEmail => {
              handleInstantOpen(updatedEmail);
            });
          }
        }
      })
      .catch(() => {
        isPulsing = false;
      });
  }

  // Poll high-speed pulse every 800ms when tab is active (< 1s speed)
  setInterval(runSubSecondPulse, 800);

  // Background live sync polling every 4s
  setInterval(() => {
    if (!isAlive() || document.hidden) return;
    fetchAllTrackedEmails();
    updateAllRows();
    updateOpenThreadHeader();
    setupComposeButtons();
    setupTopNavButton();
  }, 4000);

  // -------------------------------------------------------------------------
  // 4. HOVER TOOLTIP SYSTEM (Total Opens, Last Open Time, Dashboard CTA)
  // -------------------------------------------------------------------------
  let activeTooltip = null;
  let tooltipHideTimeout = null;

  function showTooltipForBadge(badge) {
    clearTimeout(tooltipHideTimeout);

    const row = badge.closest('tr');
    const emailId = badge.getAttribute('data-mt-id') || row?.getAttribute('data-mt-id');

    let email = null;
    if (emailId) {
      email = trackedEmails.find(e => e.id === emailId);
    }

    if (!email && row) {
      const subjectEl = row.querySelector('.bog, .bqe, span[data-thread-id]');
      if (subjectEl) {
        const s = subjectEl.textContent.trim().toLowerCase();
        email = trackedEmails.find(e => e.subject && e.subject !== 'No Subject' && (s.includes(e.subject.toLowerCase()) || e.subject.toLowerCase().includes(s)));
      }
    }

    const state = row?.getAttribute('data-mt-state') || (badge.classList.contains('opened') ? 'opened' : 'unread');
    const isOpened = state === 'opened' || (email && (email.status === 'opened' || (email.opens && email.opens.length > 0)));

    const openCount = email ? (email.openCount || (email.opens ? email.opens.length : 0)) : (isOpened ? 1 : 0);
    const lastOpenObj = email?.opens && email.opens.length > 0 ? email.opens[email.opens.length - 1] : null;
    const lastOpenTimestamp = email?.lastOpenedAt || (lastOpenObj ? lastOpenObj.timestamp : null);
    const lastOpenStr = isOpened ? formatFullDateTime(lastOpenTimestamp) : 'Not opened yet';
    const deviceStr = lastOpenObj ? formatDeviceName(lastOpenObj.client) : 'Desktop';

    if (!activeTooltip) {
      activeTooltip = document.createElement('div');
      activeTooltip.className = 'mt-hover-tooltip';
      document.body.appendChild(activeTooltip);

      activeTooltip.addEventListener('mouseenter', () => {
        clearTimeout(tooltipHideTimeout);
      });

      activeTooltip.addEventListener('mouseleave', () => {
        hideTooltip(100);
      });

      activeTooltip.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      activeTooltip.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
    }

    const recList = Array.isArray(email?.recipients) && email.recipients.length > 0
      ? email.recipients
      : (email?.recipient ? email.recipient.split(/[,;]+/).map(r => r.trim()).filter(Boolean) : []);

    let recipientsSectionHtml = '';
    if (recList.length > 0) {
      recipientsSectionHtml = `
        <div class="mt-tt-rec-section">
          <div class="mt-tt-rec-title">Recipients Activity:</div>
          <div class="mt-tt-rec-list">
            ${recList.map(rec => {
        const opensForRec = (email?.opens || []).filter(o => o.recipient && o.recipient.toLowerCase() === rec.toLowerCase());
        const recOpened = opensForRec.length > 0;
        return `
                <div class="mt-tt-rec-row">
                  <span class="mt-tt-rec-dot ${recOpened ? 'opened' : 'unread'}"></span>
                  <span class="mt-tt-rec-email" title="${escapeHtml(rec)}">${escapeHtml(rec)}</span>
                  <span class="mt-tt-rec-tag ${recOpened ? 'opened' : 'unread'}">${recOpened ? `✓✓ Read (${opensForRec.length})` : '✓ Unread'}</span>
                </div>
              `;
      }).join('')}
          </div>
        </div>
      `;
    }

    activeTooltip.innerHTML = `
      <div class="mt-tt-header">
        <span class="mt-tt-status-text">${isOpened ? 'Email Opened' : 'Delivered • Unread'}</span>
      </div>
      <div class="mt-tt-content">
        <div class="mt-tt-row">
          <span class="mt-tt-label">Total Opens:</span>
          <span class="mt-tt-val ${isOpened ? 'opened-count' : ''}">${isOpened ? Math.max(openCount, 1) : 0}</span>
        </div>
        <div class="mt-tt-row">
          <span class="mt-tt-label">Last Opened:</span>
          <span class="mt-tt-val">${lastOpenStr}</span>
        </div>
        ${(email?.clickCount > 0 || (email?.clicks && email.clicks.length > 0)) ? `
        <div class="mt-tt-row">
          <span class="mt-tt-label">Link Clicks:</span>
          <span class="mt-tt-val opened-count" style="color:#059669;font-weight:600;">🔗 ${Math.max(email.clickCount || 0, (email.clicks || []).length)}</span>
        </div>` : ''}
        ${isOpened ? `
        <div class="mt-tt-row">
          <span class="mt-tt-label">Device:</span>
          <span class="mt-tt-val">${escapeHtml(formatDeviceDisplay(deviceStr))}</span>
        </div>` : ''}
        ${recipientsSectionHtml}
      </div>
      <div class="mt-tt-footer">
        <a href="${getServerUrl()}/app?emailId=${encodeURIComponent(email?.id || '')}" target="_blank" rel="noopener noreferrer" class="mt-tt-cta">
          <span>View in Dashboard</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>
    `;

    activeTooltip.classList.add('visible');

    const rect = badge.getBoundingClientRect();
    const ttWidth = activeTooltip.offsetWidth || 210;
    const ttHeight = activeTooltip.offsetHeight || 110;

    let left = rect.left + (rect.width / 2) - (ttWidth / 2);
    if (left + ttWidth > window.innerWidth - 12) {
      left = window.innerWidth - ttWidth - 12;
    }
    if (left < 12) left = 12;

    let top = rect.top - ttHeight - 8;
    if (top < 10) {
      top = rect.bottom + 8;
    }

    activeTooltip.style.left = `${Math.round(left + window.scrollX)}px`;
    activeTooltip.style.top = `${Math.round(top + window.scrollY)}px`;
  }

  function hideTooltip(delay = 180) {
    clearTimeout(tooltipHideTimeout);
    tooltipHideTimeout = setTimeout(() => {
      if (activeTooltip) {
        activeTooltip.classList.remove('visible');
      }
    }, delay);
  }

  // Delegated event listeners for high performance (0 overhead per row)
  document.addEventListener('mouseover', (e) => {
    const badge = e.target.closest('.mt-tick-container');
    if (badge) {
      showTooltipForBadge(badge);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const badge = e.target.closest('.mt-tick-container');
    if (badge) {
      if (e.relatedTarget && activeTooltip && activeTooltip.contains(e.relatedTarget)) {
        return;
      }
      hideTooltip(180);
    }
  });

  document.addEventListener('click', (e) => {
    if (activeLinkModal && !e.target.closest('.mt-link-modal') && !e.target.closest('.mt-compose-link-btn') && !e.target.closest('.mt-compose-logo-btn') && !e.target.closest('.mt-compose-dropdown')) {
      activeLinkModal.classList.remove('visible');
      if (activeLinkBackdrop) activeLinkBackdrop.classList.remove('visible');
    }
    if (activeComposeDropdown && !e.target.closest('.mt-compose-dropdown') && !e.target.closest('.mt-compose-logo-btn')) {
      closeComposeDropdown();
    }
    if (!e.target.closest('#mtTopNavDropdown') && !e.target.closest('#mt-topnav-btn')) {
      closeTopNavDropdown();
    }
    if (!e.target.closest('.mt-hover-tooltip') && !e.target.closest('.mt-tick-container')) {
      hideTooltip(0);
    }
  });

  window.addEventListener('scroll', () => {
    if (activeTooltip && activeTooltip.classList.contains('visible')) {
      hideTooltip(0);
    }
  }, { passive: true });

  // -------------------------------------------------------------------------
  // 5. GMAIL TOPNAV BUTTON & NOTIFICATIONS DROPDOWN
  // -------------------------------------------------------------------------
  let unreadNotificationsCount = 0;
  let topNavDropdownEl = null;
  const readNotificationIds = new Set();
  const newOpenedEmailIds = new Set();

  function updateNavBadgeCount(count) {
    const navBtn = document.getElementById('mt-topnav-btn');
    if (!navBtn) return;
    const badge = navBtn.querySelector('#mtNavBadge');
    if (!badge) return;

    const num = Number(count) || 0;
    if (num > 0) {
      badge.textContent = num > 99 ? '99+' : String(num);
      badge.classList.add('visible');
      badge.style.setProperty('display', 'inline-flex', 'important');
    } else {
      badge.textContent = '';
      badge.classList.remove('visible');
      badge.style.setProperty('display', 'none', 'important');
    }
  }

  function incrementUnreadCount() {
    unreadNotificationsCount++;
    updateNavBadgeCount(unreadNotificationsCount);
    const navBtn = document.getElementById('mt-topnav-btn');
    if (navBtn) {
      navBtn.classList.add('mt-pulse');
      setTimeout(() => navBtn.classList.remove('mt-pulse'), 5000);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function positionDropdown(btn) {
    if (!topNavDropdownEl || !btn) return;
    const rect = btn.getBoundingClientRect();
    const dropdownWidth = 380;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Anchor directly below the button with 8px margin
    const top = Math.round(rect.bottom + 8);
    // Align dropdown's right edge with button's right edge
    let left = Math.round(rect.right - dropdownWidth);

    // Viewport clamping
    if (left + dropdownWidth > viewportWidth - 12) {
      left = viewportWidth - dropdownWidth - 12;
    }
    if (left < 12) {
      left = 12;
    }

    topNavDropdownEl.style.setProperty('position', 'fixed', 'important');
    topNavDropdownEl.style.setProperty('top', `${top}px`, 'important');
    topNavDropdownEl.style.setProperty('left', `${left}px`, 'important');
    topNavDropdownEl.style.setProperty('right', 'auto', 'important');
    const maxHeight = Math.max(280, viewportHeight - top - 16);
    topNavDropdownEl.style.setProperty('max-height', `${maxHeight}px`, 'important');
  }

  function renderNotificationsDropdown() {
    if (!topNavDropdownEl) {
      topNavDropdownEl = document.createElement('div');
      topNavDropdownEl.id = 'mtTopNavDropdown';
      topNavDropdownEl.className = 'mt-topnav-dropdown';
      document.body.appendChild(topNavDropdownEl);

      topNavDropdownEl.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      topNavDropdownEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
    }

    // Sort all tracked emails by newest activity timestamp descending
    const activityEmails = [...trackedEmails].sort((a, b) => {
      const timeA = Math.max(
        new Date(a.lastOpenedAt || (a.opens && a.opens.length ? a.opens[a.opens.length - 1].timestamp : 0)).getTime(),
        new Date(a.createdAt || 0).getTime()
      );
      const timeB = Math.max(
        new Date(b.lastOpenedAt || (b.opens && b.opens.length ? b.opens[b.opens.length - 1].timestamp : 0)).getTime(),
        new Date(b.createdAt || 0).getTime()
      );
      return timeB - timeA;
    });

    let itemsHtml = '';
    if (activityEmails.length === 0) {
      itemsHtml = `
        <div class="mt-dropdown-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <div class="mt-empty-title">No notifications yet</div>
          <div class="mt-empty-desc">When you send tracked emails and recipients open them, notifications will appear here instantly.</div>
        </div>
      `;
    } else {
      itemsHtml = activityEmails.slice(0, 50).map(email => {
        const isOpened = email.status === 'opened' || (email.opens && email.opens.length > 0) || (email.openCount > 0);
        const openCount = email.openCount || (email.opens ? email.opens.length : (isOpened ? 1 : 0));
        const lastActivityTime = isOpened
          ? (email.lastOpenedAt || (email.opens && email.opens.length ? email.opens[email.opens.length - 1].timestamp : email.createdAt))
          : email.createdAt;
        const timeFormatted = formatFullDateTime(lastActivityTime);

        // Recipient formatting with truncation & "+X" for multiple recipients
        const recList = Array.isArray(email.recipients) && email.recipients.length > 0
          ? email.recipients
          : (email.recipient ? email.recipient.split(/,\s*/) : ['Recipient']);

        const firstRec = recList[0] || 'Recipient';
        const remainingCount = recList.length - 1;
        const fullRecipientTitle = recList.join(', ');

        const recipientDisplayHtml = remainingCount > 0
          ? `<span class="mt-notif-recipient" title="${escapeHtml(fullRecipientTitle)}">To: ${escapeHtml(firstRec)}</span><span class="mt-notif-more-tag" title="${escapeHtml(fullRecipientTitle)}">+${remainingCount}</span>`
          : `<span class="mt-notif-recipient" title="${escapeHtml(fullRecipientTitle)}">To: ${escapeHtml(firstRec)}</span>`;

        // Check if this notification is newly opened (unread)
        const isUnread = newOpenedEmailIds.has(email.id);
        const redDotHtml = isUnread ? `<span class="mt-notif-red-dot" title="New activity"></span>` : '';

        const clickCount = Math.max(email.clickCount || 0, (email.clicks || []).length);
        const clickBadgeHtml = clickCount > 0 ? `
          <span class="mt-notif-badge ${isUnread ? 'mt-badge-new' : 'mt-badge-gray'} mt-badge-clicks">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            ${clickCount} click${clickCount > 1 ? 's' : ''}
          </span>
        ` : '';

        let badgeHtml = '';
        let deviceTagHtml = '';
        if (isOpened) {
          const lastOpenObj = email.opens && email.opens.length > 0 ? email.opens[email.opens.length - 1] : null;
          // Never display "Read via Gmail (Google Proxy)" or generic desktop in Mail Track Activity
          if (lastOpenObj && lastOpenObj.client && !/Google Proxy|Gmail|Desktop/i.test(lastOpenObj.client)) {
            const dev = formatDeviceDisplay(lastOpenObj.client);
            if (dev && !/Google Proxy|Gmail|Desktop/i.test(dev)) {
              deviceTagHtml = `<span class="mt-notif-device">• Read on ${escapeHtml(dev)}</span>`;
            }
          }
          badgeHtml = `
            <span class="mt-notif-badge ${isUnread ? 'mt-badge-new' : 'mt-badge-gray'}">
              ${openCount} open${openCount > 1 ? 's' : ''}
              ${redDotHtml}
            </span>
            ${clickBadgeHtml}
          `;
        } else {
          badgeHtml = `
            <span class="mt-notif-badge mt-badge-sent">
              ✓ Sent
              ${redDotHtml}
            </span>
            ${clickBadgeHtml}
          `;
        }

        return `
          <div class="mt-notif-item ${isUnread ? 'is-unread' : ''}" data-email-id="${escapeHtml(email.id)}">
            <div class="mt-notif-body">
              <div class="mt-notif-top-row">
                <div class="mt-notif-subject-group">
                  <span class="mt-notif-subject" title="${escapeHtml(email.subject || 'No Subject')}">${escapeHtml(email.subject || 'No Subject')}</span>
                  ${badgeHtml}
                </div>
                <span class="mt-notif-time">${timeFormatted}</span>
              </div>
              <div class="mt-notif-meta">
                ${recipientDisplayHtml}
                ${deviceTagHtml}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    const isAuth = isUserAuthenticated();
    const dropdownHeaderIconColor = isAuth ? '#059669' : '#94a3b8';

    let contentBodyHtml = '';
    if (!isAuth) {
      contentBodyHtml = `
        <div class="mt-dropdown-unauth-box">
          <div class="mt-unauth-badge-row">
            <div class="mt-unauth-avatar-pill">
              <div class="mt-unauth-avatar-logo">
                <svg width="20" height="20" viewBox="0 0 36 36" fill="none">
                  <rect width="36" height="36" rx="8" fill="#94a3b8"/>
                  <g transform="translate(5, 5)">
                    <path d="M12.5688 14.9068L14.0985 16.4364L23.2695 7.26537L24.8016 8.79743L14.0985 19.5005L7.20417 12.6062L8.73623 11.0742L11.0381 13.376L12.5688 14.9068ZM12.5707 11.8434L17.936 6.47799L19.4638 8.0058L14.0985 13.3711L12.5707 11.8434ZM9.5084 17.9698L7.97762 19.5005L1.08333 12.6062L2.61539 11.0742L4.14617 12.605L4.14488 12.6062L9.5084 17.9698Z" fill="white"/>
                  </g>
                </svg>
              </div>
              <span class="mt-unauth-status-text">Account Not Connected</span>
            </div>
          </div>

          <h3 class="mt-unauth-headline">Connect your Google Account</h3>
          <p class="mt-unauth-description">
            Sign in to Mail Track to enable real-time email open tracking, link click alerts, and double checkmarks.
          </p>

          <a href="${getServerUrl()}/auth/google?flow_src=extension" target="_blank" class="mt-unauth-primary-btn" id="mtDropdownConnectBtn">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Connect Google Account</span>
          </a>

          <div class="mt-unauth-perks">
            <div class="mt-unauth-perk-item">
              <span class="mt-perk-check">✓</span>
              <span>Know the exact moment your email is opened</span>
            </div>
            <div class="mt-unauth-perk-item">
              <span class="mt-perk-check">✓</span>
              <span>Track link clicks with live timestamps</span>
            </div>
            <div class="mt-unauth-perk-item">
              <span class="mt-perk-check">✓</span>
              <span>Double checkmarks (✓✓) right in your Gmail list</span>
            </div>
          </div>
        </div>
      `;
    } else {
      contentBodyHtml = `
        <div class="mt-dropdown-list">
          ${itemsHtml}
        </div>
        <div class="mt-dropdown-footer">
          <a href="${getServerUrl()}" target="_blank" rel="noopener noreferrer" class="mt-dropdown-cta">
            <span>Open Full Dashboard</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
      `;
    }

    topNavDropdownEl.innerHTML = `
      <div class="mt-dropdown-header">
        <div class="mt-dh-left">
          <div class="mt-dh-badge-icon" aria-label="Mail Track Logo">
            <svg width="20" height="20" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="36" height="36" rx="8" fill="${dropdownHeaderIconColor}"/>
              <g transform="translate(5, 5)">
                <path d="M12.5688 14.9068L14.0985 16.4364L23.2695 7.26537L24.8016 8.79743L14.0985 19.5005L7.20417 12.6062L8.73623 11.0742L11.0381 13.376L12.5688 14.9068ZM12.5707 11.8434L17.936 6.47799L19.4638 8.0058L14.0985 13.3711L12.5707 11.8434ZM9.5084 17.9698L7.97762 19.5005L1.08333 12.6062L2.61539 11.0742L4.14617 12.605L4.14488 12.6062L9.5084 17.9698Z" fill="white"/>
              </g>
            </svg>
          </div>
          <span class="mt-dh-title">Mail Track Activity</span>
        </div>
        <button class="mt-dh-close" id="mtDropdownCloseBtn" title="Close">✕</button>
      </div>
      ${contentBodyHtml}
    `;

    const closeBtn = topNavDropdownEl.querySelector('#mtDropdownCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTopNavDropdown();
      };
    }

    const connectBtn = topNavDropdownEl.querySelector('#mtDropdownConnectBtn');
    if (connectBtn) {
      connectBtn.onclick = () => {
        setTimeout(closeTopNavDropdown, 400);
      };
    }

    // Clicking any activity item opens that email's detailed page in a new tab
    topNavDropdownEl.querySelectorAll('.mt-notif-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const emailId = item.getAttribute('data-email-id');
        if (emailId) {
          window.open(`${getServerUrl()}/app?emailId=${encodeURIComponent(emailId)}`, '_blank');
          closeTopNavDropdown();
        }
      };
    });
  }

  function toggleTopNavDropdown() {
    const btn = document.getElementById('mt-topnav-btn');
    if (!btn) return;

    if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
      closeTopNavDropdown();
    } else {
      renderNotificationsDropdown();
      positionDropdown(btn);
      topNavDropdownEl.classList.add('visible');
      btn.classList.add('active');

      // Clear badge and mark currently visible notifications as read on view
      unreadNotificationsCount = 0;
      updateNavBadgeCount(0);
      btn.classList.remove('mt-pulse');
      try {
        localStorage.setItem('mt_last_seen_activity_time', Date.now().toString());
      } catch (e) { }

      // Schedule clearing the new state after user sees them
      setTimeout(() => {
        trackedEmails.forEach(e => readNotificationIds.add(e.id));
        newOpenedEmailIds.clear();
        if (topNavDropdownEl) {
          topNavDropdownEl.querySelectorAll('.mt-notif-red-dot').forEach(dot => {
            dot.style.transition = 'opacity 0.6s ease';
            dot.style.opacity = '0';
            setTimeout(() => dot.remove(), 600);
          });
          topNavDropdownEl.querySelectorAll('.mt-notif-badge.mt-badge-new').forEach(badge => {
            badge.classList.remove('mt-badge-new');
            badge.classList.add('mt-badge-gray');
          });
          topNavDropdownEl.querySelectorAll('.mt-notif-item.is-unread').forEach(item => {
            item.classList.remove('is-unread');
          });
        }
      }, 4000);
    }
  }

  function closeTopNavDropdown() {
    if (topNavDropdownEl) {
      topNavDropdownEl.classList.remove('visible');
      topNavDropdownEl.querySelectorAll('.mt-notif-badge.mt-badge-new').forEach(badge => {
        badge.classList.remove('mt-badge-new');
        badge.classList.add('mt-badge-gray');
      });
      topNavDropdownEl.querySelectorAll('.mt-notif-red-dot').forEach(dot => dot.remove());
      topNavDropdownEl.querySelectorAll('.mt-notif-item.is-unread').forEach(item => item.classList.remove('is-unread'));
    }
    trackedEmails.forEach(e => readNotificationIds.add(e.id));
    newOpenedEmailIds.clear();
    const btn = document.getElementById('mt-topnav-btn');
    if (btn) btn.classList.remove('active');
  }

  window.addEventListener('resize', () => {
    if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
      const btn = document.getElementById('mt-topnav-btn');
      if (btn) positionDropdown(btn);
    }
  }, { passive: true });

  function findSupportButton() {
    const selectors = [
      'button[aria-label*="Support" i]',
      'div[aria-label*="Support" i]',
      'a[aria-label*="Support" i]',
      '[data-tooltip*="Support" i]',
      'button[aria-label*="Help" i]',
      'div[aria-label*="Help" i]',
      'a[href*="support.google.com"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Fallbacks
    const settings = document.querySelector('button[aria-label*="Settings" i], [data-tooltip*="Settings" i], div[aria-label*="Settings" i]');
    if (settings) return settings;

    return null;
  }

  function setupTopNavButton() {
    const supportEl = findSupportButton();
    if (!supportEl) return;

    // Climb up to the direct icon-wrapper child of the header row
    let targetAnchor = supportEl;
    let parent = supportEl.parentElement;

    while (parent && parent.tagName !== 'HEADER' && !parent.getAttribute('role')?.includes('banner')) {
      const pStyle = window.getComputedStyle(parent);
      if (pStyle.display.includes('flex') && parent.children.length > 1) {
        break;
      }
      targetAnchor = parent;
      parent = parent.parentElement;
    }

    const parentContainer = targetAnchor.parentElement || supportEl.parentElement;
    if (!parentContainer) return;

    let navBtn = document.getElementById('mt-topnav-btn');
    if (navBtn) {
      if (navBtn.nextElementSibling === targetAnchor) {
        updateNavBadgeCount(unreadNotificationsCount);
        updateTopNavBtnAuthState();
        return;
      }
      navBtn.remove();
    }

    const isAuth = isUserAuthenticated();
    navBtn = document.createElement('div');
    navBtn.id = 'mt-topnav-btn';
    navBtn.className = `mt-topnav-btn ${isAuth ? '' : 'unlinked'}`;
    navBtn.title = isAuth ? 'Mail Track Activity & Notifications' : 'Mail Track: Not Connected — Click to connect your Google account';
    navBtn.setAttribute('role', 'button');
    navBtn.setAttribute('aria-label', isAuth ? 'Mail Track Activity & Notifications' : 'Mail Track: Not Connected — Click to connect your Google account');
    navBtn.setAttribute('tabindex', '0');
    navBtn.setAttribute('data-node-id', '188:9972');
    navBtn.setAttribute('data-name', 'Track Mail Butotn');
    navBtn.innerHTML = `
      <div class="mt-nav-container ${isAuth ? '' : 'unlinked'}" style="background: ${isAuth ? '#059669' : '#94a3b8'} !important;" data-node-id="188:9973" data-name="Container" title="${isAuth ? 'Mail Track Activity' : 'Mail Track: Not Connected'}">
        <svg class="mt-nav-svg" width="18" height="18" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" data-node-id="188:9974" data-name="Frame">
          <path d="M12.5688 14.9068L14.0985 16.4364L23.2695 7.26537L24.8016 8.79743L14.0985 19.5005L7.20417 12.6062L8.73623 11.0742L11.0381 13.376L12.5688 14.9068ZM12.5707 11.8434L17.936 6.47799L19.4638 8.0058L14.0985 13.3711L12.5707 11.8434ZM9.5084 17.9698L7.97762 19.5005L1.08333 12.6062L2.61539 11.0742L4.14617 12.605L4.14488 12.6062L9.5084 17.9698Z" fill="white"/>
        </svg>
        <span class="mt-nav-badge" id="mtNavBadge" style="display:none !important;" data-node-id="188:9976" data-name="Count Badge"></span>
        <span class="mt-nav-unlinked-dot" id="mtNavUnlinkedDot" style="${isAuth ? 'display:none !important;' : 'display:block !important;'}"></span>
      </div>
    `;

    if (topNavDropdownEl && topNavDropdownEl.classList.contains('visible')) {
      navBtn.classList.add('active');
    }

    navBtn.onclick = (e) => {
      e.stopPropagation();
      toggleTopNavDropdown();
    };

    navBtn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTopNavDropdown();
      }
    };

    parentContainer.insertBefore(navBtn, targetAnchor);
    updateTopNavBtnAuthState();
    updateNavBadgeCount(unreadNotificationsCount);
  }

  // Initial runs
  fetchAuthStatus();
  fetchAllTrackedEmails();
  initDirectWebSocket();
  attachTargetedObserver();
  setupComposeButtons();
  setupTopNavButton();

  // Prompt user after brief delay on opening Gmail if not logged in
  setTimeout(() => {
    checkAndShowAuthPrompt();
  }, 1800);

  // Sync auth when window regains focus (e.g. user finished Google OAuth in another tab)
  window.addEventListener('focus', () => {
    fetchAuthStatus();
  });
})();
