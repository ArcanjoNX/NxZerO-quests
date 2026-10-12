/**
 * ArcanjoQuest - Auth Manager
 * Gerencia autenticação, ofuscação de token e sessão local no navegador.
 */

const AuthManager = {
  // Configuração de Segurança
  CONFIG: {
    OBFS_KEY: 'vdAJ5Gu69qHIrMgm7VTl5MkWkNg4sQlo', 
    PREFIX: 'ARC_QT::',
    EXPIRY_MS: 24 * 60 * 60 * 1000,
    VERSION: '1.0'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITÁRIOS DE CODIFICAÇÃO (UTF-8 SAFE)
  // Substitui escape/unescape por TextEncoder/TextDecoder ou métodos manuais
  // ─────────────────────────────────────────────────────────────────────────
  
  // Converte string para Array de Bytes (Uint8Array) para garantir UTF-8
  _toBytes(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  },

  // Converte Array de Bytes (Uint8Array) para string
  _fromBytes(bytes) {
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // OFUSCAÇÃO (XOR + Base64)
  // ─────────────────────────────────────────────────────────────────────────
  
  _xorBytes(inputBytes, key) {
    const keyBytes = this._toBytes(key);
    const output = new Uint8Array(inputBytes.length);
    
    for (let i = 0; i < inputBytes.length; i++) {
      output[i] = inputBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return output;
  },

  /**
   * Ofusca um texto usando XOR com a chave configurada e converte para Base64.
   * @param {string} text - Texto claro para ofuscar.
   * @returns {string} Texto ofuscado em Base64.
   */
  obfuscate(text) {
    if (!text) return '';
    try {
      // 1. Converte texto para bytes (UTF-8)
      const textBytes = this._toBytes(text);
      
      // 2. Aplica XOR
      const xoredBytes = this._xorBytes(textBytes, this.CONFIG.OBFS_KEY);
      
      // 3. Converte bytes para Base64
      // btoa espera uma string binária, então convertemos Uint8Array para string binária
      const binString = String.fromCharCode(...xoredBytes);
      return btoa(binString);
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
      // 1. Decodifica Base64 para string binária
      const binString = atob(encoded);
      
      // 2. Converte string binária para Uint8Array
      const bytes = new Uint8Array(binString.length);
      for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i);
      }
      
      // 3. Aplica XOR (inverso)
      const xoredBytes = this._xorBytes(bytes, this.CONFIG.OBFS_KEY);
      
      // 4. Converte bytes para string (UTF-8)
      return this._fromBytes(xoredBytes);
    } catch (e) {
      console.warn('[Auth] Falha na desofuscação:', e);
      return '';
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GERAÇÃO DE HASH SIMPLES (Integridade)
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
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Cria um token de sessão local ofuscado.
   * @param {string} discordToken - Token do usuário do Discord.
   * @param {object} user - Objeto de usuário do Discord.
   * @returns {string} Token de sessão ofuscado.
   */
  createSession(discordToken, user) {
    const sessionData = {
      v: this.CONFIG.VERSION,
      sub: String(user.id),
      usr: user.username,
      tag: `${user.username}#${user.discriminator || '0'}`, // Fallback para nova tag
      dt: this.obfuscate(discordToken),
      exp: Date.now() + this.CONFIG.EXPIRY_MS,
      iat: Date.now()
    };

    // Usamos btoa no JSON. Se o JSON tiver caracteres unicode, 
    // é recomendável usar o mesmo método de ofuscação base64 acima 
    // ou garantir que o JSON esteja seguro para ASCII.
    // Para manter compatibilidade com o verifySession atual (atob),
    // vamos usar a ofuscação própria para o payload também, 
    // mas para simplificar e manter o formato JWT-like, 
    // mantemos btoa se o JSON for ASCII-safe.
    // Como o Discord user object é JSON seguro, btoa funciona.
    
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(sessionData))));
    const header = btoa(unescape(encodeURIComponent(JSON.stringify({ alg: 'ARC-V1', typ: 'SESSION' }))));
    const signature = this._simpleHash(`${header}.${payload}`);
    
    return `${header}.${payload}.${signature}`;
  },

  /**
   * Verifica a validade e integridade de um token de sessão.
   * @param {string} sessionToken - Token de sessão para verificar.
   * @returns {object|null} Objeto com dados da sessão ou null.
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
      // Reverte o unescape(encodeURIComponent()) feito no createSession
      const jsonStr = decodeURIComponent(escape(atob(payload)));
      const data = JSON.parse(jsonStr);
      
      if (data.v !== this.CONFIG.VERSION) return null;

      if (data.exp < Date.now()) {
        console.warn('[Auth] Sessão expirada.');
        return null;
      }

      const discordToken = this.deobfuscate(data.dt);
      
      if (!discordToken || discordToken.length < 50) return null;

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
  
  async validateDiscordToken(token) {
    if (!token || token.length < 50) {
      return { valid: false, error: 'Token muito curto ou inválido.' };
    }

    if (!/^[A-Za-z0-9._-]+$/.test(token)) {
      return { valid: false, error: 'Token contém caracteres inválidos.' };
    }

    try {
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
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

// Export para uso em módulos (se aplicável)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthManager;
        }
