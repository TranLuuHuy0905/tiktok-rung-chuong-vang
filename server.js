import express from 'express';
import fs from 'fs';
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
  maxHttpBufferSize: 5e6,
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT) || 3000;
const QUESTION_DURATION_SECONDS = 15;

const QUESTIONS_FILE = path.join(__dirname, 'questions.json');

// Bộ 3 câu hỏi mặc định ban đầu
const DEFAULT_QUESTIONS = [
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

function cloneDefaultQuestions() {
  return DEFAULT_QUESTIONS.map((q) => ({
    ...q,
    options: { ...q.options },
  }));
}

function loadQuestionsFromDisk() {
  try {
    if (fs.existsSync(QUESTIONS_FILE)) {
      const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((q, idx) => ({
          id: Number(q?.id) || idx + 1,
          topic: String(q?.topic || 'Kiến thức chung').trim() || 'Kiến thức chung',
          question: String(q?.question || '').trim(),
          options: {
            A: String(q?.options?.A || '').trim(),
            B: String(q?.options?.B || '').trim(),
            C: String(q?.options?.C || '').trim(),
            D: String(q?.options?.D || '').trim(),
          },
          correctAnswer: ['A', 'B', 'C', 'D'].includes(String(q?.correctAnswer || '').toUpperCase())
            ? String(q.correctAnswer).toUpperCase()
            : 'A',
        }));
      }
    }
  } catch {
    // Nếu file lỗi định dạng, dùng bộ câu hỏi mặc định
  }
  return cloneDefaultQuestions();
}

let QUESTIONS = loadQuestionsFromDisk();

function saveQuestionsToDisk() {
  try {
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(QUESTIONS, null, 2), 'utf8');
  } catch {
    // Bỏ qua lỗi ghi file nếu môi trường chỉ đọc
  }
}

// Trạng thái trò chơi tập trung trên server (Server-authoritative state)
const players = new Map();
const liveCommenters = new Map();
const announcedLateUsers = new Set();
const askedQuestionIds = new Set();
const systemLogs = [];
let countdownInterval = null;
let autoTimeout = null;
let autoInterval = null;
let tiktokConnection = null;

function parseCorrectAnswerValue(rawValue, options) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(upper)) return upper;

  const letterMatch = upper.match(/(?:ĐÁP\s*ÁN|DAP\s*AN|ANSWER|CORRECT|^)?\s*([ABCD])(?:[\.\)\:\s]|$)/);
  if (letterMatch && ['A', 'B', 'C', 'D'].includes(letterMatch[1])) {
    return letterMatch[1];
  }
  if (['1', '2', '3', '4'].includes(upper)) {
    return ['A', 'B', 'C', 'D'][Number(upper) - 1];
  }
  if (options) {
    const normalizedRaw = raw.toLowerCase();
    for (const key of ['A', 'B', 'C', 'D']) {
      if (String(options[key] || '').trim().toLowerCase() === normalizedRaw) {
        return key;
      }
    }
  }
  return null;
}

function normalizeImportedQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const topic =
    String(
      raw.topic ?? raw.chuDe ?? raw.chude ?? raw.category ?? raw.subject ?? raw['Chủ đề'] ?? ''
    ).trim() || 'Kiến thức chung';
  const question = String(
    raw.question ?? raw.cauHoi ?? raw.cauhoi ?? raw.title ?? raw.text ?? raw['Câu hỏi'] ?? ''
  ).trim();

  let optA = '';
  let optB = '';
  let optC = '';
  let optD = '';

  if (Array.isArray(raw.options)) {
    optA = String(raw.options[0] ?? '').trim();
    optB = String(raw.options[1] ?? '').trim();
    optC = String(raw.options[2] ?? '').trim();
    optD = String(raw.options[3] ?? '').trim();
  } else if (raw.options && typeof raw.options === 'object') {
    optA = String(raw.options.A ?? raw.options.a ?? '').trim();
    optB = String(raw.options.B ?? raw.options.b ?? '').trim();
    optC = String(raw.options.C ?? raw.options.c ?? '').trim();
    optD = String(raw.options.D ?? raw.options.d ?? '').trim();
  } else {
    optA = String(raw.A ?? raw.a ?? raw.optA ?? raw.optionA ?? raw['Đáp án A'] ?? '').trim();
    optB = String(raw.B ?? raw.b ?? raw.optB ?? raw.optionB ?? raw['Đáp án B'] ?? '').trim();
    optC = String(raw.C ?? raw.c ?? raw.optC ?? raw.optionC ?? raw['Đáp án C'] ?? '').trim();
    optD = String(raw.D ?? raw.d ?? raw.optD ?? raw.optionD ?? raw['Đáp án D'] ?? '').trim();
  }

  const options = { A: optA, B: optB, C: optC, D: optD };
  const correctAnswer = parseCorrectAnswerValue(
    raw.correctAnswer ?? raw.correct ?? raw.answer ?? raw.dapAn ?? raw.dapan ?? raw['Đáp án đúng'],
    options
  );

  if (!question || !optA || !optB || !optC || !optD || !correctAnswer) {
    return null;
  }

  return { topic, question, options, correctAnswer };
}

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseTxtQuestions(text) {
  const lines = text.split('\n');
  const results = [];
  let current = null;

  const resetCurrent = () => {
    current = {
      topic: 'Kiến thức chung',
      questionLines: [],
      options: {},
      correctAnswer: null,
    };
  };

  const finalizeCurrent = () => {
    if (!current) return;
    const questionText = current.questionLines.join(' ').trim();
    const normalized = normalizeImportedQuestion({
      topic: current.topic,
      question: questionText,
      options: current.options,
      correctAnswer: current.correctAnswer,
    });
    if (normalized) {
      results.push(normalized);
    }
    current = null;
  };

  resetCurrent();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^[-=]{3,}$/.test(line)) {
      if (
        current &&
        current.questionLines.length > 0 &&
        current.options.A &&
        current.options.B &&
        current.options.C &&
        current.options.D &&
        current.correctAnswer
      ) {
        finalizeCurrent();
        resetCurrent();
      }
      continue;
    }

    const topicMatch = line.match(/^(?:Chủ\s*đề|Chu\s*de|Topic|Danh\s*mục)\s*[:\-]\s*(.+)$/i);
    if (topicMatch) {
      if (
        current &&
        current.options.A &&
        current.options.B &&
        current.options.C &&
        current.options.D &&
        current.correctAnswer
      ) {
        finalizeCurrent();
        resetCurrent();
      }
      if (!current) resetCurrent();
      current.topic = topicMatch[1].trim() || 'Kiến thức chung';
      continue;
    }

    const answerMatch = line.match(
      /^(?:Đáp\s*án(?:\s*đúng)?|Dap\s*an(?:\s*dung)?|Answer|Correct(?:\s*answer)?|Key)\s*[:\-]\s*(.+)$/i
    );
    if (answerMatch) {
      if (!current) resetCurrent();
      current.correctAnswer = parseCorrectAnswerValue(answerMatch[1], current.options);
      continue;
    }

    const optMatch = line.match(/^(\*)?\s*([ABCD])\s*[\.\)\:\-]\s*(.+)$/i);
    if (optMatch) {
      if (!current) resetCurrent();
      const isMarked = Boolean(optMatch[1]);
      const letter = optMatch[2].toUpperCase();
      let optText = optMatch[3].trim();
      if (/\*\s*$/.test(optText)) {
        optText = optText.replace(/\*\s*$/, '').trim();
        current.correctAnswer = letter;
      }
      current.options[letter] = optText;
      if (isMarked) {
        current.correctAnswer = letter;
      }
      continue;
    }

    const qStartMatch = line.match(
      /^(?:Câu(?:\s*hỏi)?\s*\d*\s*[:\.\-\)]|Question\s*\d*\s*[:\.\-\)]|\d+[\.\)])\s*(.+)$/i
    );
    if (qStartMatch) {
      if (
        current &&
        current.questionLines.length > 0 &&
        current.options.A &&
        current.options.B &&
        current.options.C &&
        current.options.D
      ) {
        finalizeCurrent();
        resetCurrent();
      }
      if (!current) resetCurrent();
      current.questionLines.push(qStartMatch[1].trim());
      continue;
    }

    if (!current) resetCurrent();
    if (!current.options.A) {
      current.questionLines.push(line);
    }
  }

  finalizeCurrent();
  return results;
}

