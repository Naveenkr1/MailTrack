const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const gmail = require('./gmail');
const authRouter = require('./auth');
const { requireAuth, optionalAuth } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;
let publicBaseUrl = process.env.BASE_URL || 
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
  (process.env.VERCEL ? 'https://mail-track-pink.vercel.app' : `http://localhost:${PORT}`)));
let customDomain = (process.env.CUSTOM_DOMAIN || '').trim();
let tunnelToken = (process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();

const domainConfigFile = path.join(__dirname, 'data', 'domain.json');
try {
  const fs = require('fs');
  if (fs.existsSync(domainConfigFile)) {
    const savedDomain = JSON.parse(fs.readFileSync(domainConfigFile, 'utf8'));
    if (savedDomain.customDomain) customDomain = savedDomain.customDomain.trim();
    if (savedDomain.tunnelToken) tunnelToken = savedDomain.tunnelToken.trim();
  }
} catch {}

if (customDomain) {
  publicBaseUrl = customDomain.startsWith('http') 
    ? customDomain.replace(/\/+$/, '') 
    : `https://${customDomain.replace(/\/+$/, '')}`;
  console.log('[DOMAIN] Active Personal Custom Domain:', publicBaseUrl);
} else {
  const tunnelConfigFile = path.join(__dirname, 'data', 'tunnel.json');
  try {
    const fs = require('fs');
    if (fs.existsSync(tunnelConfigFile)) {
      const saved = JSON.parse(fs.readFileSync(tunnelConfigFile, 'utf8'));
      if (saved && saved.publicUrl && saved.publicUrl.startsWith('https://') && saved.publicUrl !== 'https://api.trycloudflare.com') {
        publicBaseUrl = saved.publicUrl;
        console.log('[TUNNEL] Restored saved active public tunnel URL:', publicBaseUrl);
      }
    }
  } catch {}
}

function getRequestBaseUrl(req) {
  if (customDomain) {
    return customDomain.startsWith('http') ? customDomain.replace(/\/+$/, '') : `https://${customDomain.replace(/\/+$/, '')}`;
  }
  if (process.env.BASE_URL && (!process.env.VERCEL || !process.env.BASE_URL.includes('localhost'))) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}`;
    }
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL) return 'https://mail-track-pink.vercel.app';
  return publicBaseUrl;
}

let senderPublicIp = '103.181.161.19';

// In-memory + persistent registry of known IPs per user for cross-device self-open suppression
const userKnownIps = new Map(); // userId -> Set of recent clean IPs

async function registerUserIp(userId, ip) {
  if (!userId || !ip) return;
  const clean = ip.replace(/^.*:/, '').split(',')[0].trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1' || clean === '1') return;
  if (!userKnownIps.has(userId)) {
    userKnownIps.set(userId, new Set());
  }
  userKnownIps.get(userId).add(clean);
  try {
    await db.registerUserIp(userId, clean);
  } catch {}
}

async function isKnownSenderIp(userId, ip) {
  if (!userId || !ip) return false;
  const clean = ip.replace(/^.*:/, '').split(',')[0].trim();
  if (userKnownIps.has(userId) && userKnownIps.get(userId).has(clean)) {
    return true;
  }
  try {
    return await db.isKnownSenderIp(userId, clean);
  } catch {
    return false;
  }
}

// Auto-detect host public IP for self-open filtering
http.get('http://api.ipify.org', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    senderPublicIp = data.trim();
    console.log('[SENDER IP] Detected sender host IP for self-open filtering:', senderPublicIp);
  });
}).on('error', () => {});

// -------------------------------------------------------------
// SECURITY & MIDDLEWARE
// -------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false
}));

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// Rate limiters for security
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, error: 'Too many login attempts. Please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 3000,
  message: { success: false, error: 'Rate limit exceeded.' }
});

// -------------------------------------------------------------
// AUTHENTICATION & LOGIN ROUTES
// -------------------------------------------------------------
app.use('/auth', apiLimiter, authRouter);

app.get('/login', (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.cookies && req.cookies.mt_token) {
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('./middleware/auth');
      jwt.verify(req.cookies.mt_token, JWT_SECRET);
      return res.redirect('/');
    } catch {}
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Public Landing Page
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Official Privacy Policy Page (Google OAuth Compliance)
app.get(['/privacy', '/privacy-policy'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// Official Terms of Service Page
app.get(['/terms', '/terms-of-service', '/tos'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Google Search Console Site Verification
app.get('/googlec4ad3d7d85161054.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'googlec4ad3d7d85161054.html'));
});

// Root: Dashboard for authenticated users, Landing Page for unauthenticated visitors
app.get('/', optionalAuth, (req, res) => {
  if (req.user) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Explicit Dashboard / App routes (requires Google authentication)
app.get(['/app', '/dashboard'], requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Static files (css, js, icons, etc.)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 1x1 Transparent PNG for email tracking beacons
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// -------------------------------------------------------------
// MULTI-TENANT WEBSOCKET DISPATCHER
// Broadcasts events only to clients authorized to see that user's data
function broadcast(eventType, data, targetUserId = null) {
  const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Strict user isolation: If this event is targeted to a specific user,
      // only clients verified as that user may receive it.
      if (targetUserId) {
        if (!client.userId || client.userId !== targetUserId) {
          return;
        }
      }
      client.send(payload);
    }
  });
}

wss.on('connection', async (ws, req) => {
  // Authenticate WebSocket connection from:
  // 1. Query parameters (?apiKey=... or ?token=...)
  // 2. Cookie (mt_token=...)
  // 3. Authorization header
  let token = null;

  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const queryApiKey = parsedUrl.searchParams.get('apiKey');
    const queryToken = parsedUrl.searchParams.get('token');
    const queryEmail = parsedUrl.searchParams.get('email');

    if (queryApiKey) {
      const user = await db.findUserByApiKey(queryApiKey);
      if (user) ws.userId = user.id;
    } else if (queryToken) {
      if (queryToken.startsWith('mtk_')) {
        const user = await db.findUserByApiKey(queryToken);
        if (user) ws.userId = user.id;
      } else {
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('./middleware/auth');
        const decoded = jwt.verify(queryToken, JWT_SECRET);
        ws.userId = decoded.userId;
      }
    } else if (queryEmail) {
      const user = await db.findUserByEmail(queryEmail);
      if (user) ws.userId = user.id;
    }
  } catch (err) {}

  if (!ws.userId && req.headers && req.headers.cookie) {
    const match = req.headers.cookie.match(/mt_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!ws.userId && token) {
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('./middleware/auth');
      const decoded = jwt.verify(token, JWT_SECRET);
      ws.userId = decoded.userId;
    } catch {}
  }

  if (!ws.userId && req.headers && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      const bToken = authHeader.substring(7);
      if (bToken.startsWith('mtk_')) {
        const user = await db.findUserByApiKey(bToken);
        if (user) ws.userId = user.id;
      } else {
        try {
          const jwt = require('jsonwebtoken');
          const { JWT_SECRET } = require('./middleware/auth');
          const decoded = jwt.verify(bToken, JWT_SECRET);
          ws.userId = decoded.userId;
        } catch {}
      }
    }
  }

  ws.on('message', async (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'AUTH') {
        const apiKeyOrToken = parsed.token || parsed.apiKey;
        if (apiKeyOrToken && apiKeyOrToken.startsWith('mtk_')) {
          const user = await db.findUserByApiKey(apiKeyOrToken);
          if (user) {
            ws.userId = user.id;
            ws.send(JSON.stringify({ type: 'AUTH_OK', userId: user.id }));
          }
        } else if (apiKeyOrToken) {
          const jwt = require('jsonwebtoken');
          const { JWT_SECRET } = require('./middleware/auth');
          const decoded = jwt.verify(apiKeyOrToken, JWT_SECRET);
          ws.userId = decoded.userId;
          ws.send(JSON.stringify({ type: 'AUTH_OK', userId: decoded.userId }));
        } else if (parsed.email) {
          const user = await db.findUserByEmail(parsed.email);
          if (user) {
            ws.userId = user.id;
            ws.send(JSON.stringify({ type: 'AUTH_OK', userId: user.id }));
          }
        }
      }
    } catch {}
  });

  ws.send(JSON.stringify({ 
    type: 'CONNECTED', 
    publicUrl: publicBaseUrl, 
    userId: ws.userId || null,
    serverTime: new Date().toISOString() 
  }));
});

function parseClient(ua) {
  if (!ua) return 'Gmail (Google Proxy)';

  // 1. Google Image Proxy (Gmail Web or Gmail Mobile Apps)
  if (/GoogleImageProxy/i.test(ua)) {
    return 'Gmail (Google Proxy)';
  }

  // 2. Real Direct Mobile & Tablet Clients (Apple Mail, Outlook, link clicks)
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';

  // 3. Desktop Operating Systems
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows NT|Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';

  return 'Gmail (Google Proxy)';
}

function isBotOrPrefetch(userAgent, req) {
  if (!userAgent || userAgent === 'Unknown') return false;

  // Real Gmail open via Google Image Proxy - NEVER filter as bot
  if (/GoogleImageProxy/i.test(userAgent)) return false;

  const purpose = (req.headers['purpose'] || req.headers['x-purpose'] || req.headers['sec-purpose'] || '').toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return true;

  // Google's cloud email notification & security scanner bot:
  if (/Edge\/12\.246|Chrome\/42\.0\.2311\.135/i.test(userAgent)) return true;

  // Automated crawlers, security scanners, link unfurlers
  if (/googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|facebookexternalhit|slackbot|telegrambot|twitterbot|linkedinbot|whatsapp|applebot|barracuda|mimecast|proofpoint|fireeye|symantec|trendmicro|sophos|virus|crawler|spider|scraper/i.test(userAgent)) {
    return true;
  }

  return false;
}

// -------------------------------------------------------------
// PUBLIC TRACKING BEACONS & REDIRECTS (Unauthenticated)
// -------------------------------------------------------------

// Pixel Beacon Endpoint
app.get(['/trace/mail/:id.png', '/trace/mail/:id'], async (req, res) => {
  const emailId = req.params.id.replace(/\.png$/, '');
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const timestamp = new Date().toISOString();

  let email = await db.getEmailForBeacon(emailId);

  // If email was not yet registered, register it under real sender user or fallback user
  if (!email) {
    const fromEmail = (req.query.from || '').trim().toLowerCase();
    let senderUser = fromEmail ? await db.findUserByEmail(fromEmail) : null;
    if (!senderUser && fromEmail && fromEmail.includes('@')) {
      senderUser = await db.createOrUpdateUser({ email: fromEmail, name: fromEmail.split('@')[0] });
    }
    if (!senderUser) {
      senderUser = (await db.findUserByEmail('nnaveen.8527@gmail.com')) || 
                   (await db.findUserById('usr_default')) || 
                   { id: 'usr_default', email: 'nnaveen.8527@gmail.com' };
    }
    const decodedSubject = req.query.s ? decodeURIComponent(req.query.s) : 'Tracked Email';
    const decodedRecipient = req.query.r ? decodeURIComponent(req.query.r) : 'Recipient';
    email = await db.createEmail(senderUser.id, {
      id: emailId,
      subject: decodedSubject,
      recipient: decodedRecipient,
      recipients: [decodedRecipient],
      sender: fromEmail || senderUser.email || 'Me'
    });
  }

  const cleanIp = ip.replace(/^.*:/, '').split(',')[0].trim();
  const now = Date.now();
  const createdTime = email.createdAt ? new Date(email.createdAt).getTime() : now;
  const elapsedSeconds = (now - createdTime) / 1000;

  // 1. Known Sender IP check across devices:
  // If the request comes directly from any IP associated with the sender's network or devices, ignore as self-open!
  const isSenderIP = cleanIp === senderPublicIp || 
                     cleanIp === email.senderPublicIp || 
                     cleanIp === email.senderIp || 
                     cleanIp === '1' || 
                     cleanIp === '127.0.0.1' ||
                     (await isKnownSenderIp(email.userId, cleanIp));

  if (isSenderIP && !/GoogleImageProxy/i.test(userAgent)) {
    console.log(`[SELF-OPEN FILTERED] "${email.subject}" (${emailId}) from sender device IP (${cleanIp}) - IGNORED.`);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': TRANSPARENT_PNG.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Timing-Allow-Origin': '*'
    });
    return res.end(TRANSPARENT_PNG);
  }

  // 2. Pre-render Grace Period: Google Image Proxy or email client pre-rendering immediately after send (< 30s)
  if (elapsedSeconds < 30) {
    console.log(`[PRE-RENDER FILTERED] "${email.subject}" (${emailId}) hit within ${Math.round(elapsedSeconds)}s of sending - IGNORED.`);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': TRANSPARENT_PNG.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Timing-Allow-Origin': '*'
    });
    return res.end(TRANSPARENT_PNG);
  }

  // 3. Non-Gmail Recipient GoogleImageProxy Filter:
  // If recipient is NOT a @gmail.com or @googlemail.com address, the recipient will NEVER use GoogleImageProxy!
  // Any GoogleImageProxy request for a non-Gmail recipient can ONLY be the sender opening their Sent folder in Gmail!
  const recList = email.recipients && email.recipients.length > 0 ? email.recipients : [email.recipient];
  const hasGmailRecipient = recList.some(r => {
    if (!r) return false;
    const lower = r.toLowerCase();
    return lower.includes('@gmail.com') || lower.includes('@googlemail.com');
  });

  if (!hasGmailRecipient && /GoogleImageProxy/i.test(userAgent)) {
    console.log(`[SENDER SENT VIEW FILTERED] "${email.subject}" (${emailId}) GoogleImageProxy on non-Gmail recipient (${email.recipient}) - SENDER SELF-OPEN IGNORED.`);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': TRANSPARENT_PNG.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Timing-Allow-Origin': '*'
    });
    return res.end(TRANSPARENT_PNG);
  }

  // 4. Automated Notification Bot Scanner Filter
  if (isBotOrPrefetch(userAgent, req)) {
    console.log(`[BOT / NOTIFICATION PREFETCH FILTERED] "${email.subject}" (${emailId}) request by ${userAgent} (${cleanIp}) - IGNORED.`);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': TRANSPARENT_PNG.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Timing-Allow-Origin': '*'
    });
    return res.end(TRANSPARENT_PNG);
  }

  // Resolve recipient for this beacon hit
  let beaconRecipient = req.query.r ? decodeURIComponent(req.query.r).trim().toLowerCase() : null;
  if (!beaconRecipient) {
    if (email.recipients && email.recipients.length === 1) {
      beaconRecipient = email.recipients[0];
    } else if (email.recipients && email.recipients.length > 1) {
      const openedSet = new Set((email.opens || []).map(o => (o.recipient || '').toLowerCase()));
      const unopened = email.recipients.filter(r => !openedSet.has(r.toLowerCase()));
      beaconRecipient = unopened.length > 0 ? unopened[0] : email.recipients[0];
    } else {
      beaconRecipient = email.recipient ? email.recipient.split(/[,;]+/)[0].trim() : 'Recipient';
    }
  }

  const openData = {
    id: crypto.randomBytes(8).toString('hex'),
    recipient: beaconRecipient,
    timestamp,
    ip: cleanIp,
    userAgent,
    client: parseClient(userAgent)
  };

  const updatedEmail = await db.recordOpen(emailId, openData);

  // If this hit was within the 10-minute session cooldown or capped self-test,
  // do not trigger repeated WebSocket popups, chime sounds, or label changes
  if (updatedEmail && updatedEmail.isExistingSession) {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': TRANSPARENT_PNG.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Timing-Allow-Origin': '*'
    });
    return res.end(TRANSPARENT_PNG);
  }

  console.log(`\n======================================================`);
  console.log(`🔥 [REAL OPEN CONFIRMED] "${email.subject}" (${email.id})`);
  console.log(`   Recipient: ${openData.recipient} | Client: ${openData.client} | Time: ${timestamp}`);
  console.log(`   Open Count: ${updatedEmail.openCount} | Status updated to READ (✓✓) in dashboard and Gmail!`);
  console.log(`======================================================\n`);

  broadcast('EMAIL_OPENED', { email: updatedEmail, event: openData }, email.userId);

  // Asynchronously trigger Gmail Mobile Sync to swap to double checkmark (✓✓)
  gmail.applyOpenedLabel(email.userId, email.id).catch(err => {
    console.warn('[GMAIL MOBILE SYNC] Non-blocking applyOpenedLabel error:', err.message);
  });

  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': TRANSPARENT_PNG.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0, post-check=0, pre-check=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Timing-Allow-Origin': '*'
  });
  res.end(TRANSPARENT_PNG);
});

// Link Click Tracking Redirection
app.get(['/trace/link/:id', '/trace/link'], async (req, res) => {
  const emailId = req.params.id || req.query.id;
  const targetUrl = req.query.url;

  if (!targetUrl) return res.status(400).send('Missing target URL');

  const safeTargetUrl = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const cleanIp = ip.replace(/^.*:/, '');
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const timestamp = new Date().toISOString();

  let email = emailId ? await db.getEmailForBeacon(emailId) : null;

  // Filter automated bots/crawlers
  const isBot = isBotOrPrefetch(userAgent, req);
  if (isBot) {
    console.log(`[BOT / PREFETCH FILTERED] Link "${safeTargetUrl}" crawler (${userAgent}) - IGNORED.`);
    return res.redirect(302, safeTargetUrl);
  }

  // Parse recipient parameter if provided
  let clickRecipient = req.query.r ? decodeURIComponent(req.query.r).trim().toLowerCase() : null;

  // Only filter self-clicks if clicked within 3 seconds of email creation by sender device
  const now = Date.now();
  const createdTime = email && email.createdAt ? new Date(email.createdAt).getTime() : now;
  const elapsedSeconds = (now - createdTime) / 1000;
  if (elapsedSeconds < 3 && req.headers['x-mailtrack-sender'] === '1') {
    console.log(`[SELF-CLICK FILTERED] Immediate pre-click on "${safeTargetUrl}" (< 3s) - IGNORED.`);
    return res.redirect(302, safeTargetUrl);
  }

  // Prevent immediate duplicate bursts (< 800ms) on double-click
  const recentDuplicate = email && email.clicks && email.clicks.find(c => 
    c.url === safeTargetUrl && 
    (Date.now() - new Date(c.timestamp).getTime()) < 800
  );
  if (recentDuplicate) {
    return res.redirect(302, safeTargetUrl);
  }

  if (!clickRecipient && email) {
    if (email.recipients && email.recipients.length === 1) {
      clickRecipient = email.recipients[0];
    } else if (email.recipients && email.recipients.length > 1) {
      // Find matching open by IP or UserAgent to know which recipient clicked
      const matchingOpen = (email.opens || []).slice().reverse().find(o => o.ip === cleanIp && o.recipient);
      if (matchingOpen) {
        clickRecipient = matchingOpen.recipient;
      } else {
        const clickedSet = new Set((email.clicks || []).map(c => (c.recipient || '').toLowerCase()));
        const unclicked = email.recipients.filter(r => !clickedSet.has(r.toLowerCase()));
        clickRecipient = unclicked.length > 0 ? unclicked[0] : email.recipients[0];
      }
    } else {
      clickRecipient = email.recipient ? email.recipient.split(/[,;]+/)[0].trim() : 'Recipient';
    }
  }
  if (!clickRecipient) clickRecipient = 'Recipient';

  const clickData = {
    id: crypto.randomBytes(8).toString('hex'),
    url: safeTargetUrl,
    timestamp,
    ip: cleanIp,
    userAgent,
    client: parseClient(userAgent),
    recipient: clickRecipient
  };

  let updatedEmail = null;
  if (email) {
    updatedEmail = await db.recordClick(email.id, clickData);

    // If email was not yet marked opened, clicking a link is proof it was opened!
    if (email.status === 'sent') {
      const autoOpenData = {
        id: crypto.randomBytes(8).toString('hex'),
        recipient: clickRecipient,
        timestamp,
        ip: cleanIp,
        userAgent,
        client: parseClient(userAgent)
      };
      const markedOpened = await db.recordOpen(email.id, autoOpenData);
      if (markedOpened) {
        broadcast('EMAIL_OPENED', { email: markedOpened, event: autoOpenData }, email.userId);
        if (email.userId) {
          gmail.applyOpenedLabel(email.userId, email.id).catch(() => {});
        }
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`🔗 [LINK CLICK CONFIRMED] "${email ? email.subject : 'Email'}" (${email ? email.id : emailId})`);
  console.log(`   Target: ${safeTargetUrl} | Recipient: ${clickRecipient} | Time: ${timestamp}`);
  console.log(`======================================================\n`);

  if (updatedEmail) {
    broadcast('LINK_CLICKED', { email: updatedEmail, event: clickData }, email.userId);
  }

  res.redirect(302, safeTargetUrl);
});

// Explicit Recipient Open Report (from Gmail tab with extension)
app.post('/api/emails/:id/open', async (req, res) => {
  const emailId = req.params.id;
  let email = await db.getEmailForBeacon(emailId);
  if (!email) return res.status(404).json({ success: false, error: 'Email not found' });

  const recipient = (req.body.recipient || '').trim().toLowerCase();
  const timestamp = req.body.timestamp || new Date().toISOString();
  const client = req.body.client || 'Gmail (Web)';

  // 1. Prevent immediate sender self-open (< 3s)
  const now = Date.now();
  const createdTime = email && email.createdAt ? new Date(email.createdAt).getTime() : now;
  const elapsedSeconds = (now - createdTime) / 1000;
  if (elapsedSeconds < 3 && req.headers['x-mailtrack-sender'] === '1') {
    console.log(`[SELF-OPEN FILTERED] Immediate pre-open (< 3s) - IGNORED.`);
    return res.json({ success: true, ignored: true });
  }

  // Only ignore if an identical open from same recipient was recorded in the last 1 second (network collision protection)
  const immediateNetworkCollision = email.opens && email.opens.length > 0 && email.opens.find(o => 
    o.recipient && o.recipient.toLowerCase().trim() === recipient &&
    (Date.now() - new Date(o.timestamp).getTime()) < 1000
  );
  if (immediateNetworkCollision) {
    return res.json({ success: true, email });
  }

  const openData = {
    id: crypto.randomBytes(8).toString('hex'),
    timestamp,
    recipient,
    client,
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').replace(/^.*:/, '')
  };

  const updatedEmail = await db.recordOpen(emailId, openData);

  console.log(`\n======================================================`);
  console.log(`🔥 [CONFIRMED RECIPIENT OPEN] "${email.subject}" (${email.id})`);
  console.log(`   Recipient: ${recipient} | Time: ${timestamp} | Total Opens: ${updatedEmail.openCount}`);
  console.log(`======================================================\n`);

  broadcast('EMAIL_OPENED', { email: updatedEmail, event: openData }, email.userId);

  // Asynchronously trigger Gmail Mobile Sync to swap to double checkmark (✓✓)
  gmail.applyOpenedLabel(email.userId, email.id).catch(err => {
    console.warn('[GMAIL MOBILE SYNC] Non-blocking applyOpenedLabel error:', err.message);
  });

  res.json({ success: true, email: updatedEmail, openEvent: openData });
});

// -------------------------------------------------------------
// SECURE MULTI-TENANT REST API
// -------------------------------------------------------------
app.use('/api', apiLimiter);

app.get('/api/config', (req, res) => {
  const effectiveUrl = getRequestBaseUrl(req);
  res.json({
    success: true,
    localUrl: `http://localhost:${PORT}`,
    publicUrl: effectiveUrl,
    wsUrl: `ws://localhost:${PORT}`,
    customDomain: customDomain || null,
    hasTunnelToken: !!tunnelToken,
    isCustomDomain: !!customDomain
  });
});

