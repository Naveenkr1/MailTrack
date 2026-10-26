const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const gmail = require('./gmail');
const { signUserToken, requireAuth } = require('./middleware/auth');

const router = express.Router();

function getEffectiveBaseUrl(req) {
  if (process.env.BASE_URL && process.env.BASE_URL.startsWith('http')) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4000';
  return `${protocol}://${host}`;
}

// -------------------------------------------------------------
// 1. INITIATE GOOGLE OAUTH (With Gmail Permissions for Mobile Sync)
// -------------------------------------------------------------
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const isExtension = req.query.flow === 'extension';
  const isMobileSync = req.query.flow === 'mobile_sync';

  // If Google OAuth credentials are not yet set up, provide the Setup / Dev Login view
  if (!clientId || clientId.includes('your_google_client_id')) {
    return res.redirect('/login?setup=required' + (isExtension ? '&flow=extension' : ''));
  }

  const baseUrl = getEffectiveBaseUrl(req);
  const redirectUri = `${baseUrl}/auth/google/callback`;
  const suffix = isExtension ? '_ext' : (isMobileSync ? '_mobile' : '');
  const stateNonce = crypto.randomBytes(16).toString('hex') + suffix;

  // Anti-CSRF protection: save state in HttpOnly cookie
  res.cookie('mt_oauth_state', stateNonce, {
    httpOnly: true,
    secure: false, // Allow both http localhost and https tunnel
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.append('client_id', clientId);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('response_type', 'code');

  // For public login: request standard non-sensitive scopes (openid email profile)
  // This allows ANY Google account to log in freely without Google Restricted Scope verification block.
  // Restricted scopes (gmail.modify) are only requested during mobile sync authorization.
  const scope = 'openid email profile https://www.googleapis.com/auth/gmail.modify';
  authUrl.searchParams.append('scope', scope);
  authUrl.searchParams.append('access_type', 'offline');
  authUrl.searchParams.append('prompt', 'consent select_account');
  authUrl.searchParams.append('state', stateNonce);

  res.redirect(authUrl.toString());
});

router.get('/google/mobile-sync', (req, res) => {
  res.redirect('/auth/google?flow=mobile_sync');
});

// -------------------------------------------------------------
// 2. GOOGLE OAUTH CALLBACK
// -------------------------------------------------------------
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[OAuth] Google returned error:', error);
    return res.redirect(`/login?error=${encodeURIComponent('Google login was cancelled or failed.')}`);
  }

  const savedState = req.cookies.mt_oauth_state;
  if (!state || !savedState || state !== savedState) {
    console.error('[OAuth] State CSRF mismatch. Expected:', savedState, 'Got:', state);
    return res.status(403).send('Security Error: Invalid or expired OAuth state parameter (Anti-CSRF). Please retry logging in.');
  }
  res.clearCookie('mt_oauth_state');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = getEffectiveBaseUrl(req);
  const redirectUri = `${baseUrl}/auth/google/callback`;

  try {
    // 1. Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[OAuth] Token exchange error:', tokenData);
      return res.redirect(`/login?error=${encodeURIComponent(tokenData.error_description || 'Failed to exchange authorization token.')}`);
    }

    // 2. Fetch authenticated user profile from Google OIDC endpoint
    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    if (!profile || !profile.email) {
      return res.redirect('/login?error=Unable+to+retrieve+email+from+Google+profile.');
    }

    // 3. Upsert user into database
    const user = await db.createOrUpdateUser({
      googleId: profile.sub,
      email: profile.email,
      name: profile.name || profile.given_name || profile.email.split('@')[0],
      avatarUrl: profile.picture || null
    });

    // Save OAuth access and refresh tokens for Gmail Mobile Sync if granted
    if (tokenData.access_token) {
      const expiry = Date.now() + ((tokenData.expires_in || 3600) * 1000);
      await db.saveUserGoogleTokens(user.id, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        expiry
      });

      const grantedScopes = tokenData.scope || '';
      if (grantedScopes.includes('gmail.modify')) {
        // Ensure Gmail checkmark labels exist immediately
        gmail.ensureLabels(user.id).catch(err => {
          console.warn('[OAuth] Non-blocking label init error:', err.message);
        });

        // Retroactively sync recent emails so they immediately show checkmarks on phone
        gmail.syncAllRecentEmails(user.id).catch(err => {
          console.warn('[OAuth] Non-blocking initial sync error:', err.message);
        });
      }
    }

    // 4. Issue cryptographically signed session JWT
    const token = signUserToken(user);
    res.cookie('mt_token', token, {
      httpOnly: true,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    console.log(`[OAuth] Successfully authenticated user: ${user.email} (${user.id})`);

    // Check if launched from extension
    if (state.endsWith('_ext')) {
      return res.redirect(`/auth/extension-success?apiKey=${encodeURIComponent(user.api_key)}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name || '')}`);
    }

    if (state.endsWith('_mobile')) {
      return res.redirect('/?mobile_sync=success');
    }

    res.redirect('/');
  } catch (err) {
    console.error('[OAuth] Callback exception:', err);
    res.redirect(`/login?error=${encodeURIComponent('Internal error during authentication: ' + err.message)}`);
  }
});