function parseQuestionsFromContent(fileName, content) {
  const cleanText = String(content || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!cleanText) return [];

  const ext = path.extname(String(fileName || '')).toLowerCase();

  // 1. JSON
  if (ext === '.json' || cleanText.startsWith('[') || cleanText.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanText);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed?.questions || parsed?.items || parsed?.data || [];
      if (Array.isArray(list)) {
        const items = list.map(normalizeImportedQuestion).filter(Boolean);
        if (items.length > 0) return items;
      }
    } catch {
      if (ext === '.json') return [];
    }
  }

  // 2. CSV / TSV
  if (ext === '.csv' || ext === '.tsv') {
    const firstLine = cleanText.split('\n')[0] || '';
    const delimiter = firstLine.includes('\t')
      ? '\t'
      : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length
        ? ';'
        : ',';
    const rows = parseCsvRows(cleanText, delimiter).filter((r) =>
      r.some((c) => String(c || '').trim() !== '')
    );
    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i].map((c) => String(c || '').trim());
      if (
        i === 0 &&
        /câu\s*hỏi|cau\s*hoi|question|chủ\s*đề|chu\s*de|topic/i.test(cols.join(' '))
      ) {
        continue;
      }
      if (cols.length >= 7) {
        const q = normalizeImportedQuestion({
          topic: cols[0],
          question: cols[1],
          options: { A: cols[2], B: cols[3], C: cols[4], D: cols[5] },
          correctAnswer: cols[6],
        });
        if (q) items.push(q);
      } else if (cols.length === 6) {
        const q = normalizeImportedQuestion({
          topic: 'Kiến thức chung',
          question: cols[0],
          options: { A: cols[1], B: cols[2], C: cols[3], D: cols[4] },
          correctAnswer: cols[5],
        });
        if (q) items.push(q);
      }
    }
    return items;
  }

  // 3. TXT hoặc CSV không có đuôi rõ ràng
  const txtItems = parseTxtQuestions(cleanText);
  if (txtItems.length > 0) return txtItems;

  const firstLine = cleanText.split('\n')[0] || '';
  if ((firstLine.match(/,/g) || []).length >= 5 || (firstLine.match(/;/g) || []).length >= 5) {
    const delimiter = (firstLine.match(/;/g) || []).length >= 5 ? ';' : ',';
    const rows = parseCsvRows(cleanText, delimiter);
    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i].map((c) => String(c || '').trim());
      if (
        i === 0 &&
        /câu\s*hỏi|cau\s*hoi|question|chủ\s*đề|chu\s*de|topic/i.test(cols.join(' '))
      ) {
        continue;
      }
      if (cols.length >= 7) {
        const q = normalizeImportedQuestion({
          topic: cols[0],
          question: cols[1],
          options: { A: cols[2], B: cols[3], C: cols[4], D: cols[5] },
          correctAnswer: cols[6],
        });
        if (q) items.push(q);
      } else if (cols.length === 6) {
        const q = normalizeImportedQuestion({
          topic: 'Kiến thức chung',
          question: cols[0],
          options: { A: cols[1], B: cols[2], C: cols[3], D: cols[4] },
          correctAnswer: cols[5],
        });
        if (q) items.push(q);
      }
    }
    return items;
  }

  return [];
}

function getUnaskedQuestionIndices() {
  const result = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    if (!askedQuestionIds.has(QUESTIONS[i].id)) {
      result.push(i);
    }
  }
  return result;
}

function pickRandomUnaskedQuestionIndex(allowResetIfExhausted = false) {
  if (QUESTIONS.length === 0) return -1;
  let unasked = getUnaskedQuestionIndices();
  if (unasked.length === 0) {
    if (!allowResetIfExhausted) return -1;
    const currentId =
      gameState.currentQuestionIndex !== null && QUESTIONS[gameState.currentQuestionIndex]
        ? QUESTIONS[gameState.currentQuestionIndex].id
        : null;
    askedQuestionIds.clear();
    if (currentId !== null && QUESTIONS.length > 1) {
      askedQuestionIds.add(currentId);
    }
    unasked = getUnaskedQuestionIndices();
  }
  if (unasked.length === 0) return 0;
  return unasked[Math.floor(Math.random() * unasked.length)];
}

function shuffleQuestionsOrder(reasonLabel = '') {
  if (QUESTIONS.length <= 1) return false;
  const activeId =
    gameState.currentQuestionIndex !== null && QUESTIONS[gameState.currentQuestionIndex]
      ? QUESTIONS[gameState.currentQuestionIndex].id
      : null;

  for (let i = QUESTIONS.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [QUESTIONS[i], QUESTIONS[j]] = [QUESTIONS[j], QUESTIONS[i]];
  }

  if (activeId !== null) {
    const nextIdx = QUESTIONS.findIndex((q) => q.id === activeId);
    gameState.currentQuestionIndex = nextIdx >= 0 ? nextIdx : null;
  }

  saveQuestionsToDisk();
  if (reasonLabel) {
    addSystemLog(reasonLabel, 'info');
  }
  return true;
}

