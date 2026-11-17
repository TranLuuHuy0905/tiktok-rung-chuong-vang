import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector/legacy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT) || 3000;
const QUESTION_DURATION_SECONDS = 15;

// Bộ 3 câu hỏi trắc nghiệm Rung Chuông Vàng
const QUESTIONS = [
  {
    id: 1,
    topic: 'Địa lý Việt Nam',
    question: 'Đỉnh núi nào được mệnh danh là "Nóc nhà Đông Dương" với độ cao 3.143m?',
    options: {
      A: 'Núi Bà Đen',
      B: 'Đỉnh Fansipan',
      C: 'Núi Langbiang',
      D: 'Đỉnh Ngọc Linh',
    },
    correctAnswer: 'B',
  },
  {
    id: 2,
    topic: 'Lịch sử & Văn hóa',
    question: 'Quốc hiệu đầu tiên của nước ta dưới thời các Vua Hùng dựng nước là gì?',
    options: {
      A: 'Đại Cồ Việt',
      B: 'Âu Lạc',
      C: 'Văn Lang',
      D: 'Đại Việt',
    },
    correctAnswer: 'C',
  },
  {
    id: 3,
    topic: 'Khoa học Tự nhiên',
    question: 'Nguyên tố khí nào chiếm tỷ lệ phần trăm lớn nhất trong bầu khí quyển Trái Đất?',
    options: {
      A: 'Oxy (O₂)',
      B: 'Carbon Dioxide (CO₂)',
      C: 'Nitơ (N₂)',
      D: 'Argon (Ar)',
    },
    correctAnswer: 'C',
  },
];

// Trạng thái trò chơi tập trung trên server (Server-authoritative state)
const players = new Map();
const liveCommenters = new Map();
const systemLogs = [];
let countdownInterval = null;
let tiktokConnection = null;

const gameState = {
  phase: 'IDLE', // 'IDLE' | 'QUESTION' | 'REVEAL' | 'WINNER' | 'GAME_OVER'
  currentQuestionIndex: null,
  timeLeft: 0,
  questionDuration: QUESTION_DURATION_SECONDS,
  isAcceptingAnswers: false,
  correctAnswer: null,
  rosterLocked: false,
  winner: null,
  tiktok: {
    status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'error'
    username: '',
    errorMessage: '',
  },
};

function getAvatarUrl(uniqueId, rawUrl) {
  if (typeof rawUrl === 'string' && rawUrl.trim().startsWith('http')) {
    return rawUrl.trim();
  }
  const seed = encodeURIComponent(uniqueId || 'player');
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

function addSystemLog(message, level = 'info') {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    message,
    level, // 'info' | 'success' | 'warning' | 'error'
  };
  systemLogs.push(entry);
  if (systemLogs.length > 60) {
    systemLogs.shift();
  }
  io.emit('system_log', entry);
  return entry;
}

function getPublicQuestion(index) {
  if (index === null || index === undefined || !QUESTIONS[index]) {
    return null;
  }
  const q = QUESTIONS[index];
  const revealCorrect = gameState.phase === 'REVEAL' || gameState.phase === 'WINNER' || gameState.phase === 'GAME_OVER';
  return {
    id: q.id,
    index,
    total: QUESTIONS.length,
    topic: q.topic,
    question: q.question,
    options: q.options,
    correctAnswer: revealCorrect ? q.correctAnswer : null,
  };
}

