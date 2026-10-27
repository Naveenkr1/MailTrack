const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let turso = null;
try {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    const { createClient } = require('@libsql/client');
    turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    console.log('[TURSO] 🚀 Connected to Turso Cloud Database: ' + process.env.TURSO_DATABASE_URL);
  }
} catch (e) {
  console.warn('[TURSO] Notice: Could not init Turso client:', e.message);
}

let db = null;
try {
  const Database = require('better-sqlite3');
  const DATA_DIR = path.join(__dirname, 'data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const DB_PATH = path.join(DATA_DIR, 'mailtrack.db');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Initialize SQLite schema if local db is active
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      api_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      settings TEXT DEFAULT '{}',
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_token_expiry INTEGER,
      gmail_single_label_id TEXT,
      gmail_double_label_id TEXT
    );

    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      recipient TEXT NOT NULL,
      recipients TEXT NOT NULL,
      sender TEXT NOT NULL,
      sender_ip TEXT,
      sender_public_ip TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      created_at TEXT NOT NULL,
      last_opened_at TEXT,
      open_count INTEGER DEFAULT 0,
      last_clicked_at TEXT,
      click_count INTEGER DEFAULT 0,
      thread_id TEXT,
      gmail_message_id TEXT
    );

    CREATE TABLE IF NOT EXISTS email_opens (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      recipient TEXT,
      client TEXT,
      ip TEXT,
      user_agent TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_clicks (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      recipient TEXT,
      url TEXT NOT NULL,
      client TEXT,
      ip TEXT,
      user_agent TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
    CREATE INDEX IF NOT EXISTS idx_opens_email_id ON email_opens(email_id);
    CREATE INDEX IF NOT EXISTS idx_clicks_email_id ON email_clicks(email_id);
    CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
  `);
} catch (err) {
  console.warn('[DB] SQLite native driver not active (running in serverless Turso cloud mode):', err.message);
}

function generateApiKey() {
  return 'mtk_' + crypto.randomBytes(24).toString('hex');
}

// -------------------------------------------------------------
// USER OPERATIONS
// -------------------------------------------------------------

async function findUserById(id) {
  if (!id) return null;
  if (turso) {
    try {
      const res = await turso.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
      return res.rows[0] || null;
    } catch {}
  }
  if (db) {
    try {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
    } catch {}
  }
  return null;
}

async function findUserByGoogleId(googleId) {
  if (!googleId) return null;
  if (turso) {
    try {
      const res = await turso.execute({ sql: 'SELECT * FROM users WHERE google_id = ?', args: [googleId] });
      return res.rows[0] || null;
    } catch {}
  }
  if (db) {
    try {
      return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) || null;
    } catch {}
  }
  return null;
}

async function findUserByEmail(email) {
  if (!email) return null;
  const normalized = email.trim();
  if (turso) {
    try {
      const res = await turso.execute({ sql: 'SELECT * FROM users WHERE LOWER(email) = LOWER(?)', args: [normalized] });
      return res.rows[0] || null;
    } catch {}
  }
  if (db) {
    try {
      return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(normalized) || null;
    } catch {}
  }
  return null;
}

async function findUserByApiKey(apiKey) {
  if (!apiKey) return null;
  const normalized = apiKey.trim();
  if (turso) {
    try {
      const res = await turso.execute({ sql: 'SELECT * FROM users WHERE api_key = ?', args: [normalized] });
      return res.rows[0] || null;
    } catch {}
  }
  if (db) {
    try {
      return db.prepare('SELECT * FROM users WHERE api_key = ?').get(normalized) || null;
    } catch {}
  }
  return null;
}

async function createOrUpdateUser({ googleId, email, name, avatarUrl }) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  const now = new Date().toISOString();

  if (existing) {
    if (turso) {
      try {
        await turso.execute({
          sql: `UPDATE users 
                SET google_id = COALESCE(?, google_id),
                    name = COALESCE(?, name),
                    avatar_url = COALESCE(?, avatar_url),
                    last_login_at = ?
                WHERE id = ?`,
          args: [googleId || null, name || null, avatarUrl || null, now, existing.id]
        });
      } catch {}
    }
    if (db) {
      try {
        db.prepare(`
          UPDATE users 
          SET google_id = COALESCE(?, google_id),
              name = COALESCE(?, name),
              avatar_url = COALESCE(?, avatar_url),
              last_login_at = ?
          WHERE id = ?
        `).run(googleId || null, name || null, avatarUrl || null, now, existing.id);
      } catch {}
    }
    return findUserById(existing.id);
  }

  const userId = 'usr_' + crypto.randomBytes(12).toString('hex');
  const apiKey = generateApiKey();

  if (turso) {
    try {
      await turso.execute({
        sql: `INSERT INTO users (id, google_id, email, name, avatar_url, api_key, created_at, last_login_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, googleId || null, normalizedEmail, name || 'User', avatarUrl || null, apiKey, now, now]
      });
    } catch {}
  }
  if (db) {
    try {
      db.prepare(`
        INSERT INTO users (id, google_id, email, name, avatar_url, api_key, created_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, googleId || null, normalizedEmail, name || 'User', avatarUrl || null, apiKey, now, now);
    } catch {}
  }

  return findUserById(userId);
}

async function updateUserName(userId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return null;
  if (turso) {
    try {
      await turso.execute({ sql: 'UPDATE users SET name = ? WHERE id = ?', args: [trimmed, userId] });
    } catch {}
  }
  if (db) {
    try {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(trimmed, userId);
    } catch {}
  }
  return findUserById(userId);
}

async function updateUserSettings(userId, newSettings) {
  const user = await findUserById(userId);
  if (!user) return null;
  let currentSettings = {};
  try {
    currentSettings = JSON.parse(user.settings || '{}');
  } catch {}
  const merged = { ...currentSettings, ...newSettings };
  const jsonStr = JSON.stringify(merged);
  if (turso) {
    try {
      await turso.execute({ sql: 'UPDATE users SET settings = ? WHERE id = ?', args: [jsonStr, userId] });
    } catch {}
  }
  if (db) {
    try {
      db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(jsonStr, userId);
    } catch {}
  }
  return { ...user, settings: merged };
}

async function deleteUserAccountAndData(userId) {
  const user = await findUserById(userId);
  if (!user) return false;
  if (turso) {
    try {
      await turso.execute({ sql: 'DELETE FROM email_clicks WHERE email_id IN (SELECT id FROM emails WHERE user_id = ?)', args: [userId] });
      await turso.execute({ sql: 'DELETE FROM email_opens WHERE email_id IN (SELECT id FROM emails WHERE user_id = ?)', args: [userId] });
      await turso.execute({ sql: 'DELETE FROM emails WHERE user_id = ?', args: [userId] });
      await turso.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] });
    } catch {}
  }
  if (db) {
    try {
      db.prepare('DELETE FROM emails WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    } catch {}
  }
  return true;
}

// -------------------------------------------------------------
// EMAIL & MULTI-TENANT OPERATIONS
// -------------------------------------------------------------

async function formatEmailWithRelations(emailRow) {
  if (!emailRow) return null;

  let recipients = [];
  try {
    recipients = JSON.parse(emailRow.recipients);
  } catch {
    recipients = emailRow.recipient ? emailRow.recipient.split(', ') : [];
  }

  let opens = [];
  let clicks = [];

  if (turso) {
    try {
      const [opensRes, clicksRes] = await Promise.all([
        turso.execute({ sql: 'SELECT * FROM email_opens WHERE email_id = ? ORDER BY timestamp ASC', args: [emailRow.id] }),
        turso.execute({ sql: 'SELECT * FROM email_clicks WHERE email_id = ? ORDER BY timestamp ASC', args: [emailRow.id] })
      ]);
      opens = opensRes.rows;
      clicks = clicksRes.rows;
    } catch {}
  } else if (db) {
    try {
      opens = db.prepare('SELECT * FROM email_opens WHERE email_id = ? ORDER BY timestamp ASC').all(emailRow.id);
      clicks = db.prepare('SELECT * FROM email_clicks WHERE email_id = ? ORDER BY timestamp ASC').all(emailRow.id);
    } catch {}
  }

  return {
    id: emailRow.id,
    userId: emailRow.user_id,
    subject: emailRow.subject,
    recipient: emailRow.recipient,
    recipients,
    sender: emailRow.sender,
    senderIp: emailRow.sender_ip,
    senderPublicIp: emailRow.sender_public_ip,
    threadId: emailRow.thread_id,
    gmailMessageId: emailRow.gmail_message_id,
    status: emailRow.status,
    createdAt: emailRow.created_at,
    lastOpenedAt: emailRow.last_opened_at,
    openCount: emailRow.open_count || 0,
    lastClickedAt: emailRow.last_clicked_at,
    clickCount: emailRow.click_count || 0,
    opens,
    clicks
  };
}

async function getUserEmails(userId) {
  if (!userId) return [];
  if (turso) {
    try {
      const res = await turso.execute({
        sql: 'SELECT * FROM emails WHERE user_id = ? ORDER BY created_at DESC',
        args: [userId]
      });
      return Promise.all(res.rows.map(row => formatEmailWithRelations(row)));
    } catch {}
  }
  if (db) {
    try {
      const rows = db.prepare('SELECT * FROM emails WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return Promise.all(rows.map(row => formatEmailWithRelations(row)));
    } catch {}
  }
  return [];
}

async function getEmailById(emailId, userId) {
  if (!emailId || !userId) return null;
  if (turso) {
    try {
      const res = await turso.execute({
        sql: 'SELECT * FROM emails WHERE id = ? AND user_id = ?',
        args: [emailId, userId]
      });
      return res.rows[0] ? await formatEmailWithRelations(res.rows[0]) : null;
    } catch {}
  }
  if (db) {
    try {
      const row = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(emailId, userId);
      return row ? await formatEmailWithRelations(row) : null;
    } catch {}
  }
  return null;
}

async function getEmailForBeacon(emailId) {
  if (!emailId) return null;
  if (turso) {
    try {
      const res = await turso.execute({
        sql: 'SELECT * FROM emails WHERE id = ?',
        args: [emailId]
      });
      return res.rows[0] ? await formatEmailWithRelations(res.rows[0]) : null;
    } catch {}
  }
  if (db) {
    try {
      const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(emailId);
      return row ? await formatEmailWithRelations(row) : null;
    } catch {}
  }
  return null;
}

async function saveUserGoogleTokens(userId, { accessToken, refreshToken, expiry }) {
  const user = await findUserById(userId);
  if (!user) return null;
  const updates = [];
  const params = [];
  if (accessToken) { updates.push('google_access_token = ?'); params.push(accessToken); }
  if (refreshToken) { updates.push('google_refresh_token = ?'); params.push(refreshToken); }
  if (expiry) { updates.push('google_token_expiry = ?'); params.push(expiry); }
  if (updates.length === 0) return user;
  params.push(userId);
  if (turso) {
    try {
      await turso.execute({ sql: `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, args: params });
    } catch {}
  }
  if (db) {
    try {
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    } catch {}
  }
  return findUserById(userId);
}