// -------------------------------------------------------------
// 3. DEV / SANDBOX LOGIN (Active when configuring keys)
// -------------------------------------------------------------
router.post('/dev-login', async (req, res) => {
  const allowDev = process.env.ALLOW_DEV_LOGIN === 'true' || !process.env.GOOGLE_CLIENT_ID;
  if (!allowDev) {
    return res.status(403).json({ success: false, error: 'Developer sandbox login is disabled.' });
  }

  const { email, name } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid Gmail address is required.' });
  }

  const user = await db.createOrUpdateUser({
    googleId: 'dev_' + crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex'),
    email: email.trim().toLowerCase(),
    name: name || email.split('@')[0],
    avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(email)}`
  });

  const token = signUserToken(user);
  res.cookie('mt_token', token, {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      apiKey: user.api_key
    },
    token
  });
});

// -------------------------------------------------------------
// 4. USER PROFILE & CURRENT SESSION
// -------------------------------------------------------------
router.get('/me', async (req, res) => {
  let token = null;
  if (req.cookies && req.cookies.mt_token) token = req.cookies.mt_token;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7).trim();
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) token = apiKeyHeader.trim();

  if (!token) {
    return res.json({ authenticated: false });
  }

  if (token.startsWith('mtk_')) {
    const user = await db.findUserByApiKey(token);
    if (user) {
      let userSettings = {};
      try { userSettings = JSON.parse(user.settings || '{}'); } catch {}
      return res.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
          apiKey: user.api_key,
          settings: userSettings,
          gmailConnected: !!(user.google_refresh_token || user.google_access_token)
        }
      });
    }
    return res.json({ authenticated: false });
  }

  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./middleware/auth');
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.userId);
    if (!user) return res.json({ authenticated: false });

    let userSettings = {};
    try { userSettings = JSON.parse(user.settings || '{}'); } catch {}

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        apiKey: user.api_key,
        settings: userSettings,
        gmailConnected: !!(user.google_refresh_token || user.google_access_token)
      }
    });
  } catch {
    res.json({ authenticated: false });
  }
});

// -------------------------------------------------------------
// 5. UPDATE PROFILE & DELETE ACCOUNT
// -------------------------------------------------------------
router.patch('/profile', requireAuth, async (req, res) => {
  const { name, timezone, timeFormat, mobileAlerts } = req.body;
  const user = req.user;

  if (name && typeof name === 'string') {
    await db.updateUserName(user.id, name);
  }

  await db.updateUserSettings(user.id, { 
    ...(timezone ? { timezone } : {}), 
    ...(timeFormat ? { timeFormat } : {}), 
    ...(typeof mobileAlerts === 'boolean' ? { mobileAlerts } : {}) 
  });

  const refreshed = await db.findUserById(user.id);
  let userSettings = {};
  try { userSettings = JSON.parse(refreshed.settings || '{}'); } catch {}

  res.json({
    success: true,
    user: {
      id: refreshed.id,
      email: refreshed.email,
      name: refreshed.name,
      avatarUrl: refreshed.avatar_url,
      apiKey: refreshed.api_key,
      settings: userSettings
    }
  });
});

router.delete('/account', requireAuth, async (req, res) => {
  const user = req.user;
  const success = await db.deleteUserAccountAndData(user.id);
  res.clearCookie('mt_token');
  res.json({ success, message: 'Account and all tracked data permanently deleted.' });
});

// -------------------------------------------------------------
// 6. LOGOUT
// -------------------------------------------------------------
router.post('/logout', (req, res) => {
  res.clearCookie('mt_token');
  res.json({ success: true });
});

router.get('/logout', (req, res) => {
  res.clearCookie('mt_token');
  res.redirect('/login');
});

// -------------------------------------------------------------
// 6. EXTENSION SUCCESS PAIRING SCREEN
// -------------------------------------------------------------
router.get('/extension-success', (req, res) => {
  const { apiKey, email, name } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Mail Track — Account Connected!</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #090d16;
          color: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 36px 32px;
          max-width: 420px;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        }
        .check-badge {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        h2 { margin: 0 0 10px 0; font-size: 1.4rem; font-weight: 700; color: #fff; }
        p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin: 0 0 24px 0; }
        .user-pill {
          background: #1f2937;
          padding: 8px 14px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.85rem;
          color: #38bdf8;
          font-weight: 600;
          margin-bottom: 24px;
        }
        .btn {
          display: inline-block;
          background: #10b981;
          color: #fff;
          font-weight: 600;
          padding: 11px 22px;
          border-radius: 8px;
          text-decoration: none;
          font-size: 0.9rem;
          transition: background 0.15s;
        }
        .btn:hover { background: #059669; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="check-badge">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h2>Gmail Account Linked!</h2>
        <p>Mail Track is now securely authenticated. Emails sent from your Gmail account will be monitored and synced automatically in real time.</p>
        <div class="user-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span>${email || 'Connected Account'}</span>
        </div>
        <br/>
        <a href="/" class="btn">Open Analytics Dashboard</a>
      </div>
      <script>
        // Broadcast auth credentials to Chrome extension if listening
        try {
          const authData = {
            type: 'MAILTRACK_AUTH_SUCCESS',
            apiKey: '${apiKey || ''}',
            email: '${email || ''}',
            name: '${name || ''}'
          };
          window.postMessage(authData, '*');
          if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage(authData).catch(() => {});
          }
        } catch (e) {}
      </script>
    </body>
    </html>
  `);
});

module.exports = router;
