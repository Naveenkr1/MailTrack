const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_mode_only_12345';

async function requireAuth(req, res, next) {
  let token = null;

  // 1. Check HttpOnly cookie
  if (req.cookies && req.cookies.mt_token) {
    token = req.cookies.mt_token;
  }

  // 2. Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 3. Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) {
    const user = await db.findUserByApiKey(apiKeyHeader);
    if (user) {
      req.user = user;
      return next();
    }
  }

  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Please log in with Google to continue.' });
    }
    return res.redirect('/login');
  }

  // Check if token is directly an API key
  if (token.startsWith('mtk_')) {
    const user = await db.findUserByApiKey(token);
    if (user) {
      req.user = user;
      return next();
    }
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Invalid API Key.' });
    }
    return res.redirect('/login');
  }

  // Verify JWT
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.userId);
    if (!user) {
      res.clearCookie('mt_token');
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'User account not found.' });
      }
      return res.redirect('/login');
    }

    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('mt_token');
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }
    return res.redirect('/login');
  }
}

async function optionalAuth(req, res, next) {
  let token = null;
  if (req.cookies && req.cookies.mt_token) token = req.cookies.mt_token;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7).trim();
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) {
    const user = await db.findUserByApiKey(apiKeyHeader);
    if (user) {
      req.user = user;
      return next();
    }
  }

  if (!token) return next();

  if (token.startsWith('mtk_')) {
    const user = await db.findUserByApiKey(token);
    if (user) req.user = user;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.userId);
    if (user) req.user = user;
  } catch {}

  next();
}

function signUserToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = {
  requireAuth,
  optionalAuth,
  signUserToken,
  JWT_SECRET
};