async function saveUserGmailLabels(userId, { singleLabelId, doubleLabelId }) {
  const user = await findUserById(userId);
  if (!user) return null;
  if (turso) {
    try {
      await turso.execute({
        sql: 'UPDATE users SET gmail_single_label_id = COALESCE(?, gmail_single_label_id), gmail_double_label_id = COALESCE(?, gmail_double_label_id) WHERE id = ?',
        args: [singleLabelId || null, doubleLabelId || null, userId]
      });
    } catch {}
  }
  if (db) {
    try {
      db.prepare('UPDATE users SET gmail_single_label_id = COALESCE(?, gmail_single_label_id), gmail_double_label_id = COALESCE(?, gmail_double_label_id) WHERE id = ?')
        .run(singleLabelId || null, doubleLabelId || null, userId);
    } catch {}
  }
  return findUserById(userId);
}

async function updateEmailThreadId(emailId, { threadId, messageId }) {
  if (!emailId || (!threadId && !messageId)) return null;
  const updates = [];
  const params = [];
  if (threadId) { updates.push('thread_id = ?'); params.push(threadId); }
  if (messageId) { updates.push('gmail_message_id = ?'); params.push(messageId); }
  params.push(emailId);
  if (turso) {
    try {
      await turso.execute({ sql: `UPDATE emails SET ${updates.join(', ')} WHERE id = ?`, args: params });
    } catch {}
  }
  if (db) {
    try {
      db.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    } catch {}
  }
  return getEmailForBeacon(emailId);
}