app.get('/api/ping', (req, res) => {
  res.json({ pong: true, time: Date.now(), publicUrl: getRequestBaseUrl(req) });
});

// Update or disconnect personal custom domain
app.post('/api/settings/domain', optionalAuth, (req, res) => {
  const { domain, token, reset } = req.body || {};

  if (reset) {
    customDomain = '';
    tunnelToken = '';
    publicBaseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  } else {
    if (domain !== undefined) {
      customDomain = (domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
    if (token !== undefined && token.trim() !== '') {
      tunnelToken = token.trim();
    }
    if (customDomain) {
      publicBaseUrl = `https://${customDomain}`;
    }
  }

  // Persist to server/data/domain.json
  try {
    const fs = require('fs');
    const domainFile = path.join(__dirname, 'data', 'domain.json');
    fs.writeFileSync(domainFile, JSON.stringify({
      customDomain,
      tunnelToken,
      updatedAt: new Date().toISOString()
    }, null, 2));
    console.log('[DOMAIN] Updated custom domain config:', { customDomain, hasToken: !!tunnelToken });
  } catch (err) {
    console.warn('[DOMAIN] Failed to write domain.json:', err.message);
  }

  // Restart tunnel process to apply new token/domain
  startCloudflareTunnel();

  res.json({
    success: true,
    publicUrl: publicBaseUrl,
    customDomain,
    hasTunnelToken: !!tunnelToken,
    isCustomDomain: !!customDomain
  });
});

// Retroactive mark-opened for old emails (syncs UI + Gmail labels)
app.post('/api/emails/:id/mark-opened', optionalAuth, async (req, res) => {
  const emailId = req.params.id;
  const email = await db.getEmailForBeacon(emailId);
  if (!email) return res.status(404).json({ success: false, error: 'Email not found' });

  const openData = {
    id: crypto.randomBytes(8).toString('hex'),
    recipient: email.recipient ? email.recipient.split(/[,;]+/)[0].trim() : 'Recipient',
    timestamp: new Date().toISOString(),
    ip: '127.0.0.1',
    userAgent: 'Manual Sync / Verified Read',
    client: 'Verified Read'
  };

  const updated = await db.recordOpen(emailId, openData);
  broadcast('EMAIL_OPENED', { email: updated, event: openData }, email.userId);
  if (email.userId) {
    gmail.applyOpenedLabel(email.userId, emailId).catch(() => {});
  }

  res.json({ success: true, email: updated });
});

// Create tracked email
app.post('/api/emails', optionalAuth, async (req, res) => {
  const { id: customId, subject, recipient, recipients, sender, threadId, gmailMessageId } = req.body;
  const id = customId || crypto.randomBytes(20).toString('hex');

  let recArray = [];
  if (Array.isArray(recipients) && recipients.length > 0) {
    recArray = recipients.map(r => r.trim().toLowerCase()).filter(Boolean);
  } else if (recipient) {
    recArray = recipient.split(/[,;\s]+/).map(r => r.trim().toLowerCase()).filter(r => r.includes('@'));
  }
  if (recArray.length === 0) recArray = ['Recipient'];
  const fullRecipientStr = recArray.join(', ');

  // Determine user tenant - prioritize the actual sender email of this email!
  let user = req.user;
  const senderEmail = (sender && sender.includes('@')) 
    ? sender.trim().toLowerCase() 
    : (req.headers['x-mailtrack-user-email'] || '').trim().toLowerCase();

  if (senderEmail && senderEmail.includes('@')) {
    if (!user || user.email.toLowerCase() !== senderEmail) {
      user = await db.findUserByEmail(senderEmail);
      if (!user) {
        user = await db.createOrUpdateUser({ email: senderEmail, name: senderEmail.split('@')[0] });
      }
    }
  }
  if (!user) {
    user = (await db.findUserByEmail('nnaveen.8527@gmail.com')) || (await db.findUserById('usr_default'));
  }
  if (!user) {
    user = await db.createOrUpdateUser({ email: senderEmail || 'user@example.com', name: 'User' });
  }

  const senderIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').replace(/^.*:/, '').split(',')[0].trim();
  registerUserIp(user.id, senderIp);

  const newEmail = await db.createEmail(user.id, {
    id,
    subject: subject || 'No Subject',
    recipient: fullRecipientStr,
    recipients: recArray,
    sender: sender || user.email,
    senderIp,
    senderPublicIp,
    threadId: threadId || null,
    gmailMessageId: gmailMessageId || null
  });

  const effectiveBaseUrl = getRequestBaseUrl(req);
  const pixelUrl = `${effectiveBaseUrl}/trace/mail/${id}.png`;
  const trackingPixelHtml = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:inline-block;width:1px;min-width:1px;height:1px;min-height:1px;margin:0;padding:0;border:0;outline:none;opacity:0.01;pointer-events:none;" />`;

  if (newEmail) {
    broadcast('EMAIL_CREATED', { email: newEmail }, user.id);

    // Asynchronously trigger Gmail Mobile Sync to apply single checkmark (✓)
    if (newEmail.id && user.id) {
      gmail.applySentLabel(user.id, newEmail.id, threadId || null).catch(err => {
        console.warn('[GMAIL MOBILE SYNC] Non-blocking applySentLabel error:', err.message);
      });
      // Schedule follow-up auto-sync to ensure thread is tagged once indexed by Gmail
      setTimeout(() => gmail.autoSyncUserThrottled(user.id, true), 3500);
      setTimeout(() => gmail.autoSyncUserThrottled(user.id, true), 12000);
    }
  }

  res.json({
    success: true,
    email: newEmail,
    pixelUrl,
    trackingPixelHtml,
    linkTrackPrefix: `${effectiveBaseUrl}/trace/link/${id}?url=`
  });
});

// -------------------------------------------------------------
// GMAIL MOBILE DOUBLE CHECKMARKS SYNC ENDPOINTS
// -------------------------------------------------------------
app.get('/api/mobile-sync/status', optionalAuth, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const status = await gmail.getConnectionStatus(user.id);
  // Proactively auto-sync in background if connected
  if (status.connected) {
    gmail.autoSyncUserThrottled(user.id);
  }
  res.json({ success: true, ...status });
});

app.post('/api/mobile-sync/sync-now', optionalAuth, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const result = await gmail.syncAllRecentEmails(user.id, true);
  res.json(result);
});

