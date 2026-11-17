/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Bell, Check, RotateCcw, Shuffle, Trophy, Users, X } from 'lucide-react';

type AnswerChoice = 'A' | 'B' | 'C' | 'D';
type GamePhase = 'IDLE' | 'QUESTION' | 'REVEAL' | 'WINNER' | 'GAME_OVER';
type LogLevel = 'info' | 'success' | 'warning' | 'error';

interface Player {
  uniqueId: string;
  nickname: string;
  avatar: string;
  currentAnswer: AnswerChoice | null;
  isEliminated: boolean;
  eliminatedAtQuestion: number | null;
  answeredAt: number | null;
}

interface QuestionMeta {
  index: number;
  id: number;
  topic: string;
  question: string;
}

interface CurrentQuestion {
  id: number;
  index: number;
  total: number;
  topic: string;
  question: string;
  options: Record<AnswerChoice, string>;
  correctAnswer: AnswerChoice | null;
}

interface GameStats {
  remaining: number;
  total: number;
  eliminated: number;
  answerCounts: Record<AnswerChoice, number>;
}

interface TikTokState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  username: string;
  errorMessage: string;
}

interface GameState {
  phase: GamePhase;
  currentQuestionIndex: number | null;
  currentQuestion: CurrentQuestion | null;
  questionsMeta: QuestionMeta[];
  timeLeft: number;
  questionDuration: number;
  isAcceptingAnswers: boolean;
  correctAnswer: AnswerChoice | null;
  rosterLocked: boolean;
  winner: Player | null;
  liveCommentersCount: number;
  stats: GameStats;
  players: Player[];
  tiktok: TikTokState;
}

interface SystemLogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: LogLevel;
}

const OPTION_KEYS: AnswerChoice[] = ['A', 'B', 'C', 'D'];

const MOCK_PLAYERS: Array<{ uniqueId: string; nickname: string }> = [
  { uniqueId: 'minhanh_99', nickname: 'Minh Anh' },
  { uniqueId: 'tuankiet_hn', nickname: 'Tuấn Kiệt' },
  { uniqueId: 'baongoc_2k', nickname: 'Bảo Ngọc' },
  { uniqueId: 'hoangnam_vn', nickname: 'Hoàng Nam' },
  { uniqueId: 'thao_vy_live', nickname: 'Thảo Vy' },
  { uniqueId: 'duc_thinh_pro', nickname: 'Đức Thịnh' },
  { uniqueId: 'khanh_linh_04', nickname: 'Khánh Linh' },
  { uniqueId: 'quang_huy_tt', nickname: 'Quang Huy' },
  { uniqueId: 'nhu_quynh_sg', nickname: 'Như Quỳnh' },
  { uniqueId: 'gia_bao_gaming', nickname: 'Gia Bảo' },
  { uniqueId: 'phuong_anh_98', nickname: 'Phương Anh' },
  { uniqueId: 'thanh_dat_01', nickname: 'Thành Đạt' },
  { uniqueId: 'yen_nhi_cute', nickname: 'Yến Nhi' },
  { uniqueId: 'trong_nghia_dn', nickname: 'Trọng Nghĩa' },
  { uniqueId: 'hai_dang_live', nickname: 'Hải Đăng' },
  { uniqueId: 'kim_ngan_07', nickname: 'Kim Ngân' },
  { uniqueId: 'anh_khoa_tv', nickname: 'Anh Khoa' },
  { uniqueId: 'my_duyen_96', nickname: 'Mỹ Duyên' },
  { uniqueId: 'huu_phuc_hp', nickname: 'Hữu Phúc' },
  { uniqueId: 'ngoc_tram_22', nickname: 'Ngọc Trâm' },
  { uniqueId: 'tien_dung_fc', nickname: 'Tiến Dũng' },
  { uniqueId: 'lan_huong_hn', nickname: 'Lan Hương' },
  { uniqueId: 'quoc_bao_05', nickname: 'Quốc Bảo' },
  { uniqueId: 'hong_nhung_live', nickname: 'Hồng Nhung' },
  { uniqueId: 'nhat_minh_vip', nickname: 'Nhật Minh' },
];

