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
  const [randomCount, setRandomCount] = useState(16);
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
  const [activeSubTab, setActiveSubTab] = useState<'logs' | 'bank' | 'test'>('logs');
  const [copiedObsUrl, setCopiedObsUrl] = useState(false);
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

    function playInviteSfx() {
      if (!soundEnabledRef.current) return;
      playTone(587.33, 0, 0.16, 'triangle', 0.11);
      playTone(783.99, 0.11, 0.18, 'triangle', 0.12);
      playTone(1046.5, 0.22, 0.28, 'sine', 0.13);
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

    socket.on('auto_invite', ({ text }: { text?: string } = {}) => {
      if (!text) return;
      playInviteSfx();
      speakVietnamese(text, 'normal', 1.02);
    });

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

  async function handleCopyObsUrl() {
    const obsUrl = `${window.location.origin}/overlay`;
    try {
      await navigator.clipboard.writeText(obsUrl);
      setCopiedObsUrl(true);
      window.setTimeout(() => setCopiedObsUrl(false), 2000);
    } catch {
      setLastEventNotice(`Link OBS Overlay: ${obsUrl}`);
    }
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

  const phaseLabel =
    phase === 'QUESTION'
      ? 'Đang hỏi'
      : phase === 'REVEAL'
        ? 'Công bố'
        : phase === 'WINNER'
          ? 'Quán quân'
          : phase === 'GAME_OVER'
            ? 'Kết thúc'
            : 'Chờ phát câu';

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col bg-[#070b14] text-slate-100">
      {/* Thanh điều khiển trên cùng: 1 dòng gọn */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#111827] px-5 py-2.5 shrink-0">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <a href="/" className="whitespace-nowrap shrink-0 text-base font-extrabold tracking-tight text-slate-50">
            Rung Chuông Vàng
          </a>

          <form onSubmit={handleConnectTikTok} className="flex items-center gap-2">
            <input
              type="text"
              value={tiktokUsername}
              onChange={(e) => setTiktokUsername(e.target.value)}
              placeholder="@username TikTok Live"
              aria-label="TikTok Username"
              className="min-h-[34px] w-44 rounded-lg border border-slate-700 bg-[#090f1d] px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              className="min-h-[34px] whitespace-nowrap shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 transition-colors cursor-pointer"
            >
              Kết nối Live
            </button>
            {gameState?.tiktok.status === 'connected' || gameState?.tiktok.status === 'connecting' ? (
              <button
                type="button"
                onClick={handleDisconnectTikTok}
                className="min-h-[34px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Ngắt
              </button>
            ) : null}
          </form>

          <span
            className={`text-xs font-semibold whitespace-nowrap ${
              gameState?.tiktok.status === 'connected'
                ? 'text-emerald-400'
                : gameState?.tiktok.status === 'connecting'
                  ? 'text-amber-400'
                  : gameState?.tiktok.status === 'error'
                    ? 'text-red-400'
                    : 'text-slate-400'
            }`}
          >
            {gameState?.tiktok.status === 'connected'
              ? `Live @${gameState.tiktok.username}`
              : gameState?.tiktok.status === 'connecting'
                ? `Đang kết nối @${gameState.tiktok.username}...`
                : gameState?.tiktok.status === 'error'
                  ? `Lỗi: ${gameState.tiktok.errorMessage}`
                  : isSocketConnected
                    ? 'Chưa kết nối Live'
                    : 'Đang kết nối server...'}
          </span>
        </div>

        <div className="hidden xl:flex items-center gap-2.5 text-xs text-slate-400 font-mono-tabular whitespace-nowrap">
          <span>
            Trên sàn: <strong className="text-slate-100">{remainingCount} / {totalCount}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Bình luận: <strong className="text-slate-100">{gameState?.liveCommentersCount ?? 0}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <strong className="text-amber-300">{phaseLabel}</strong>
          <span aria-hidden="true">·</span>
          <strong className="text-slate-100">{timeLeft}s</strong>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleVoice}
            className={`inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
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
            className={`inline-flex min-h-[34px] items-center whitespace-nowrap shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
              soundEnabled
                ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {soundEnabled ? 'Âm thanh: Bật' : 'Âm thanh: Tắt'}
          </button>
          <button
            type="button"
            onClick={handleCopyObsUrl}
            className="inline-flex min-h-[34px] items-center whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            {copiedObsUrl ? 'Đã copy link OBS' : 'Copy link OBS'}
          </button>
          <button
            type="button"
            onClick={handleResetGame}
            className="inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Ván Mới
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-1 gap-4 p-4 lg:grid-cols-12">
        {/* Cột trái: Điều khiển ghim trên + 3 Tab con bên dưới */}
        <section className="flex flex-col gap-3 min-h-0 lg:col-span-6">
          {/* Phần ghim trên: Thao tác dùng liên tục khi đang Live */}
          <article className="rounded-xl border border-slate-800 bg-[#0f172a] p-3.5 flex flex-col gap-2.5 shrink-0">
            {/* Hàng 1: Tuyển thí sinh */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-200">Thí sinh:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={randomCount}
                  onChange={(e) => {
                    const nextVal = Math.max(1, Math.min(100, Number(e.target.value) || 16));
                    setRandomCount(nextVal);
                    socketRef.current?.emit('set_auto_mode', { pickCount: nextVal });
                  }}
                  aria-label="Số lượng thí sinh chọn ngẫu nhiên"
                  className="min-h-[34px] w-16 rounded-lg border border-slate-700 bg-[#090f1d] px-2.5 text-xs font-mono-tabular text-slate-100 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handlePickRandom}
                  className="inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  Chọn ngẫu nhiên từ bình luận
                </button>
                <button
                  type="button"
                  onClick={handleToggleRosterLock}
                  className="min-h-[34px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  {gameState?.rosterLocked ? 'Mở nhận tự do' : 'Khóa sàn đấu'}
                </button>
                <button
                  type="button"
                  onClick={handleClearPool}
                  className="min-h-[34px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  Xóa pool
                </button>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                {gameState?.rosterLocked ? 'Đã khóa danh sách thí sinh' : 'Nhận tự do qua bình luận A, B, C, D'}
              </span>
            </div>

            {/* Hàng 2: Vận hành tự động & Mix */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-200">Vận hành:</span>
                <button
                  type="button"
                  onClick={handleToggleAutoMode}
                  className={`min-h-[34px] whitespace-nowrap shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    gameState?.autoMode
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                      : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {gameState?.autoMode ? 'Tắt Tự động' : 'Bật Tự động'}
                </button>
                <button
                  type="button"
                  onClick={handleToggleShuffleMode}
                  className={`inline-flex min-h-[34px] items-center gap-1 whitespace-nowrap shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    gameState?.shuffleMode !== false
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {gameState?.shuffleMode !== false ? 'Mix ván mới: Bật' : 'Mix ván mới: Tắt'}
                </button>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Nghỉ chuyển câu:</span>
                  <select
                    value={gameState?.autoTransitionSeconds ?? 9}
                    onChange={(e) => handleChangeAutoTransition(Number(e.target.value) || 9)}
                    aria-label="Thời gian nghỉ chuyển câu tiếp theo"
                    className="min-h-[34px] rounded-lg border border-slate-700 bg-[#090f1d] px-2 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    <option value={6}>6s (Nhanh)</option>
                    <option value={9}>9s (Khuyên dùng)</option>
                    <option value={12}>12s (Thoải mái)</option>
                    <option value={15}>15s (Chậm)</option>
                  </select>
                </label>
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  gameState?.autoMode ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {gameState?.autoMode
                  ? gameState.autoStatus || 'Tự động: Đang bật'
                  : 'Tự động: Tắt (thủ công)'}
              </span>
            </div>

            {/* Hàng 3: Phát câu hỏi & Tiebreak */}
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-200">Phát câu hỏi:</span>
                  <button
                    type="button"
                    onClick={handlePlayRandomQuestion}
                    className="inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                    Phát ngẫu nhiên 1 câu
                  </button>
                </div>

                {phase === 'REVEAL' && remainingCount > 1 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-amber-300">
                      Còn {remainingCount} người — chốt Quán quân:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTiebreakWinner('fastest')}
                      className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
                    >
                      Nhanh nhất
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTiebreakWinner('random')}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      Bốc thăm
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="grid max-h-28 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                {(gameState?.questionsMeta && gameState.questionsMeta.length > 0
                  ? gameState.questionsMeta.map((q) => q.index)
                  : [0, 1, 2]
                ).map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleStartQuestion(idx)}
                    className={`min-h-[34px] rounded-lg border px-2 py-1 text-xs font-bold transition-colors cursor-pointer ${
                      gameState?.currentQuestionIndex === idx
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    Phát Câu {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          </article>

          {/* Phần Tab con bên dưới: Nhật ký Live | Ngân hàng câu hỏi | Test nhanh & Âm thanh */}
          <article className="flex-1 min-h-[280px] flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0f172a]">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-[#111827] px-3 py-2 shrink-0">
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Khu vực quản lý chi tiết">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSubTab === 'logs'}
                  onClick={() => setActiveSubTab('logs')}
                  className={`min-h-[32px] whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${
                    activeSubTab === 'logs'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  Nhật ký Live
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSubTab === 'bank'}
                  onClick={() => setActiveSubTab('bank')}
                  className={`min-h-[32px] whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${
                    activeSubTab === 'bank'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  Ngân hàng câu hỏi ({gameState?.questionsMeta?.length ?? 0})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSubTab === 'test'}
                  onClick={() => setActiveSubTab('test')}
                  className={`min-h-[32px] whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-bold transition-colors cursor-pointer ${
                    activeSubTab === 'test'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  Test nhanh &amp; Âm thanh
                </button>
              </div>
            </div>

            {activeSubTab === 'logs' ? (
              <div className="flex-1 min-h-0 flex flex-col p-3.5">
                <div
                  ref={logContainerRef}
                  role="log"
                  aria-live="polite"
                  className="flex-1 min-h-[180px] overflow-y-auto rounded-lg border border-slate-800 bg-[#070b14] p-3 font-mono-tabular text-xs leading-relaxed flex flex-col gap-1.5"
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
              </div>
            ) : null}

            {activeSubTab === 'bank' ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#070b14] p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={importMode}
                      onChange={(e) => setImportMode(e.target.value === 'replace' ? 'replace' : 'append')}
                      aria-label="Chế độ nhập file câu hỏi"
                      className="min-h-[32px] rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none"
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
                      className="inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Nhập file
                    </button>
                    <button
                      type="button"
                      onClick={handleShuffleQuestions}
                      className="inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      <Shuffle className="h-3.5 w-3.5" />
                      Trộn thứ tự
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDownloadSampleTemplate}
                      className="inline-flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      <Download className="h-3 w-3" />
                      Mẫu TXT
                    </button>
                    <button
                      type="button"
                      onClick={handleExportQuestionsJson}
                      className="inline-flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      <Download className="h-3 w-3" />
                      Xuất JSON
                    </button>
                    <button
                      type="button"
                      onClick={handleResetDefaultQuestions}
                      className="min-h-[32px] rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      Mặc định (3 câu)
                    </button>
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

                <form onSubmit={handleAddQuestion} className="flex flex-col gap-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <input
                      type="text"
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      placeholder="Chủ đề"
                      className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                      placeholder="Nhập nội dung câu hỏi mới..."
                      className="min-h-[36px] sm:col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    <div className="flex gap-1.5">
                      <select
                        id="reactCorrectSelect"
                        value={newCorrect}
                        onChange={(e) => setNewCorrect(e.target.value as AnswerChoice)}
                        aria-label="Đáp án đúng"
                        className="min-h-[36px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs font-bold text-amber-300 focus:border-amber-500 focus:outline-none"
                      >
                        {OPTION_KEYS.map((k) => (
                          <option key={k} value={k}>
                            Đáp án {k}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="min-h-[36px] whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                      >
                        + Thêm
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input
                      type="text"
                      value={newOptA}
                      onChange={(e) => setNewOptA(e.target.value)}
                      placeholder="Đáp án A"
                      className="min-h-[34px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newOptB}
                      onChange={(e) => setNewOptB(e.target.value)}
                      placeholder="Đáp án B"
                      className="min-h-[34px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newOptC}
                      onChange={(e) => setNewOptC(e.target.value)}
                      placeholder="Đáp án C"
                      className="min-h-[34px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newOptD}
                      onChange={(e) => setNewOptD(e.target.value)}
                      placeholder="Đáp án D"
                      className="min-h-[34px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
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

                <div className="flex flex-col gap-1.5 border-t border-slate-800 pt-2.5">
                  {(gameState?.questionsMeta ?? []).map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#070b14] px-3 py-2"
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
              </div>
            ) : null}

            {activeSubTab === 'test' ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3">
                <p className="text-xs text-slate-400">
                  Dùng để kiểm tra nhanh giao diện sân khấu, hiệu ứng pháo hoa và giọng đọc tiếng Việt trước khi phát Live.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={isSimulating}
                    onClick={handleSimulate15Answers}
                    className="min-h-[38px] whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Giả lập 15 người bình luận
                  </button>
                  <button
                    type="button"
                    disabled={isSimulating}
                    onClick={handleSimulate25Pool}
                    className="min-h-[38px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Giả lập 25 bình luận Live
                  </button>
                  <button
                    type="button"
                    onClick={handleTestVoice}
                    className="min-h-[38px] whitespace-nowrap shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Thử giọng đọc MC
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Mẹo: Bấm &quot;Giả lập 25 bình luận Live&quot; rồi chọn ngẫu nhiên từ bình luận, sau đó phát câu hỏi và bấm &quot;Giả lập 15 người bình luận&quot;.
                </p>
              </div>
            ) : null}
          </article>
        </section>

        {/* Cột phải: Màn hình Lớp Học Rung Chuông Vàng thời gian thực */}
        <section className="relative overflow-y-auto flex flex-col gap-3.5 rounded-2xl border-4 border-[#d97706] bg-gradient-to-b from-[#fffdf7] via-[#fef3dc] to-[#f3dfc0] p-5 text-slate-900 lg:col-span-6">
          {phase === 'WINNER' ? (
            <canvas
              ref={fireworksCanvasRef}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
              aria-hidden="true"
            />
          ) : null}

          {/* Header lớp học */}
          <div className="flex items-center justify-between gap-4 border-b border-amber-300/60 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-white bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-sm">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-amber-900">
                  RUNG CHUÔNG VÀNG
                </h1>
                <p className="text-xs font-semibold text-slate-600">
                  {lastEventNotice || 'Lớp học thi đấu trực tuyến qua TikTok Live'}
                </p>
              </div>
            </div>

            <div className="text-right font-mono-tabular">
              <div className="text-sm font-extrabold text-amber-900">
                Còn {remainingCount} / {totalCount} bạn
              </div>
              <div className="text-xs font-semibold text-slate-600">
                Đã rời bàn: {gameState?.stats.eliminated ?? 0}
              </div>
            </div>
          </div>

          {/* Bảng đen câu hỏi + Đồng hồ 15s */}
          <div className="rounded-2xl border-[6px] border-[#92400e] bg-gradient-to-b from-[#165b42] to-[#0d3d2b] p-4 text-white shadow-md flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-extrabold tracking-wide text-yellow-300">
                  {gameState?.currentQuestion
                    ? `Câu hỏi ${String(gameState.currentQuestion.index + 1).padStart(2, '0')} / ${String(gameState.currentQuestion.total).padStart(2, '0')} · ${gameState.currentQuestion.topic}`
                    : 'Lớp học trực tuyến · Chờ phát câu hỏi'}
                </div>
                <p className="mt-1.5 text-base font-bold leading-snug text-white">
                  {gameState?.currentQuestion?.question ??
                    'Hãy chọn ngẫu nhiên thí sinh từ bình luận Live hoặc nhấn Phát Câu 1 để bắt đầu.'}
                </p>
              </div>

              <div
                className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-4 bg-amber-50 font-mono-tabular ${
                  phase === 'QUESTION' && timeLeft <= 5
                    ? 'border-red-600 text-red-600'
                    : 'border-amber-500 text-slate-900'
                }`}
              >
                <span className="text-lg font-extrabold leading-none">{timeLeft}</span>
                <span className="text-[10px] font-bold text-slate-500">giây</span>
              </div>
            </div>

            <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/30">
              <div
                className={`h-full w-full origin-left transition-transform duration-1000 linear ${
                  phase === 'QUESTION' && timeLeft <= 5 ? 'bg-red-500' : 'bg-yellow-300'
                }`}
                style={{ transform: `scaleX(${progressRatio})` }}
              />
            </div>

            {/* Lưới 2x2 Thẻ Đáp án */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {OPTION_KEYS.map((key) => {
                const optionText = gameState?.currentQuestion?.options[key] ?? 'Đang chờ câu hỏi...';
                const count = gameState?.stats.answerCounts[key] ?? 0;
                const isCorrect = isEnded && gameState?.correctAnswer === key;
                const isWrong = isEnded && gameState?.correctAnswer !== null && gameState?.correctAnswer !== key;
                const keyBadgeClass =
                  isCorrect
                    ? 'bg-emerald-600 text-white'
                    : key === 'A'
                      ? 'bg-sky-600 text-white'
                      : key === 'B'
                        ? 'bg-orange-600 text-white'
                        : key === 'C'
                          ? 'bg-violet-600 text-white'
                          : 'bg-rose-600 text-white';

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2.5 rounded-xl border-2 border-b-4 px-3 py-2.5 transition-all ${
                      isCorrect
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-950'
                        : isWrong
                          ? 'border-slate-200 bg-white/85 opacity-45 text-slate-900'
                          : 'border-slate-200 border-b-slate-300 bg-white text-slate-900'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono-tabular text-sm font-extrabold ${keyBadgeClass}`}
                    >
                      {key}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-extrabold text-slate-900">{optionText}</div>
                      <div className="font-mono-tabular text-[11px] font-semibold text-slate-500">
                        {isCorrect ? `Đáp án đúng · ${count} lượt chọn` : `${count} lượt chọn`}
                      </div>
                    </div>
                    {isCorrect ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sân khấu bàn học lớp học */}
          <div className="flex flex-1 flex-col gap-3 rounded-2xl border-2 border-[#d97706] bg-white/80 p-3.5">
            <div className="flex items-center justify-between rounded-xl border-2 border-[#92400e] bg-[#165b42] px-3.5 py-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-100">
                <Users className="h-4 w-4 text-yellow-300" />
                LỚP HỌC THI ĐẤU · SÂN KHẤU HỌC SINH
              </div>
              <span className="font-mono-tabular text-xs font-bold text-emerald-200">
                Chỗ ngồi: {remainingCount} còn thi / {totalCount} bàn
              </span>
            </div>

            {waitlistBannerText ? (
              <div
                aria-live="polite"
                className="rounded-lg border border-amber-400 bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900"
              >
                {waitlistBannerText}
              </div>
            ) : null}

            {phase === 'WINNER' && gameState?.winner ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-amber-600 bg-gradient-to-b from-amber-100 to-amber-200 p-6 text-center">
                <div className="inline-flex items-center gap-2 text-sm font-extrabold tracking-wide text-amber-900">
                  <Trophy className="h-5 w-5" />
                  THỦ KHOA RUNG CHUÔNG VÀNG
                </div>
                <div className="relative h-24 w-24 overflow-hidden rounded-full border-4 border-white bg-amber-300 shadow-md">
                  <img
                    src={gameState.winner.avatar}
                    alt={gameState.winner.nickname}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = createFallbackAvatarDataUri(gameState.winner?.nickname ?? '?');
                    }}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="text-2xl font-extrabold text-slate-900">
                  {gameState.winner.nickname}
                </div>
                <div className="font-mono-tabular text-xs font-bold text-amber-900">
                  @{gameState.winner.uniqueId}
                </div>
                <p className="text-xs font-bold text-emerald-800">
                  Xuất sắc vượt qua tất cả câu hỏi và giành vòng nguyệt quế!
                </p>
              </div>
            ) : displayPlayers.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-10 text-center text-slate-600">
                <div className="text-sm font-extrabold text-amber-900">Lớp học đang chờ các bạn vào chỗ ngồi</div>
                <p className="mt-1 max-w-md text-xs font-medium">
                  Nhấn &quot;Giả lập 25 bình luận Live&quot; rồi chọn ngẫu nhiên thí sinh để xem bàn học hiển thị avatar và tên từng người chơi.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_14px_1fr] items-start pt-1">
                <div className={`grid gap-2.5 ${isDenseClassroom ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
                  <div className="h-full w-0.5 border-l-2 border-dashed border-amber-700/30" />
                </div>

                <div className={`grid gap-2.5 ${isDenseClassroom ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
  const displayName = (player.nickname || player.uniqueId || `Bạn ${seatIndex}`).trim();

  return (
    <div className={`flex flex-col items-center px-0.5 pt-0.5 transition-opacity ${player.isEliminated ? 'opacity-70' : ''}`}>
      <div
        className={`self-start pl-1 font-mono-tabular text-[10px] font-extrabold ${
          player.isEliminated ? 'text-slate-500' : 'text-amber-800'
        }`}
      >
        Bàn {String(seatIndex).padStart(2, '0')}
      </div>

      {/* Avatar tách biệt hoàn toàn bên trên mặt bàn */}
      <div className="relative z-10 mb-1 h-12 w-12 shrink-0 rounded-full border-2 border-white bg-sky-100 shadow-sm">
        <div className="relative h-full w-full overflow-hidden rounded-full flex items-center justify-center">
          <span className="text-sm font-extrabold text-slate-900 select-none">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <img
            src={player.avatar}
            alt={displayName}
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className={`absolute inset-0 h-full w-full object-cover ${
              player.isEliminated ? 'opacity-40 grayscale' : ''
            }`}
          />
          {player.isEliminated ? (
            <div
              aria-label="Đã rời bàn"
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-white/40"
            >
              <X className="h-7 w-7 stroke-[3.5] text-red-600" />
            </div>
          ) : null}
        </div>

        {player.currentAnswer ? (
          <span
            className={`absolute -right-1.5 -top-1 flex h-5 w-5 items-center justify-center rounded-md border-2 border-white font-mono-tabular text-[11px] font-extrabold shadow-sm ${
              player.isEliminated
                ? 'bg-slate-500 text-white'
                : isCorrectReveal
                  ? 'bg-emerald-500 text-white'
                  : 'bg-yellow-300 text-slate-900'
            }`}
          >
            {player.currentAnswer}
          </span>
        ) : null}
      </div>

      {/* Bàn gỗ + Bảng tên giấy trắng chữ đậm */}
      <div
        className={`relative z-20 w-full rounded-t-lg rounded-b-md border-t-2 border-b-4 p-1.5 text-center shadow-sm ${
          player.isEliminated
            ? 'border-t-slate-300 border-b-slate-500 bg-slate-400'
            : 'border-t-amber-400 border-b-[#78350f] bg-gradient-to-b from-[#d97706] to-[#b45309]'
        }`}
      >
        <div
          className={`w-full rounded px-1.5 py-0.5 ${
            player.isEliminated
              ? 'bg-slate-100 text-slate-500 line-through'
              : 'bg-white text-slate-900'
          }`}
        >
          <div className="truncate text-[11px] font-extrabold" title={displayName}>
            {displayName}
          </div>
        </div>
      </div>
    </div>
  );
}