app.post('/api/emails/:id/thread', optionalAuth, async (req, res) => {
  const emailId = req.params.id;
  const { threadId, messageId } = req.body;
  const updated = await db.updateEmailThreadId(emailId, { threadId, messageId });
  if (updated) {
    if (updated.status === 'opened') {
      gmail.applyOpenedLabel(updated.userId, emailId).catch(() => {});
    } else {
      gmail.applySentLabel(updated.userId, emailId, threadId).catch(() => {});
    }
    return res.json({ success: true, email: updated });
  }
  res.status(404).json({ success: false, error: 'Email not found.' });
});

// List tracked emails for logged-in user
app.get('/api/emails', optionalAuth, async (req, res) => {
  let user = req.user;
  const userEmail = (req.query.email || req.headers['x-mailtrack-user-email'] || '').trim().toLowerCase();

  // If a specific user email is requested by the active tab or client, resolve to that exact user
  if (userEmail && userEmail.includes('@')) {
    if (!user || user.email.toLowerCase() !== userEmail) {
      user = await db.findUserByEmail(userEmail);
      if (!user) {
        user = await db.createOrUpdateUser({ email: userEmail, name: userEmail.split('@')[0] });
      }
    }
  }
  if (!user) {
    user = (await db.findUserByEmail('nnaveen.8527@gmail.com')) || (await db.findUserById('usr_default'));
  }
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Please log in to view tracked emails.' });
  }

  registerUserIp(user.id, req.headers['x-forwarded-for'] || req.socket.remoteAddress);

  // Proactively auto-sync mobile checkmarks in background for connected user
  if (user && user.id) {
    gmail.autoSyncUserThrottled(user.id);
  }

  const effectiveBaseUrl = getRequestBaseUrl(req);
  const emails = await db.getUserEmails(user.id);
  res.json({
    success: true,
    count: emails.length,
    emails,
    publicUrl: effectiveBaseUrl,
    user: { id: user.id, email: user.email, name: user.name, apiKey: user.api_key }
  });
});