async function createEmail(userId, emailData) {
  const {
    id: customId,
    subject = 'No Subject',
    recipient = 'Recipient',
    recipients = ['Recipient'],
    sender = 'Me',
    senderIp,
    senderPublicIp,
    threadId = null,
    gmailMessageId = null
  } = emailData;

  const id = customId || crypto.randomBytes(20).toString('hex');
  const now = new Date().toISOString();
  const recJson = JSON.stringify(Array.isArray(recipients) ? recipients : [recipient]);

  const existing = await getEmailForBeacon(id);
  if (existing) {
    if (turso) {
      try {
        await turso.execute({
          sql: `UPDATE emails 
                SET subject = ?, recipient = ?, recipients = ?, sender = ?,
                    thread_id = COALESCE(?, thread_id),
                    gmail_message_id = COALESCE(?, gmail_message_id)
                WHERE id = ?`,
          args: [subject, recipient, recJson, sender, threadId, gmailMessageId, id]
        });
      } catch {}
    }
    if (db) {
      try {
        db.prepare(`
          UPDATE emails 
          SET subject = ?, recipient = ?, recipients = ?, sender = ?,
              thread_id = COALESCE(?, thread_id),
              gmail_message_id = COALESCE(?, gmail_message_id)
          WHERE id = ?
        `).run(subject, recipient, recJson, sender, threadId, gmailMessageId, id);
      } catch {}
    }
    return getEmailForBeacon(id);
  }

  if (turso) {
    try {
      await turso.execute({
        sql: `INSERT INTO emails (id, user_id, subject, recipient, recipients, sender, sender_ip, sender_public_ip, status, created_at, thread_id, gmail_message_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)`,
        args: [id, userId, subject, recipient, recJson, sender, senderIp || null, senderPublicIp || null, now, threadId, gmailMessageId]
      });
    } catch {}
  }
  if (db) {
    try {
      db.prepare(`
        INSERT INTO emails (id, user_id, subject, recipient, recipients, sender, sender_ip, sender_public_ip, status, created_at, thread_id, gmail_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)
      `).run(id, userId, subject, recipient, recJson, sender, senderIp || null, senderPublicIp || null, now, threadId, gmailMessageId);
    } catch {}
  }

  const created = await getEmailForBeacon(id);
  if (created) return created;
  return {
    id,
    userId,
    subject,
    recipient,
    recipients: Array.isArray(recipients) ? recipients : [recipient],
    sender,
    senderIp: senderIp || null,
    senderPublicIp: senderPublicIp || null,
    threadId,
    gmailMessageId,
    status: 'sent',
    createdAt: now,
    lastOpenedAt: null,
    openCount: 0,
    lastClickedAt: null,
    clickCount: 0,
    opens: [],
    clicks: []
  };
}

