/**
 * ArcanjoQuest - UI Controller
 * Conecta o HTML Matrix à lógica de automação do Discord.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── ESTADO GLOBAL ──────────────────────────────────────────────────────────
  const state = {
    token: null,
    userId: null,
    user: null,
    quests: [],
    isRunning: false
  };

  // ── REFERÊNCIAS DO DOM ─────────────────────────────────────────────────────
  const els = {
    loginScreen: document.getElementById('loginScreen'),
    dashboardScreen: document.getElementById('dashboardScreen'),
    tokenInput: document.getElementById('tokenInput'),
    loginBtn: document.getElementById('loginBtn'),
    loginMsg: document.getElementById('loginMsg'),
    autoExecuteBtn: document.getElementById('autoExecuteBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    userDisplay: document.getElementById('userDisplay'),
    progressText: document.getElementById('progressText'),
    progressBar: document.getElementById('progressBar'),
    missionGrid: document.getElementById('missionGrid'),
    toast: document.getElementById('toast')
  };

  // ── EFEITO MATRIX ──────────────────────────────────────────────────────────
  function initMatrixRain() {
    const rain = document.getElementById('matrixRain');
    const chars = "01アイウエオカキクケコサシスセソタチツテト";
    for (let i = 0; i < 30; i++) {
      const span = document.createElement('span');
      span.textContent = chars[Math.floor(Math.random() * chars.length)];
      span.style.left = Math.random() * 100 + 'vw';
      span.style.animationDuration = (Math.random() * 3 + 2) + 's';
      span.style.animationDelay = (Math.random() * 5) + 's';
      rain.appendChild(span);
    }
  }

  // ── TOAST NOTIFICATIONS ────────────────────────────────────────────────────
  function showToast(message, type = 'success') {
    els.toast.textContent = message;
    els.toast.className = `show ${type}`;
    setTimeout(() => { els.toast.className = ''; }, 4000);
  }

  // ── RENDERIZAÇÃO DE MISSÕES ────────────────────────────────────────────────
  function renderMissions(quests) {
    els.missionGrid.innerHTML = '';
    quests.forEach(q => {
      const card = document.createElement('div');
      card.className = 'mission-card';
      card.id = `quest-card-${q.id}`;
      
      const header = document.createElement('div');
      header.className = 'mission-header';
      header.innerHTML = `
        <div class="mission-icon">◎</div>
        <div class="mission-tag">${q.taskTypeLabel || 'QUEST'}</div>
      `;
      
      const title = document.createElement('div');
      title.className = 'mission-title';
      title.textContent = q.title;
      
      const desc = document.createElement('div');
      desc.className = 'mission-desc';
      desc.textContent = q.reward;
      
      const status = document.createElement('div');
      status.className = 'mission-status status-pending';
      status.id = `quest-status-${q.id}`;
      status.textContent = 'PENDING';
      
      card.append(header, title, desc, status);
      els.missionGrid.appendChild(card);
    });
  }

  function updateQuestStatus(questId, statusType, text) {
    const el = document.getElementById(`quest-status-${questId}`);
    if (el) {
      el.className = `mission-status status-${statusType}`;
      el.textContent = text.toUpperCase();
    }
  }

  // ── HANDLER DE PROGRESSO (Chamado pelo QuestRunner) ────────────────────────
  function handleProgress(progress) {
    showToast(progress.message || '', progress.type === 'error' ? 'error' : 'success');
    
    if (progress.questId) {
      const statusMap = {
        'start': ['executing', 'EXECUTANDO'],
        'success': ['completed', 'CONCLUÍDA'],
        'error': ['error', 'ERRO']
      };
      const [type, text] = statusMap[progress.type] || ['pending', 'PENDING'];
      updateQuestStatus(progress.questId, type, text);
    }

    if (progress.type === 'complete') {
      els.autoExecuteBtn.disabled = false;
      els.autoExecuteBtn.textContent = 'Iniciar Auto-Execução';
    }
  }

  // ── AÇÕES DO BOTÃO DE LOGIN ────────────────────────────────────────────────
  els.loginBtn.addEventListener('click', async () => {
    const rawToken = els.tokenInput.value.trim();
    if (!rawToken) {
      els.loginMsg.textContent = 'Insira um token.';
      els.loginMsg.className = 'status-msg status-error';
      return;
    }

    els.loginBtn.disabled = true;
    els.loginMsg.textContent = 'Validando token...';
    els.loginMsg.className = 'status-msg status-success';

    try {
      // 1. Valida na API do Discord
      const authResult = await AuthManager.validateDiscordToken(rawToken);
      if (!authResult.valid) throw new Error(authResult.error);

      // 2. Cria sessão ofuscada
      const sessionToken = AuthManager.createSession(rawToken, authResult.user);
      AuthManager.saveSession(sessionToken);

      // 3. Atualiza estado
      state.token = rawToken;
      state.userId = authResult.user.id;
      state.user = authResult.user;

      // 4. Atualiza UI
      els.userDisplay.textContent = `${state.user.username}#${state.user.discriminator}`;
      els.loginScreen.classList.add('hidden');
      els.dashboardScreen.classList.remove('hidden');
      
      // 5. Busca e renderiza quests
      const questsRes = await DiscordClient.getQuests(rawToken);
      if (questsRes.status === 200) {
        state.quests = QuestLogic.processQuests(questsRes.data);
        renderMissions(state.quests);
        showToast(`Conectado! ${state.quests.length} missões encontradas.`);
      } else {
        throw new Error(`Erro ao buscar missões: ${questsRes.status}`);
      }
    } catch (error) {
      els.loginMsg.textContent = `Erro: ${error.message}`;
      els.loginMsg.className = 'status-msg status-error';
    } finally {
      els.loginBtn.disabled = false;
    }
  });

  // ── AÇÕES DO BOTÃO DE AUTO-EXECUÇÃO ────────────────────────────────────────
  els.autoExecuteBtn.addEventListener('click', async () => {
    if (state.isRunning || state.quests.length === 0) return;
    
    state.isRunning = true;
    els.autoExecuteBtn.disabled = true;
    els.autoExecuteBtn.textContent = 'Executando...';
    els.progressText.textContent = 'Iniciando auto-execução...';
    els.progressBar.style.width = '0%';

    // Executa sequencialmente
    for (const quest of state.quests) {
      updateQuestStatus(quest.id, 'executing', 'EXECUTANDO');
      showToast(`Executando: ${quest.title}`, 'info');
      
      await QuestRunner.startQuestAwait(state.token, state.userId, quest);
      
      // Atualiza status final
      const status = QuestRunner.getUserStatus(state.userId);
      const questStatus = status.find(s => s.questId === quest.id);
      if (questStatus) {
        if (questStatus.status === 'completed') {
          updateQuestStatus(quest.id, 'completed', 'CONCLUÍDA');
        } else {
          updateQuestStatus(quest.id, 'error', 'ERRO');
        }
      }
    }

    state.isRunning = false;
    els.autoExecuteBtn.disabled = false;
    els.autoExecuteBtn.textContent = 'Iniciar Auto-Execução';
    els.progressText.textContent = 'Execução finalizada.';
    els.progressBar.style.width = '100%';
    showToast('Auto-execução concluída!', 'success');
  });

  // ── LOGOUT ─────────────────────────────────────────────────────────────────
  els.logoutBtn.addEventListener('click', () => {
    AuthManager.clearSession();
    state.token = null;
    state.userId = null;
    state.user = null;
    state.quests = [];
    els.tokenInput.value = '';
    els.loginScreen.classList.remove('hidden');
    els.dashboardScreen.classList.add('hidden');
    els.userDisplay.textContent = 'N/A';
    els.progressBar.style.width = '0%';
    els.progressText.textContent = '0/0 Missões';
  });

  // ── AUTO-LOGIN (SE HOUVER SESSÃO SALVA) ────────────────────────────────────
  const savedSession = AuthManager.loadSession();
  if (savedSession) {
    els.tokenInput.value = savedSession.discordToken;
    // Dispara o login automaticamente
    els.loginBtn.click();
  }

  initMatrixRain();
});
