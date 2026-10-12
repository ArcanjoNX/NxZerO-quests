/**
 * ArcanjoQuest - Auth Manager
 * Gerencia autenticação, ofuscação de token e sessão local no navegador.
 */

const AuthManager = {
  // Configuração de Segurança
  CONFIG: {
  // Use as suas chaves do .env aqui
  OBFS_KEY: 'vdAJ5Gu69qHIrMgm7VTl5MkWkNg4sQlo', 
  PREFIX: 'ARC_QT::',
  EXPIRY_MS: 24 * 60 * 60 * 1000,
  VERSION: '1.0'
},

  // ─────────────────────────────────────────────────────────────────────────
  // OFUSCAÇÃO (XOR + Base64)
  // Substitui o Buffer do Node.js por operações nativas do browser
  // ─────────────────────────────────────────────────────────────────────────
  
  _xorString(input, key) {
    let result = '';
    for (let i = 0; i < input.length; i++) {
      result += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  },

  /**
   * Ofusca um texto usando XOR com a chave configurada e converte para Base64.
   * @param {string} text - Texto claro para ofuscar.
   * @returns {string} Texto ofuscado em Base64.
   */
  obfuscate(text) {
    if (!text) return '';
    try {
      const xored = this._xorString(text, this.CONFIG.OBFS_KEY);
      // encodeURIComponent evita erro com caracteres não-ASCII no btoa
      return btoa(unescape(encodeURIComponent(xored)));
    } catch (e) {
      console.warn('[Auth] Falha na ofuscação:', e);
      return '';
    }
  },

  /**
   * Desofusca um texto Base64 usando XOR com a chave configurada.
   * @param {string} encoded - Texto ofuscado em Base64.
   * @returns {string} Texto claro original.
   */
  deobfuscate(encoded) {
    if (!encoded) return '';
    try {
      const decoded = decodeURIComponent(escape(atob(encoded)));
      return this._xorString(decoded, this.CONFIG.OBFS_KEY);
    } catch (e) {
      console.warn('[Auth] Falha na desofuscação:', e);
      return '';
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GERAÇÃO DE HASH SIMPLES (Integridade)
  // Não é criptografia forte, mas impede edição casual do payload
  // ─────────────────────────────────────────────────────────────────────────
  
  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GESTÃO DE SESSÃO (JWT Local)
  // Cria um token de sessão que contém o token ofuscado e metadados
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Cria um token de sessão local ofuscado.
   * @param {string} discordToken - Token do usuário do Discord.
   * @param {object} user - Objeto de usuário do Discord ({id, username, discriminator}).
   * @returns {string} Token de sessão ofuscado.
   */
  createSession(discordToken, user) {
    const sessionData = {
      v: this.CONFIG.VERSION,
      sub: String(user.id),
      usr: user.username,
      tag: `${user.username}#${user.discriminator}`,
      dt: this.obfuscate(discordToken), // Token Discord ofuscado
      exp: Date.now() + this.CONFIG.EXPIRY_MS,
      iat: Date.now()
    };

    const payload = btoa(JSON.stringify(sessionData));
    const header = btoa(JSON.stringify({ alg: 'ARC-V1', typ: 'SESSION' }));
    const signature = this._simpleHash(`${header}.${payload}`);
    
    return `${header}.${payload}.${signature}`;
  },

  /**
   * Verifica a validade e integridade de um token de sessão.
   * @param {string} sessionToken - Token de sessão para verificar.
   * @returns {object|null} Objeto com {discordToken, userId, username, tag} ou null.
   */
  verifySession(sessionToken) {
    if (!sessionToken) return null;
    
    const parts = sessionToken.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    
    // Verifica integridade do hash
    if (this._simpleHash(`${header}.${payload}`) !== signature) {
      console.warn('[Auth] Sessão com assinatura inválida.');
      return null;
    }

    try {
      const data = JSON.parse(atob(payload));
      
      // Verifica versão
      if (data.v !== this.CONFIG.VERSION) {
        return null;
      }

      // Verifica expiração
      if (data.exp < Date.now()) {
        console.warn('[Auth] Sessão expirada.');
        return null;
      }

      // Desofusca o token do Discord
      const discordToken = this.deobfuscate(data.dt);
      
      // Valida formato básico do token
      if (!discordToken || discordToken.length < 50) {
        return null;
      }

      return {
        discordToken,
        userId: data.sub,
        username: data.usr,
        tag: data.tag
      };
    } catch (e) {
      console.warn('[Auth] Erro ao verificar sessão:', e);
      return null;
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PERSISTÊNCIA (localStorage)
  // ─────────────────────────────────────────────────────────────────────────
  
  saveSession(sessionToken) {
    try {
      localStorage.setItem('arcQuestSession', this.CONFIG.PREFIX + sessionToken);
    } catch (e) {
      console.warn('[Auth] Falha ao salvar sessão no localStorage:', e);
    }
  },

  loadSession() {
    try {
      const stored = localStorage.getItem('arcQuestSession');
      if (!stored || !stored.startsWith(this.CONFIG.PREFIX)) return null;
      
      const token = stored.replace(this.CONFIG.PREFIX, '');
      return this.verifySession(token);
    } catch (e) {
      console.warn('[Auth] Falha ao carregar sessão:', e);
      return null;
    }
  },

  clearSession() {
    localStorage.removeItem('arcQuestSession');
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VALIDAÇÃO DE TOKEN DO DISCORD (API Real-Time)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Valida um token do Discord chamando a API oficial.
   * @param {string} token - Token do usuário do Discord.
   * @returns {Promise<object>} {valid: boolean, user: object, error: string}
   */
  async validateDiscordToken(token) {
    if (!token || token.length < 50) {
      return { valid: false, error: 'Token muito curto ou inválido.' };
    }

    // Validação de formato básico (evita chamadas desnecessárias)
    if (!/^[A-Za-z0-9._-]+$/.test(token)) {
      return { valid: false, error: 'Token contém caracteres inválidos.' };
    }

    try {
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8'
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.message || `Erro HTTP ${response.status}`;
        return { valid: false, error: errMsg };
      }

      const user = await response.json();
      return { valid: true, user };
    } catch (error) {
      return { valid: false, error: `Erro de rede: ${error.message}` };
    }
  }
};