// High-speed sub-second live pulse check (delivers open counts in < 1s)
app.get('/api/emails/pulse', optionalAuth, async (req, res) => {
  let user = req.user;
  const userEmail = (req.query.email || req.headers['x-mailtrack-user-email'] || '').trim().toLowerCase();

  if (userEmail && userEmail.includes('@')) {
    if (!user || user.email.toLowerCase() !== userEmail) {
      user = await db.findUserByEmail(userEmail);
    }
  }
  if (!user) {
    user = (await db.findUserByEmail('nnaveen.8527@gmail.com')) || (await db.findUserById('usr_default'));
  }
  if (!user) {
    return res.json({ success: true, updated: false, emails: [] });
  }

  const since = req.query.since || new Date(Date.now() - 30000).toISOString();
  const updatedEmails = await db.getEmailsUpdatedSince(user.id, since);

  if (updatedEmails.length > 0 && user && user.id) {
    gmail.autoSyncUserThrottled(user.id);
  }

  res.json({
    success: true,
    updated: updatedEmails.length > 0,
    emails: updatedEmails,
    serverTime: new Date().toISOString()
  });
});

// Get single tracked email
app.get('/api/emails/:id', optionalAuth, async (req, res) => {
  let user = req.user;
  if (!user && (req.query.email || req.headers['x-mailtrack-user-email'])) {
    const userEmail = req.query.email || req.headers['x-mailtrack-user-email'];
    user = await db.findUserByEmail(userEmail);
  }
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const email = await db.getEmailById(req.params.id, user.id);
  if (!email) return res.status(404).json({ success: false, error: 'Email not found.' });
  res.json({ success: true, email });
});