async function deleteEmail(emailId, userId) {
  const existing = await getEmailById(emailId, userId);
  if (!existing) return null;
  if (turso) {
    try {
      await turso.execute({ sql: 'DELETE FROM email_clicks WHERE email_id = ?', args: [emailId] });
      await turso.execute({ sql: 'DELETE FROM email_opens WHERE email_id = ?', args: [emailId] });
      await turso.execute({ sql: 'DELETE FROM emails WHERE id = ?', args: [emailId] });
    } catch {}
  }
  if (db) {
    try {
      db.prepare('DELETE FROM emails WHERE id = ?').run(emailId);
    } catch {}
  }
  return existing;
}

// -------------------------------------------------------------
// SENDER & SELF-OPEN DETECTION HELPERS
// -------------------------------------------------------------

let cachedUserEmails = null;
let lastUserEmailsFetch = 0;

async function getAllUserEmails() {
  const now = Date.now();
  if (cachedUserEmails && (now - lastUserEmailsFetch < 60000)) {
    return cachedUserEmails;
  }
  const emailSet = new Set();
  try {
    if (turso) {
      const res = await turso.execute('SELECT email FROM users');
      res.rows.forEach(r => {
        if (r.email) emailSet.add(r.email.toLowerCase().trim());
      });
    } else if (db) {
      const rows = db.prepare('SELECT email FROM users').all();
      rows.forEach(r => {
        if (r.email) emailSet.add(r.email.toLowerCase().trim());
      });
    }
  } catch {}
  cachedUserEmails = emailSet;
  lastUserEmailsFetch = now;
  return emailSet;
}

