/**
 * ArcanjoQuest - Discord Client
 * Cliente HTTP para a API do Discord (Versão Navegador)
 * Usa fetch com headers simulando o App Desktop para acessar APIs privadas.
 */

const DiscordClient = {
  // ── CONFIGURAÇÃO ───────────────────────────────────────────────────────────
  
  _baseUrl: 'https://discord.com/api/v10',
  
  // ── VALIDAÇÃO ──────────────────────────────────────────────────────────────
  
  isValidTokenFormat(token) {
    return typeof token === 'string' && token.length >= 50 && token.length <= 100 && /^[A-Za-z0-9._-]+$/.test(token);
  },

  isValidQuestId(questId) {
    return /^\d+$/.test(String(questId));
  },

  // ── HEADERS ────────────────────────────────────────────────────────────────
  
  _makeHeaders(token) {
    return {
      'authorization': token,
      'content-type': 'application/json',
      'accept': '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'origin': 'https://discord.com',
      'referer': 'https://discord.com/channels/@me',
      'sec-ch-ua': '"Chromium";v="138", "Not=A?Brand";v="8"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    };
  },

  _questHeaders(token) {
    return {
      ...this._makeHeaders(token),
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9217 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36',
      'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InB0LUJSIiwiaGFzX2NsaWVudF9tb2RzIjpmYWxzZSwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJyZWZlcnJpbmdfZG9tYWluIjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6OTk5OTk5LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==',
    };
  },

  // ── CHAMADA GENÉRICA ───────────────────────────────────────────────────────
  
  async _request(path, method, token, body = null, useQuestHeaders = false) {
    const url = `${this._baseUrl}${path}`;
    const headers = useQuestHeaders ? this._questHeaders(token) : this._makeHeaders(token);
    
    const options = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    };

    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    } catch (error) {
      return { status: 500, data: { message: error.message } };
    }
  },

  // ── FUNÇÕES DE ALTO NÍVEL ──────────────────────────────────────────────────
  
  async getMe(token) {
    if (!this.isValidTokenFormat(token)) return { status: 400, data: { message: 'Token inválido.' } };
    return this._request('/users/@me', 'GET', token);
  },

  async getQuests(token) {
    if (!this.isValidTokenFormat(token)) return { status: 400, data: { message: 'Token inválido.' } };
    // A API de quests usa /api/v9/quests/@me
    return this._request('/api/v9/quests/@me', 'GET', token, null, true);
  },

  async enrollQuest(token, questId) {
    if (!this.isValidTokenFormat(token)) return { status: 400, data: { message: 'Token inválido.' } };
    if (!this.isValidQuestId(questId)) return { status: 400, data: { message: 'Invalid quest ID' } };
    
    return this._request(
      `/api/v9/quests/${questId}/enroll`,
      'POST',
      token,
      { location: 11, is_targeted: false, metadata_raw: null },
      true
    );
  },

  async sendVideoProgress(token, questId, timestamp) {
    if (!this.isValidTokenFormat(token)) return { status: 400, data: { message: 'Token inválido.' } };
    if (!this.isValidQuestId(questId)) return { status: 400, data: { message: 'Invalid quest ID' } };
    if (typeof timestamp !== 'number' || timestamp < 0) {
      return { status: 400, data: { message: 'Invalid timestamp' } };
    }
    return this._request(`/api/v9/quests/${questId}/video-progress`, 'POST', token, { timestamp }, true);
  },

  async sendHeartbeat(token, questId, streamKey, terminal = false) {
    if (!this.isValidTokenFormat(token)) return { status: 400, data: { message: 'Token inválido.' } };
    if (!this.isValidQuestId(questId)) return { status: 400, data: { message: 'Invalid quest ID' } };
    if (typeof streamKey !== 'string' || streamKey.length > 100) {
      return { status: 400, data: { message: 'Invalid stream_key' } };
    }
    return this._request(`/api/v9/quests/${questId}/heartbeat`, 'POST', token, {
      stream_key: streamKey,
      terminal: !!terminal,
    }, true);
  }
};