// Delete tracked email
app.delete('/api/emails/:id', requireAuth, async (req, res) => {
  const deleted = await db.deleteEmail(req.params.id, req.user.id);
  if (deleted) {
    broadcast('EMAIL_DELETED', { id: req.params.id }, req.user.id);
    return res.json({ success: true, deleted });
  }
  res.status(404).json({ success: false, error: 'Email not found or access denied.' });
});

let cfProcess = null;
let watchdogInterval = null;
let consecutiveFailures = 0;

// Start Cloudflare Tunnel (Named Tunnel for Custom Domain, or Quick Tunnel for instant testing)
function startCloudflareTunnel() {
  if (cfProcess) {
    try { cfProcess.kill('SIGKILL'); } catch {}
    cfProcess = null;
  }

  const directBin = '/Users/naveen/.npm/_npx/8a26fc3a61fe4212/node_modules/cloudflared/bin/cloudflared';
  const fs = require('fs');
  const binExists = fs.existsSync(directBin);
  const cmd = binExists ? directBin : 'npx';

  // 1. CLOUDFLARE NAMED TUNNEL WITH TOKEN (Personal Domain)
  if (tunnelToken) {
    console.log('[TUNNEL] Starting Cloudflare Named Tunnel with Custom Domain Token...');
    const tokenArgs = binExists
      ? ['tunnel', 'run', '--token', tunnelToken]
      : ['-y', 'cloudflared', 'tunnel', 'run', '--token', tunnelToken];

    if (customDomain) {
      publicBaseUrl = customDomain.startsWith('http')
        ? customDomain.replace(/\/+$/, '')
        : `https://${customDomain.replace(/\/+$/, '')}`;
    }

    cfProcess = spawn(cmd, tokenArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    console.log(`\n======================================================`);
    console.log(` 🚀 CLOUDFLARE NAMED TUNNEL ACTIVE (PERSONAL DOMAIN):`);
    console.log(`    Domain: ${publicBaseUrl}`);
    console.log(`    Emails & links will track with your personal domain!`);
    console.log(`======================================================\n`);

    try {
      const tunnelFile = path.join(__dirname, 'data', 'tunnel.json');
      fs.writeFileSync(tunnelFile, JSON.stringify({ publicUrl: publicBaseUrl, updatedAt: new Date().toISOString() }));
    } catch {}

    broadcast('CONFIG_UPDATED', { publicUrl: publicBaseUrl });

    cfProcess.on('close', (code) => {
      console.warn(`[TUNNEL] Cloudflare named tunnel exited (${code}), restarting in 3s...`);
      cfProcess = null;
      setTimeout(startCloudflareTunnel, 3000);
    });

    cfProcess.on('error', (err) => {
      console.warn(`[TUNNEL] Named tunnel error:`, err.message);
    });

    return;
  }

  // 2. CUSTOM DOMAIN CONFIGURED WITHOUT TUNNEL TOKEN (e.g. cloud host or external reverse proxy)
  if (customDomain && !process.env.ENABLE_QUICK_TUNNEL) {
    console.log('[TUNNEL] Personal domain active without quick tunnel:', publicBaseUrl);
    broadcast('CONFIG_UPDATED', { publicUrl: publicBaseUrl });
    return;
  }

  // 3. FALLBACK: CLOUDFLARE QUICK TUNNEL
  console.log('[TUNNEL] Starting Cloudflare Quick Tunnel...');
  const args = binExists ? ['tunnel', '--url', `http://localhost:${PORT}`] : ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`];

  cfProcess = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const extractUrl = (data) => {
    const str = data.toString();
    const match = str.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] && match[0] !== 'https://api.trycloudflare.com') {
      if (!customDomain) {
        publicBaseUrl = match[0];
      }
      consecutiveFailures = 0;
      console.log(`\n======================================================`);
      console.log(` 🚀 CLOUDFLARE PUBLIC HTTPS TUNNEL ACTIVE:`);
      console.log(`    ${publicBaseUrl}`);
      console.log(`    Emails sent anywhere in the world will now track!`);
      console.log(`======================================================\n`);

      try {
        const tunnelFile = path.join(__dirname, 'data', 'tunnel.json');
        fs.writeFileSync(tunnelFile, JSON.stringify({ publicUrl: publicBaseUrl, updatedAt: new Date().toISOString() }));
      } catch {}

      broadcast('CONFIG_UPDATED', { publicUrl: publicBaseUrl });
    }
  };

  cfProcess.stdout.on('data', extractUrl);
  cfProcess.stderr.on('data', extractUrl);

  cfProcess.on('close', (code) => {
    console.warn(`[TUNNEL] Cloudflare tunnel exited (${code}), restarting in 3s...`);
    cfProcess = null;
    setTimeout(startCloudflareTunnel, 3000);
  });

  cfProcess.on('error', (err) => {
    console.warn(`[TUNNEL] Tunnel process error:`, err.message);
  });

  // Watchdog: verify tunnel is actually alive and serving requests every 15s
  if (!watchdogInterval) {
    watchdogInterval = setInterval(() => {
      if (!publicBaseUrl || publicBaseUrl.includes('localhost')) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      fetch(`${publicBaseUrl}/api/ping`, { signal: controller.signal })
        .then(res => {
          clearTimeout(timeout);
          if (res.ok) {
            consecutiveFailures = 0;
          } else {
            consecutiveFailures++;
          }
        })
        .catch(() => {
          clearTimeout(timeout);
          consecutiveFailures++;
        })
        .finally(() => {
          if (consecutiveFailures >= 2) {
            console.warn(`[TUNNEL WATCHDOG] Tunnel ${publicBaseUrl} failed health check 2x. Restarting tunnel now...`);
            consecutiveFailures = 0;
            startCloudflareTunnel();
          }
        });
    }, 15000);
  }
}

// Proactive continuous auto-sync worker for Gmail mobile checkmarks
const mobileAutoSyncTimer = setInterval(() => {
  gmail.autoSyncAllUsers().catch(() => {});
}, 30000);
if (mobileAutoSyncTimer.unref) mobileAutoSyncTimer.unref();

if (!process.env.VERCEL && require.main === module) {
  server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` 🛡️ Mail Track Public Multi-User Server Active`);
    console.log(` 🌐 Dashboard: http://localhost:${PORT}`);
    console.log(` 🔑 Google OAuth: http://localhost:${PORT}/auth/google`);
    console.log(`=================================================`);
    startCloudflareTunnel();
  });
}

module.exports = app;
