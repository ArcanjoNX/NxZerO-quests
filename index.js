// Discord Quest Automation Backend API — Express.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { isValidTokenFormat, isValidQuestId, getMe, getQuests } = require('./discordClient');
const { processQuests } = require('./questLogic');
const { startQuest, startQuestAwait, cancelQuest, getUserStatus } = require('./questRunner');
const { createAccessToken, authMiddleware } = require('./auth');

const app = express();

// ── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json({ limit: '1kb' }));

// ── CORS ─────────────────────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const allowedOrigins = FRONTEND_URL.split(',').map((o) => o.trim());

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));

// ── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
});

// ── Headers de Segurança Adicionais ──────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Validação de ID da Missão ────────────────────────────────────────────────
function validateQuestId(req, res, next) {
  const { questId } = req.params;
  if (!isValidQuestId(questId)) {
    return res.status(400).json({ error: 'ID de missão inválido' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// ROTAS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});// ── Auth: Validar token Discord e gerar JWT ──────────────────────────────────
app.post('/api/auth/validate', authLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token não fornecido' });
    }

    if (!isValidTokenFormat(token)) {
      return res.status(400).json({ error: 'Formato de token inválido' });
    }

    const result = await getMe(token);
    if (result.status !== 200 || !result.data?.id) {
      return res.status(401).json({ error: 'Token de usuário inválido' });
    }

    const jwt = createAccessToken(token, result.data.id);
    return res.json({ jwt, user: result.data });
  } catch (err) {
    console.error('[auth] Erro na validação:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── Listar missões ativas ────────────────────────────────────────────────────
app.get('/api/quests', apiLimiter, authMiddleware, async (req, res) => {
  try {
    const result = await getQuests(req.discordToken);

    if (result.status === 401) {
      return res.status(401).json({ error: 'Token expirado' });
    }

    if (result.status !== 200) {
      return res.status(502).json({ error: `Discord retornou status ${result.status}` });
    }

    const processed = processQuests(result.data);
    return res.json(processed);
  } catch (err) {
    console.error('[quests] Erro ao listar:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── Executar uma missão específica ───────────────────────────────────────────
app.post('/api/quests/:questId/run', apiLimiter, authMiddleware, validateQuestId, async (req, res) => {
  try {
    const { questId } = req.params;

    const currentStatus = getUserStatus(req.userId);
    const alreadyRunning = currentStatus.find((s) => s.questId === questId && s.status === 'running');
    if (alreadyRunning) {
      return res.json({ status: 'already_running', questId });
    }

    const result = await getQuests(req.discordToken);
    if (result.status !== 200) {
      return res.status(502).json({ error: 'Falha ao buscar missões' });
    }

    const processed = processQuests(result.data);
    const quest = processed.find((q) => q.id === questId);

    if (!quest) {
      return res.status(404).json({ error: 'Missão não encontrada ou já concluída' });
    }

    startQuest(req.discordToken, req.userId, quest);
    return res.json({ status: 'started', questId });
  } catch (err) {
    console.error('[quests] Erro ao executar:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── Executar todas as missões sequencialmente ────────────────────────────────
app.post('/api/quests/run-all', apiLimiter, authMiddleware, async (req, res) => {
  try {
    const result = await getQuests(req.discordToken);
    if (result.status !== 200) {
      return res.status(502).json({ error: 'Falha ao buscar missões' });
    }

    const processed = processQuests(result.data);

    if (processed.length === 0) {
      return res.json({ status: 'no_quests' });
    }

    const token = req.discordToken;
    const userId = req.userId;

    (async () => {
      for (const quest of processed) {
        const currentStatus = getUserStatus(userId);
        const alreadyRunning = currentStatus.find((s) => s.questId === quest.id && s.status === 'running');
        if (alreadyRunning) continue;
        await startQuestAwait(token, userId, quest);
      }
    })().catch((err) => {
      console.error('[quests] Erro ao rodar todas:', err.message);
    });

    return res.json({ status: 'started_all', count: processed.length });
  } catch (err) {
    console.error('[quests] Erro ao executar todas:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── Obter status das missões do usuário ──────────────────────────────────────
app.get('/api/quests/status', apiLimiter, authMiddleware, (req, res) => {
  const status = getUserStatus(req.userId);
  return res.json(status);
});

// ── Cancelar execução de uma missão ──────────────────────────────────────────
app.post('/api/quests/:questId/cancel', apiLimiter, authMiddleware, validateQuestId, (req, res) => {
  const success = cancelQuest(req.userId, req.params.questId);
  if (!success) {
    return res.status(404).json({ error: 'Missão não está em execução' });
  }
  return res.json({ status: 'cancelled', questId: req.params.questId });
});

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  return res.json({ status: 'ok' });
});

// ── Inicialização do Servidor ────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[Discord Quest API] Backend rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
