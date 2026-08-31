// webapp/app.js — Логика веб-приложения Telegram WebApp / PWA

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
}

// Идентификация пользователя (из Telegram WebApp или случайный ID для внешнего браузера)
const playerId = tg?.initDataUnsafe?.user?.id || Math.floor(Math.random() * 1000000);

let currentRoomId = null;
let pollInterval = null;
let hasRefusedFullBots = false;
let deferredPrompt = null;

// --- Регистрация Service Worker & PWA Установка ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/webapp/sw.js').catch((err) => {
    console.error('Ошибка регистрации Service Worker:', err);
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installScreen = document.getElementById('install-screen');
  if (installScreen && !tg?.initDataUnsafe?.user) {
    installScreen.style.display = 'block';
  }
});

document.getElementById('pwa-install-trigger')?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      const installScreen = document.getElementById('install-screen');
      if (installScreen) installScreen.style.display = 'none';
    }
    deferredPrompt = null;
  }
});

// Навигация между экранами
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => (s.style.display = 'none'));
  const activeScreen = document.getElementById(screenId);
  if (activeScreen) activeScreen.style.display = 'flex';
}

// --- Создание и вход в комнату ---
document.getElementById('create-room-btn')?.addEventListener('click', async () => {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  await createRoomApi(roomId);
});

document.getElementById('solo-bot-btn')?.addEventListener('click', async () => {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const created = await createRoomApi(roomId);
  if (created) {
    await fetch('/api/room/fill-bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, target_count: 4 })
    });
    fetchState();
  }
});

document.getElementById('join-room-btn')?.addEventListener('click', () => {
  const input = document.getElementById('room-code-input');
  const code = input ? input.value.trim().toUpperCase() : '';
  if (code) {
    joinRoom(code);
  } else {
    alert('Введите код комнаты!');
  }
});

async function createRoomApi(roomId) {
  try {
    const res = await fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId })
    });
    if (res.ok) {
      joinRoom(roomId);
      return true;
    }
  } catch (err) {
    alert('Ошибка при создании комнаты');
  }
  return false;
}

function joinRoom(roomId) {
  currentRoomId = roomId;
  showScreen('game-screen');
  const roomInfo = document.getElementById('room-info');
  if (roomInfo) roomInfo.innerText = `Комната: ${roomId}`;
  startPolling();
}

// --- Опрос состояния игры (Polling) ---
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  fetchState();
  pollInterval = setInterval(fetchState, 1500);
}

async function fetchState() {
  if (!currentRoomId) return;
  try {
    const res = await fetch(`/api/room/state?room_id=${currentRoomId}&player_id=${playerId}`);
    if (res.ok) {
      const state = await res.json();
      renderGame(state);
    }
  } catch (err) {
    console.error('Ошибка получения состояния:', err);
  }
}

// --- Отрисовка игрового процесса ---
function renderGame(state) {
  // 1. Статус ролей
  const roleBadge = document.getElementById('role-badge');
  if (roleBadge) {
    if (state.is_czar) {
      roleBadge.innerText = '👑 Вы Ведущий';
      roleBadge.style.background = '#f39c12';
    } else {
      roleBadge.innerText = 'Игрок';
      roleBadge.style.background = '#2ea6ff';
    }
  }

  // 2. Текст вопроса
  const qText = document.getElementById('question-text');
  if (qText) qText.innerText = state.question || 'Загрузка вопроса...';

  // 3. Панель Лобби и диалог ботов
  updateLobbyAndBots(state);

  // 4. Отрисовка карты на руках игрока
  const handContainer = document.getElementById('cards-hand');
  if (handContainer) {
    handContainer.innerHTML = '';
    if (state.is_czar) {
      handContainer.innerHTML = '<div style="color: #7f91a4; grid-column: span 2;">Вы ведущий в этом раунде. Ждите карт от игроков!</div>';
    } else {
      state.my_hand.forEach((card) => {
        const cardElem = document.createElement('div');
        cardElem.className = 'game-card';
        cardElem.innerText = card;
        cardElem.onclick = () => playCard(card);
        handContainer.appendChild(cardElem);
      });
    }
  }

  // 5. Отрисовка стола (сброшенные карты)
  const tableContainer = document.getElementById('table-cards');
  if (tableContainer) {
    tableContainer.innerHTML = '';
    if (state.table_cards.length === 0) {
      tableContainer.innerHTML = '<div style="color: #7f91a4; grid-column: span 2;">Пока никто не скинул карту...</div>';
    } else {
      state.table_cards.forEach((item) => {
        const cardElem = document.createElement('div');
        cardElem.className = 'game-card';
        cardElem.innerText = item.card;

        if (state.is_czar && item.player_id !== null) {
          cardElem.style.borderColor = '#f39c12';
          cardElem.onclick = () => selectWinner(item.player_id);
        }
        tableContainer.appendChild(cardElem);
      });
    }
  }

  // 6. Таблица очков участников
  const scoreContainer = document.getElementById('score-board');
  if (scoreContainer) {
    scoreContainer.innerHTML = '';
    Object.entries(state.scores).forEach(([pId, score]) => {
      const scoreElem = document.createElement('div');
      scoreElem.className = 'score-item';
      const isSelf = parseInt(pId) === playerId;
      const name = pId < 0 ? `🤖 Бот #${Math.abs(pId)}` : isSelf ? 'Вы' : `Игрок #${pId}`;
      scoreElem.innerHTML = `<span>${name}</span><b>${score} pt</b>`;
      scoreContainer.appendChild(scoreElem);
    });
  }
}