function buildSyncPayload() {
  const playerList = Array.from(players.values());
  const totalPlayers = playerList.length;
  const remainingPlayers = playerList.filter((p) => !p.isEliminated).length;

  const answerCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of playerList) {
    if (!p.isEliminated && p.currentAnswer && answerCounts[p.currentAnswer] !== undefined) {
      answerCounts[p.currentAnswer] += 1;
    }
  }

  return {
    phase: gameState.phase,
    currentQuestionIndex: gameState.currentQuestionIndex,
    currentQuestion: getPublicQuestion(gameState.currentQuestionIndex),
    questionsMeta: QUESTIONS.map((q, idx) => ({
      index: idx,
      id: q.id,
      topic: q.topic,
      question: q.question,
    })),
    timeLeft: gameState.timeLeft,
    questionDuration: gameState.questionDuration,
    isAcceptingAnswers: gameState.isAcceptingAnswers,
    correctAnswer:
      gameState.phase === 'REVEAL' || gameState.phase === 'WINNER' || gameState.phase === 'GAME_OVER'
        ? gameState.correctAnswer
        : null,
    rosterLocked: gameState.rosterLocked,
    winner: gameState.winner,
    liveCommentersCount: liveCommenters.size,
    stats: {
      remaining: remainingPlayers,
      total: totalPlayers,
      eliminated: totalPlayers - remainingPlayers,
      answerCounts,
    },
    players: playerList,
    tiktok: { ...gameState.tiktok },
  };
}

function broadcastSyncState() {
  io.emit('sync_state', buildSyncPayload());
}

function extractAnswerChoice(comment) {
  if (typeof comment !== 'string') return null;
  const match = comment.trim().match(/^([ABCD])(?:\s|[.!?:,)\]-]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function recordLiveCommenter({ uniqueId, nickname, avatar, comment }) {
  const cleanId = String(uniqueId).trim();
  const cleanName = String(nickname || cleanId).trim();
  const existed = liveCommenters.has(cleanId);
  const resolvedAvatar = avatar
    ? getAvatarUrl(cleanId, avatar)
    : liveCommenters.get(cleanId)?.avatar || getAvatarUrl(cleanId, null);

  liveCommenters.set(cleanId, {
    uniqueId: cleanId,
    nickname: cleanName,
    avatar: resolvedAvatar,
    lastComment: String(comment || '').trim(),
    commentedAt: Date.now(),
  });

  return { cleanId, cleanName, resolvedAvatar, isNewCommenter: !existed };
}

function handleIncomingChat({ uniqueId, nickname, avatar, comment }) {
  if (!uniqueId) return;
  const { cleanId, cleanName, resolvedAvatar, isNewCommenter } = recordLiveCommenter({
    uniqueId,
    nickname,
    avatar,
    comment,
  });

  const choice = extractAnswerChoice(comment);
  let player = players.get(cleanId);

  // Nếu danh sách sàn đấu đã chốt (từ bốc thăm ngẫu nhiên), chỉ thí sinh đã được chọn mới được trả lời
  if (!player) {
    if (gameState.rosterLocked) {
      if (isNewCommenter) {
        broadcastSyncState();
        addSystemLog(`${cleanName} vừa bình luận trong phiên Live (chờ lượt chọn ngẫu nhiên).`, 'info');
      }
      return;
    }

    if (!choice) {
      if (isNewCommenter) {
        broadcastSyncState();
        addSystemLog(`${cleanName} đã bình luận "${String(comment || '').trim()}" (vào danh sách chờ).`, 'info');
      }
      return;
    }

    player = {
      uniqueId: cleanId,
      nickname: cleanName,
      avatar: resolvedAvatar,
      currentAnswer: null,
      isEliminated: false,
      eliminatedAtQuestion: null,
      answeredAt: null,
    };
    players.set(cleanId, player);
  } else {
    player.nickname = cleanName || player.nickname;
    if (avatar) {
      player.avatar = resolvedAvatar;
    }
  }

  if (!choice) {
    if (isNewCommenter) {
      broadcastSyncState();
    }
    return;
  }

  if (player.isEliminated) {
    return;
  }

  if (gameState.phase === 'QUESTION' && gameState.isAcceptingAnswers) {
    const previousAnswer = player.currentAnswer;
    player.currentAnswer = choice;
    player.answeredAt = Date.now();
    broadcastSyncState();
    addSystemLog(
      previousAnswer
        ? `${player.nickname} đổi đáp án sang ${choice}`
        : `${player.nickname} chọn đáp án ${choice}`,
      'info'
    );
  } else if (gameState.phase === 'IDLE') {
    broadcastSyncState();
    addSystemLog(`${player.nickname} đã lên sàn chờ (bình luận ${choice})`, 'info');
  }
}

function pickRandomPlayersFromComments(requestedCount = 15) {
  const pool = Array.from(liveCommenters.values());
  if (pool.length === 0) {
    addSystemLog('Chưa có người dùng nào bình luận trong phiên Live để chọn ngẫu nhiên.', 'warning');
    return;
  }

  clearQuestionTimer();

  const count = Math.max(1, Math.min(100, Number(requestedCount) || 15));
  // Thuật toán Fisher-Yates xáo trộn công bằng danh sách người đã bình luận
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, Math.min(count, shuffled.length));

  players.clear();
  for (const user of selected) {
    players.set(user.uniqueId, {
      uniqueId: user.uniqueId,
      nickname: user.nickname,
      avatar: user.avatar,
      currentAnswer: null,
      isEliminated: false,
      eliminatedAtQuestion: null,
      answeredAt: null,
    });
  }

  gameState.phase = 'IDLE';
  gameState.currentQuestionIndex = null;
  gameState.timeLeft = 0;
  gameState.isAcceptingAnswers = false;
  gameState.correctAnswer = null;
  gameState.winner = null;
  gameState.rosterLocked = true;

  const syncPayload = buildSyncPayload();
  io.emit('random_selected', {
    selectedCount: selected.length,
    poolCount: pool.length,
    players: syncPayload.players,
  });
  io.emit('sync_state', syncPayload);

  addSystemLog(
    `Đã chọn ngẫu nhiên ${selected.length} / ${pool.length} người bình luận lên sàn đấu (đã khóa danh sách thi).`,
    'success'
  );
}