const gameState = {
  phase: 'IDLE', // 'IDLE' | 'QUESTION' | 'REVEAL' | 'WINNER' | 'GAME_OVER'
  currentQuestionIndex: null,
  timeLeft: 0,
  questionDuration: QUESTION_DURATION_SECONDS,
  isAcceptingAnswers: false,
  correctAnswer: null,
  rosterLocked: false,
  autoMode: false,
  autoPickCount: 15,
  autoTransitionSeconds: 9,
  shuffleMode: true,
  autoStatus: '',
  voiceEnabled: true,
  soundEnabled: true,
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
      options: q.options,
      correctAnswer: q.correctAnswer,
    })),
    timeLeft: gameState.timeLeft,
    questionDuration: gameState.questionDuration,
    isAcceptingAnswers: gameState.isAcceptingAnswers,
    correctAnswer:
      gameState.phase === 'REVEAL' || gameState.phase === 'WINNER' || gameState.phase === 'GAME_OVER'
        ? gameState.correctAnswer
        : null,
    rosterLocked: gameState.rosterLocked,
    autoMode: gameState.autoMode,
    autoPickCount: gameState.autoPickCount,
    autoTransitionSeconds: gameState.autoTransitionSeconds,
    shuffleMode: gameState.shuffleMode,
    autoStatus: gameState.autoStatus,
    voiceEnabled: gameState.voiceEnabled,
    soundEnabled: gameState.soundEnabled,
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
      }
      if (!announcedLateUsers.has(cleanId)) {
        announcedLateUsers.add(cleanId);
        io.emit('late_commenter', {
          uniqueId: cleanId,
          nickname: cleanName,
          avatar: resolvedAvatar,
          comment: String(comment || '').trim(),
        });
        addSystemLog(
          `${cleanName} vào bình luận sau khi khóa sàn — sẽ tham gia vòng sau.`,
          'info'
        );
      }
      return;
    }

    if (!choice) {
      if (isNewCommenter) {
        broadcastSyncState();
        addSystemLog(`${cleanName} đã bình luận "${String(comment || '').trim()}" (vào danh sách chờ).`, 'info');
      }
      if (gameState.autoMode && gameState.phase === 'IDLE' && players.size === 0 && !autoTimeout) {
        evaluateAutoStep();
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
    if (gameState.autoMode && !autoTimeout) {
      evaluateAutoStep();
    }
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
  announcedLateUsers.clear();
  askedQuestionIds.clear();
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

  let shuffledMsg = '';
  if (gameState.shuffleMode && shuffleQuestionsOrder()) {
    shuffledMsg = ' Đã tự động trộn ngẫu nhiên bộ câu hỏi cho ván mới.';
  }

  const syncPayload = buildSyncPayload();
  io.emit('random_selected', {
    selectedCount: selected.length,
    poolCount: pool.length,
    players: syncPayload.players,
  });
  io.emit('sync_state', syncPayload);

  addSystemLog(
    `Đã chọn ngẫu nhiên ${selected.length} / ${pool.length} người bình luận lên sàn đấu (đã khóa danh sách thi).${shuffledMsg}`,
    'success'
  );

  if (gameState.autoMode) {
    evaluateAutoStep();
  }
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

  if (gameState.autoMode) {
    evaluateAutoStep();
  }
}

function clearQuestionTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function clearAutoScheduler() {
  if (autoTimeout) {
    clearTimeout(autoTimeout);
    autoTimeout = null;
  }
  if (autoInterval) {
    clearInterval(autoInterval);
    autoInterval = null;
  }
}

function emitAutoStatus() {
  io.emit('auto_status', {
    autoMode: gameState.autoMode,
    autoPickCount: gameState.autoPickCount,
    autoTransitionSeconds: gameState.autoTransitionSeconds,
    shuffleMode: gameState.shuffleMode,
    autoStatus: gameState.autoStatus,
  });
}

function scheduleAutoAction(seconds, labelBuilder, callback) {
  clearAutoScheduler();
  if (!gameState.autoMode) return;

  let remaining = Math.max(1, Math.round(seconds));
  gameState.autoStatus = labelBuilder(remaining);
  emitAutoStatus();

  autoInterval = setInterval(() => {
    if (!gameState.autoMode) {
      clearAutoScheduler();
      return;
    }
    remaining = Math.max(0, remaining - 1);
    gameState.autoStatus = labelBuilder(remaining);
    emitAutoStatus();
  }, 1000);

  autoTimeout = setTimeout(() => {
    clearAutoScheduler();
    if (!gameState.autoMode) return;
    callback();
  }, remaining * 1000);
}

function startNextAutoRound() {
  clearQuestionTimer();
  clearAutoScheduler();
  players.clear();
  announcedLateUsers.clear();
  askedQuestionIds.clear();
  gameState.phase = 'IDLE';
  gameState.currentQuestionIndex = null;
  gameState.timeLeft = 0;
  gameState.isAcceptingAnswers = false;
  gameState.correctAnswer = null;
  gameState.winner = null;
  gameState.rosterLocked = false;

  addSystemLog('Chế độ Tự động: Khởi tạo ván đấu mới!', 'warning');

  if (liveCommenters.size > 0) {
    pickRandomPlayersFromComments(gameState.autoPickCount);
  } else {
    if (gameState.shuffleMode) {
      shuffleQuestionsOrder(`Đã trộn ngẫu nhiên ${QUESTIONS.length} câu hỏi chuẩn bị cho ván mới.`);
    }
    broadcastSyncState();
    evaluateAutoStep();
  }
}

function evaluateAutoStep() {
  clearAutoScheduler();
  if (!gameState.autoMode) {
    gameState.autoStatus = '';
    emitAutoStatus();
    return;
  }

  if (gameState.phase === 'IDLE') {
    if (players.size > 0) {
      scheduleAutoAction(
        4,
        (s) => `Tự động phát Câu 1 sau ${s}s`,
        () => startQuestion(0)
      );
    } else if (liveCommenters.size > 0) {
      scheduleAutoAction(
        4,
        (s) => `Đang gom bình luận — tự động bốc thăm sau ${s}s`,
        () => pickRandomPlayersFromComments(gameState.autoPickCount)
      );
    } else {
      gameState.autoStatus = 'Đang chờ người xem bình luận trên Live để tự bốc thăm mở ván...';
      emitAutoStatus();
    }
    return;
  }

  if (gameState.phase === 'QUESTION') {
    const qNum = (gameState.currentQuestionIndex ?? 0) + 1;
    gameState.autoStatus = `Đang chạy Câu ${qNum} — tự động chuyển bước khi hết giờ`;
    emitAutoStatus();
    return;
  }

  const transitionSeconds = Math.max(5, Math.min(20, Number(gameState.autoTransitionSeconds) || 9));

  if (gameState.phase === 'REVEAL') {
    const idx = gameState.currentQuestionIndex ?? 0;
    const survivors = Array.from(players.values()).filter((p) => !p.isEliminated);

    if (idx + 1 < QUESTIONS.length) {
      scheduleAutoAction(
        transitionSeconds,
        (s) => `Tự động phát Câu ${idx + 2} sau ${s}s`,
        () => startQuestion(idx + 1)
      );
    } else if (survivors.length > 1) {
      scheduleAutoAction(
        Math.max(8, transitionSeconds),
        (s) => `Hết câu hỏi (${survivors.length} người trụ) — tự chốt Quán quân nhanh nhất sau ${s}s`,
        () => declareTiebreakWinner('fastest')
      );
    } else {
      scheduleAutoAction(
        transitionSeconds,
        (s) => `Tự động mở ván mới sau ${s}s`,
        () => startNextAutoRound()
      );
    }
    return;
  }

  if (gameState.phase === 'WINNER') {
    scheduleAutoAction(
      15,
      (s) => `Vinh danh Quán quân — tự mở ván mới sau ${s}s`,
      () => startNextAutoRound()
    );
    return;
  }

  if (gameState.phase === 'GAME_OVER') {
    scheduleAutoAction(
      Math.max(8, transitionSeconds),
      (s) => `Không còn thí sinh — tự mở ván mới sau ${s}s`,
      () => startNextAutoRound()
    );
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

  const correctOptionText = question.options?.[question.correctAnswer] || '';

  // Xác định người chiến thắng: người cuối cùng còn lại trên sàn
  if (players.size > 0 && remainingSurvivors.length === 1) {
    const champion = remainingSurvivors[0];
    gameState.winner = champion;
    gameState.phase = 'WINNER';

    const syncPayload = buildSyncPayload();
    io.emit('reveal_answer', {
      questionIndex: idx,
      correctAnswer: question.correctAnswer,
      correctOptionText,
      hasWinner: true,
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
    if (gameState.autoMode) {
      evaluateAutoStep();
    }
    return;
  }

  if (totalBeforeRound > 0 && remainingSurvivors.length === 0) {
    gameState.winner = null;
    gameState.phase = 'GAME_OVER';

    const syncPayload = buildSyncPayload();
    io.emit('reveal_answer', {
      questionIndex: idx,
      correctAnswer: question.correctAnswer,
      correctOptionText,
      hasWinner: false,
      eliminatedThisRound,
      survivedThisRound,
      stats: syncPayload.stats,
    });
    io.emit('sync_state', syncPayload);

    addSystemLog(
      `Hết giờ Câu ${idx + 1}! Đáp án: ${question.correctAnswer}. Toàn bộ ${eliminatedThisRound} thí sinh đều bị loại — chưa tìm được Quán quân.`,
      'warning'
    );
    if (gameState.autoMode) {
      evaluateAutoStep();
    }
    return;
  }

  gameState.phase = 'REVEAL';
  const syncPayload = buildSyncPayload();
  io.emit('reveal_answer', {
    questionIndex: idx,
    correctAnswer: question.correctAnswer,
    correctOptionText,
    hasWinner: false,
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

  if (gameState.autoMode) {
    evaluateAutoStep();
  }
}

function startQuestion(questionIndex) {
  const idx = Number(questionIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= QUESTIONS.length) {
    addSystemLog(`Câu hỏi không hợp lệ (index=${questionIndex}).`, 'error');
    return;
  }

  clearQuestionTimer();
  clearAutoScheduler();

  // Xóa lựa chọn cũ của những thí sinh còn lại trên sàn
  for (const player of players.values()) {
    if (!player.isEliminated) {
      player.currentAnswer = null;
      player.answeredAt = null;
    }
  }

  gameState.phase = 'QUESTION';
  gameState.currentQuestionIndex = idx;
  if (QUESTIONS[idx]) {
    askedQuestionIds.add(QUESTIONS[idx].id);
  }
  gameState.timeLeft = QUESTION_DURATION_SECONDS;
  gameState.isAcceptingAnswers = true;
  gameState.correctAnswer = null;
  gameState.winner = null;

  if (gameState.autoMode) {
    gameState.autoStatus = `Đang thi Câu ${idx + 1} — tự động chuyển bước khi hết giờ`;
  }

  io.emit('question_started', {
    questionIndex: idx,
    topic: QUESTIONS[idx].topic,
    question: QUESTIONS[idx].question,
  });
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
  clearAutoScheduler();
  players.clear();
  announcedLateUsers.clear();
  askedQuestionIds.clear();
  gameState.phase = 'IDLE';
  gameState.currentQuestionIndex = null;
  gameState.timeLeft = 0;
  gameState.isAcceptingAnswers = false;
  gameState.correctAnswer = null;
  gameState.winner = null;
  gameState.rosterLocked = false;
  gameState.autoMode = false;
  gameState.autoStatus = '';

  let shuffledMsg = '';
  if (gameState.shuffleMode && shuffleQuestionsOrder()) {
    shuffledMsg = ` Đã trộn ngẫu nhiên thứ tự ${QUESTIONS.length} câu hỏi cho ván mới.`;
  }

  broadcastSyncState();
  addSystemLog(
    `Đã Reset ván mới! Toàn bộ thí sinh trên sàn đã được làm mới.${shuffledMsg}`,
    'warning'
  );
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
  let cleanUsername = String(rawUsername || '').trim();
  const urlMatch = cleanUsername.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) {
    cleanUsername = urlMatch[1];
  }
  cleanUsername = cleanUsername.replace(/^@+/, '');

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
    const connectionOptions = {
      processInitialData: false,
      enableExtendedGiftInfo: false,
    };
    if (process.env.TIKTOK_SIGN_API_KEY) {
      connectionOptions.signApiKey = process.env.TIKTOK_SIGN_API_KEY;
    }

    const connection = new WebcastPushConnection(cleanUsername, connectionOptions);

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

const ttsCache = new Map();

app.get('/api/tts', async (req, res) => {
  try {
    const rawText = String(req.query.text || '').trim();
    if (!rawText) {
      return res.status(400).json({ error: 'Missing text parameter' });
    }
    const text = rawText.slice(0, 280);
    if (ttsCache.has(text)) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(ttsCache.get(text));
    }

    const ttsUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=${encodeURIComponent(text)}`;
    const upstream = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'audio/mpeg,*/*',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: `TTS upstream returned ${upstream.status}` });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (ttsCache.size >= 120) {
      const oldestKey = ttsCache.keys().next().value;
      ttsCache.delete(oldestKey);
    }
    ttsCache.set(text, buffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(buffer);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'TTS proxy unavailable' });
  }
});

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
    announcedLateUsers.clear();
    broadcastSyncState();
    addSystemLog('Đã xóa danh sách người dùng đã bình luận trong phiên Live.', 'info');
  });

  socket.on('set_auto_mode', (payload) => {
    const hasEnabled = typeof payload?.enabled === 'boolean';
    const enabled = hasEnabled ? payload.enabled : gameState.autoMode;
    if (payload?.pickCount) {
      gameState.autoPickCount = Math.max(1, Math.min(100, Number(payload.pickCount) || 15));
    }
    if (payload?.transitionSeconds !== undefined) {
      const nextSeconds = Math.max(5, Math.min(20, Number(payload.transitionSeconds) || 9));
      if (nextSeconds !== gameState.autoTransitionSeconds) {
        gameState.autoTransitionSeconds = nextSeconds;
        if (!hasEnabled) {
          addSystemLog(`Đã chỉnh thời gian nghỉ chuyển câu tự động thành ${nextSeconds}s.`, 'info');
        }
      }
    }
    gameState.autoMode = enabled;
    if (hasEnabled) {
      addSystemLog(
        enabled
          ? `Đã BẬT chế độ Tự động vận hành (bốc thăm ${gameState.autoPickCount} thí sinh, nghỉ chuyển câu ${gameState.autoTransitionSeconds}s).`
          : 'Đã TẮT chế độ Tự động vận hành — chuyển về điều khiển thủ công.',
        enabled ? 'success' : 'warning'
      );
    }
    evaluateAutoStep();
    broadcastSyncState();
  });

  socket.on('set_audio_settings', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.voiceEnabled === 'boolean') {
      gameState.voiceEnabled = payload.voiceEnabled;
    }
    if (typeof payload.soundEnabled === 'boolean') {
      gameState.soundEnabled = payload.soundEnabled;
    }
    broadcastSyncState();
    addSystemLog(
      `Cài đặt âm thanh: Hiệu ứng ${gameState.soundEnabled ? 'BẬT' : 'TẮT'} · Giọng đọc ${gameState.voiceEnabled ? 'BẬT' : 'TẮT'}.`,
      'info'
    );
  });

  socket.on('test_voice', () => {
    io.emit('voice_test', {
      text: 'Hệ thống Rung Chuông Vàng đã sẵn sàng. Giọng đọc đang hoạt động bình thường!',
    });
  });

  socket.on('add_question', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const topic = String(payload.topic || '').trim() || 'Kiến thức chung';
    const question = String(payload.question || '').trim();
    const optA = String(payload.options?.A || '').trim();
    const optB = String(payload.options?.B || '').trim();
    const optC = String(payload.options?.C || '').trim();
    const optD = String(payload.options?.D || '').trim();
    const correctAnswer = String(payload.correctAnswer || '').trim().toUpperCase();

    if (!question || !optA || !optB || !optC || !optD) {
      addSystemLog('Vui lòng nhập đầy đủ nội dung câu hỏi và cả 4 đáp án A, B, C, D.', 'error');
      return;
    }
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
      addSystemLog('Đáp án đúng phải là A, B, C hoặc D.', 'error');
      return;
    }

    const nextId = QUESTIONS.reduce((maxId, q) => Math.max(maxId, Number(q.id) || 0), 0) + 1;
    QUESTIONS.push({
      id: nextId,
      topic,
      question,
      options: { A: optA, B: optB, C: optC, D: optD },
      correctAnswer,
    });
    saveQuestionsToDisk();
    broadcastSyncState();
    addSystemLog(
      `Đã thêm Câu ${QUESTIONS.length} (${topic}): "${question}" — Đáp án đúng: ${correctAnswer}.`,
      'success'
    );
  });

  socket.on('delete_question', (payload) => {
    const idx = Number(payload?.questionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= QUESTIONS.length) return;

    if (gameState.phase === 'QUESTION') {
      addSystemLog('Không thể xóa câu hỏi khi đang trong thời gian đếm ngược.', 'warning');
      return;
    }
    if (QUESTIONS.length <= 1) {
      addSystemLog('Ngân hàng phải giữ lại ít nhất 1 câu hỏi.', 'warning');
      return;
    }

    const [removed] = QUESTIONS.splice(idx, 1);
    if (gameState.currentQuestionIndex === idx) {
      gameState.currentQuestionIndex = null;
      gameState.phase = 'IDLE';
      gameState.correctAnswer = null;
    } else if (gameState.currentQuestionIndex !== null && gameState.currentQuestionIndex > idx) {
      gameState.currentQuestionIndex -= 1;
    }
    saveQuestionsToDisk();
    broadcastSyncState();
    addSystemLog(`Đã xóa câu hỏi "${removed?.question || `#${idx + 1}`}" khỏi ngân hàng.`, 'info');
  });

  socket.on('reset_default_questions', () => {
    if (gameState.phase === 'QUESTION') {
      addSystemLog('Không thể khôi phục bộ câu hỏi khi đang đếm ngược.', 'warning');
      return;
    }
    QUESTIONS = cloneDefaultQuestions();
    askedQuestionIds.clear();
    gameState.currentQuestionIndex = null;
    if (gameState.phase === 'REVEAL') {
      gameState.phase = 'IDLE';
      gameState.correctAnswer = null;
    }
    saveQuestionsToDisk();
    broadcastSyncState();
    addSystemLog('Đã khôi phục ngân hàng về 3 câu hỏi mặc định ban đầu.', 'info');
  });

  socket.on('set_shuffle_mode', (payload) => {
    gameState.shuffleMode = Boolean(payload?.enabled);
    if (gameState.shuffleMode && gameState.phase === 'IDLE' && askedQuestionIds.size === 0) {
      shuffleQuestionsOrder();
      addSystemLog(
        `Đã BẬT tự động trộn câu hỏi khi bắt đầu ván mới (đã trộn ngay ${QUESTIONS.length} câu).`,
        'info'
      );
    } else {
      addSystemLog(
        gameState.shuffleMode
          ? 'Đã BẬT tự động trộn ngẫu nhiên bộ câu hỏi mỗi khi bắt đầu ván mới.'
          : 'Đã TẮT tự động trộn câu hỏi — giữ nguyên thứ tự danh sách khi sang ván mới.',
        'info'
      );
    }
    evaluateAutoStep();
    broadcastSyncState();
  });

  socket.on('shuffle_questions', () => {
    if (gameState.phase === 'QUESTION') {
      addSystemLog('Không thể trộn danh sách câu hỏi khi đang đếm ngược.', 'warning');
      return;
    }
    if (QUESTIONS.length <= 1) {
      addSystemLog('Cần ít nhất 2 câu hỏi để trộn thứ tự.', 'warning');
      return;
    }
    shuffleQuestionsOrder();
    broadcastSyncState();
    addSystemLog(`Đã trộn ngẫu nhiên thứ tự toàn bộ ${QUESTIONS.length} câu hỏi trong ngân hàng!`, 'success');
  });

  socket.on('start_random_question', () => {
    const idx = pickRandomUnaskedQuestionIndex(true);
    if (idx < 0) {
      addSystemLog('Ngân hàng hiện chưa có câu hỏi nào.', 'warning');
      return;
    }
    startQuestion(idx);
  });

  socket.on('import_questions', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const fileName = String(payload.fileName || 'questions.txt');
    const content = String(payload.content || '');
    const mode = payload.mode === 'replace' ? 'replace' : 'append';

    if (mode === 'replace' && gameState.phase === 'QUESTION') {
      const msg = 'Không thể thay thế bộ câu hỏi khi đang trong thời gian đếm ngược.';
      socket.emit('import_questions_result', { ok: false, message: msg });
      addSystemLog(msg, 'warning');
      return;
    }

    const parsed = parseQuestionsFromContent(fileName, content);
    if (parsed.length === 0) {
      const msg =
        'Không đọc được câu hỏi hợp lệ từ file. Hãy kiểm tra định dạng JSON, CSV hoặc TXT có đủ câu hỏi, 4 đáp án A/B/C/D và đáp án đúng.';
      socket.emit('import_questions_result', { ok: false, message: msg });
      addSystemLog(`Nhập file "${fileName}" thất bại: không có câu hỏi hợp lệ.`, 'error');
      return;
    }

    let nextId =
      mode === 'replace'
        ? 1
        : QUESTIONS.reduce((maxId, q) => Math.max(maxId, Number(q.id) || 0), 0) + 1;

    const prepared = parsed.map((q) => ({
      id: nextId++,
      topic: q.topic,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
    }));

    if (mode === 'replace') {
      QUESTIONS = prepared;
      askedQuestionIds.clear();
      gameState.currentQuestionIndex = null;
      if (gameState.phase === 'REVEAL') {
        gameState.phase = 'IDLE';
        gameState.correctAnswer = null;
      }
    } else {
      QUESTIONS.push(...prepared);
    }

    saveQuestionsToDisk();
    evaluateAutoStep();
    broadcastSyncState();

    const successMsg =
      mode === 'replace'
        ? `Đã nhập ${prepared.length} câu hỏi từ "${fileName}" (thay thế bộ cũ).`
        : `Đã thêm ${prepared.length} câu hỏi từ "${fileName}" (tổng cộng ${QUESTIONS.length} câu).`;
    socket.emit('import_questions_result', {
      ok: true,
      count: prepared.length,
      total: QUESTIONS.length,
      mode,
      message: successMsg,
    });
    addSystemLog(successMsg, 'success');
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
