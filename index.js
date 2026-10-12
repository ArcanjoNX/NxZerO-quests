/**
 * ArcanjoQuest - UI Controller (Main)
 * Conecta o HTML Matrix à lógica de automação do Discord.
 * 
 * Pré-requisito: Os arquivos de lógica devem ser carregados via ES Modules.
 */

// 1. IMPORTS DAS LÓGICAS EXTERNAS
// Ajuste os caminhos conforme sua estrutura de pastas
import { AuthManager } from './modules/auth.js';
import { DiscordClient } from './modules/client.js';
import { QuestLogic } from './modules/quest-logic.js';
import { QuestRunner } from './modules/quest-runner.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── ESTADO GLOBAL (Reativo) ────────────────────────────────────────────────
  const state = {
    token: null,
    userId: null,
    user: null,
    quests: [],
    isRunning: false,
    isLoggedOut: false // Flag para interromper loops assíncronos
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
    toast: document.getElementById('toast'),
    matrixRain: document.getElementById('matrixRain')
  };

  // ── EFEITO MATRIX ──────────────────────────────────────────────────────────
  function initMatrixRain() {
    if (!els.matrixRain) return;
    const chars = "01アイウエオカキクケコサシスセソタチツテト";
    for (let i = 0; i < 30; i++) {
      const span = document.createElement('span');
      span.textContent = chars[Math.floor(Math.random() * chars.length)];
      span.style.left = Math.random() * 100 + 'vw';
      span.style.animationDuration = (Math.random() * 3 + 2) + 's';
      span.style.animationDelay = (Math.random() * 5) + 's';
      els.matrixRain.appendChild(span);
    }
  }

  // ── TOAST NOTIFICATIONS ────────────────────────────────────────────────────
  function showToast(message, type = 'success') {
    els.toast.textContent = message;
    els.toast.className = `show ${type}`;
    // Garante que a classe 'show' seja removida mesmo se houver toasts rápidos
    clearTimeout(els.toast._timeout);
    els.toast._timeout = setTimeout(() => { 
      els.toast.className = ''; 
    }, 4000);
  }

  // ── RENDERIZAÇÃO DE MISSÕES ────────────────────────────────────────────────
  function renderMissions(quests) {
    els.missionGrid.innerHTML = '';
    
    if (quests.length === 0) {
      els.missionGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--muted); font-family: var(--mono); padding: 2rem;">NENHUMA MISSÃO DISPONÍVEL</div>';
      return;
    }

    quests.forEach(q => {
      const card = document.createElement('div');
      card.className = 'mission-card';
      card.id = `quest-card-${q.id}`;
      
      const header = document.createElement('div');
      header.className = 'mission-header';
      // Sanitize: Use textContent para dinâmico se possível, mas innerHTML é ok para labels fixos
      header.innerHTML = `
        <div class="mission-icon">◎</div>
        <div class="mission-tag">${q.taskTypeLabel || 'QUEST'}</div>
      `;
      
      const title = document.createElement('div');
      title.className = 'mission-title';
      title.textContent = q.title;
      
      const desc = document.createElement('div');
      desc.className = 'mission-desc';
      // Evita injeção de HTML se target/reward vierem da API com caracteres especiais
      const descSpan = document.createElement('span');
      descSpan.textContent = `Alvo: ${q.target} | Recompensa: ${q.reward}`;
      desc.appendChild(descSpan);
      
      const status = document.createElement('div');
      status.className = 'mission-status status-pending';
      status.id = `quest-status-${q.id}`;
      status.textContent = 'PENDENTE';
      
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

  // ── FUNÇÃO DE BUSCA E RENDERIZAÇÃO ─────────────────────────────────────────
  async function fetchAndRenderQuests() {
    if (!state.token || state.isLoggedOut) return 0;
    
    try {
      const questsRes = await DiscordClient.getQuests(state.token);
      
      if (questsRes.status === 200) {
        state.quests = QuestLogic.processQuests(questsRes.data);
        renderMissions(state.quests);
        return state.quests.length;
      } else if (questsRes.status === 401) {
        showToast('Token inválido ou expirado. Sessão encerrada.', 'error');
        handleLogout(true); // forceLogout
        return 0;
      } else {
        showToast(`Erro ao buscar missões: ${questsRes.data.message || questsRes.status}`, 'error');
        return 0;
      }
    } catch (err) {
      console.error("Falha na rede ao buscar quests:", err);
      showToast('Falha de conexão com o servidor de Quests.', 'error');
      return 0;
    }
  }

  // ── HANDLER DE LOGIN ───────────────────────────────────────────────────────
  async function performLogin() {
    const rawToken = els.tokenInput.value.trim();
    if (!rawToken) {
      setLoginMsg('Insira um token.', 'error');
      return;
    }

    els.loginBtn.disabled = true;
    setLoginMsg('Validando token...', 'info');

    try {
      // 1. Valida na API do Discord
      const authResult = await AuthManager.validateDiscordToken(rawToken);
      if (!authResult.valid) throw new Error(authResult.error || 'Token inválido');

      // 2. Cria sessão ofuscada
      const sessionToken = AuthManager.createSession(rawToken, authResult.user);
      AuthManager.saveSession(sessionToken);

      // 3. Atualiza estado
      state.token = rawToken;
      state.userId = authResult.user.id;
      state.user = authResult.user;
      state.isLoggedOut = false;

      // 4. Atualiza UI
      els.userDisplay.textContent = state.user.username;
      els.loginScreen.classList.add('hidden');
      els.dashboardScreen.classList.remove('hidden');
      
      // 5. Busca e renderiza quests
      const count = await fetchAndRenderQuests();
      if (count > 0) {
        showToast(`Conectado! ${count} missões encontradas.`);
      } else {
        showToast('Conectado! Nenhuma missão pendente no momento.', 'warning');
      }
    } catch (error) {
      console.error("Login Error:", error);
      setLoginMsg(`Erro: ${error.message}`, 'error');
    } finally {
      els.loginBtn.disabled = false;
    }
  }

  // ── HANDLER DE AUTO-EXECUÇÃO ───────────────────────────────────────────────
  async function performAutoExecute() {
    if (state.isRunning || state.quests.length === 0) return;
    
    state.isRunning = true;
    els.autoExecuteBtn.disabled = true;
    els.autoExecuteBtn.textContent = 'EXECUTANDO...';
    els.progressText.textContent = 'Processando missões...';
    els.progressBar.style.width = '0%';

    let completedCount = 0;
    const totalToRun = state.quests.length;
    
    try {
      for (let i = 0; i < totalToRun; i++) {
        // Verifica se o usuário fez logout durante a execução
        if (state.isLoggedOut) break;

        const quest = state.quests[i];
        
        // Atualiza barra de progresso (baseado no índice atual, não concluído)
        els.progressBar.style.width = `${(i / totalToRun) * 100}%`;
        updateQuestStatus(quest.id, 'executing', 'EXECUTANDO');
        
        try {
          await QuestRunner.startQuestAwait(state.token, state.userId, quest);
          
          // Verifica status final
          const status = QuestRunner.getUserStatus(state.userId);
          const questStatus = status.find(s => s.questId === quest.id);
          
          if (questStatus && questStatus.status === 'completed') {
            updateQuestStatus(quest.id, 'completed', 'CONCLUÍDA');
            completedCount++;
          } else {
            updateQuestStatus(quest.id, 'error', 'FALHOU');
          }
        } catch (err) {
          console.error(`Erro na quest ${quest.id}:`, err);
          updateQuestStatus(quest.id, 'error', 'ERRO');
        }
        
        // Pequeno delay para evitar rate limits do Discord (ex: 100ms)
        await new Promise(r => setTimeout(r, 100));
      }

      if (!state.isLoggedOut) {
        els.progressBar.style.width = '100%';
        els.progressText.textContent = `${completedCount}/${totalToRun} Missões Concluídas`;
        showToast(`Auto-execução concluída! ${completedCount} sucesso(s).`, 'success');
        
        // Atualiza a lista após a execução para pegar novas missões ou remover as concluídas
        await fetchAndRenderQuests();
      }

    } catch (err) {
      console.error('Erro crítico na auto-execução:', err);
      if (!state.isLoggedOut) showToast('Erro crítico na execução.', 'error');
    } finally {
      state.isRunning = false;
      if (!state.isLoggedOut) {
        els.autoExecuteBtn.disabled = false;
        els.autoExecuteBtn.textContent = 'INICIAR AUTO-EXECUÇÃO';
      }
    }
  }

  // ── HANDLER DE LOGOUT ──────────────────────────────────────────────────────
  function handleLogout(isForced = false) {
    state.isLoggedOut = true;
    state.token = null;
    state.userId = null;
    state.user = null;
    state.quests = [];
    state.isRunning = false; // Para o loop de execução imediatamente na próxima iteração

    AuthManager.clearSession();
    
    // Reset UI
    els.tokenInput.value = '';
    els.loginScreen.classList.remove('hidden');
    els.dashboardScreen.classList.add('hidden');
    els.userDisplay.textContent = 'N/A';
    els.progressBar.style.width = '0%';
    els.progressText.textContent = '0/0 Missões';
    els.missionGrid.innerHTML = '';
    
    // Reset botões
    els.autoExecuteBtn.disabled = false;
    els.autoExecuteBtn.textContent = 'INICIAR AUTO-EXECUÇÃO';
    
    if (!isForced) {
      showToast('Sessão encerrada com segurança.', 'info');
    }
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function setLoginMsg(text, type) {
    els.loginMsg.textContent = text;
    els.loginMsg.className = `status-msg status-${type}`;
  }

  // ── EVENT LISTENERS ────────────────────────────────────────────────────────
  els.loginBtn.addEventListener('click', performLogin);
  els.tokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performLogin();
  });
  els.autoExecuteBtn.addEventListener('click', performAutoExecute);
  els.logoutBtn.addEventListener('click', () => handleLogout(false));

  // ── AUTO-LOGIN (SE HOUVER SESSÃO SALVA) ────────────────────────────────────
  const savedSession = AuthManager.loadSession();
  if (savedSession) {
    els.tokenInput.value = savedSession.discordToken;
    setLoginMsg('Sessão anterior encontrada. Clique para validar.', 'warning');
  }

  initMatrixRain();
});