function declareTiebreakWinner(mode = 'fastest') {
  const survivors = Array.from(players.values()).filter((p) => !p.isEliminated);
  if (survivors.length === 0) {
    addSystemLog('Không còn thí sinh nào trụ hạng để chốt Quán quân.', 'warning');
    return;
  }

  let champion;
  if (survivors.length === 1) {
    champion = survivors[0];
  } else if (mode === 'random') {
    champion = survivors[Math.floor(Math.random() * survivors.length)];
  } else {
    // Chọn người trả lời đúng nhanh nhất ở câu gần nhất
    champion = [...survivors].sort((a, b) => (a.answeredAt || Infinity) - (b.answeredAt || Infinity))[0];
  }

  for (const p of survivors) {
    if (p.uniqueId !== champion.uniqueId) {
      p.isEliminated = true;
      p.eliminatedAtQuestion = (gameState.currentQuestionIndex ?? 0) + 1;
    }
  }

  gameState.winner = champion;
  gameState.phase = 'WINNER';

  const syncPayload = buildSyncPayload();
  io.emit('game_winner', {
    winner: champion,
    reason: mode === 'random' ? 'tiebreak_random' : 'tiebreak_fastest',
    questionIndex: gameState.currentQuestionIndex,
  });
  io.emit('sync_state', syncPayload);
  addSystemLog(
    `CHÚC MỪNG QUÁN QUÂN: ${champion.nickname} (${mode === 'random' ? 'Bốc thăm chung cuộc' : 'Trả lời nhanh nhất'}) — người cuối cùng còn lại trên sàn!`,
    'success'
  );
}

function clearQuestionTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function finishCurrentQuestion() {
  clearQuestionTimer();
  const idx = gameState.currentQuestionIndex;
  const question = QUESTIONS[idx];
  if (!question) return;

  gameState.isAcceptingAnswers = false;
  gameState.timeLeft = 0;
  gameState.correctAnswer = question.correctAnswer;

  let eliminatedThisRound = 0;
  let survivedThisRound = 0;
  const totalBeforeRound = Array.from(players.values()).filter((p) => !p.isEliminated).length;

  for (const player of players.values()) {
    if (!player.isEliminated) {
      if (player.currentAnswer !== question.correctAnswer) {
        player.isEliminated = true;
        player.eliminatedAtQuestion = idx + 1;
        eliminatedThisRound += 1;
      } else {
        survivedThisRound += 1;
      }
    }
  }

  const remainingSurvivors = Array.from(players.values()).filter((p) => !p.isEliminated);

  // Xác định người chiến thắng: người cuối cùng còn lại trên sàn
  if (players.size > 0 && remainingSurvivors.length === 1) {
    const champion = remainingSurvivors[0];
    gameState.winner = champion;
    gameState.phase = 'WINNER';

    const syncPayload = buildSyncPayload();
    io.emit('reveal_answer', {
      questionIndex: idx,
      correctAnswer: question.correctAnswer,
      eliminatedThisRound,
      survivedThisRound,
      stats: syncPayload.stats,
    });
    io.emit('game_winner', {
      winner: champion,
      reason: 'last_survivor',
      questionIndex: idx,
    });
    io.emit('sync_state', syncPayload);

    addSystemLog(
      `Hết giờ Câu ${idx + 1}! Đáp án: ${question.correctAnswer}. CHÚC MỪNG QUÁN QUÂN ${champion.nickname} là người cuối cùng còn lại và đã RUNG CHUÔNG VÀNG!`,
      'success'
    );
    return;
  }

  if (totalBeforeRound > 0 && remainingSurvivors.length === 0) {
    gameState.winner = null;
    gameState.phase = 'GAME_OVER';

    const syncPayload = buildSyncPayload();
    io.emit('reveal_answer', {
      questionIndex: idx,
      correctAnswer: question.correctAnswer,
      eliminatedThisRound,
      survivedThisRound,
      stats: syncPayload.stats,
    });
    io.emit('sync_state', syncPayload);

    addSystemLog(
      `Hết giờ Câu ${idx + 1}! Đáp án: ${question.correctAnswer}. Toàn bộ ${eliminatedThisRound} thí sinh đều bị loại — chưa tìm được Quán quân.`,
      'warning'
    );
    return;
  }

  gameState.phase = 'REVEAL';
  const syncPayload = buildSyncPayload();
  io.emit('reveal_answer', {
    questionIndex: idx,
    correctAnswer: question.correctAnswer,
    eliminatedThisRound,
    survivedThisRound,
    stats: syncPayload.stats,
  });
  io.emit('sync_state', syncPayload);

  if (idx === QUESTIONS.length - 1 && remainingSurvivors.length > 1) {
    addSystemLog(
      `Hết Câu cuối! Đáp án: ${question.correctAnswer}. Còn ${survivedThisRound} thí sinh cùng trụ hạng — Admin có thể chốt 1 Quán quân theo tốc độ hoặc bốc thăm.`,
      'warning'
    );
  } else {
    addSystemLog(
      `Hết giờ Câu ${idx + 1}! Đáp án đúng: ${question.correctAnswer}. Còn ${survivedThisRound} người trụ hạng, loại ${eliminatedThisRound} người.`,
      'success'
    );
  }
}

function startQuestion(questionIndex) {
  const idx = Number(questionIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= QUESTIONS.length) {
    addSystemLog(`Câu hỏi không hợp lệ (index=${questionIndex}).`, 'error');
    return;
  }

  clearQuestionTimer();

  // Xóa lựa chọn cũ của những thí sinh còn lại trên sàn
  for (const player of players.values()) {
    if (!player.isEliminated) {
      player.currentAnswer = null;
      player.answeredAt = null;
    }
  }

  gameState.phase = 'QUESTION';
  gameState.currentQuestionIndex = idx;
  gameState.timeLeft = QUESTION_DURATION_SECONDS;
  gameState.isAcceptingAnswers = true;
  gameState.correctAnswer = null;
  gameState.winner = null;

  broadcastSyncState();
  addSystemLog(
    `Đã phát Câu ${idx + 1}: "${QUESTIONS[idx].question}" (Đếm ngược ${QUESTION_DURATION_SECONDS}s)`,
    'warning'
  );

  countdownInterval = setInterval(() => {
    gameState.timeLeft = Math.max(0, gameState.timeLeft - 1);
    io.emit('timer_tick', { timeLeft: gameState.timeLeft });

    if (gameState.timeLeft <= 0) {
      finishCurrentQuestion();
    }
  }, 1000);
}