// --- Действия игрока ---
async function playCard(cardText) {
  try {
    await fetch('/api/room/play-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: currentRoomId, player_id: playerId, card_text: cardText })
    });
    fetchState();
  } catch (err) {
    console.error('Ошибка сброса карты:', err);
  }
}

async function selectWinner(winningPlayerId) {
  try {
    await fetch('/api/room/select-winner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: currentRoomId, czar_id: playerId, winning_player_id: winningPlayerId })
    });
    fetchState();
  } catch (err) {
    console.error('Ошибка выбора победителя:', err);
  }
}

// --- Таймер лобби и предложения добавить ботов ---
document.getElementById('start-now-btn')?.addEventListener('click', async () => {
  if (!currentRoomId) return;
  await fetch('/api/room/start-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: currentRoomId })
  });
  fetchState();
});

function updateLobbyAndBots(state) {
  const lobbyPanel = document.getElementById('lobby-panel');
  const timerElem = document.getElementById('lobby-timer');
  const botModal = document.getElementById('bot-modal');

  if (!state.is_started) {
    if (lobbyPanel) lobbyPanel.style.display = 'block';
    if (timerElem) timerElem.innerText = state.lobby_time_left;
  } else {
    if (lobbyPanel) lobbyPanel.style.display = 'none';
    if (botModal) botModal.style.display = 'none';
    return;
  }

  const needed = 4 - state.player_count;
  if (needed > 0 && botModal && botModal.style.display !== 'flex') {
    if (!hasRefusedFullBots) {
      showBotModal(
        `В комнате ${state.player_count} игрок(а).`,
        `Добавить +${needed} ботов для игры вчетвером?`,
        async () => {
          await fillBots(4);
          botModal.style.display = 'none';
        },
        () => {
          hasRefusedFullBots = true;
          promptAddSingleBot(state.player_count);
        }
      );
    }
  }
}

function promptAddSingleBot(currentCount) {
  showBotModal(
    'Предложение',
    'Добавить хотя бы +1 бота, чтобы кто-то исполнял роль судьи?',
    async () => {
      await fillBots(currentCount + 1);
      const modal = document.getElementById('bot-modal');
      if (modal) modal.style.display = 'none';
    },
    () => {
      const modal = document.getElementById('bot-modal');
      if (modal) modal.style.display = 'none';
    }
  );
}

function showBotModal(title, text, onYes, onNo) {
  const modal = document.getElementById('bot-modal');
  const titleElem = document.getElementById('bot-modal-title');
  const textElem = document.getElementById('bot-modal-text');

  if (titleElem) titleElem.innerText = title;
  if (textElem) textElem.innerText = text;

  const yesBtn = document.getElementById('bot-modal-yes');
  const noBtn = document.getElementById('bot-modal-no');

  if (yesBtn) yesBtn.onclick = onYes;
  if (noBtn) noBtn.onclick = onNo;

  if (modal) modal.style.display = 'flex';
}

async function fillBots(targetCount) {
  try {
    await fetch('/api/room/fill-bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: currentRoomId, target_count: targetCount })
    });
    fetchState();
  } catch (err) {
    console.error('Ошибка добавления ботов:', err);
  }
}

// Старт приложения с экрана Лобби
showScreen('lobby-screen');
