/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Bell, Check, Download, RotateCcw, Shuffle, Trophy, Upload, Users, Volume2, VolumeX, X } from 'lucide-react';

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
  options?: Record<AnswerChoice, string>;
  correctAnswer?: AnswerChoice;
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
  autoMode: boolean;
  autoPickCount: number;
  autoTransitionSeconds: number;
  shuffleMode: boolean;
  autoStatus: string;
  voiceEnabled: boolean;
  soundEnabled: boolean;
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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const voiceEnabledRef = useRef(true);
  const speechQueueRef = useRef<Array<{ text: string; rate: number }>>([]);
  const isSpeakingRef = useRef(false);
  const activeTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechSafetyTimerRef = useRef<number | null>(null);
  const speechRetryTimerRef = useRef<number | null>(null);
  const speechSessionIdRef = useRef<number>(0);
  const speechVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const pendingLateNamesRef = useRef<string[]>([]);
  const lateBatchTimerRef = useRef<number | null>(null);
  const waitlistTimerRef = useRef<number | null>(null);
  const lastLateSpeechAtRef = useRef<number>(0);
  const latestPhaseRef = useRef<GamePhase>('IDLE');
  const latestTimeLeftRef = useRef<number>(0);
  const fireworksCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const speakRef = useRef<((text: string, priority?: 'high' | 'normal', rate?: number) => void) | null>(null);
  const stopAllSpeechRef = useRef<(() => void) | null>(null);

  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [randomCount, setRandomCount] = useState(15);
  const [isSimulating, setIsSimulating] = useState(false);
  const [lastEventNotice, setLastEventNotice] = useState<string>('');
  const [waitlistBannerText, setWaitlistBannerText] = useState<string>('');
  const [newTopic, setNewTopic] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newOptA, setNewOptA] = useState('');
  const [newOptB, setNewOptB] = useState('');
  const [newOptC, setNewOptC] = useState('');
  const [newOptD, setNewOptD] = useState('');
  const [newCorrect, setNewCorrect] = useState<AnswerChoice>('A');
  const [questionFormMsg, setQuestionFormMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [importFileMsg, setImportFileMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const soundEnabled = gameState?.soundEnabled ?? true;
  const voiceEnabled = gameState?.voiceEnabled ?? true;

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (!voiceEnabled) {
      stopAllSpeechRef.current?.();
    }
  }, [voiceEnabled]);

  useEffect(() => {
    function ensureAudioContext(): AudioContext | null {
      if (!soundEnabledRef.current) return null;
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return audioCtxRef.current;
    }

    function playTone(
      freq: number,
      startOffset: number,
      duration: number,
      type: OscillatorType = 'sine',
      volume = 0.14
    ) {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime + startOffset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    function playQuestionStartSfx() {
      if (!soundEnabledRef.current) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        playTone(freq, i * 0.08, 0.28, 'triangle', 0.14);
      });
    }

    function playCountdownTickSfx(isFinalSecond: boolean) {
      if (!soundEnabledRef.current) return;
      playTone(isFinalSecond ? 1174.66 : 880, 0, 0.09, 'square', 0.06);
    }

    function playRevealSfx(eliminatedCount: number) {
      if (!soundEnabledRef.current) return;
      playTone(659.25, 0, 0.35, 'triangle', 0.15);
      playTone(987.77, 0.08, 0.45, 'sine', 0.14);
      if (eliminatedCount > 0) {
        playTone(220, 0.22, 0.32, 'sawtooth', 0.06);
      }
    }

    function playWinnerSfx() {
      if (!soundEnabledRef.current) return;
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) => {
        playTone(freq, i * 0.1, 0.45, 'triangle', 0.16);
      });
      playTone(1567.98, 0.52, 0.9, 'sine', 0.18);
    }

    function playLateCommenterSfx() {
      if (!soundEnabledRef.current) return;
      playTone(783.99, 0, 0.18, 'sine', 0.1);
      playTone(987.77, 0.1, 0.24, 'sine', 0.11);
    }

    function loadVoices() {
      if ('speechSynthesis' in window) {
        speechVoicesRef.current = window.speechSynthesis.getVoices() || [];
      }
    }
    if ('speechSynthesis' in window) {
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    function stopAllSpeech() {
      speechSessionIdRef.current += 1;
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      if (speechSafetyTimerRef.current) {
        window.clearTimeout(speechSafetyTimerRef.current);
        speechSafetyTimerRef.current = null;
      }
      if (speechRetryTimerRef.current) {
        window.clearTimeout(speechRetryTimerRef.current);
        speechRetryTimerRef.current = null;
      }
      if (activeTtsAudioRef.current) {
        try {
          activeTtsAudioRef.current.onended = null;
          activeTtsAudioRef.current.onerror = null;
          activeTtsAudioRef.current.pause();
          activeTtsAudioRef.current.removeAttribute('src');
          activeTtsAudioRef.current.load();
        } catch {}
        activeTtsAudioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }

    function speakWithWebSpeech(text: string, rate: number, sessionId: number, onDone: () => void) {
      if (sessionId !== speechSessionIdRef.current) return;
      if (!('speechSynthesis' in window)) {
        onDone();
        return;
      }
      const voices =
        speechVoicesRef.current.length > 0
          ? speechVoicesRef.current
          : window.speechSynthesis.getVoices() || [];
      const viVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('vi'));
      // Tuyệt đối không dùng giọng mặc định tiếng Anh nếu hệ điều hành không có giọng tiếng Việt
      if (!viVoice) {
        onDone();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'vi-VN';
        utterance.voice = viVoice;
        utterance.rate = rate;
        utterance.pitch = 1.05;

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (speechSafetyTimerRef.current) {
            window.clearTimeout(speechSafetyTimerRef.current);
            speechSafetyTimerRef.current = null;
          }
          if (sessionId === speechSessionIdRef.current) {
            onDone();
          }
        };

        utterance.onend = finish;
        utterance.onerror = finish;
        speechSafetyTimerRef.current = window.setTimeout(finish, 12000);
        window.speechSynthesis.speak(utterance);
      } catch {
        if (sessionId === speechSessionIdRef.current) {
          onDone();
        }
      }
    }

    function processSpeechQueue() {
      if (!voiceEnabledRef.current) {
        stopAllSpeech();
        return;
      }
      if (isSpeakingRef.current || speechQueueRef.current.length === 0) return;

      const next = speechQueueRef.current.shift();
      if (!next) return;
      const sessionId = speechSessionIdRef.current;
      isSpeakingRef.current = true;

      const advanceQueue = () => {
        if (sessionId !== speechSessionIdRef.current) return;
        isSpeakingRef.current = false;
        if (speechSafetyTimerRef.current) {
          window.clearTimeout(speechSafetyTimerRef.current);
          speechSafetyTimerRef.current = null;
        }
        if (speechRetryTimerRef.current) {
          window.clearTimeout(speechRetryTimerRef.current);
          speechRetryTimerRef.current = null;
        }
        processSpeechQueue();
      };

      const playTtsAttempt = (attempt: number) => {
        if (sessionId !== speechSessionIdRef.current || !voiceEnabledRef.current) return;
        try {
          const audio = new Audio(`/api/tts?text=${encodeURIComponent(next.text)}`);
          activeTtsAudioRef.current = audio;
          audio.playbackRate = next.rate || 1.0;

          let settled = false;
          const handleFailure = () => {
            if (settled || sessionId !== speechSessionIdRef.current) return;
            settled = true;
            audio.onended = null;
            audio.onerror = null;
            activeTtsAudioRef.current = null;
            if (speechSafetyTimerRef.current) {
              window.clearTimeout(speechSafetyTimerRef.current);
              speechSafetyTimerRef.current = null;
            }
            if (attempt === 0) {
              speechRetryTimerRef.current = window.setTimeout(() => {
                speechRetryTimerRef.current = null;
                if (sessionId === speechSessionIdRef.current) {
                  playTtsAttempt(1);
                }
              }, 220);
              return;
            }
            speakWithWebSpeech(next.text, next.rate, sessionId, advanceQueue);
          };

          audio.onended = () => {
            if (settled || sessionId !== speechSessionIdRef.current) return;
            settled = true;
            audio.onended = null;
            audio.onerror = null;
            activeTtsAudioRef.current = null;
            advanceQueue();
          };
          audio.onerror = handleFailure;

          speechSafetyTimerRef.current = window.setTimeout(() => {
            if (!settled && sessionId === speechSessionIdRef.current) {
              settled = true;
              audio.onended = null;
              audio.onerror = null;
              try {
                audio.pause();
                audio.removeAttribute('src');
                audio.load();
              } catch {}
              activeTtsAudioRef.current = null;
              advanceQueue();
            }
          }, 15000);

          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
              if (sessionId !== speechSessionIdRef.current) return;
              if (err && err.name === 'AbortError') return;
              handleFailure();
            });
          }
        } catch {
          speakWithWebSpeech(next.text, next.rate, sessionId, advanceQueue);
        }
      };

      playTtsAttempt(0);
    }

    function speakVietnamese(text: string, priority: 'high' | 'normal' = 'normal', rate = 1.02) {
      if (!voiceEnabledRef.current || !text) return;

      if (priority === 'high') {
        stopAllSpeech();
        speechQueueRef.current = [{ text, rate }];
        processSpeechQueue();
        return;
      }

      if (speechQueueRef.current.length >= 4) {
        speechQueueRef.current.shift();
      }
      speechQueueRef.current.push({ text, rate });
      processSpeechQueue();
    }

    speakRef.current = speakVietnamese;
    stopAllSpeechRef.current = stopAllSpeech;

    const unlockAudio = () => {
      if (soundEnabledRef.current) {
        ensureAudioContext();
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

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
      latestPhaseRef.current = incomingState.phase;
      latestTimeLeftRef.current = incomingState.timeLeft;
      setGameState(incomingState);
    });

    socket.on(
      'auto_status',
      ({
        autoMode,
        autoPickCount,
        autoTransitionSeconds,
        shuffleMode,
        autoStatus,
      }: {
        autoMode?: boolean;
        autoPickCount?: number;
        autoTransitionSeconds?: number;
        shuffleMode?: boolean;
        autoStatus?: string;
      }) => {
        setGameState((prev) =>
          prev
            ? {
                ...prev,
                autoMode: typeof autoMode === 'boolean' ? autoMode : prev.autoMode,
                autoPickCount: typeof autoPickCount === 'number' ? autoPickCount : prev.autoPickCount,
                autoTransitionSeconds:
                  typeof autoTransitionSeconds === 'number'
                    ? autoTransitionSeconds
                    : prev.autoTransitionSeconds,
                shuffleMode: typeof shuffleMode === 'boolean' ? shuffleMode : prev.shuffleMode,
                autoStatus: typeof autoStatus === 'string' ? autoStatus : prev.autoStatus,
              }
            : prev
        );
      }
    );

    socket.on(
      'import_questions_result',
      ({ ok, message }: { ok?: boolean; message?: string } = {}) => {
        setImportFileMsg({
          text: message || (ok ? 'Nhập file thành công!' : 'Nhập file thất bại.'),
          isError: !ok,
        });
      }
    );

    socket.on(
      'question_started',
      ({ questionIndex, question }: { questionIndex?: number; question?: string } = {}) => {
        playQuestionStartSfx();
        if (question) {
          speakVietnamese(`Câu hỏi số ${(questionIndex ?? 0) + 1}: ${question}`, 'high', 1.04);
        }
      }
    );

    socket.on('timer_tick', ({ timeLeft }: { timeLeft: number }) => {
      latestTimeLeftRef.current = timeLeft;
      setGameState((prev) => {
        if (prev?.phase === 'QUESTION' && timeLeft > 0 && timeLeft <= 5) {
          playCountdownTickSfx(timeLeft === 1);
        }
        return prev ? { ...prev, timeLeft } : prev;
      });
    });

    socket.on(
      'reveal_answer',
      ({
        questionIndex,
        correctAnswer,
        correctOptionText,
        survivedThisRound,
        eliminatedThisRound,
      }: {
        questionIndex: number;
        correctAnswer: AnswerChoice;
        correctOptionText?: string;
        survivedThisRound: number;
        eliminatedThisRound: number;
      }) => {
        playRevealSfx(eliminatedThisRound || 0);
        setLastEventNotice(
          `Câu ${questionIndex + 1} kết thúc · Đáp án đúng: ${correctAnswer} · Còn ${survivedThisRound} người, loại ${eliminatedThisRound} người`
        );
        if (correctAnswer) {
          const text = correctOptionText
            ? `Hết giờ! Đáp án chính xác là ${correctAnswer}, ${correctOptionText}.`
            : `Hết giờ! Đáp án chính xác là ${correctAnswer}.`;
          speakVietnamese(text, 'high', 1.0);
        }
      }
    );

    socket.on('game_winner', ({ winner, reason }: { winner: Player; reason?: string }) => {
      playWinnerSfx();
      if (winner) {
        const winnerName = winner.nickname || winner.uniqueId;
        setLastEventNotice(`Quán quân Rung Chuông Vàng: ${winnerName} (@${winner.uniqueId})`);
        const isAfterReveal = reason === 'last_survivor';
        speakVietnamese(
          `Xin chúc mừng ${winnerName}, người chiến thắng cuối cùng đã Rung Chuông Vàng!`,
          isAfterReveal ? 'normal' : 'high',
          0.98
        );
      }
    });

    socket.on('late_commenter', ({ nickname, uniqueId }: { nickname?: string; uniqueId?: string }) => {
      const displayName = (nickname || uniqueId || 'bạn').trim();
      if (!displayName) return;

      pendingLateNamesRef.current.push(displayName);
      if (lateBatchTimerRef.current) window.clearTimeout(lateBatchTimerRef.current);

      lateBatchTimerRef.current = window.setTimeout(() => {
        const names = pendingLateNamesRef.current.splice(0, 4);
        pendingLateNamesRef.current = [];
        if (names.length === 0) return;

        setWaitlistBannerText(
          `Hàng chờ vòng sau (${names.join(', ')}): Chào các bạn, các bạn vào bình luận sau nên sẽ tham gia vòng sau nhé!`
        );
        if (waitlistTimerRef.current) window.clearTimeout(waitlistTimerRef.current);
        waitlistTimerRef.current = window.setTimeout(() => setWaitlistBannerText(''), 4500);

        const now = Date.now();
        const currentPhase = latestPhaseRef.current;
        const currentTimeLeft = latestTimeLeftRef.current;
        const isQuietMoment =
          !isSpeakingRef.current &&
          currentPhase !== 'WINNER' &&
          !(currentPhase === 'QUESTION' && currentTimeLeft <= 5);

        if (isQuietMoment && now - lastLateSpeechAtRef.current >= 15000) {
          lastLateSpeechAtRef.current = now;
          playLateCommenterSfx();
          speakVietnamese(
            'Chào các bạn, các bạn vào bình luận sau nên sẽ tham gia vòng sau nhé!',
            'normal',
            1.04
          );
        }
      }, 900);
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
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      if (lateBatchTimerRef.current) window.clearTimeout(lateBatchTimerRef.current);
      if (waitlistTimerRef.current) window.clearTimeout(waitlistTimerRef.current);
      stopAllSpeech();
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

  function handleToggleAutoMode() {
    const nextAuto = !(gameState?.autoMode ?? false);
    socketRef.current?.emit('set_auto_mode', {
      enabled: nextAuto,
      pickCount: randomCount,
      transitionSeconds: gameState?.autoTransitionSeconds ?? 9,
    });
  }

  function handleChangeAutoTransition(seconds: number) {
    socketRef.current?.emit('set_auto_mode', {
      transitionSeconds: seconds,
    });
  }

  function handleToggleVoice() {
    const nextVoice = !voiceEnabled;
    if (!nextVoice) {
      stopAllSpeechRef.current?.();
    }
    socketRef.current?.emit('set_audio_settings', { voiceEnabled: nextVoice });
  }

  function handleToggleSound() {
    socketRef.current?.emit('set_audio_settings', { soundEnabled: !soundEnabled });
  }

  function handleTestVoice() {
    if (!voiceEnabled) {
      voiceEnabledRef.current = true;
      socketRef.current?.emit('set_audio_settings', { voiceEnabled: true });
    }
    speakRef.current?.(
      'Hệ thống Rung Chuông Vàng đã sẵn sàng. Giọng đọc đang hoạt động bình thường!',
      'high',
      1.0
    );
  }

  function handleAddQuestion(e: FormEvent) {
    e.preventDefault();
    const question = newQuestion.trim();
    const A = newOptA.trim();
    const B = newOptB.trim();
    const C = newOptC.trim();
    const D = newOptD.trim();
    if (!question || !A || !B || !C || !D) {
      setQuestionFormMsg({
        text: 'Vui lòng nhập đầy đủ câu hỏi và cả 4 đáp án A, B, C, D.',
        isError: true,
      });
      return;
    }

    socketRef.current?.emit('add_question', {
      topic: newTopic.trim() || 'Kiến thức chung',
      question,
      options: { A, B, C, D },
      correctAnswer: newCorrect,
    });
    setNewQuestion('');
    setNewOptA('');
    setNewOptB('');
    setNewOptC('');
    setNewOptD('');
    setQuestionFormMsg({ text: 'Đã thêm câu hỏi mới vào ngân hàng!', isError: false });
  }

  function handleDeleteQuestion(questionIndex: number) {
    socketRef.current?.emit('delete_question', { questionIndex });
  }

  function handleResetDefaultQuestions() {
    socketRef.current?.emit('reset_default_questions');
  }

  function handlePlayRandomQuestion() {
    socketRef.current?.emit('start_random_question');
  }

  function handleToggleShuffleMode() {
    socketRef.current?.emit('set_shuffle_mode', {
      enabled: !(gameState?.shuffleMode ?? false),
    });
  }

  function handleShuffleQuestions() {
    socketRef.current?.emit('shuffle_questions');
  }

  async function handleImportQuestionsFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setImportFileMsg({ text: `Đang đọc file "${file.name}"...`, isError: false });
      socketRef.current?.emit('import_questions', {
        fileName: file.name,
        content,
        mode: importMode,
      });
    } catch {
      setImportFileMsg({ text: 'Không thể đọc nội dung file đã chọn.', isError: true });
    }
  }

  function handleDownloadSampleTemplate() {
    const templateText = [
      'Chủ đề: Địa lý Việt Nam',
      'Câu 1: Thành phố nào được mệnh danh là "Thành phố ngàn hoa"?',
      'A. Sa Pa',
      'B. Đà Lạt',
      'C. Hội An',
      'D. Huế',
      'Đáp án: B',
      '',
      'Chủ đề: Đố vui dân gian',
      'Câu 2: Con vật nào xuất hiện đầu tiên trong 12 con giáp của Việt Nam?',
      'A. Chuột (Tý)',
      'B. Trâu (Sửu)',
      'C. Mèo (Mão)',
      'D. Rồng (Thìn)',
      'Đáp án: A',
      '',
      'Chủ đề: Khoa học',
      'Câu 3: Hành tinh nào gần Mặt Trời nhất trong Hệ Mặt Trời?',
      'A. Sao Kim',
      'B. Trái Đất',
      'C. Sao Thủy',
      'D. Sao Hỏa',
      'Đáp án: C',
    ].join('\n');
    const blob = new Blob([templateText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau_bo_cau_hoi_rung_chuong_vang.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleExportQuestionsJson() {
    const list = (gameState?.questionsMeta ?? []).map((q, idx) => ({
      id: q.id || idx + 1,
      topic: q.topic,
      question: q.question,
      options: q.options || { A: '', B: '', C: '', D: '' },
      correctAnswer: q.correctAnswer || 'A',
    }));
    const blob = new Blob([JSON.stringify(list, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bo_cau_hoi_rung_chuong_vang.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  useEffect(() => {
    if (phase !== 'WINNER') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = fireworksCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const FIREWORK_COLORS = ['#FFE18C', '#F5C451', '#34D399', '#FB7185', '#60A5FA', '#FBBF24', '#FFFFFF'];

    interface FireworkParticle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      alpha: number;
      decay: number;
      radius: number;
      color: string;
    }

    interface FireworkRocket {
      x: number;
      y: number;
      vx: number;
      vy: number;
      targetY: number;
      color: string;
    }

    const particles: FireworkParticle[] = [];
    const rockets: FireworkRocket[] = [];
    let animationId: number | null = null;
    let spawnTimer: number | null = null;
    const introTimers: number[] = [];
    let active = true;

    function syncCanvasSize() {
      if (!canvas) return;
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : canvas.clientWidth;
      const height = parent ? parent.clientHeight : canvas.clientHeight;
      if (width > 0 && height > 0) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    syncCanvasSize();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && canvas.parentElement
        ? new ResizeObserver(() => syncCanvasSize())
        : null;
    if (resizeObserver && canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    function playFireworkPop() {
      if (!soundEnabledRef.current) return;
      const audioCtx = audioCtxRef.current;
      if (!audioCtx || audioCtx.state !== 'running') return;

      const baseFreq = 180 + Math.random() * 140;
      const playShortTone = (freq: number, offset: number, dur: number, type: OscillatorType, vol: number) => {
        const now = audioCtx.currentTime + offset;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(vol, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + dur + 0.02);
      };

      playShortTone(baseFreq, 0, 0.14, 'triangle', 0.055);
      playShortTone(baseFreq * 2.2, 0.03, 0.1, 'sine', 0.04);
    }

    function createExplosion(x: number, y: number) {
      const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
      const secondaryColor = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
      const count = 42 + Math.floor(Math.random() * 22);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.15;
        const speed = 2.2 + Math.random() * 5.2;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: 0.014 + Math.random() * 0.012,
          radius: 1.8 + Math.random() * 2.5,
          color: i % 3 === 0 ? secondaryColor : color,
        });
      }
      playFireworkPop();
    }

    function launchRocket() {
      if (!canvas) return;
      const w = canvas.width || 640;
      const h = canvas.height || 640;
      rockets.push({
        x: w * 0.14 + Math.random() * (w * 0.72),
        y: h - 14,
        vx: (Math.random() - 0.5) * 1.8,
        vy: -(11 + Math.random() * 5),
        targetY: h * 0.16 + Math.random() * (h * 0.44),
        color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
      });
    }

    function renderFrame() {
      if (!active || !canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;

      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.16;

        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = r.color;
        ctx.fill();

        if (r.y <= r.targetY || r.vy >= -1.5) {
          createExplosion(r.x, r.y);
          rockets.splice(i, 1);
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vx *= 0.975;
        p.vy = p.vy * 0.975 + 0.1;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
      }

      animationId = window.requestAnimationFrame(renderFrame);
    }

    const w = canvas.width || 640;
    const h = canvas.height || 640;
    createExplosion(w * 0.26, h * 0.55);
    introTimers.push(window.setTimeout(() => active && createExplosion(w * 0.74, h * 0.55), 180));
    introTimers.push(window.setTimeout(() => active && createExplosion(w * 0.5, h * 0.26), 340));

    spawnTimer = window.setInterval(() => {
      if (!active) return;
      launchRocket();
      if (Math.random() > 0.45) {
        launchRocket();
      }
    }, 620);

    animationId = window.requestAnimationFrame(renderFrame);

    return () => {
      active = false;
      if (animationId !== null) window.cancelAnimationFrame(animationId);
      if (spawnTimer !== null) window.clearInterval(spawnTimer);
      introTimers.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [phase]);

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

            <div className="grid max-h-44 grid-cols-3 gap-2.5 overflow-y-auto pr-1">
              {(gameState?.questionsMeta && gameState.questionsMeta.length > 0
                ? gameState.questionsMeta.map((q) => q.index)
                : [0, 1, 2]
              ).map((idx) => (
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

            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-800 pt-3">
              <span className="text-xs text-slate-400">Tự động trộn thứ tự câu hỏi mỗi khi bắt đầu ván mới</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePlayRandomQuestion}
                  className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  Phát ngẫu nhiên 1 câu
                </button>
                <button
                  type="button"
                  onClick={handleToggleShuffleMode}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    gameState?.shuffleMode !== false
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {gameState?.shuffleMode !== false ? 'Mix ván mới: Bật' : 'Mix ván mới: Tắt'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <span
                className={`text-xs font-semibold ${
                  gameState?.autoMode ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {gameState?.autoMode
                  ? gameState.autoStatus || 'Vận hành tự động: Đang bật'
                  : 'Vận hành tự động: Đang tắt (điều khiển thủ công)'}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Nghỉ chuyển câu:</span>
                  <select
                    value={gameState?.autoTransitionSeconds ?? 9}
                    onChange={(e) => handleChangeAutoTransition(Number(e.target.value) || 9)}
                    aria-label="Thời gian nghỉ chuyển câu tiếp theo"
                    className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value={6}>6s (Nhanh)</option>
                    <option value={9}>9s (Khuyên dùng)</option>
                    <option value={12}>12s (Thoải mái)</option>
                    <option value={15}>15s (Chậm)</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleToggleAutoMode}
                  className={`min-h-[38px] whitespace-nowrap shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    gameState?.autoMode
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                      : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {gameState?.autoMode ? 'Tắt Tự động' : 'Bật Tự động vận hành'}
                </button>
              </div>
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <span className="text-xs text-slate-400">Giọng đọc MC &amp; âm thanh (ẩn khỏi màn hình Live)</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    voiceEnabled
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {voiceEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                  {voiceEnabled ? 'Giọng đọc: Bật' : 'Giọng đọc: Tắt'}
                </button>
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    soundEnabled
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {soundEnabled ? 'Âm thanh: Bật' : 'Âm thanh: Tắt'}
                </button>
                <button
                  type="button"
                  onClick={handleTestVoice}
                  className="inline-flex min-h-[36px] items-center whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  Thử giọng đọc
                </button>
              </div>
            </div>

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

          {/* Thẻ 5: Ngân hàng câu hỏi */}
          <article className="rounded-xl border border-slate-800 bg-[#111827] p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-50">
                  5. Ngân hàng câu hỏi ({gameState?.questionsMeta?.length ?? 0} câu)
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Thêm từng câu hoặc nhập cả bộ từ file (.JSON, .CSV, .TXT) và trộn ngẫu nhiên thứ tự.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetDefaultQuestions}
                className="shrink-0 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Mặc định (3 câu)
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-slate-800 bg-[#070b14] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value === 'replace' ? 'replace' : 'append')}
                  aria-label="Chế độ nhập file câu hỏi"
                  className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="append">Thêm vào bộ hiện có</option>
                  <option value="replace">Thay thế toàn bộ</option>
                </select>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".json,.csv,.txt,.tsv"
                  onChange={handleImportQuestionsFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (importFileInputRef.current) {
                      importFileInputRef.current.value = '';
                      importFileInputRef.current.click();
                    }
                  }}
                  className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Nhập file (.JSON / .CSV / .TXT)
                </button>
                <button
                  type="button"
                  onClick={handleShuffleQuestions}
                  className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  Trộn thứ tự bộ câu
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadSampleTemplate}
                  className="inline-flex min-h-[34px] items-center gap-1 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  <Download className="h-3 w-3" />
                  Tải mẫu (.TXT)
                </button>
                <button
                  type="button"
                  onClick={handleExportQuestionsJson}
                  className="inline-flex min-h-[34px] items-center gap-1 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  <Download className="h-3 w-3" />
                  Xuất JSON
                </button>
              </div>
              <div className="w-full text-[11px] text-slate-400">
                Mẫu TXT: <code className="text-slate-300">Câu 1: ...</code> · <code className="text-slate-300">A. ... B. ... C. ... D. ...</code> · <code className="text-slate-300">Đáp án: B</code> (hoặc CSV 7 cột: Chủ đề, Câu hỏi, A, B, C, D, Đáp án đúng).
              </div>
              {importFileMsg ? (
                <div
                  className={`w-full text-xs font-semibold ${
                    importFileMsg.isError ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {importFileMsg.text}
                </div>
              ) : null}
            </div>

            <form onSubmit={handleAddQuestion} className="flex flex-col gap-2.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="Chủ đề (vd: Đố vui)"
                  className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Nhập nội dung câu hỏi..."
                  className="min-h-[40px] sm:col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newOptA}
                  onChange={(e) => setNewOptA(e.target.value)}
                  placeholder="Đáp án A"
                  className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newOptB}
                  onChange={(e) => setNewOptB(e.target.value)}
                  placeholder="Đáp án B"
                  className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newOptC}
                  onChange={(e) => setNewOptC(e.target.value)}
                  placeholder="Đáp án C"
                  className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newOptD}
                  onChange={(e) => setNewOptD(e.target.value)}
                  placeholder="Đáp án D"
                  className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <label htmlFor="reactCorrectSelect" className="text-xs font-semibold text-slate-300">
                    Đáp án đúng:
                  </label>
                  <select
                    id="reactCorrectSelect"
                    value={newCorrect}
                    onChange={(e) => setNewCorrect(e.target.value as AnswerChoice)}
                    className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-sm font-bold text-amber-300 focus:border-amber-500 focus:outline-none"
                  >
                    {OPTION_KEYS.map((k) => (
                      <option key={k} value={k}>
                        Đáp án {k}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  className="min-h-[38px] whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  + Thêm câu hỏi
                </button>
              </div>

              {questionFormMsg ? (
                <div
                  className={`text-xs font-semibold ${
                    questionFormMsg.isError ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {questionFormMsg.text}
                </div>
              ) : null}
            </form>

            <div className="flex max-h-60 flex-col gap-2 overflow-y-auto border-t border-slate-800 pt-3">
              {(gameState?.questionsMeta ?? []).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between gap-2.5 rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-100" title={q.question}>
                      Câu {q.index + 1} ({q.topic}): {q.question}
                    </div>
                    <div className="truncate text-[11px] text-slate-400">
                      Đáp án đúng: <strong className="text-emerald-400">{q.correctAnswer ?? '—'}</strong>
                      {q.options ? ` · ${q.options[q.correctAnswer ?? 'A']}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleStartQuestion(q.index)}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      Phát
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteQuestion(q.index)}
                      className="rounded-md bg-red-600/85 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-500 cursor-pointer"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        {/* Cột phải: Màn hình Rung Chuông Vàng thời gian thực (kiểu lớp học) */}
        <section className="relative overflow-hidden flex flex-col gap-4 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#06112d] via-[#0a1c47] to-[#050d24] p-6 lg:col-span-7">
          {phase === 'WINNER' ? (
            <canvas
              ref={fireworksCanvasRef}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
              aria-hidden="true"
            />
          ) : null}
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
                    ? `Câu hỏi ${String(gameState.currentQuestion.index + 1).padStart(2, '0')} / ${String(gameState.currentQuestion.total).padStart(2, '0')} · ${gameState.currentQuestion.topic}`
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

            {waitlistBannerText ? (
              <div
                aria-live="polite"
                className="rounded-lg border border-amber-400/45 bg-amber-400/15 px-3.5 py-2 text-xs font-bold text-amber-100"
              >
                {waitlistBannerText}
              </div>
            ) : null}

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