function resetGame() {
  clearQuestionTimer();
  players.clear();
  gameState.phase = 'IDLE';
  gameState.currentQuestionIndex = null;
  gameState.timeLeft = 0;
  gameState.isAcceptingAnswers = false;
  gameState.correctAnswer = null;
  gameState.winner = null;
  gameState.rosterLocked = false;

  broadcastSyncState();
  addSystemLog('Đã Reset ván mới! Toàn bộ thí sinh trên sàn đã được làm mới (giữ nguyên danh sách bình luận Live để bốc thăm lại nếu cần).', 'warning');
}

async function disconnectTikTok(silent = false) {
  if (tiktokConnection) {
    try {
      await tiktokConnection.disconnect();
    } catch {
      // Bỏ qua lỗi khi ngắt kết nối cũ
    }
    tiktokConnection = null;
  }
  gameState.tiktok = {
    status: 'disconnected',
    username: '',
    errorMessage: '',
  };
  if (!silent) {
    broadcastSyncState();
    addSystemLog('Đã ngắt kết nối TikTok Live.', 'info');
  }
}

async function connectTikTok(rawUsername) {
  const cleanUsername = String(rawUsername || '')
    .trim()
    .replace(/^@+/, '');

  if (!cleanUsername) {
    addSystemLog('Vui lòng nhập TikTok Username hợp lệ trước khi kết nối.', 'error');
    return;
  }

  await disconnectTikTok(true);

  gameState.tiktok = {
    status: 'connecting',
    username: cleanUsername,
    errorMessage: '',
  };
  broadcastSyncState();
  addSystemLog(`Đang kết nối tới phiên Live của @${cleanUsername}...`, 'info');

  try {
    const connection = new WebcastPushConnection(cleanUsername, {
      processInitialData: false,
      enableExtendedGiftInfo: false,
      requestPollingIntervalMs: 2000,
    });

    tiktokConnection = connection;

    connection.on('chat', (data) => {
      const uniqueId = data?.uniqueId || data?.user?.uniqueId;
      const nickname = data?.nickname || data?.user?.nickname || uniqueId;
      const avatar =
        data?.profilePictureUrl ||
        data?.user?.profilePicture?.url?.[0] ||
        data?.user?.profilePictureUrl;
      const comment = data?.comment || '';

      handleIncomingChat({ uniqueId, nickname, avatar, comment });
    });

    connection.on('streamEnd', () => {
      if (tiktokConnection !== connection) return;
      gameState.tiktok = {
        status: 'disconnected',
        username: cleanUsername,
        errorMessage: 'Phiên livestream đã kết thúc.',
      };
      tiktokConnection = null;
      broadcastSyncState();
      addSystemLog(`Phiên Live của @${cleanUsername} đã kết thúc.`, 'warning');
    });

    connection.on('disconnected', () => {
      if (tiktokConnection !== connection) return;
      if (gameState.tiktok.status === 'connected') {
        gameState.tiktok = {
          status: 'disconnected',
          username: cleanUsername,
          errorMessage: 'Mất kết nối tới TikTok Live.',
        };
        tiktokConnection = null;
        broadcastSyncState();
        addSystemLog(`Mất kết nối khỏi phòng Live @${cleanUsername}.`, 'warning');
      }
    });

    connection.on('error', (err) => {
      if (tiktokConnection !== connection) return;
      const msg = err?.message || 'Lỗi luồng TikTok Live';
      gameState.tiktok = {
        status: 'error',
        username: cleanUsername,
        errorMessage: msg,
      };
      broadcastSyncState();
      addSystemLog(`Lỗi TikTok Live (@${cleanUsername}): ${msg}`, 'error');
    });

    connection
      .connect()
      .then((state) => {
        if (tiktokConnection !== connection) return;
        gameState.tiktok = {
          status: 'connected',
          username: cleanUsername,
          errorMessage: '',
        };
        broadcastSyncState();
        addSystemLog(
          `Kết nối thành công tới TikTok Live @${cleanUsername} (Room ID: ${state?.roomId || 'Live'}).`,
          'success'
        );
      })
      .catch((err) => {
        if (tiktokConnection !== connection) return;
        const msg = err?.message || 'Không thể kết nối (người dùng chưa Live hoặc lỗi mạng)';
        gameState.tiktok = {
          status: 'error',
          username: cleanUsername,
          errorMessage: msg,
        };
        tiktokConnection = null;
        broadcastSyncState();
        addSystemLog(`Không thể kết nối @${cleanUsername}: ${msg}`, 'error');
      });
  } catch (err) {
    const msg = err?.message || 'Lỗi khởi tạo kết nối TikTok Live';
    gameState.tiktok = {
      status: 'error',
      username: cleanUsername,
      errorMessage: msg,
    };
    tiktokConnection = null;
    broadcastSyncState();
    addSystemLog(`Lỗi kết nối @${cleanUsername}: ${msg}`, 'error');
  }
}

