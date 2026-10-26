const db = require('./db');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Predefined palette colors allowed by Gmail API:
// Single tick: subtle gray label
const SINGLE_LABEL_COLOR = {
  textColor: '#000000',
  backgroundColor: '#cccccc'
};

// Double tick: vibrant green label (instant visual confirmation on mobile app)
const DOUBLE_LABEL_COLOR = {
  textColor: '#ffffff',
  backgroundColor: '#16a766'
};

const LABEL_SINGLE_NAME = '✓';
const LABEL_DOUBLE_NAME = '✓✓';

// In-memory label cache per user
const labelCache = new Map();

/**
 * Obtain a valid Google Access Token for the user, auto-refreshing via refresh token if expired.
 */
async function getValidAccessToken(userId) {
  const user = await db.findUserById(userId);
  if (!user) return null;

  const now = Date.now();
  const token = user.google_access_token;
  const expiry = user.google_token_expiry || 0;
  const refreshToken = user.google_refresh_token;

  // If current token is still valid (at least 60s remaining), use it
  if (token && expiry > (now + 60000)) {
    return token;
  }

  // If no refresh token, cannot refresh
  if (!refreshToken) {
    return token || null;
  }

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.warn('[GMAIL API] Token refresh failed for user:', user.email, data);
      return token || null;
    }

    const newExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
    await db.saveUserGoogleTokens(userId, {
      accessToken: data.access_token,
      expiry: newExpiry
    });

    console.log('[GMAIL API] Successfully refreshed Google access token for:', user.email);
    return data.access_token;
  } catch (err) {
    console.error('[GMAIL API] Exception during token refresh:', err.message);
    return token || null;
  }
}

/**
 * Ensure the "✓" and "✓✓" labels exist in the user's Gmail account with custom colors.
 */
async function ensureLabels(userId) {
  if (labelCache.has(userId)) {
    return labelCache.get(userId);
  }

  const user = await db.findUserById(userId);
  if (!user) return null;

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return null;

  try {
    // 1. Fetch user's existing labels
    const listRes = await fetch(`${GMAIL_API_BASE}/labels`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      const errData = await listRes.json().catch(() => ({}));
      console.warn('[GMAIL API] Failed to list labels:', errData);
      return null;
    }

    const listData = await listRes.json();
    const labels = listData.labels || [];

    let singleLabel = labels.find(l => l.name === LABEL_SINGLE_NAME);
    let doubleLabel = labels.find(l => l.name === LABEL_DOUBLE_NAME);

    // 2. Create single checkmark label if missing, or update visibility
    if (!singleLabel) {
      singleLabel = await createLabelWithFallback(accessToken, LABEL_SINGLE_NAME, SINGLE_LABEL_COLOR);
    } else {
      updateLabelVisibilityAndColor(accessToken, singleLabel.id, LABEL_SINGLE_NAME, SINGLE_LABEL_COLOR).catch(() => {});
    }

    // 3. Create double checkmark label if missing, or update visibility
    if (!doubleLabel) {
      doubleLabel = await createLabelWithFallback(accessToken, LABEL_DOUBLE_NAME, DOUBLE_LABEL_COLOR);
    } else {
      updateLabelVisibilityAndColor(accessToken, doubleLabel.id, LABEL_DOUBLE_NAME, DOUBLE_LABEL_COLOR).catch(() => {});
    }

    if (singleLabel && doubleLabel) {
      await db.saveUserGmailLabels(userId, {
        singleLabelId: singleLabel.id,
        doubleLabelId: doubleLabel.id
      });

      const labelObj = {
        singleCheckId: singleLabel.id,
        doubleCheckId: doubleLabel.id
      };
      labelCache.set(userId, labelObj);
      console.log(`[GMAIL API] ✓ / ✓✓ Labels verified for ${user.email} (Single: ${singleLabel.id}, Double: ${doubleLabel.id})`);
      return labelObj;
    }
  } catch (err) {
    console.error('[GMAIL API] Exception ensuring labels:', err.message);
  }

  return null;
}

