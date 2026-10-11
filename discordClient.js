// Cliente HTTP para a API do Discord

const https = require('https');

// ── Validação ──────────────────────────────────────────────────────────────────
function isValidTokenFormat(token) {
  return typeof token === 'string' && token.length >= 50 && token.length <= 100 && /^[A-Za-z0-9._-]+$/.test(token);
}

function isValidQuestId(questId) {
  return /^\d+$/.test(String(questId));
}

const TOKEN_ERROR = { status: 400, data: { message: 'Token inválido.' } };
const QUEST_ID_ERROR = { status: 400, data: { message: 'Invalid quest ID' } };

// ── Headers ───────────────────────────────────────────────────────────────────
function makeHeaders(token) {
  return {
    'authorization':      token,
    'content-type':       'application/json',
    'accept':             '*/*',
    'accept-language':    'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control':      'no-cache',
    'pragma':             'no-cache',
    'origin':             'https://discord.com',
    'referer':            'https://discord.com/channels/@me',
    'sec-ch-ua':          '"Chromium";v="138", "Not=A?Brand";v="8"',
    'sec-ch-ua-mobile':   '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest':     'empty',
    'sec-fetch-mode':     'cors',
    'sec-fetch-site':     'same-origin',
    'user-agent':         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  };
}

function questHeaders(token) {
  return {
    ...makeHeaders(token),
    'user-agent':         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9217 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36',
    'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InB0LUJSIiwiaGFzX2NsaWVudF9tb2RzIjpmYWxzZSwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJyZWZlcnJpbmdfZG9tYWluIjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6OTk5OTk5LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==',
  };
}

// ── Chamada pra discord.com ───────────────────────────────────────────────────
function discordRequest(path, method, headers, body = null) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'discord.com',
      path,
      method,
      headers: {
        ...headers,
        ...(bodyStr ? { 'content-length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', () => resolve({ status: 500, data: { message: 'Request failed' } }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Funções de alto nível ────────────────────────────────────────────────────
async function getMe(token) {
  if (!isValidTokenFormat(token)) return TOKEN_ERROR;
  return discordRequest('/api/v10/users/@me', 'GET', makeHeaders(token));
}

async function getQuests(token) {
  if (!isValidTokenFormat(token)) return TOKEN_ERROR;
  return discordRequest('/api/v9/quests/@me', 'GET', questHeaders(token));
}

async function enrollQuest(token, questId) {
  if (!isValidTokenFormat(token)) return TOKEN_ERROR;
  if (!isValidQuestId(questId)) return QUEST_ID_ERROR;
  return discordRequest(
    `/api/v9/quests/${questId}/enroll`,
    'POST',
    questHeaders(token),
    { location: 11, is_targeted: false, metadata_raw: null },
  );
}

async function sendVideoProgress(token, questId, timestamp) {
  if (!isValidTokenFormat(token)) return TOKEN_ERROR;
  if (!isValidQuestId(questId)) return QUEST_ID_ERROR;
  if (typeof timestamp !== 'number' || timestamp < 0) {
    return { status: 400, data: { message: 'Invalid timestamp' } };
  }
  return discordRequest(`/api/v9/quests/${questId}/video-progress`, 'POST', questHeaders(token), { timestamp });
}

async function sendHeartbeat(token, questId, streamKey, terminal = false) {
  if (!isValidTokenFormat(token)) return TOKEN_ERROR;
  if (!isValidQuestId(questId)) return QUEST_ID_ERROR;
  if (typeof streamKey !== 'string' || streamKey.length > 100) {
    return { status: 400, data: { message: 'Invalid stream_key' } };
  }
  return discordRequest(`/api/v9/quests/${questId}/heartbeat`, 'POST', questHeaders(token), {
    stream_key: streamKey,
    terminal: !!terminal,
  });
}

module.exports = {
  isValidTokenFormat,
  isValidQuestId,
  getMe,
  getQuests,
  enrollQuest,
  sendVideoProgress,
  sendHeartbeat,
};