async function isSelfOrInternalEmail(email, recipientOverride = null) {
  const senderClean = (email.sender || '').toLowerCase().trim();
  const recipientClean = (recipientOverride || email.recipient || '').toLowerCase().trim();
  const recList = (email.recipients || []).map(r => (r || '').toLowerCase().trim());

  // 1. Direct identical address
  if (senderClean && recipientClean && senderClean === recipientClean) {
    return true;
  }
  if (senderClean && recList.includes(senderClean)) {
    return true;
  }

  // 2. Sender is 'Me' or test placeholder
  if (senderClean === 'me') {
    return true;
  }

  // 3. Sender and recipient are both registered users in the database
  const allUserEmails = await getAllUserEmails();
  const senderIsUser = allUserEmails.has(senderClean);
  const recipientIsUser = allUserEmails.has(recipientClean) || recList.some(r => allUserEmails.has(r));

  if (senderIsUser && recipientIsUser) {
    return true;
  }

  // 4. Known user alias prefixes (e.g. Naveen's test accounts across devices)
  const knownPrefixes = ['nnaveen', 'nk5975', 'hello.naveeen', 'dafuqbc'];
  const matchesKnown = (addr) => knownPrefixes.some(p => addr.startsWith(p));
  if (matchesKnown(senderClean) && (matchesKnown(recipientClean) || recList.some(matchesKnown))) {
    return true;
  }

  return false;
}

