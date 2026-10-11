// Quest runner — automação e monitoramento de progresso de quests Discord

const { enrollQuest, sendVideoProgress, sendHeartbeat } = require('./discordClient');
const { jitter, sleep } = require('./questLogic');

// Estado em memória: { userId: { questId: { status, progress, target, ... } } }
const activeQuests = {};

// ── Helper ───────────────────────────────────────────────────────────────────
function getEntry(userId, questId) {
  return activeQuests[userId]?.[questId];
}

function setEntry(userId, questId, updates) {
  if (activeQuests[userId]?.[questId]) {
    Object.assign(activeQuests[userId][questId], updates);
  }
}

function markCompleted(userId, questId, target) {
  setEntry(userId, questId, { status: 'completed', progress: target });
}

function markError(userId, questId, error) {
  setEntry(userId, questId, { status: 'error', error: error || 'Erro desconhecido' });
}

// ── Missões de vídeo ─────────────────────────────────────────────────────────
// Continua enviando video-progress até o Discord responder com completed_at.
// Quando timestamp >= target, continua reenviando até confirmação do servidor.
async function runVideoQuest(token, userId, questId, target) {
  let timestamp = 0;

  while (true) {
    const entry = getEntry(userId, questId);
    if (!entry || entry.cancelled) return;

    const res = await sendVideoProgress(token, questId, timestamp);

    // Token inválido — encerra execução
    if (res.status === 401) {
      markError(userId, questId, 'Token inválido');
      return;
    }

    // Rate limit ou erro temporário — recua e aguarda com jitter
    if (res.status === 400 || res.status === 429) {
      timestamp = Math.max(0, timestamp - 10);
      await sleep(jitter(8000));
      continue;
    }

    // Erro fatal
    if (res.status >= 400) {
      markError(userId, questId, `Discord retornou status ${res.status}`);
      return;
    }

    const data = res.data || {};

    // Ponto de saída definitivo: confirmação do Discord
    if (data.completed_at) {
      markCompleted(userId, questId, target);
      return;
    }

    // Atualiza progresso atual
    setEntry(userId, questId, { progress: timestamp });

    // Só incrementa se ainda não atingiu o target; caso contrário, reenvia até completed_at
    if (timestamp < target) {
      timestamp += 10;
    }

    await sleep(jitter(2500, 2500));
  }
}

// ── Missões de jogar ─────────────────────────────────────────────────────────
// Continua enviando heartbeat com stream_key até o Discord responder com completed_at.
async function runPlayQuest(token, userId, questId, taskType, target) {
  const streamKey = `call:${questId}:1`;

  while (true) {
    const entry = getEntry(userId, questId);
    if (!entry || entry.cancelled) {
      // Se cancelado, finaliza com terminal heartbeat
      await sendHeartbeat(token, questId, streamKey, true).catch(() => {});
      return;
    }

    const res = await sendHeartbeat(token, questId, streamKey, false);

    // Token inválido
    if (res.status === 401) {
      markError(userId, questId, 'Token inválido');
      return;
    }

    // Rate limit
    if (res.status === 429) {
      await sleep(jitter(8000));
      continue;
    }

    // Erro fatal
    if (res.status >= 400) {
      markError(userId, questId, `Discord retornou status ${res.status}`);
      return;
    }

    const data = res.data || {};

    // Ponto de saída definitivo: confirmação do Discord
    if (data.completed_at || data.user_status?.completed_at) {
      markCompleted(userId, questId, target);
      await sendHeartbeat(token, questId, streamKey, true).catch(() => {});
      return;
    }

    // Lê o progresso real retornado pelo servidor
    const newProgress = data.progress?.[taskType]?.value ?? (getEntry(userId, questId)?.progress || 0);
    setEntry(userId, questId, { progress: newProgress });

    await sleep(jitter(24000, 3000));
  }
}

// ── API pública ──────────────────────────────────────────────────────────────
async function startQuest(token, userId, quest) {
  const questId = quest.id;
  const taskType = quest.taskType;
  const target = quest.target;

  // Inscreve na missão primeiro
  await enrollQuest(token, questId);

  if (!activeQuests[userId]) activeQuests[userId] = {};
  activeQuests[userId][questId] = {
    status: 'running',
    progress: 0,
    target,
    taskType,
    cancelled: false,
  };

  // Roda em background
  if (taskType === 'WATCH_VIDEO' || taskType === 'WATCH_VIDEO_ON_MOBILE') {
    runVideoQuest(token, userId, questId, target).catch((err) => {
      console.error(`[questRunner] Erro em vídeo quest ${questId}:`, err.message);
      markError(userId, questId, err.message);
    });
  } else {
    runPlayQuest(token, userId, questId, taskType, target).catch((err) => {
      console.error(`[questRunner] Erro em play quest ${questId}:`, err.message);
      markError(userId, questId, err.message);
    });
  }
}

// Versão sequencial para rodar todas
async function startQuestAwait(token, userId, quest) {
  const questId = quest.id;
  const taskType = quest.taskType;
  const target = quest.target;

  await enrollQuest(token, questId);

  if (!activeQuests[userId]) activeQuests[userId] = {};
  activeQuests[userId][questId] = {
    status: 'running',
    progress: 0,
    target,
    taskType,
    cancelled: false,
  };

  if (taskType === 'WATCH_VIDEO' || taskType === 'WATCH_VIDEO_ON_MOBILE') {
    await runVideoQuest(token, userId, questId, target);
  } else {
    await runPlayQuest(token, userId, questId, taskType, target);
  }
}

function cancelQuest(userId, questId) {
  if (activeQuests[userId]?.[questId]) {
    activeQuests[userId][questId].cancelled = true;
    activeQuests[userId][questId].status = 'cancelled';
    return true;
  }
  return false;
}

function getUserStatus(userId) {
  if (!activeQuests[userId]) return [];
  return Object.entries(activeQuests[userId]).map(([qid, data]) => ({
    questId: qid,
    status: data.status,
    progress: data.progress,
    target: data.target,
    taskType: data.taskType,
  }));
}

module.exports = {
  activeQuests,
  startQuest,
  startQuestAwait,
  cancelQuest,
  getUserStatus,
};