// Phục vụ thư mục tĩnh public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/overlay', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Kết nối Socket.io thời gian thực
io.on('connection', (socket) => {
  socket.emit('sync_state', buildSyncPayload());
  socket.emit('init_logs', systemLogs);

  socket.on('request_sync', () => {
    socket.emit('sync_state', buildSyncPayload());
  });

  socket.on('connect_tiktok', (payload) => {
    const username = typeof payload === 'string' ? payload : payload?.username;
    connectTikTok(username);
  });

  socket.on('disconnect_tiktok', () => {
    disconnectTikTok(false);
  });

  socket.on('start_question', (payload) => {
    const idx = typeof payload === 'number' ? payload : payload?.questionIndex;
    startQuestion(idx);
  });

  socket.on('reset_game', () => {
    resetGame();
  });

  socket.on('pick_random_players', (payload) => {
    const count = typeof payload === 'number' ? payload : payload?.count;
    pickRandomPlayersFromComments(count);
  });

  socket.on('set_roster_lock', (payload) => {
    gameState.rosterLocked = Boolean(payload?.locked);
    broadcastSyncState();
    addSystemLog(
      gameState.rosterLocked
        ? 'Đã khóa danh sách thí sinh trên sàn đấu.'
        : 'Đã mở khóa nhận thí sinh tự do qua bình luận A, B, C, D.',
      'info'
    );
  });

  socket.on('declare_tiebreak_winner', (payload) => {
    const mode = payload?.mode === 'random' ? 'random' : 'fastest';
    declareTiebreakWinner(mode);
  });

  socket.on('clear_commenters', () => {
    liveCommenters.clear();
    broadcastSyncState();
    addSystemLog('Đã xóa danh sách người dùng đã bình luận trong phiên Live.', 'info');
  });

  socket.on('simulate_chat', (payload) => {
    if (!payload) return;
    handleIncomingChat({
      uniqueId: payload.uniqueId,
      nickname: payload.nickname,
      avatar: payload.avatar,
      comment: payload.comment,
    });
  });
});

addSystemLog('Hệ thống Rung Chuông Vàng đã sẵn sàng.', 'success');

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server Rung Chuông Vàng đang chạy tại http://0.0.0.0:${PORT}`);
  console.log(`- Studio Portal: http://localhost:${PORT}/`);
  console.log(`- Trang điều khiển Admin: http://localhost:${PORT}/admin`);
  console.log(`- Giao diện OBS Overlay: http://localhost:${PORT}/overlay`);
});
