// Autenticação JWT com ofuscação do token Discord no payload

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-random-jwt-secret-key-change-in-production';
const JWT_EXPIRY = '24h';

const OBFUSCATION_KEY = process.env.ENCRYPTION_KEY || 'default-obfuscation-key-change-in-production';

function obfuscate(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
  }
  return Buffer.from(result, 'binary').toString('base64');
}

function deobfuscate(encoded) {
  const text = Buffer.from(encoded, 'base64').toString('binary');
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ OBFUSCATION_KEY.charCodeAt(i % OBFUSCATION_KEY.length));
  }
  return result;
}

function createAccessToken(discordToken, userId) {
  const payload = {
    sub: String(userId),
    dt: obfuscate(discordToken),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(jwtToken) {
  try {
    const payload = jwt.verify(jwtToken, JWT_SECRET);
    const discordToken = deobfuscate(payload.dt);
    return { discordToken, userId: payload.sub };
  } catch {
    return null;
  }
}

// Middleware Express para proteger rotas da API
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de sessão ausente' });
  }

  const token = authHeader.slice(7);
  const result = verifyToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }

  req.discordToken = result.discordToken;
  req.userId = result.userId;
  next();
}

module.exports = {
  createAccessToken,
  verifyToken,
  authMiddleware,
};