async function updateLabelVisibilityAndColor(accessToken, labelId, name, color) {
  try {
    const res = await fetch(`${GMAIL_API_BASE}/labels/${labelId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color
      })
    });
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

async function createLabelWithFallback(accessToken, name, color) {
  // Try first with official color
  try {
    const res = await fetch(`${GMAIL_API_BASE}/labels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color
      })
    });

    if (res.ok) {
      return await res.json();
    }

    // If color rejected, fallback without color
    const fallbackRes = await fetch(`${GMAIL_API_BASE}/labels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      })
    });

    if (fallbackRes.ok) {
      return await fallbackRes.json();
    }
  } catch (e) {
    console.error('[GMAIL API] Error creating label:', name, e.message);
  }
  return null;
}

/**
 * Search for an email message and thread in Gmail by tracking ID or subject
 */
async function findThreadForEmail(userId, emailId, subject = null) {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return null;

  try {
    // 1. Search directly by unique 40-character tracking ID (embedded in beacon HTML)
    const query = encodeURIComponent(`"${emailId}"`);
    const searchRes = await fetch(`${GMAIL_API_BASE}/messages?q=${query}&maxResults=1`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.messages && data.messages.length > 0) {
        const msg = data.messages[0];
        await db.updateEmailThreadId(emailId, { threadId: msg.threadId, messageId: msg.id });
        return { threadId: msg.threadId, messageId: msg.id };
      }
    }

    // 2. Fallback search by subject if unique ID search returned 0
    if (subject && subject !== 'No Subject') {
      const cleanSub = subject.replace(/["\\]/g, '');
      const subQuery = encodeURIComponent(`subject:"${cleanSub}" newer_than:2d`);
      const subRes = await fetch(`${GMAIL_API_BASE}/messages?q=${subQuery}&maxResults=5`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (subRes.ok) {
        const data = await subRes.json();
        if (data.messages && data.messages.length > 0) {
          const msg = data.messages[0];
          await db.updateEmailThreadId(emailId, { threadId: msg.threadId, messageId: msg.id });
          return { threadId: msg.threadId, messageId: msg.id };
        }
      }
    }

    // 3. Fallback: inspect the latest 10 sent messages
    const sentRes = await fetch(`${GMAIL_API_BASE}/messages?q=from:me+newer_than:2d&maxResults=10`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (sentRes.ok) {
      const sentData = await sentRes.json();
      if (sentData.messages && sentData.messages.length > 0) {
        for (const m of sentData.messages) {
          const detailRes = await fetch(`${GMAIL_API_BASE}/messages/${m.id}?format=metadata&metadataHeaders=Subject`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const headers = detail.payload && detail.payload.headers ? detail.payload.headers : [];
            const subHeader = headers.find(h => h.name && h.name.toLowerCase() === 'subject');
            const subVal = subHeader ? subHeader.value : '';
            if (subject && subVal && (subVal.trim().toLowerCase() === subject.trim().toLowerCase() || subVal.includes(subject) || subject.includes(subVal))) {
              await db.updateEmailThreadId(emailId, { threadId: detail.threadId, messageId: detail.id });
              return { threadId: detail.threadId, messageId: detail.id };
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[GMAIL API] Exception searching email:', err.message);
  }

  return null;
}

/**
 * Apply Single Checkmark "✓" label when email is sent
 */
async function applySentLabel(userId, emailId, threadId = null, attempt = 1) {
  const user = await db.findUserById(userId);
  if (!user) return;

  let userSettings = {};
  try { userSettings = JSON.parse(user.settings || '{}'); } catch {}
  if (userSettings.mobileAlerts === false) return; // User turned off mobile sync

  const labels = await ensureLabels(userId);
  if (!labels) return;

  let targetThreadId = threadId;
  let targetMessageId = null;

  const emailRecord = await db.getEmailForBeacon(emailId);
  if (!targetThreadId && emailRecord && emailRecord.threadId) {
    targetThreadId = emailRecord.threadId;
    targetMessageId = emailRecord.gmailMessageId;
  }

  if (!targetThreadId) {
    const found = await findThreadForEmail(userId, emailId, emailRecord ? emailRecord.subject : null);
    if (found) {
      targetThreadId = found.threadId;
      targetMessageId = found.messageId;
    }
  }

  // If email was just sent via browser, Gmail may take 2-4 seconds to index into Sent box
  if (!targetThreadId && attempt < 4) {
    const delays = [2500, 5000, 10000];
    const delay = delays[attempt - 1] || 5000;
    setTimeout(() => {
      applySentLabel(userId, emailId, null, attempt + 1);
    }, delay);
    return;
  }

  if (!targetThreadId) {
    console.log(`[GMAIL MOBILE SYNC] Could not locate thread for "${emailRecord?.subject}" (${emailId}) after ${attempt} attempts.`);
    return;
  }

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;

  try {
    // Apply single checkmark to thread
    await fetch(`${GMAIL_API_BASE}/threads/${targetThreadId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        addLabelIds: [labels.singleCheckId],
        removeLabelIds: [labels.doubleCheckId]
      })
    });

    if (targetMessageId) {
      await fetch(`${GMAIL_API_BASE}/messages/${targetMessageId}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          addLabelIds: [labels.singleCheckId],
          removeLabelIds: [labels.doubleCheckId]
        })
      });
    }

    console.log(`[GMAIL MOBILE SYNC] ✓ Single checkmark applied to thread ${targetThreadId} ("${emailRecord?.subject}")`);
  } catch (err) {
    console.error('[GMAIL MOBILE SYNC] Error applying sent label:', err.message);
  }
}

/**
 * Apply Double Checkmark "✓✓" label when recipient opens email
 */
async function applyOpenedLabel(userId, emailId) {
  const user = await db.findUserById(userId);
  if (!user) return;

  let userSettings = {};
  try { userSettings = JSON.parse(user.settings || '{}'); } catch {}
  if (userSettings.mobileAlerts === false) return;

  const labels = await ensureLabels(userId);
  if (!labels) return;

  const emailRecord = await db.getEmailForBeacon(emailId);
  let targetThreadId = emailRecord?.threadId;
  let targetMessageId = emailRecord?.gmailMessageId;

  if (!targetThreadId) {
    const found = await findThreadForEmail(userId, emailId, emailRecord ? emailRecord.subject : null);
    if (found) {
      targetThreadId = found.threadId;
      targetMessageId = found.messageId;
    }
  }

  if (!targetThreadId) {
    console.log(`[GMAIL MOBILE SYNC] Could not find thread to update to double checkmark for email ${emailId}`);
    return;
  }

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;

  try {
    // Swap single checkmark to double checkmark on thread
    const res = await fetch(`${GMAIL_API_BASE}/threads/${targetThreadId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        addLabelIds: [labels.doubleCheckId],
        removeLabelIds: [labels.singleCheckId]
      })
    });

    if (targetMessageId) {
      await fetch(`${GMAIL_API_BASE}/messages/${targetMessageId}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          addLabelIds: [labels.doubleCheckId],
          removeLabelIds: [labels.singleCheckId]
        })
      });
    }

    if (res.ok) {
      console.log(`\n======================================================`);
      console.log(`🔥 [GMAIL MOBILE SYNC ACTIVE] ✓✓ DOUBLE CHECKMARK APPLIED!`);
      console.log(`   Thread: ${targetThreadId} | Email: "${emailRecord?.subject}"`);
      console.log(`   Mobile Gmail app now shows green [✓✓] checkmarks!`);
      console.log(`======================================================\n`);
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('[GMAIL MOBILE SYNC] Modify thread response error:', err);
    }
  } catch (err) {
    console.error('[GMAIL MOBILE SYNC] Error applying opened label:', err.message);
  }
}

/**
 * Sync all recent tracked emails to Gmail labels (retroactive sync)
 */
async function syncAllRecentEmails(userId) {
  const user = await db.findUserById(userId);
  if (!user) return { success: false, error: 'User not found' };

  const labels = await ensureLabels(userId);
  if (!labels) return { success: false, error: 'Gmail API not connected or permissions missing' };

  const emails = (await db.getUserEmails(userId)).slice(0, 30);
  let syncedCount = 0;

  for (const email of emails) {
    try {
      let threadId = email.threadId;
      if (!threadId) {
        const found = await findThreadForEmail(userId, email.id, email.subject);
        if (found) threadId = found.threadId;
      }

      if (threadId) {
        const isOpened = email.status === 'opened' || (email.opens && email.opens.length > 0);
        const accessToken = await getValidAccessToken(userId);
        if (accessToken) {
          await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              addLabelIds: [isOpened ? labels.doubleCheckId : labels.singleCheckId],
              removeLabelIds: [isOpened ? labels.singleCheckId : labels.doubleCheckId]
            })
          });
          syncedCount++;
        }
      }
    } catch (e) {
      // Continue next email
    }
  }

  return { success: true, count: syncedCount, total: emails.length };
}

/**
 * Return current Gmail sync connection status for user
 */
async function getConnectionStatus(userId) {
  const user = await db.findUserById(userId);
  if (!user) return { connected: false, error: 'User not found' };

  let userSettings = {};
  try { userSettings = JSON.parse(user.settings || '{}'); } catch {}

  const hasTokens = !!(user.google_refresh_token || user.google_access_token);
  let apiWorking = false;

  if (hasTokens) {
    const token = await getValidAccessToken(userId);
    apiWorking = !!token;
  }

  return {
    connected: apiWorking,
    email: user.email,
    mobileEnabled: userSettings.mobileAlerts !== false,
    hasRefreshToken: !!user.google_refresh_token,
    singleLabelId: user.gmail_single_label_id,
    doubleLabelId: user.gmail_double_label_id
  };
}

module.exports = {
  getValidAccessToken,
  ensureLabels,
  findThreadForEmail,
  applySentLabel,
  applyOpenedLabel,
  syncAllRecentEmails,
  getConnectionStatus,
  LABEL_SINGLE_NAME,
  LABEL_DOUBLE_NAME
};