async function registerUserIp(userId, ip) {
  if (!userId || !ip) return;
  const clean = ip.replace(/^.*:/, '').split(',')[0].trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1' || clean === '1') return;
  
  const parts = clean.split('.');
  const subnet = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}` : clean;

  const user = await findUserById(userId);
  if (!user) return;
  let settings = {};
  try { settings = JSON.parse(user.settings || '{}'); } catch {}
  const ips = new Set(settings.knownIps || []);
  const subnets = new Set(settings.knownSubnets || []);
  
  const beforeSize = ips.size;
  ips.add(clean);
  subnets.add(subnet);
  
  if (ips.size > beforeSize) {
    settings.knownIps = Array.from(ips).slice(-20);
    settings.knownSubnets = Array.from(subnets).slice(-15);
    await updateUserSettings(userId, settings);
  }
}

async function isKnownSenderIp(userId, ip) {
  if (!userId || !ip) return false;
  const clean = ip.replace(/^.*:/, '').split(',')[0].trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1' || clean === '1') return true;
  
  const user = await findUserById(userId);
  if (!user) return false;
  let settings = {};
  try { settings = JSON.parse(user.settings || '{}'); } catch {}
  
  const knownIps = new Set(settings.knownIps || []);
  if (knownIps.has(clean)) return true;
  
  const parts = clean.split('.');
  if (parts.length === 4) {
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const knownSubnets = new Set(settings.knownSubnets || []);
    if (knownSubnets.has(subnet)) return true;
  }
  
  return false;
}

async function getEmailsUpdatedSince(userId, sinceIso) {
  if (!userId || !sinceIso) return [];
  if (turso) {
    try {
      const res = await turso.execute({
        sql: `SELECT id, user_id, subject, recipient, recipients, sender, status, open_count, last_opened_at, created_at
              FROM emails
              WHERE user_id = ? AND last_opened_at > ?
              ORDER BY last_opened_at DESC
              LIMIT 10`,
        args: [userId, sinceIso]
      });
      return res.rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        subject: r.subject,
        recipient: r.recipient,
        recipients: (r.recipients || '').split(',').map(s => s.trim()).filter(Boolean),
        sender: r.sender,
        status: r.status,
        openCount: r.open_count,
        lastOpenedAt: r.last_opened_at,
        createdAt: r.created_at
      }));
    } catch (e) {
      console.warn('[DB] getEmailsUpdatedSince error:', e.message);
    }
  }
  if (db) {
    try {
      const rows = db.prepare(`
        SELECT id, user_id, subject, recipient, recipients, sender, status, open_count, last_opened_at, created_at
        FROM emails
        WHERE user_id = ? AND last_opened_at > ?
        ORDER BY last_opened_at DESC
        LIMIT 10
      `).all(userId, sinceIso);
      return rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        subject: r.subject,
        recipient: r.recipient,
        recipients: (r.recipients || '').split(',').map(s => s.trim()).filter(Boolean),
        sender: r.sender,
        status: r.status,
        openCount: r.open_count,
        lastOpenedAt: r.last_opened_at,
        createdAt: r.created_at
      }));
    } catch {}
  }
  return [];
}

async function recordOpen(emailId, openData) {
  const email = await getEmailForBeacon(emailId);
  if (!email) return null;

  const openId = openData.id || crypto.randomBytes(8).toString('hex');
  const timestamp = openData.timestamp || new Date().toISOString();

  // Deduplication & session cooldown check:
  const now = new Date(timestamp).getTime();
  const lastTime = email.lastOpenedAt ? new Date(email.lastOpenedAt).getTime() : 0;
  const elapsedSec = (now - lastTime) / 1000;

  // Deduplication & burst debounce:
  // Only suppress rapid-fire duplicate requests that arrive within 2.5 seconds of the previous hit (caused by Google Image Proxy dual fetches or network retries)
  if (email.openCount > 0 && elapsedSec < 2.5) {
    console.log(`[RAPID BURST SUPPRESSED] "${email.subject}" (${emailId}) open hit ${elapsedSec.toFixed(1)}s ago (< 2.5s) - duplicate proxy burst ignored.`);
    if (turso) {
      try {
        await turso.execute({
          sql: `UPDATE emails SET last_opened_at = ? WHERE id = ?`,
          args: [timestamp, emailId]
        });
      } catch {}
    }
    if (db) {
      try {
        db.prepare(`UPDATE emails SET last_opened_at = ? WHERE id = ?`).run(timestamp, emailId);
      } catch {}
    }
    email.lastOpenedAt = timestamp;
    return { ...email, isExistingSession: true };
  }

  // 3. New distinct reading session: increment open_count and record event
  if (turso) {
    try {
      await turso.execute({
        sql: `INSERT INTO email_opens (id, email_id, recipient, client, ip, user_agent, timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [openId, emailId, openData.recipient || null, openData.client || 'Unknown Client', openData.ip || null, openData.userAgent || null, timestamp]
      });
      await turso.execute({
        sql: `UPDATE emails SET status = 'opened', last_opened_at = ?, open_count = open_count + 1 WHERE id = ?`,
        args: [timestamp, emailId]
      });
    } catch {}
  }
  if (db) {
    try {
      db.prepare(`
        INSERT INTO email_opens (id, email_id, recipient, client, ip, user_agent, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(openId, emailId, openData.recipient || null, openData.client || 'Unknown Client', openData.ip || null, openData.userAgent || null, timestamp);
      db.prepare(`
        UPDATE emails 
        SET status = 'opened',
            last_opened_at = ?,
            open_count = open_count + 1
        WHERE id = ?
      `).run(timestamp, emailId);
    } catch {}
  }

  return getEmailForBeacon(emailId);
}

async function recordClick(emailId, clickData) {
  const email = await getEmailForBeacon(emailId);
  if (!email) return null;

  const clickId = clickData.id || crypto.randomBytes(8).toString('hex');
  const timestamp = clickData.timestamp || new Date().toISOString();

  if (turso) {
    try {
      await turso.execute({
        sql: `INSERT INTO email_clicks (id, email_id, recipient, url, client, ip, user_agent, timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [clickId, emailId, clickData.recipient || null, clickData.url, clickData.client || 'Unknown Client', clickData.ip || null, clickData.userAgent || null, timestamp]
      });
      await turso.execute({
        sql: `UPDATE emails SET last_clicked_at = ?, click_count = click_count + 1 WHERE id = ?`,
        args: [timestamp, emailId]
      });
    } catch {}
  }
  if (db) {
    try {
      db.prepare(`
        INSERT INTO email_clicks (id, email_id, recipient, url, client, ip, user_agent, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(clickId, emailId, clickData.recipient || null, clickData.url, clickData.client || 'Unknown Client', clickData.ip || null, clickData.userAgent || null, timestamp);
      db.prepare(`
        UPDATE emails 
        SET last_clicked_at = ?,
            click_count = click_count + 1
        WHERE id = ?
      `).run(timestamp, emailId);
    } catch {}
  }

  return getEmailForBeacon(emailId);
}

module.exports = {
  db,
  findUserById,
  findUserByGoogleId,
  findUserByEmail,
  findUserByApiKey,
  createOrUpdateUser,
  updateUserName,
  updateUserSettings,
  deleteUserAccountAndData,
  getUserEmails,
  getEmailById,
  getEmailForBeacon,
  createEmail,
  deleteEmail,
  recordOpen,
  recordClick,
  saveUserGoogleTokens,
  saveUserGmailLabels,
  updateEmailThreadId,
  registerUserIp,
  isKnownSenderIp,
  isSelfOrInternalEmail,
  getEmailsUpdatedSince
};
