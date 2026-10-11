// Lógica de processamento de quests do Discord

const TASK_TYPES = {
  WATCH_VIDEO: 'Vídeo',
  WATCH_VIDEO_ON_MOBILE: 'Vídeo',
  PLAY_ON_DESKTOP: 'Jogar',
  PLAY_ON_XBOX: 'Jogar',
  PLAY_ON_PLAYSTATION: 'Jogar',
};

const TASK_PRIORITY = [
  'PLAY_ON_DESKTOP',
  'PLAY_ON_XBOX',
  'PLAY_ON_PLAYSTATION',
  'WATCH_VIDEO',
  'WATCH_VIDEO_ON_MOBILE',
];

function getBestTask(tasks) {
  let selectedTask = null;
  let bestPriority = 999;
  for (const [type, data] of Object.entries(tasks)) {
    if (!TASK_TYPES[type]) continue;
    const p = TASK_PRIORITY.indexOf(type);
    if (p !== -1 && p < bestPriority) {
      bestPriority = p;
      selectedTask = { taskType: type, taskData: data };
    }
  }
  return selectedTask;
}

function parseRewardText(r) {
  if (!r) return { text: 'Recompensa desconhecida', orbs: 0 };
  if (r.type === 4) return { text: `${r.orb_quantity} Orbs`, orbs: r.orb_quantity };
  if (r.type === 3) return { text: r.messages?.name || 'Decoração de Avatar', orbs: 0 };
  if (r.type === 1) return { text: r.messages?.name || 'Item no jogo', orbs: 0 };
  return { text: 'Recompensa desconhecida', orbs: 0 };
}

function jitter(baseMs, rangeMs = 1500) {
  return baseMs + Math.floor(Math.random() * rangeMs);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Processa as quests cruas retornadas pela API do Discord
function processQuests(rawData) {
  const now = new Date();
  const parsed = [];

  // A API /api/v9/quests/@me retorna { quests: [...] }
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
    if (new Date(quest.config.expires_at) < now) continue;
    // Pula completadas
    if (quest.user_status?.completed_at) continue;

    // Pega tasks de task_config_v2 (prioridade) ou task_config (fallback)
    const tasks = quest.config.task_config_v2?.tasks || quest.config.task_config?.tasks || {};
    const selectedTask = getBestTask(tasks);
    if (!selectedTask) continue;

    const target = selectedTask.taskData.target || 0;
    const reward = parseRewardText(quest.config.rewards_config?.rewards?.[0]);

    const heroPath = quest.config.assets?.quest_bar_hero;
    const splash = heroPath
      ? heroPath.startsWith('http')
        ? heroPath
        : `https://cdn.discordapp.com/${heroPath}`
      : null;

    const taskTypeLabel = TASK_TYPES[selectedTask.taskType] || selectedTask.taskType;

    parsed.push({
      id: String(quest.id),
      title: quest.config.messages?.quest_name || 'Missão desconhecida',
      taskType: selectedTask.taskType,
      taskTypeLabel,
      target,
      reward: reward.text,
      isOrbs: reward.orbs > 0,
      splash,
      isEnrolled: !!quest.user_status?.enrolled_at,
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

module.exports = {
  TASK_TYPES,
  TASK_PRIORITY,
  getBestTask,
  parseRewardText,
  processQuests,
  jitter,
  sleep,
};
