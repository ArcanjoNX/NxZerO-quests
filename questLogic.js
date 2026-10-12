/**
 * ArcanjoQuest - Quest Logic
 * Lógica de processamento de quests do Discord (Versão Navegador)
 */

const QuestLogic = {
  // ── CONSTANTES ─────────────────────────────────────────────────────────────
  
  TASK_TYPES: {
    WATCH_VIDEO: 'Vídeo',
    WATCH_VIDEO_ON_MOBILE: 'Vídeo',
    PLAY_ON_DESKTOP: 'Jogar',
    PLAY_ON_XBOX: 'Jogar',
    PLAY_ON_PLAYSTATION: 'Jogar',
  },

  TASK_PRIORITY: [
    'PLAY_ON_DESKTOP',
    'PLAY_ON_XBOX',
    'PLAY_ON_PLAYSTATION',
    'WATCH_VIDEO',
    'WATCH_VIDEO_ON_MOBILE',
  ],

  // ── FUNÇÕES UTILITÁRIAS ────────────────────────────────────────────────────
  
  getBestTask(tasks) {
    let selectedTask = null;
    let bestPriority = 999;
    for (const [type, data] of Object.entries(tasks)) {
      if (!this.TASK_TYPES[type]) continue;
      const p = this.TASK_PRIORITY.indexOf(type);
      if (p !== -1 && p < bestPriority) {
        bestPriority = p;
        selectedTask = { taskType: type, taskData: data };
      }
    }
    return selectedTask;
  },

  parseRewardText(r) {
    if (!r) return { text: 'Recompensa desconhecida', orbs: 0 };
    if (r.type === 4) return { text: `${r.orb_quantity} Orbs`, orbs: r.orb_quantity };
    if (r.type === 3) return { text: r.messages?.name || 'Decoração de Avatar', orbs: 0 };
    if (r.type === 1) return { text: r.messages?.name || 'Item no jogo', orbs: 0 };
    return { text: 'Recompensa desconhecida', orbs: 0 };
  },

  jitter(baseMs, rangeMs = 1500) {
    return baseMs + Math.floor(Math.random() * rangeMs);
  },

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  // ── PROCESSAMENTO PRINCIPAL ────────────────────────────────────────────────
  
  /**
   * Processa as quests cruas retornadas pela API do Discord.
   * @param {object|Array} rawData - Resposta bruta da API /api/v9/quests/@me.
   * @returns {Array} Lista de quests processadas e ordenadas.
   */
  processQuests(rawData) {
    const now = new Date();
    const parsed = [];

    // A API /api/v9/quests/@me retorna { quests: [...] } ou Array direto
    let questsList;
    if (Array.isArray(rawData)) {
      questsList = rawData;
    } else if (rawData && Array.isArray(rawData.quests)) {
      questsList = rawData.quests;
    } else {
      questsList = [];
    }

    for (const quest of questsList) {
      // Pula expiradas
      if (quest.config && quest.config.expires_at && new Date(quest.config.expires_at) < now) continue;
      
      // Pula completadas
      if (quest.user_status && quest.user_status.completed_at) continue;

      // Pega tasks de task_config_v2 (prioridade) ou task_config (fallback)
      const tasks = (quest.config && quest.config.task_config_v2 && quest.config.task_config_v2.tasks) 
        || (quest.config && quest.config.task_config && quest.config.task_config.tasks) 
        || {};
        
      const selectedTask = this.getBestTask(tasks);
      if (!selectedTask) continue;

      const target = selectedTask.taskData.target || 0;
      const reward = this.parseRewardText(quest.config.rewards_config?.rewards?.[0]);

      const heroPath = quest.config.assets?.quest_bar_hero;
      const splash = heroPath
        ? heroPath.startsWith('http')
          ? heroPath
          : `https://cdn.discordapp.com/${heroPath}`
        : null;

      const taskTypeLabel = this.TASK_TYPES[selectedTask.taskType] || selectedTask.taskType;

      parsed.push({
        id: String(quest.id),
        title: quest.config.messages?.quest_name || 'Missão desconhecida',
        taskType: selectedTask.taskType,
        taskTypeLabel,
        target,
        reward: reward.text,
        isOrbs: reward.orbs > 0,
        splash,
        isEnrolled: !!(quest.user_status && quest.user_status.enrolled_at),
      });
    }

    // Ordena: quests com orbs primeiro, depois por target crescente
    parsed.sort((a, b) => {
      if (a.isOrbs && !b.isOrbs) return -1;
      if (!a.isOrbs && b.isOrbs) return 1;
      return a.target - b.target;
    });

    return parsed;
  }
};
