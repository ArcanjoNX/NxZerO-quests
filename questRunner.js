/**
 * ArcanjoQuest - Quest Runner
 * Automação e monitoramento de progresso de quests Discord (Versão Navegador)
 */

const QuestRunner = {
  // Estado em memória: { userId: { questId: { status, progress, target, ... } } }
  activeQuests: {},
  _sessionCounter: 0,

  // ── HELPERS DE ESTADO ──────────────────────────────────────────────────────
  
  _getEntry(userId, questId) {
    return this.activeQuests[userId]?.[questId];
  },

  _setEntry(userId, questId, updates) {
    if (this.activeQuests[userId]?.[questId]) {
      Object.assign(this.activeQuests[userId][questId], updates);
    }
  },

  _markCompleted(userId, questId, target) {
    this._setEntry(userId, questId, { status: 'completed', progress: target });
  },

  _markError(userId, questId, error) {
    this._setEntry(userId, questId, { status: 'error', error: error || 'Erro desconhecido' });
  },

  _generateStreamKey(questId) {
    this._sessionCounter++;
    // Formato compatível com a API de Live do Discord
    return `live:${questId}:${Date.now()}:${this._sessionCounter}`;
  },

  // ── MISSÕES DE VÍDEO ───────────────────────────────────────────────────────
  // Continua enviando video-progress até o Discord responder com completed_at.
  
  async _runVideoQuest(token, userId, questId, target) {
    let timestamp = 0;
    let lastSuccessfulTimestamp = 0;

    while (true) {
      const entry = this._getEntry(userId, questId);
      if (!entry || entry.cancelled) return;

      const res = await DiscordClient.sendVideoProgress(token, questId, timestamp);

      // Token inválido — encerra execução
      if (res.status === 401) {
        this._markError(userId, questId, 'Token inválido');
        return;
      }

      // Rate limit ou erro temporário — recua e aguarda com jitter
      if (res.status === 400 || res.status === 429) {
        // Se o servidor rejeitar, volta para o último timestamp válido
        timestamp = lastSuccessfulTimestamp;
        await QuestLogic.sleep(QuestLogic.jitter(8000));
        continue;
      }

      // Erro fatal
      if (res.status >= 400) {
        this._markError(userId, questId, `Discord retornou status ${res.status}`);
        return;
      }

      const data = res.data || {};

      // Ponto de saída definitivo: confirmação do Discord
      if (data.completed_at || data.user_status?.completed_at) {
        this._markCompleted(userId, questId, target);
        return;
      }

      // Atualiza progresso atual
      this._setEntry(userId, questId, { progress: timestamp });
      lastSuccessfulTimestamp = timestamp;

      // Só incrementa se ainda não atingiu o target; caso contrário, reenvia até completed_at
      if (timestamp < target) {
        timestamp += 10;
      }

      await QuestLogic.sleep(QuestLogic.jitter(2500, 2500));
    }
  },

  // ── MISSÕES DE JOGAR ───────────────────────────────────────────────────────
  // Continua enviando heartbeat com stream_key até o Discord responder com completed_at.
  
  async _runPlayQuest(token, userId, questId, taskType, target) {
    const streamKey = this._generateStreamKey(questId);

    while (true) {
      const entry = this._getEntry(userId, questId);
      if (!entry || entry.cancelled) {
        // Se cancelado, finaliza com terminal heartbeat
        await DiscordClient.sendHeartbeat(token, questId, streamKey, true).catch(() => {});
        return;
      }

      const res = await DiscordClient.sendHeartbeat(token, questId, streamKey, false);

      // Token inválido
      if (res.status === 401) {
        this._markError(userId, questId, 'Token inválido');
        return;
      }

      // Rate limit
      if (res.status === 429) {
        await QuestLogic.sleep(QuestLogic.jitter(8000));
        continue;
      }

      // Erro fatal
      if (res.status >= 400) {
        this._markError(userId, questId, `Discord retornou status ${res.status}`);
        return;
      }

      const data = res.data || {};

      // Ponto de saída definitivo: confirmação do Discord
      if (data.completed_at || data.user_status?.completed_at) {
        this._markCompleted(userId, questId, target);
        await DiscordClient.sendHeartbeat(token, questId, streamKey, true).catch(() => {});
        return;
      }

      // Lê o progresso real retornado pelo servidor
      const newProgress = data.progress?.[taskType]?.value ?? (this._getEntry(userId, questId)?.progress || 0);
      this._setEntry(userId, questId, { progress: newProgress });

      await QuestLogic.sleep(QuestLogic.jitter(24000, 3000));
    }
  },

  // ── API PÚBLICA ────────────────────────────────────────────────────────────
  
  /**
   * Inicia uma quest em background (não bloqueia a UI).
   */
  async startQuest(token, userId, quest) {
    const questId = quest.id;
    const taskType = quest.taskType;
    const target = quest.target;

    // Inscreve na missão primeiro (ignora se já estiver inscrita)
    const enrollRes = await DiscordClient.enrollQuest(token, questId);
    // Status 400/409 pode significar "já inscrito", o que é aceitável
    
    if (!this.activeQuests[userId]) this.activeQuests[userId] = {};
    this.activeQuests[userId][questId] = {
      status: 'running',
      progress: 0,
      target,
      taskType,
      cancelled: false,
    };

    // Roda em background
    if (taskType === 'WATCH_VIDEO' || taskType === 'WATCH_VIDEO_ON_MOBILE') {
      this._runVideoQuest(token, userId, questId, target).catch((err) => {
        console.error(`[questRunner] Erro em vídeo quest ${questId}:`, err.message);
        this._markError(userId, questId, err.message);
      });
    } else {
      this._runPlayQuest(token, userId, questId, taskType, target).catch((err) => {
        console.error(`[questRunner] Erro em play quest ${questId}:`, err.message);
        this._markError(userId, questId, err.message);
      });
    }
  },

  /**
   * Inicia uma quest e aguarda a conclusão (bloqueia a UI até terminar).
   */
  async startQuestAwait(token, userId, quest) {
    const questId = quest.id;
    const taskType = quest.taskType;
    const target = quest.target;

    await DiscordClient.enrollQuest(token, questId);

    if (!this.activeQuests[userId]) this.activeQuests[userId] = {};
    this.activeQuests[userId][questId] = {
      status: 'running',
      progress: 0,
      target,
      taskType,
      cancelled: false,
    };

    if (taskType === 'WATCH_VIDEO' || taskType === 'WATCH_VIDEO_ON_MOBILE') {
      await this._runVideoQuest(token, userId, questId, target);
    } else {
      await this._runPlayQuest(token, userId, questId, taskType, target);
    }
  },

  cancelQuest(userId, questId) {
    const entry = this.activeQuests[userId]?.[questId];
    if (entry && entry.status === 'running') {
      entry.cancelled = true;
      entry.status = 'cancelled';
      return true;
    }
    return false;
  },

  getUserStatus(userId) {
    if (!this.activeQuests[userId]) return [];
    return Object.entries(this.activeQuests[userId]).map(([qid, data]) => ({
      questId: qid,
      status: data.status,
      progress: data.progress,
      target: data.target,
      taskType: data.taskType,
    }));
  }
};