const LIVE_CHAT_PHRASES = [
  'Cho em tham gia với ạ!',
  'Em xin 1 slot lên sàn',
  'Chào cả nhà đang xem live',
  'Rung chuông vàng hay quá',
  'Chơi thôi mọi người ơi',
  'Em sẵn sàng rồi',
  'Chọn em đi ad ơi',
];

function createFallbackAvatarDataUri(name: string): string {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#102a63"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#FFE18C" font-family="sans-serif" font-size="52" font-weight="800">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const simulationTimersRef = useRef<number[]>([]);

  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [randomCount, setRandomCount] = useState(15);
  const [isSimulating, setIsSimulating] = useState(false);
  const [lastEventNotice, setLastEventNotice] = useState<string>('');

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsSocketConnected(true);
      socket.emit('request_sync');
    });

    socket.on('disconnect', () => {
      setIsSocketConnected(false);
    });

    socket.on('sync_state', (incomingState: GameState) => {
      setGameState(incomingState);
    });

    socket.on('timer_tick', ({ timeLeft }: { timeLeft: number }) => {
      setGameState((prev) => (prev ? { ...prev, timeLeft } : prev));
    });

    socket.on(
      'reveal_answer',
      ({
        questionIndex,
        correctAnswer,
        survivedThisRound,
        eliminatedThisRound,
      }: {
        questionIndex: number;
        correctAnswer: AnswerChoice;
        survivedThisRound: number;
        eliminatedThisRound: number;
      }) => {
        setLastEventNotice(
          `Câu ${questionIndex + 1} kết thúc · Đáp án đúng: ${correctAnswer} · Còn ${survivedThisRound} người, loại ${eliminatedThisRound} người`
        );
      }
    );

    socket.on('game_winner', ({ winner }: { winner: Player }) => {
      if (winner) {
        setLastEventNotice(`Quán quân Rung Chuông Vàng: ${winner.nickname} (@${winner.uniqueId})`);
      }
    });

    socket.on(
      'random_selected',
      ({ selectedCount, poolCount }: { selectedCount: number; poolCount: number }) => {
        setLastEventNotice(`Đã chọn ngẫu nhiên ${selectedCount}/${poolCount} thí sinh vào lớp học`);
      }
    );

    socket.on('init_logs', (initialLogs: SystemLogEntry[]) => {
      setLogs(Array.isArray(initialLogs) ? initialLogs : []);
    });

    socket.on('system_log', (entry: SystemLogEntry) => {
      setLogs((prev) => [...prev.slice(-99), entry]);
    });

    return () => {
      simulationTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      simulationTimersRef.current = [];
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const sortedPlayers = useMemo(() => {
    const list = gameState?.players ?? [];
    return [...list].sort((a, b) => {
      if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
      return (b.answeredAt || 0) - (a.answeredAt || 0);
    });
  }, [gameState?.players]);

  const isDenseClassroom = sortedPlayers.length > 16;
  const visibleLimit = isDenseClassroom ? 30 : 16;
  const displayPlayers = sortedPlayers.slice(0, visibleLimit);
  const colsPerSide = isDenseClassroom ? 3 : 2;

  const { leftWing, rightWing } = useMemo(() => {
    const left: Array<{ player: Player; seatIndex: number }> = [];
    const right: Array<{ player: Player; seatIndex: number }> = [];

    displayPlayers.forEach((player, idx) => {
      const posInRow = idx % (colsPerSide * 2);
      if (posInRow < colsPerSide) {
        left.push({ player, seatIndex: idx + 1 });
      } else {
        right.push({ player, seatIndex: idx + 1 });
      }
    });

    return { leftWing: left, rightWing: right };
  }, [displayPlayers, colsPerSide]);

  function handleConnectTikTok(e: FormEvent) {
    e.preventDefault();
    socketRef.current?.emit('connect_tiktok', { username: tiktokUsername.trim() });
  }

  function handleDisconnectTikTok() {
    socketRef.current?.emit('disconnect_tiktok');
  }

  function handlePickRandom() {
    socketRef.current?.emit('pick_random_players', { count: randomCount });
  }

  function handleToggleRosterLock() {
    socketRef.current?.emit('set_roster_lock', {
      locked: !(gameState?.rosterLocked ?? false),
    });
  }

  function handleClearPool() {
    socketRef.current?.emit('clear_commenters');
  }

  function handleStartQuestion(questionIndex: number) {
    socketRef.current?.emit('start_question', { questionIndex });
  }

  function handleTiebreakWinner(mode: 'fastest' | 'random') {
    socketRef.current?.emit('declare_tiebreak_winner', { mode });
  }

  function handleResetGame() {
    setLastEventNotice('');
    socketRef.current?.emit('reset_game');
  }

  function handleSimulate15Answers() {
    if (isSimulating || !socketRef.current) return;
    setIsSimulating(true);

    const activeSurvivors =
      gameState?.rosterLocked && gameState.players.length > 0
        ? gameState.players.filter((p) => !p.isEliminated)
        : [];
    const batch = activeSurvivors.length > 0 ? activeSurvivors.slice(0, 15) : MOCK_PLAYERS.slice(0, 15);

    batch.forEach((player, i) => {
      const timerId = window.setTimeout(() => {
        const randomChoice = OPTION_KEYS[Math.floor(Math.random() * OPTION_KEYS.length)];
        socketRef.current?.emit('simulate_chat', {
          uniqueId: player.uniqueId,
          nickname: player.nickname,
          comment: randomChoice,
        });
        if (i === batch.length - 1) {
          setIsSimulating(false);
        }
      }, i * 200);
      simulationTimersRef.current.push(timerId);
    });
  }

  function handleSimulate25Pool() {
    if (isSimulating || !socketRef.current) return;
    setIsSimulating(true);

    MOCK_PLAYERS.forEach((player, i) => {
      const timerId = window.setTimeout(() => {
        const phrase = LIVE_CHAT_PHRASES[i % LIVE_CHAT_PHRASES.length];
        socketRef.current?.emit('simulate_chat', {
          uniqueId: player.uniqueId,
          nickname: player.nickname,
          comment: phrase,
        });
        if (i === MOCK_PLAYERS.length - 1) {
          setIsSimulating(false);
        }
      }, i * 80);
      simulationTimersRef.current.push(timerId);
    });
  }

  const phase = gameState?.phase ?? 'IDLE';
  const isEnded = phase === 'REVEAL' || phase === 'WINNER' || phase === 'GAME_OVER';
  const duration = gameState?.questionDuration ?? 15;
  const timeLeft = phase === 'IDLE' ? duration : (gameState?.timeLeft ?? 0);
  const progressRatio = phase === 'QUESTION' ? timeLeft / duration : isEnded ? 0 : 1;
  const remainingCount = gameState?.stats.remaining ?? 0;
  const totalCount = gameState?.stats.total ?? 0;

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100">
      {/* Top Bar Contract: 3 zones */}
      <header className="flex items-center justify-between gap-8 border-b border-slate-800 bg-[#111827] px-6 py-3.5">
        <a href="/" className="whitespace-nowrap shrink-0 text-lg font-extrabold tracking-tight text-slate-50">
          Rung Chuông Vàng
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-400">
          <a href="/admin" className="whitespace-nowrap shrink-0 hover:text-slate-100 transition-colors">
            Trang Admin
          </a>
          <a href="/overlay" target="_blank" rel="noopener noreferrer" className="whitespace-nowrap shrink-0 hover:text-slate-100 transition-colors">
            Màn hình OBS
          </a>
          <span className="whitespace-nowrap shrink-0 text-slate-300">
            {isSocketConnected ? 'Socket.io đã kết nối' : 'Đang kết nối Socket.io...'}
          </span>
        </nav>

        <a
          href="/overlay"
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors"
        >
          Mở Overlay 1080×1920
        </a>
      </header>

      <main className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 p-6 lg:grid-cols-12">
        {/* Cột trái: Điều khiển thời gian thực */}
        <section className="flex flex-col gap-5 lg:col-span-5">
          {/* Thẻ 1: Kết nối TikTok & Chọn ngẫu nhiên */}
          <article className="rounded-xl border border-slate-800 bg-[#111827] p-5 flex flex-col gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-50">1. Kết nối TikTok Live & Tuyển thí sinh</h2>
              <p className="mt-1 text-sm text-slate-400">
                Ghi nhận bình luận trong phiên Live và chọn ngẫu nhiên thí sinh lên bàn học.
              </p>
            </div>

            <form onSubmit={handleConnectTikTok} className="flex flex-wrap gap-2.5">
              <input
                type="text"
                value={tiktokUsername}
                onChange={(e) => setTiktokUsername(e.target.value)}
                placeholder="Nhập TikTok username (vd: @tenkenh)"
                className="min-h-[42px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[42px] whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer"
              >
                Kết nối TikTok Live
              </button>
              {gameState?.tiktok.status === 'connected' || gameState?.tiktok.status === 'connecting' ? (
                <button
                  type="button"
                  onClick={handleDisconnectTikTok}
                  className="min-h-[42px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Ngắt
                </button>
              ) : null}
            </form>

            <div className="text-xs font-semibold text-slate-400">
              {gameState?.tiktok.status === 'connected' ? (
                <span className="text-emerald-400">Đã kết nối Live @{gameState.tiktok.username}</span>
              ) : gameState?.tiktok.status === 'connecting' ? (
                <span className="text-amber-400">Đang kết nối tới @{gameState.tiktok.username}...</span>
              ) : gameState?.tiktok.status === 'error' ? (
                <span className="text-red-400">Lỗi: {gameState.tiktok.errorMessage}</span>
              ) : (
                <span>Trạng thái TikTok: Chưa kết nối</span>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <span className="text-sm text-slate-300">
                Người đã bình luận:{' '}
                <strong className="font-mono-tabular text-amber-400">
                  {gameState?.liveCommentersCount ?? 0}
                </strong>
              </span>
              <button
                type="button"
                onClick={handleClearPool}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Xóa pool
              </button>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <input
                type="number"
                min={1}
                max={100}
                value={randomCount}
                onChange={(e) => setRandomCount(Number(e.target.value) || 15)}
                aria-label="Số lượng thí sinh chọn ngẫu nhiên"
                className="min-h-[42px] w-24 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-mono-tabular text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handlePickRandom}
                className="inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                <Shuffle className="h-4 w-4" />
                Chọn ngẫu nhiên từ bình luận
              </button>
              <button
                type="button"
                onClick={handleToggleRosterLock}
                className="min-h-[42px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {gameState?.rosterLocked ? 'Mở nhận tự do' : 'Khóa sàn đấu'}
              </button>
            </div>
          </article>

          {/* Thẻ 2: Điều khiển câu hỏi & Reset */}
          <article className="rounded-xl border border-slate-800 bg-[#111827] p-5 flex flex-col gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-50">2. Điều khiển trò chơi</h2>
              <p className="mt-1 text-sm text-slate-400">
                Phát câu hỏi (15s đếm ngược). Người cuối cùng còn lại trên sàn là Quán quân.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {[0, 1, 2].map((idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleStartQuestion(idx)}
                  className={`min-h-[42px] rounded-lg border px-3 py-2 text-sm font-bold transition-colors cursor-pointer ${
                    gameState?.currentQuestionIndex === idx
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  Phát Câu {idx + 1}
                </button>
              ))}
            </div>

            {phase === 'REVEAL' && remainingCount > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                <span className="text-xs font-semibold text-amber-300">
                  Còn {remainingCount} người trụ hạng — chốt Quán quân:
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleTiebreakWinner('fastest')}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
                  >
                    Nhanh nhất
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTiebreakWinner('random')}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    Bốc thăm
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <span className="text-xs text-slate-400">Xóa thí sinh trên sàn để bắt đầu ván mới</span>
              <button
                type="button"
                onClick={handleResetGame}
                className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                Reset Ván Mới
              </button>
            </div>
          </article>

          {/* Thẻ 3: Test nhanh */}
          <article className="rounded-xl border border-slate-800 bg-[#111827] p-5 flex flex-col gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-50">3. Test nhanh (Giả lập bình luận)</h2>
              <p className="mt-1 text-sm text-slate-400">
                Gửi 15 bình luận A/B/C/D cách nhau 200ms hoặc tạo nhanh 25 người bình luận Live.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={isSimulating}
                onClick={handleSimulate15Answers}
                className="min-h-[42px] whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Giả lập 15 người bình luận
              </button>
              <button
                type="button"
                disabled={isSimulating}
                onClick={handleSimulate25Pool}
                className="min-h-[42px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Giả lập 25 bình luận Live
              </button>
            </div>
          </article>

          {/* Thẻ 4: Nhật ký hệ thống */}
          <article className="rounded-xl border border-slate-800 bg-[#111827] p-5 flex flex-col gap-3">
            <h2 className="text-base font-bold text-slate-50">4. Nhật ký hệ thống</h2>
            <div
              ref={logContainerRef}
              role="log"
              aria-live="polite"
              className="h-52 overflow-y-auto rounded-lg border border-slate-800 bg-[#070b14] p-3 font-mono-tabular text-xs leading-relaxed flex flex-col gap-1.5"
            >
              {logs.length === 0 ? (
                <div className="text-slate-500">Đang chờ sự kiện từ server...</div>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className="flex gap-2.5">
                    <span className="shrink-0 text-slate-500">[{entry.timestamp}]</span>
                    <span
                      className={
                        entry.level === 'success'
                          ? 'text-emerald-400'
                          : entry.level === 'warning'
                            ? 'text-amber-300'
                            : entry.level === 'error'
                              ? 'text-red-400'
                              : 'text-slate-200'
                      }
                    >
                      {entry.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        {/* Cột phải: Màn hình Rung Chuông Vàng thời gian thực (kiểu lớp học) */}
        <section className="flex flex-col gap-4 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#06112d] via-[#0a1c47] to-[#050d24] p-6 lg:col-span-7">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 border-b border-amber-400/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/15 text-amber-300">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-display-royal text-2xl font-black tracking-wide text-amber-300">
                  RUNG CHUÔNG VÀNG
                </h1>
                <p className="text-xs font-medium text-slate-300">
                  {lastEventNotice || 'Đồng bộ thời gian thực qua Socket.io Client'}
                </p>
              </div>
            </div>

            <div className="text-right font-mono-tabular">
              <div className="text-sm font-bold text-amber-300">
                Còn {remainingCount} / {totalCount} người trên sàn
              </div>
              <div className="text-xs text-slate-400">Đã loại: {gameState?.stats.eliminated ?? 0}</div>
            </div>
          </div>

          {/* Khung câu hỏi + Đếm ngược 15s */}
          <div className="rounded-xl border border-amber-400/30 bg-[#0d2255]/90 p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  {gameState?.currentQuestion
                    ? `Câu hỏi 0${gameState.currentQuestion.index + 1} / 0${gameState.currentQuestion.total} · ${gameState.currentQuestion.topic}`
                    : 'Phòng thi trực tuyến · Chờ phát câu hỏi'}
                </div>
                <p className="mt-2 text-lg font-bold leading-snug text-white">
                  {gameState?.currentQuestion?.question ??
                    'Hãy chọn ngẫu nhiên thí sinh từ bình luận Live hoặc nhấn Phát Câu 1 để bắt đầu.'}
                </p>
              </div>

              <div
                className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2 bg-slate-950/80 font-mono-tabular ${
                  phase === 'QUESTION' && timeLeft <= 5
                    ? 'border-red-500 text-red-300'
                    : 'border-amber-400/60 text-amber-300'
                }`}
              >
                <span className="text-xl font-extrabold leading-none">{timeLeft}</span>
                <span className="text-[10px] font-semibold text-slate-400">giây</span>
              </div>
            </div>

            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-950/80 border border-amber-400/20">
              <div
                className={`h-full w-full origin-left transition-transform duration-1000 linear ${
                  phase === 'QUESTION' && timeLeft <= 5 ? 'bg-red-500' : 'bg-amber-400'
                }`}
                style={{ transform: `scaleX(${progressRatio})` }}
              />
            </div>

            {/* Lưới 2x2 Đáp án */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {OPTION_KEYS.map((key) => {
                const optionText = gameState?.currentQuestion?.options[key] ?? 'Đang chờ câu hỏi...';
                const count = gameState?.stats.answerCounts[key] ?? 0;
                const isCorrect = isEnded && gameState?.correctAnswer === key;
                const isWrong = isEnded && gameState?.correctAnswer !== null && gameState?.correctAnswer !== key;

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all ${
                      isCorrect
                        ? 'border-emerald-400 bg-emerald-900/75 text-white'
                        : isWrong
                          ? 'border-amber-400/20 bg-[#10265c]/60 opacity-45'
                          : 'border-amber-400/30 bg-[#10265c]/90'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono-tabular text-base font-extrabold ${
                        isCorrect ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-400 text-slate-950'
                      }`}
                    >
                      {key}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-slate-50">{optionText}</div>
                      <div className="font-mono-tabular text-xs text-slate-300">
                        {isCorrect ? `Đáp án đúng · ${count} lượt chọn` : `${count} lượt chọn`}
                      </div>
                    </div>
                    {isCorrect ? <Check className="h-5 w-5 shrink-0 text-emerald-300" /> : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sân khấu thí sinh kiểu lớp học */}
          <div className="flex flex-1 flex-col gap-3 rounded-xl border border-amber-400/25 bg-[#060f28]/90 p-4">
            <div className="flex items-center justify-between rounded-lg border-2 border-[#925420] bg-[#0a3126] px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-extrabold text-amber-100">
                <Users className="h-4 w-4 text-amber-300" />
                LỚP HỌC THI ĐẤU · SÂN KHẤU THÍ SINH
              </div>
              <span className="font-mono-tabular text-xs font-bold text-emerald-200">
                Chỗ ngồi: {remainingCount} còn thi / {totalCount} bàn
              </span>
            </div>

            {phase === 'WINNER' && gameState?.winner ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-amber-400/60 bg-gradient-to-b from-[#102860] to-[#07112e] p-8 text-center">
                <div className="inline-flex items-center gap-2 text-sm font-extrabold tracking-widest text-amber-300">
                  <Trophy className="h-5 w-5" />
                  QUÁN QUÂN RUNG CHUÔNG VÀNG
                </div>
                <div className="h-28 w-28 rounded-full bg-gradient-to-br from-amber-200 to-amber-600 p-1">
                  <img
                    src={gameState.winner.avatar}
                    alt={gameState.winner.nickname}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = createFallbackAvatarDataUri(gameState.winner?.nickname ?? '?');
                    }}
                    className="h-full w-full rounded-full bg-[#0f2558] object-cover"
                  />
                </div>
                <div className="font-display-royal text-3xl font-black text-white">
                  {gameState.winner.nickname}
                </div>
                <div className="font-mono-tabular text-sm text-amber-300">
                  @{gameState.winner.uniqueId}
                </div>
                <p className="text-sm font-semibold text-emerald-300">
                  Chiến thắng tuyệt đối — Người cuối cùng còn lại trong lớp học!
                </p>
              </div>
            ) : displayPlayers.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-14 text-center text-slate-400">
                <div className="text-base font-bold text-amber-300">Lớp học đang chờ thí sinh vào chỗ ngồi</div>
                <p className="mt-1 max-w-md text-sm">
                  Nhấn "Giả lập 15 người bình luận" hoặc "Giả lập 25 bình luận Live" rồi chọn ngẫu nhiên thí sinh để xem bàn học cập nhật theo thời gian thực.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_18px_1fr] items-start pt-1">
                <div className={`grid gap-3 ${isDenseClassroom ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {leftWing.map(({ player, seatIndex }) => (
                    <ClassroomDesk
                      key={player.uniqueId}
                      player={player}
                      seatIndex={seatIndex}
                      isEnded={isEnded}
                      correctAnswer={gameState?.correctAnswer ?? null}
                    />
                  ))}
                </div>

                <div className="flex h-full justify-center" aria-hidden="true">
                  <div className="h-full w-0.5 border-l border-dashed border-amber-400/25" />
                </div>

                <div className={`grid gap-3 ${isDenseClassroom ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {rightWing.map(({ player, seatIndex }) => (
                    <ClassroomDesk
                      key={player.uniqueId}
                      player={player}
                      seatIndex={seatIndex}
                      isEnded={isEnded}
                      correctAnswer={gameState?.correctAnswer ?? null}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ClassroomDesk({
  player,
  seatIndex,
  isEnded,
  correctAnswer,
}: {
  player: Player;
  seatIndex: number;
  isEnded: boolean;
  correctAnswer: AnswerChoice | null;
}) {
  const isCorrectReveal = isEnded && !player.isEliminated && player.currentAnswer === correctAnswer;

  return (
    <div className={`flex flex-col items-center px-1 pt-1 transition-opacity ${player.isEliminated ? 'opacity-65' : ''}`}>
      <div
        className={`self-start pl-1 font-mono-tabular text-[11px] font-bold ${
          player.isEliminated ? 'text-slate-500' : 'text-amber-200/75'
        }`}
      >
        Bàn {String(seatIndex).padStart(2, '0')}
      </div>

      <div
        className={`relative z-10 -mb-3 h-14 w-14 rounded-full p-0.5 ${
          player.isEliminated
            ? 'bg-slate-600'
            : 'bg-gradient-to-br from-amber-200 to-amber-600'
        }`}
      >
        <img
          src={player.avatar}
          alt={player.nickname}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.src = createFallbackAvatarDataUri(player.nickname || player.uniqueId);
          }}
          className={`h-full w-full rounded-full bg-[#0f2558] object-cover ${
            player.isEliminated ? 'opacity-45 grayscale' : ''
          }`}
        />

        {player.isEliminated ? (
          <div
            aria-label="Đã bị loại"
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/35"
          >
            <X className="h-9 w-9 stroke-[3.5] text-red-500" />
          </div>
        ) : null}

        {player.currentAnswer ? (
          <span
            className={`absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-md border-2 border-[#06112d] font-mono-tabular text-xs font-extrabold ${
              player.isEliminated
                ? 'bg-slate-600 text-slate-200'
                : isCorrectReveal
                  ? 'bg-emerald-500 text-white'
                  : 'bg-amber-400 text-slate-950'
            }`}
          >
            {player.currentAnswer}
          </span>
        ) : null}
      </div>

      <div
        className={`relative z-20 w-full rounded-t-lg rounded-b-md border-t-2 border-b-4 px-2 pb-1.5 pt-3.5 text-center ${
          player.isEliminated
            ? 'border-t-slate-500 border-b-slate-950 bg-slate-800 text-slate-400 line-through'
            : 'border-t-[#e09b52] border-b-[#452207] bg-gradient-to-b from-[#b86f2c] to-[#68370e] text-amber-50'
        }`}
      >
        <div className="truncate text-xs font-extrabold" title={player.nickname}>
          {player.nickname}
        </div>
      </div>
    </div>
  );
}
