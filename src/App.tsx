import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, BookOpenCheck, Car, CheckCircle2, ChevronRight, CreditCard, Download, ExternalLink, Eye, EyeOff, Home, ListFilter, Lock, LogOut, Play, RotateCcw, Search, Settings, Star, TimerReset, Trash2, UserRound, Volume2, VolumeX, XCircle } from "lucide-react";
import { Button } from "./components/Button";
import { Card } from "./components/Card";
import { ProgressBar } from "./components/ProgressBar";
import { isCorrectAnswer, maxScore, passScore, secondsForQuestion } from "./lib/exam";
import { getUiSoundMuted, playUiSound, setUiSoundMuted } from "./lib/sound";
import type { Question } from "./types/domain";
import "./styles.css";

type View = "home" | "training" | "exam" | "difficult" | "stats" | "account" | "pricing" | "admin" | "terms" | "privacy" | "refunds" | "contact";
type ExamAnswer = { question: Question; selected: string; correct: boolean; order: number };
type ExamPhase = "prep" | "playing" | "answer";
type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role: "USER" | "ADMIN" | string;
  emailVerifiedAt?: string | null;
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
  createdAt: string;
  lastLoginAt?: string | null;
};
type AccessState = { hasActiveAccess: boolean; planCode: string; expiresAt?: string | null };
type Plan = { code: string; name: string; days: number; amount: number; currency: string; featured?: boolean; active?: boolean; sortOrder?: number };
type AdminUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
  counts: { sessions: number; accessGrants: number; payments: number; attempts: number; difficult: number };
};
type DifficultItem = {
  questionId: number;
  addedAt: string;
  timesReviewed: number;
  lastReviewedAt?: string | null;
  mastered: boolean;
  correctStreak: number;
  nextReviewAt: string;
  question: Question;
};
type DifficultFilter = "due" | "active" | "mastered" | "all";

const nav = [
  { id: "home" as const, label: "Menu", icon: Home },
  { id: "training" as const, label: "Trening", icon: Play },
  { id: "exam" as const, label: "Egzamin", icon: TimerReset },
  { id: "difficult" as const, label: "Trudne", icon: Star },
  { id: "stats" as const, label: "Warunki zdania", icon: BarChart3 },
  { id: "account" as const, label: "Konto", icon: UserRound }
];

const fallbackQuestions: Question[] = [
  { id: 1, text: "Czy po znaku STOP trzeba zatrzymać pojazd przed linią zatrzymania?", category: "Znaki", correctAnswer: "Tak", options: ["Tak", "Nie"], weight: 3, kind: "BASIC" },
  { id: 2, text: "Jaka jest dopuszczalna prędkość samochodu osobowego w obszarze zabudowanym w dzień, jeśli znaki nie mówią inaczej?", category: "Prędkość", correctAnswer: "50 km/h", options: ["40 km/h", "50 km/h", "70 km/h"], weight: 2, kind: "SPECIALIST" }
];

const examVideoPrepSeconds = 20;
const examVideoAnswerSeconds = 15;
const freeTrainingDailyLimit = 30;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function timeUntilDailyReset(now = new Date()) {
  const resetAt = new Date(now);
  resetAt.setHours(24, 0, 0, 0);
  const totalMinutes = Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours} godz. ${minutes} min`;
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(amount / 100);
}

function formatAccessDate(value?: string | null) {
  if (!value) return "brak aktywnego dostępu";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function answerToneClass(option: string, active = false, index = 0, total = 2) {
  const normalized = option.trim().toLowerCase();
  if (normalized === "tak") {
    return active ? "" : "border-2 text-zinc-50";
  }
  if (normalized === "nie") {
    return active ? "" : "border-2 text-zinc-50";
  }
  if (total === 3) {
    if (active) return "";
    return "border-2 text-zinc-50";
  }
  return "";
}

function answerToneStyle(option: string, active = false, index = 0, total = 2) {
  if (active) return undefined;
  const normalized = option.trim().toLowerCase();
  const palette =
    normalized === "tak" ? { borderColor: "rgba(76, 175, 125, 0.72)", backgroundColor: "rgba(76, 175, 125, 0.12)" } :
    normalized === "nie" ? { borderColor: "rgba(229, 90, 90, 0.72)", backgroundColor: "rgba(229, 90, 90, 0.12)" } :
    total === 3 ? { borderColor: "rgba(79, 168, 232, 0.72)", backgroundColor: "rgba(79, 168, 232, 0.12)" } :
    undefined;
  return palette;
}

function planName(planCode: string, plans: Plan[]) {
  const plan = plans.find((item) => item.code === planCode);
  if (plan) return plan.name;
  const fallback: Record<string, string> = {
    day: "1 dzień",
    week: "7 dni",
    month: "30 dni",
    quarter: "90 dni",
    manual: "Dostęp ręczny",
    free: "Tryb bezpłatny"
  };
  return fallback[planCode] ?? planCode;
}

function planCardName(name: string) {
  return name.replace(/^Dostęp\s+/i, "");
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    paid: "opłacone",
    pending: "oczekuje",
    expired: "wygasło",
    failed: "nieudane",
    configuration_required: "niedostępne"
  };
  return labels[status] ?? status;
}

function paymentStatusClass(status: string) {
  if (status === "paid") return "text-success";
  if (status === "failed" || status === "expired") return "text-danger";
  return "text-zinc-400";
}

function accessSourceLabel(source: string) {
  const labels: Record<string, string> = {
    stripe: "płatność online",
    admin: "obsługa serwisu",
    manual: "nadanie ręczne"
  };
  return labels[source] ?? source;
}

function isBrowserVideo(question: Question) {
  const extension = question.mediaPath?.split(".").pop()?.toLowerCase();
  return question.mediaType === "video" && (extension === "mp4" || extension === "webm" || extension === "ogg");
}

function TrainingVideoPlayer({ src, className }: { src: string; className: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<"idle" | "playing" | "ended">("idle");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setState("idle");
  }, [src]);

  function playVideo() {
    const video = videoRef.current;
    if (!video) return;
    if (state === "ended") video.currentTime = 0;
    video.play().then(() => setState("playing")).catch(() => undefined);
  }

  return (
    <div className={`relative overflow-hidden border border-zinc-700/70 bg-surface-950 shadow-lift ${className}`}>
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        src={src}
        playsInline
        preload="metadata"
        onEnded={() => setState("ended")}
        onPause={() => setState((value) => value === "ended" ? "ended" : "idle")}
        onPlay={() => setState("playing")}
        onClick={() => state !== "playing" ? playVideo() : undefined}
      />
      {state !== "playing" ? (
        <button
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-card border border-accent/70 bg-surface-950/82 text-accent shadow-lift transition hover:scale-105 hover:bg-surface-900"
          onClick={playVideo}
          aria-label={state === "ended" ? "Odtwórz ponownie" : "Odtwórz film"}
        >
          {state === "ended" ? <RotateCcw size={29} /> : <Play size={30} />}
        </button>
      ) : null}
    </div>
  );
}

function QuestionMedia({
  question,
  compact = false,
  canPlayVideo = true,
  onLockedVideo
}: {
  question: Question;
  compact?: boolean;
  canPlayVideo?: boolean;
  onLockedVideo?: () => void;
}) {
  if (!question.mediaPath) return null;

  const extension = question.mediaPath.split(".").pop()?.toLowerCase();
  const browserVideo = extension === "mp4" || extension === "webm" || extension === "ogg";
  const mediaClass = compact
    ? "h-[min(30vh,300px)] min-h-[170px] w-full rounded-card object-contain"
    : "aspect-video w-full rounded-card object-contain";

  if (question.mediaType === "video" && !canPlayVideo) {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 border border-accent/35 bg-surface-900 p-6 text-center shadow-lift ${mediaClass}`}>
        <div className="flex h-14 w-14 items-center justify-center rounded-card border border-accent/60 bg-accent/10 text-accent">
          <Lock size={28} />
        </div>
        <div>
          <p className="font-semibold text-zinc-100">Materiał wideo jest niedostępny</p>
          <p className="mt-1 text-sm text-zinc-400">Odśwież stronę albo sprawdź aktywny dostęp do tej części serwisu.</p>
        </div>
        {onLockedVideo ? <Button icon={<CreditCard size={17} />} onClick={onLockedVideo}>Zobacz dostęp</Button> : null}
      </div>
    );
  }

  if (question.mediaType === "video" && browserVideo) {
    return <TrainingVideoPlayer className={mediaClass} src={question.mediaPath} />;
  }

  if (question.mediaType === "video") {
    return (
      <div className={`flex flex-col items-center justify-center gap-4 bg-surface-900 p-6 text-center shadow-lift ${mediaClass}`}>
        <div className="flex h-14 w-14 items-center justify-center rounded-card bg-accent text-surface-950">
          <Play size={28} />
        </div>
        <div>
          <p className="font-semibold text-zinc-100">Materiał wideo jest w formacie WMV</p>
          <p className="mt-1 text-sm text-zinc-400">Przeglądarka może go nie odtworzyć bezpośrednio.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-semibold text-surface-950 shadow-lift transition hover:brightness-110" href={question.mediaPath} target="_blank" rel="noreferrer">
            <ExternalLink size={17} /> Otwórz plik
          </a>
          <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-button bg-surface-800 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-surface-850" href={question.mediaPath} download>
            <Download size={17} /> Pobierz
          </a>
        </div>
      </div>
    );
  }

  return <img className={`${mediaClass} bg-surface-900`} src={question.mediaPath} alt="Materiały do pytania" loading="eager" />;
}

function QuestionPanel({
  question,
  reveal,
  selected,
  onSelect,
  canPlayVideo = true,
  onLockedVideo
}: {
  question: Question;
  reveal: boolean;
  selected?: string;
  onSelect: (answer: string) => void;
  canPlayVideo?: boolean;
  onLockedVideo?: () => void;
}) {
  const options = question.options?.length ? question.options : ["Tak", "Nie"];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={question.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.24 }} className="space-y-5">
        <QuestionMedia question={question} canPlayVideo={canPlayVideo} onLockedVideo={onLockedVideo} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-full bg-surface-900 px-3 py-1">{question.category}</span>
          <span className="rounded-full bg-surface-900 px-3 py-1">{question.weight} pkt</span>
          <span className="rounded-full bg-surface-900 px-3 py-1">{question.kind === "BASIC" ? "Podstawowe" : "Specjalistyczne"}</span>
        </div>
        <h2 className="text-2xl font-bold leading-snug text-zinc-50 md:text-3xl">{question.text}</h2>
        <div className={`grid gap-3 ${options.length === 3 ? "grid-cols-1" : "md:grid-cols-2"}`}>
          {options.map((option, optionIndex) => {
            const chosen = selected === option;
            const correct = reveal && option === question.correctAnswer;
            const wrong = reveal && chosen && !correct;
            return <Button key={option} tone={correct ? "success" : wrong ? "danger" : chosen ? "primary" : "ghost"} style={answerToneStyle(option, correct || wrong || chosen, optionIndex, options.length)} className={`justify-start text-left ${answerToneClass(option, correct || wrong || chosen, optionIndex, options.length)}`} onClick={() => onSelect(option)}>{option}</Button>;
          })}
        </div>
        {reveal && (
          <div className="rounded-card bg-surface-900 p-4 text-sm text-zinc-200">
            Poprawna odpowiedź: <span className="font-semibold text-success">{question.correctAnswer}</span>
            {question.explanation ? <p className="mt-2 text-zinc-400">{question.explanation}</p> : null}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function ExamVideoPlayer({
  question,
  phase,
  prepLeft,
  played,
  onStart,
  onEnded
}: {
  question: Question;
  phase: ExamPhase;
  prepLeft: number;
  played: boolean;
  onStart: () => void;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const backgroundVideo = backgroundVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    if (backgroundVideo) {
      backgroundVideo.pause();
      backgroundVideo.currentTime = 0;
    }
  }, [question.id]);

  useEffect(() => {
    if (phase !== "playing") return;
    const video = videoRef.current;
    const backgroundVideo = backgroundVideoRef.current;
    if (backgroundVideo && video) backgroundVideo.currentTime = video.currentTime;
    backgroundVideo?.play().catch(() => undefined);
    video?.play().catch(() => onEnded());
  }, [onEnded, phase]);

  if (!question.mediaPath) return null;

  return (
    <div className="relative h-[min(30vh,300px)] min-h-[170px] overflow-hidden rounded-card border border-zinc-700/70 bg-surface-950 shadow-lift">
      <video
        ref={backgroundVideoRef}
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-xl"
        src={question.mediaPath}
        playsInline
        muted
        preload="auto"
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-surface-950/24" />
      <video
        ref={videoRef}
        className="relative z-10 mx-auto h-full w-auto max-w-[72%] object-contain"
        src={question.mediaPath}
        playsInline
        preload="auto"
        onEnded={onEnded}
        onContextMenu={(event) => event.preventDefault()}
      />
      {phase === "prep" ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-surface-950/58 p-6 text-center backdrop-blur-[2px]">
          <div className="flex h-14 w-14 items-center justify-center rounded-card border border-accent/60 bg-surface-900 text-accent">
            <Play size={28} />
          </div>
          <div>
            <p className="text-lg font-bold text-zinc-50">Przygotowanie do filmu</p>
            <p className="mt-1 text-sm text-zinc-300">Film włączy się automatycznie za {prepLeft}s.</p>
            <p className="mt-1 text-sm font-semibold text-zinc-50 [text-shadow:0_1px_2px_rgb(0_0_0),0_0_8px_rgb(0_0_0)]">Wideo można odtworzyć tylko raz.</p>
          </div>
          <Button icon={<Play size={18} />} onClick={onStart}>Odtwórz teraz</Button>
        </div>
      ) : null}
      {phase === "answer" && played ? (
        <>
          <div className="absolute left-4 top-4 z-20 w-[6.75rem] rounded-card border border-success/70 bg-surface-950/88 px-3 py-2 text-center text-sm font-semibold text-success shadow-soft">
            Odtworzono
          </div>
          <div className="absolute bottom-4 left-4 z-20 w-[6.75rem] rounded-card border border-success/70 bg-surface-950/88 px-3 py-2 text-center text-xs font-semibold leading-snug text-success shadow-soft">
            <span className="block">Wideo nie odtwarza się ponownie</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ExamQuestionPanel({
  question,
  order,
  total,
  selected,
  canAnswer,
  phase,
  prepLeft,
  videoPlayed,
  onStartVideo,
  onVideoEnded,
  onSelect
}: {
  question: Question;
  order: number;
  total: number;
  selected?: string;
  canAnswer: boolean;
  phase: ExamPhase;
  prepLeft: number;
  videoPlayed: boolean;
  onStartVideo: () => void;
  onVideoEnded: () => void;
  onSelect: (answer: string) => void;
}) {
  const options = question.options?.length ? question.options : ["Tak", "Nie"];
  const useExamVideo = isBrowserVideo(question);

  return (
    <AnimatePresence mode="wait">
      <motion.div key={question.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.24 }} className="space-y-3">
        {useExamVideo ? (
          <ExamVideoPlayer question={question} phase={phase} prepLeft={prepLeft} played={videoPlayed} onStart={onStartVideo} onEnded={onVideoEnded} />
        ) : (
          <QuestionMedia question={question} compact />
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-full bg-surface-900 px-3 py-1 text-accent">Pytanie {order}/{total}</span>
          <span className="rounded-full bg-surface-900 px-3 py-1">{question.category}</span>
          <span className="rounded-full bg-surface-900 px-3 py-1">{question.weight} pkt</span>
          <span className="rounded-full bg-surface-900 px-3 py-1">{question.kind === "BASIC" ? "Podstawowe" : "Specjalistyczne"}</span>
        </div>
        <h2 className="text-lg font-bold leading-tight text-zinc-50 md:text-xl">{question.text}</h2>
        <div className={`grid gap-2 ${options.length === 3 ? "grid-cols-1" : "md:grid-cols-2"}`}>
          {options.map((option, optionIndex) => (
            <Button key={option} disabled={!canAnswer} tone={selected === option ? "primary" : "ghost"} style={answerToneStyle(option, selected === option, optionIndex, options.length)} className={`min-h-10 justify-start text-left ${answerToneClass(option, selected === option, optionIndex, options.length)}`} onClick={() => onSelect(option)}>
              {option}
            </Button>
          ))}
        </div>
        {!canAnswer ? (
          <div className="rounded-card bg-surface-900 px-4 py-2 text-sm text-zinc-400">
            Odpowiedź będzie aktywna po zakończeniu filmu.
          </div>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

function AuthCard({ onAuth }: { onAuth: (user: AuthUser, access: AccessState) => void }) {
  const initialResetToken = new URLSearchParams(window.location.search).get("resetPassword") ?? "";
  const [mode, setMode] = useState<"login" | "register" | "reset">(initialResetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [newPassword, setNewPassword] = useState("");
  const [name, setName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setDevLink("");
    try {
      if (mode === "reset") {
        if (resetToken) {
          const response = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ token: resetToken, password: newPassword })
          });
          const data = await response.json();
          setMessage(data?.message ?? (response.ok ? "Hasło zostało zmienione." : "Nie udało się zmienić hasła."));
          if (response.ok) {
            setMode("login");
            setPassword("");
            setNewPassword("");
            setResetToken("");
          }
          return;
        }
        const response = await fetch("/api/auth/request-password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email })
        });
        const data = await response.json();
        setMessage(data?.message ?? "Jeśli konto istnieje, wyślemy link do zmiany hasła.");
        if (data?.devLink) setDevLink(data.devLink);
        return;
      }
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(mode === "register" ? { email, password, name, acceptedTerms, acceptedPrivacy } : { email, password })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data?.message ?? "Nie udało się zalogować.");
        return;
      }
      onAuth(data.user, data.access);
      setPassword("");
    } catch {
      setMessage("Brak połączenia z serwerem.");
    } finally {
      setLoading(false);
    }
  }

  const title = mode === "login" ? "Logowanie" : mode === "register" ? "Nowe konto" : "Reset hasła";

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <UserRound className="text-accent" />
        <div>
          <h2 className="text-lg font-bold text-zinc-50">{title}</h2>
          <p className="text-sm text-zinc-400">Konto zapisuje postępy i aktywny dostęp.</p>
        </div>
      </div>
      <form className="space-y-3" onSubmit={submit}>
        {mode === "register" ? (
          <input className="w-full rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={name} onChange={(event) => setName(event.target.value)} placeholder="Imię opcjonalnie" />
        ) : null}
        <input className="w-full rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" type="email" autoComplete="email" />
        {mode === "reset" && devLink ? (
          <a className="block rounded-card border border-accent/45 bg-accent/10 px-3 py-2 text-sm text-accent hover:brightness-110" href={devLink}>
            Otwórz testowy link resetowania
          </a>
        ) : null}
        {mode === "reset" && resetToken ? (
          <input className="w-full rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nowe hasło" type="password" autoComplete="new-password" />
        ) : mode === "reset" ? null : (
          <input className="w-full rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Hasło" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />
        )}
        {mode === "register" ? (
          <div className="space-y-2 rounded-card bg-surface-900 p-3 text-xs leading-5 text-zinc-400">
            <label className="flex items-start gap-2">
              <input className="mt-1" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
              <span>Akceptuję regulamin serwisu Zdaj B.</span>
            </label>
            <label className="flex items-start gap-2">
              <input className="mt-1" type="checkbox" checked={acceptedPrivacy} onChange={(event) => setAcceptedPrivacy(event.target.checked)} />
              <span>Akceptuję politykę prywatności i przetwarzanie danych potrzebnych do obsługi konta.</span>
            </label>
          </div>
        ) : null}
        {message ? <p className="rounded-card border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p> : null}
        <Button className="w-full" disabled={loading}>{loading ? "Chwila..." : mode === "login" ? "Zaloguj się" : mode === "register" ? "Utwórz konto" : resetToken ? "Ustaw nowe hasło" : "Wyślij link"}</Button>
      </form>
      {mode === "reset" ? (
        <input className="w-full rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={resetToken} onChange={(event) => setResetToken(event.target.value)} placeholder="Token z linku resetowania" />
      ) : null}
      <Button className="w-full" tone="ghost" onClick={() => { setMode((value) => value === "login" ? "register" : "login"); setMessage(""); setDevLink(""); }}>
        {mode === "login" ? "Nie mam konta" : "Mam już konto"}
      </Button>
      {mode !== "reset" ? (
        <Button className="w-full" tone="ghost" onClick={() => { setMode("reset"); setMessage(""); setDevLink(""); }}>Nie pamiętam hasła</Button>
      ) : null}
      <div className="rounded-card bg-surface-900 p-3 text-sm text-zinc-400">
        <p className="font-semibold text-zinc-200">Konto zapisuje:</p>
        <div className="mt-2 space-y-1">
          <p>Postęp treningu</p>
          <p>Historię egzaminów</p>
          <p>Trudne pytania</p>
        </div>
      </div>
    </Card>
  );
}

function AccountCard({
  user,
  access,
  onAuth,
  onLogout,
  onPricing
}: {
  user: AuthUser | null;
  access: AccessState;
  onAuth: (user: AuthUser, access: AccessState) => void;
  onLogout: () => void;
  onPricing: () => void;
}) {
  const [activityDays, setActivityDays] = useState<Set<string>>(new Set());
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifyLink, setVerifyLink] = useState("");

  useEffect(() => {
    if (!user || (!access.hasActiveAccess && user.role !== "ADMIN")) {
      setActivityDays(new Set());
      return;
    }
    fetch("/api/progress", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        const nextDays = new Set<string>();
        if (Array.isArray(data?.attempts)) {
          data.attempts.forEach((attempt: any) => {
            const date = new Date(attempt.finishedAt ?? attempt.startedAt);
            if (!Number.isNaN(date.getTime())) nextDays.add(date.toISOString().slice(0, 10));
          });
        }
        setActivityDays(nextDays);
      })
      .catch(() => setActivityDays(new Set()));
  }, [access.hasActiveAccess, user]);

  if (!user) return <AuthCard onAuth={onAuth} />;

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthOffset = (monthStart.getDay() + 6) % 7;
  const activityCells = [
    ...Array.from({ length: monthOffset }, (_, index) => ({ key: `empty-${index}`, dateKey: "", day: "" })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), index + 1);
      return { key: date.toISOString(), dateKey: date.toISOString().slice(0, 10), day: String(index + 1) };
    })
  ];
  const monthLabel = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(today);

  async function requestVerification() {
    setVerifyMessage("");
    setVerifyLink("");
    const response = await fetch("/api/auth/request-email-verification", { method: "POST", credentials: "include" }).catch(() => null);
    if (!response) return setVerifyMessage("Brak połączenia z serwerem.");
    const data = await response.json().catch(() => null);
    if (!response.ok) return setVerifyMessage(data?.message ?? "Nie udało się wysłać linku.");
    setVerifyMessage(data?.sent ? "Link potwierdzający został wysłany." : "Nie udało się wysłać wiadomości. Spróbuj ponownie później.");
    if (data?.devLink) setVerifyLink(data.devLink);
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-accent/50 bg-surface-900 text-accent">
          <UserRound size={20} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-zinc-50">Konto</h2>
          <p className="truncate text-sm text-zinc-400">{user.email}</p>
        </div>
      </div>
      <div className={`rounded-card border p-3 ${access.hasActiveAccess ? "border-success/60 bg-success/10" : "border-zinc-600/60 bg-surface-900"}`}>
        <p className={`text-sm font-semibold ${access.hasActiveAccess ? "text-success" : "text-zinc-200"}`}>
          {access.hasActiveAccess ? "Dostęp aktywny" : "Tryb bezpłatny"}
        </p>
        <p className="mt-1 text-xs text-zinc-400">{access.hasActiveAccess ? `Ważny do: ${formatAccessDate(access.expiresAt)}` : "Darmowy trening ma limit dzienny. Egzamin i powtórki są w planie płatnym."}</p>
      </div>
      {!user.emailVerifiedAt ? (
        <div className="rounded-card border border-accent/40 bg-accent/10 p-3">
          <p className="text-sm font-semibold text-accent">E-mail niepotwierdzony</p>
          <p className="mt-1 text-xs text-zinc-400">Potwierdzenie ułatwia odzyskanie konta i obsługę płatności.</p>
          <Button className="mt-3 w-full" tone="ghost" onClick={requestVerification}>Wyślij link</Button>
          {verifyMessage ? <p className="mt-2 text-xs text-zinc-300">{verifyMessage}</p> : null}
          {verifyLink ? <a className="mt-2 block text-xs font-semibold text-accent hover:brightness-110" href={verifyLink}>Otwórz link testowy</a> : null}
        </div>
      ) : null}
      {!access.hasActiveAccess ? <Button className="w-full" icon={<CreditCard size={17} />} onClick={onPricing}>Zobacz cennik</Button> : null}
      <div className="space-y-3 rounded-card bg-surface-900 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-100">Aktywność egzaminów</p>
            <p className="text-xs text-zinc-500">{monthLabel}</p>
          </div>
          <span className="rounded-full border border-success/45 px-2 py-1 text-xs text-success">{activityDays.size}</span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-zinc-500">
          {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((day) => <span key={day}>{day}</span>)}
          {activityCells.map((cell) => (
            <div
              key={cell.key}
              className={`flex aspect-square items-center justify-center rounded-[5px] border text-[10px] ${cell.day ? activityDays.has(cell.dateKey) ? "border-success/60 bg-success/45 text-zinc-50" : "border-zinc-700/60 bg-surface-800 text-zinc-500" : "border-transparent"}`}
              title={cell.dateKey}
            >
              {cell.day}
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-500">Zielony dzień oznacza zapisany egzamin.</p>
      </div>
      <Button className="w-full" tone="ghost" icon={<LogOut size={17} />} onClick={onLogout}>Wyloguj</Button>
    </Card>
  );
}

function PricingView({
  plans,
  user,
  access,
  onNeedAuth,
  onCheckout,
  checkoutMessage,
  checkoutLoading
}: {
  plans: Plan[];
  user: AuthUser | null;
  access: AccessState;
  onNeedAuth: () => void;
  onCheckout: (planCode: string) => void;
  checkoutMessage: string;
  checkoutLoading: string | null;
}) {
  return (
    <Card className="space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-400">Pełny dostęp bez subskrypcji</p>
        <h2 className="text-3xl font-extrabold text-zinc-50">Cennik</h2>
        <p className="max-w-2xl text-sm leading-6 text-zinc-400">Płacisz raz i korzystasz przez wybrany czas. Darmowy trening ma limit 30 pytań dziennie, a pełny dostęp odblokowuje naukę bez limitu, egzamin, trudne pytania i zapis postępów.</p>
      </div>
      <div className="rounded-card border border-zinc-700/70 bg-surface-900 p-4">
        <p className="font-semibold text-zinc-100">Co daje pełny dostęp?</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {[
            ["Aktualna baza kat. B", "Pytania przygotowane pod naukę teorii, aktualne na lipiec 2026."],
            ["Statystyki i historia", "Wyniki egzaminów, postęp nauki, błędy i tematy do powtórki."],
            ["Wygodny trening", "Czysty interfejs, filmy w treningu, szybkie odpowiedzi i mniej rozpraszaczy."],
            ["Niska cena", "Jednorazowy dostęp na wybrany czas, bez automatycznej subskrypcji."]
          ].map(([title, text]) => (
            <div key={title} className="border-l border-accent/45 pl-3">
              <p className="text-sm font-semibold text-zinc-100">{title}</p>
              <p className="mt-1 text-sm leading-5 text-zinc-400">{text}</p>
            </div>
          ))}
        </div>
      </div>
      {access.hasActiveAccess ? (
        <div className="rounded-card border border-success/60 bg-success/10 p-4 text-success">
          Dostęp aktywny do {formatAccessDate(access.expiresAt)}.
        </div>
      ) : null}
      {checkoutMessage ? (
        <div className="rounded-card border border-accent/50 bg-accent/10 p-4 text-sm text-accent">
          {checkoutMessage}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <div key={plan.code} className={`relative rounded-card border p-4 ${plan.featured ? "border-accent bg-surface-850 shadow-lift" : "border-zinc-600/60 bg-surface-900"}`}>
            {plan.featured ? <div className="mb-3 inline-flex rounded-full bg-accent px-3 py-1 text-xs font-bold text-surface-950">Najczęściej wybierany</div> : null}
            <h3 className="text-lg font-bold text-zinc-50">{planCardName(plan.name)}</h3>
            <p className="mt-3 text-3xl font-extrabold text-zinc-50">{formatPrice(plan.amount, plan.currency)}</p>
            <Button className="mt-5 w-full" disabled={access.hasActiveAccess || checkoutLoading === plan.code} onClick={user ? () => onCheckout(plan.code) : onNeedAuth}>
              {access.hasActiveAccess ? "Aktywny dostęp" : checkoutLoading === plan.code ? "Przekierowanie..." : user ? "Kup dostęp" : "Zaloguj się"}
            </Button>
          </div>
        ))}
      </div>
      <div className="rounded-card bg-surface-900 p-4 text-sm text-zinc-400">
        Płatność jest jednorazowa. Po potwierdzeniu płatności Stripe dostęp zostanie aktywowany automatycznie.
      </div>
    </Card>
  );
}

function AccountView({
  user,
  access,
  plans,
  onAuth,
  onLogout,
  onSelect
}: {
  user: AuthUser | null;
  access: AccessState;
  plans: Plan[];
  onAuth: (user: AuthUser, access: AccessState) => void;
  onLogout: () => void;
  onSelect: (view: View) => void;
}) {
  const [overview, setOverview] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [verifyLink, setVerifyLink] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(7);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [dailyResetLabel, setDailyResetLabel] = useState(() => timeUntilDailyReset());

  const hasFullAccess = Boolean(access.hasActiveAccess || user?.role === "ADMIN");
  const currentPlan = user?.role === "ADMIN" && !access.hasActiveAccess ? "Dostęp administratora" : planName(access.planCode, plans);
  const recentExamCount = overview?.examAttempts?.length ?? 0;
  const difficultCount = overview?.difficultCount ?? 0;
  const accountTrainingKey = `zdajb-training-answers-${todayKey()}-${user?.id ?? "guest"}`;
  const accountFreeAnswersToday = Number(typeof window !== "undefined" ? window.localStorage.getItem(accountTrainingKey) ?? 0 : 0) || 0;
  const accountFreeRemaining = Math.max(0, freeTrainingDailyLimit - accountFreeAnswersToday);

  useEffect(() => {
    if (!user) {
      setOverview(null);
      return;
    }
    fetch("/api/account", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => setOverview(data))
      .catch(() => setOverview(null));
  }, [user, access.hasActiveAccess, access.expiresAt]);

  useEffect(() => {
    const updateResetLabel = () => setDailyResetLabel(timeUntilDailyReset());
    updateResetLabel();
    const intervalId = window.setInterval(updateResetLabel, 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!deleteModalOpen) return;
    setDeleteCountdown(7);
    const intervalId = window.setInterval(() => {
      setDeleteCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [deleteModalOpen]);

  async function requestVerification() {
    setMessage("");
    setVerifyLink("");
    const response = await fetch("/api/auth/request-email-verification", { method: "POST", credentials: "include" }).catch(() => null);
    if (!response) return setMessage("Brak połączenia z serwerem.");
    const data = await response.json().catch(() => null);
    if (!response.ok) return setMessage(data?.message ?? "Nie udało się wysłać linku.");
    setMessage(data?.sent ? "Link potwierdzający został wysłany." : "Nie udało się wysłać wiadomości. Spróbuj ponownie później.");
    if (data?.devLink) setVerifyLink(data.devLink);
  }

  async function changePassword(event: { preventDefault: () => void }) {
    event.preventDefault();
    setPasswordMessage(null);
    if (!currentPassword || newPassword.length < 8) {
      setPasswordMessage({ tone: "danger", text: "Wpisz obecne hasło i nowe hasło min. 8 znaków." });
      return;
    }
    const response = await fetch("/api/account/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ currentPassword, newPassword })
    }).catch(() => null);
    if (!response) return setPasswordMessage({ tone: "danger", text: "Brak połączenia z serwerem." });
    const data = await response.json().catch(() => null);
    setPasswordMessage({
      tone: response.ok ? "success" : "danger",
      text: data?.message ?? (response.ok ? "Hasło zostało zmienione." : "Nie udało się zmienić hasła.")
    });
    if (response.ok) {
      setCurrentPassword("");
      setNewPassword("");
    }
  }

  function exportAccountData() {
    window.location.href = "/api/account/export";
  }

  function openDeleteModal() {
    setMessage("");
    if (!deleteConfirm || !deletePassword) return;
    setDeleteModalOpen(true);
  }

  async function deleteAccount() {
    setMessage("");
    setDeleteLoading(true);
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password: deletePassword })
    }).catch(() => null);
    if (!response) {
      setDeleteLoading(false);
      setDeleteModalOpen(false);
      return setMessage("Brak połączenia z serwerem.");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setDeleteLoading(false);
      setDeleteModalOpen(false);
      return setMessage(data?.message ?? "Nie udało się usunąć konta.");
    }
    onLogout();
  }

  if (!user) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="space-y-5">
          <div>
            <p className="text-sm text-zinc-400">Konto Zdaj B</p>
            <h2 className="mt-2 text-3xl font-extrabold text-zinc-50">Zaloguj się albo utwórz konto</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Konto zapisuje postęp treningu, historię egzaminów, trudne pytania oraz aktywny dostęp premium.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-card bg-surface-900 p-4"><p className="font-semibold text-zinc-100">Postęp</p><p className="mt-2 text-sm text-zinc-400">Wyniki i błędy przypisane do konta.</p></div>
            <div className="rounded-card bg-surface-900 p-4"><p className="font-semibold text-zinc-100">Dostęp</p><p className="mt-2 text-sm text-zinc-400">Jedno miejsce dla planu i terminu ważności.</p></div>
            <div className="rounded-card bg-surface-900 p-4"><p className="font-semibold text-zinc-100">Płatności</p><p className="mt-2 text-sm text-zinc-400">Historia zakupów i aktywnego dostępu.</p></div>
          </div>
        </Card>
        <AuthCard onAuth={onAuth} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm text-zinc-400">Panel użytkownika</p>
            <h2 className="mt-2 text-3xl font-extrabold text-zinc-50">Konto</h2>
            <p className="mt-2 text-sm text-zinc-400">{user.email}</p>
          </div>
          <Button tone="ghost" icon={<LogOut size={17} />} onClick={onLogout}>Wyloguj</Button>
        </div>

        {message ? <div className="rounded-card border border-accent/45 bg-accent/10 px-4 py-3 text-sm text-accent">{message}</div> : null}
        {verifyLink ? <a className="block rounded-card border border-accent/45 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent hover:brightness-110" href={verifyLink}>Otwórz link testowy</a> : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className={`rounded-card border p-4 ${user.emailVerifiedAt ? "border-success/45 bg-success/10" : "border-accent/45 bg-accent/10"}`}>
            <p className="text-sm text-zinc-400">E-mail</p>
            <p className={user.emailVerifiedAt ? "mt-2 font-bold text-success" : "mt-2 font-bold text-accent"}>{user.emailVerifiedAt ? "Potwierdzony" : "Wymaga potwierdzenia"}</p>
            <p className="mt-1 text-xs text-zinc-400">{user.emailVerifiedAt ? "Adres jest gotowy do odzyskiwania konta i obsługi płatności." : "Potwierdź adres, aby łatwiej odzyskać konto."}</p>
            {!user.emailVerifiedAt ? <Button className="mt-4 w-full" tone="ghost" onClick={requestVerification}>Wyślij link</Button> : null}
          </div>
          <div className={`rounded-card border p-4 ${hasFullAccess ? "border-success/55 bg-success/10" : "border-zinc-700/70 bg-surface-900"}`}>
            <p className="text-sm text-zinc-400">Dostęp</p>
            <p className={hasFullAccess ? "mt-2 font-bold text-success" : "mt-2 font-bold text-zinc-50"}>{hasFullAccess ? currentPlan : "Tryb bezpłatny"}</p>
            <p className="mt-1 text-xs text-zinc-400">{access.hasActiveAccess ? `Ważny do ${formatAccessDate(access.expiresAt)}` : user.role === "ADMIN" ? "Rola administratora odblokowuje funkcje premium." : "30 pytań dziennie bez opłaty. Egzamin i powtórki w premium."}</p>
          </div>
          <div className="rounded-card bg-surface-900 p-4">
            <p className="text-sm text-zinc-400">Ostatnie logowanie</p>
            <p className="mt-2 font-bold text-zinc-50">{formatAccessDate(user.lastLoginAt)}</p>
            <p className="mt-1 text-xs text-zinc-500">Konto utworzone: {formatAccessDate(user.createdAt)}</p>
          </div>
        </div>

        <div className="rounded-card border border-accent/35 bg-surface-900 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-zinc-400">Subskrypcja i cennik</p>
              <h3 className="mt-1 text-xl font-bold text-zinc-50">{hasFullAccess ? currentPlan : "Pełny dostęp"}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                {access.hasActiveAccess
                  ? `Masz odblokowane egzaminy, trening bez limitu, trudne pytania i statystyki do ${formatAccessDate(access.expiresAt)}.`
                  : user.role === "ADMIN"
                  ? "Konto administratora ma dostęp do egzaminów, treningu bez limitu, trudnych pytań i statystyk bez kupowania pakietu."
                  : "Pełny dostęp odblokowuje trening bez dziennego limitu, egzamin, trudne pytania, historię wyników i statystyki. Dostęp kupujesz na wybrany czas, bez automatycznego odnawiania."}
              </p>
            </div>
            <Button icon={<CreditCard size={18} />} onClick={() => onSelect("pricing")}>{access.hasActiveAccess ? "Przedłuż dostęp" : "Zobacz cennik"}</Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-card bg-surface-900 p-4">
            <h3 className="font-bold text-zinc-50">Dzienny limit treningu</h3>
            <div className={`mt-3 rounded-card border px-4 py-4 ${hasFullAccess ? "border-success/45 bg-success/10" : "border-accent/35 bg-accent/10"}`}>
              <p className="text-sm text-zinc-400">{hasFullAccess ? "Pełny dostęp" : "Darmowy trening"}</p>
              <p className={`mt-2 text-2xl font-extrabold ${hasFullAccess ? "text-success" : "text-accent"}`}>
                {hasFullAccess ? "Trening bez limitu" : `Dziś zostało ${accountFreeRemaining}/${freeTrainingDailyLimit} pytań`}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {hasFullAccess ? "Możesz ćwiczyć dowolną liczbę pytań i wracać do nauki bez dziennego ograniczenia." : "Po wykorzystaniu limitu możesz wrócić jutro albo odblokować pełny dostęp."}
              </p>
              {!hasFullAccess ? (
                <div className="mt-3 rounded-card border border-accent/30 bg-surface-950/35 px-3 py-2 text-sm text-zinc-300">
                  Reset limitu za <span className="font-semibold text-accent">{dailyResetLabel}</span>.
                </div>
              ) : null}
            </div>
            <Button className="mt-3 w-full" icon={<Play size={17} />} onClick={() => onSelect("training")}>Rozpocznij trening</Button>
          </div>
          <div className="rounded-card bg-surface-900 p-4">
            <h3 className="font-bold text-zinc-50">Szybkie przejścia</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button tone="ghost" icon={<Play size={17} />} onClick={() => onSelect("training")}>Trening</Button>
              <Button tone="ghost" icon={<TimerReset size={17} />} onClick={() => onSelect("exam")}>Egzamin</Button>
              <Button tone="ghost" icon={<Star size={17} />} onClick={() => onSelect("difficult")}>Trudne</Button>
              <Button tone="ghost" icon={<BarChart3 size={17} />} onClick={() => onSelect("stats")}>Warunki</Button>
            </div>
            <div className="mt-4 rounded-card bg-surface-800 px-3 py-3 text-sm text-zinc-400">
              <p>Ostatnie egzaminy na koncie: <span className="font-semibold text-zinc-100">{recentExamCount}</span></p>
              <p className="mt-1">Trudne pytania: <span className="font-semibold text-zinc-100">{difficultCount}</span></p>
            </div>
            <div className="mt-3 rounded-card border border-zinc-700/70 bg-surface-800 px-3 py-3 text-sm text-zinc-400">
              <p className="font-semibold text-zinc-100">Pełny dostęp obejmuje:</p>
              <p className="mt-1">trening bez limitu, egzamin z timerem, powtórki trudnych pytań, historię wyników i statystyki gotowości.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-card bg-surface-900 p-4">
            <div className="space-y-2">
              <p className="font-semibold text-zinc-100">Płatności</p>
              <div className="mt-3 space-y-2">
                {overview?.payments?.length ? overview.payments.map((payment: any) => (
                  <div key={payment.id} className="flex items-center justify-between gap-3 rounded-card bg-surface-800 px-3 py-2 text-sm">
                    <div>
                      <p className="font-semibold text-zinc-100">{planName(payment.planCode, plans)}</p>
                      <p className="text-xs text-zinc-500">{formatAccessDate(payment.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-zinc-100">{formatPrice(payment.amount, payment.currency)}</p>
                      <p className={`text-xs ${paymentStatusClass(payment.status)}`}>{paymentStatusLabel(payment.status)}</p>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-card bg-surface-800 px-3 py-3 text-sm text-zinc-400">
                    <p>Nie masz jeszcze zapisanych płatności.</p>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 border-t border-zinc-800/80 pt-4">
              <p className="font-semibold text-zinc-100">Dostępy</p>
              <div className="mt-3 space-y-2">
                {overview?.accessGrants?.length ? overview.accessGrants.map((grant: any) => (
                  <div key={grant.id} className="rounded-card bg-surface-800 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-zinc-100">{planName(grant.planCode, plans)}</p>
                      <span className={grant.cancelledAt ? "text-danger" : new Date(grant.expiresAt).getTime() > Date.now() ? "text-success" : "text-zinc-500"}>
                        {grant.cancelledAt ? "anulowany" : new Date(grant.expiresAt).getTime() > Date.now() ? "aktywny" : "wygasł"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{accessSourceLabel(grant.source)} · do {formatAccessDate(grant.expiresAt)}</p>
                  </div>
                )) : (
                  <div className="rounded-card bg-surface-800 px-3 py-3 text-sm text-zinc-400">
                    <p>Historia dostępu pojawi się po zakupie pakietu lub nadaniu dostępu przez obsługę.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-card bg-surface-900 p-4">
            <h3 className="font-bold text-zinc-50">Bezpieczeństwo i dane konta</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Zarządzaj hasłem, pobierz kopię danych albo usuń konto z jednego miejsca.</p>

            <form className="mt-4 rounded-card border border-zinc-700/70 bg-surface-800/70 p-4" onSubmit={changePassword}>
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-zinc-100">Zmiana hasła</p>
                <span className="rounded-full border border-zinc-600/70 px-2.5 py-1 text-xs font-semibold text-zinc-400">bezpieczeństwo</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-zinc-400">Po zmianie hasła pozostałe sesje na innych urządzeniach zostaną zakończone.</p>
              <div className="mt-3 space-y-3">
                <input className="w-full rounded-button border border-zinc-600/60 bg-surface-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Obecne hasło" type="password" autoComplete="current-password" />
                <input className="w-full rounded-button border border-zinc-600/60 bg-surface-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nowe hasło" type="password" autoComplete="new-password" />
                {passwordMessage ? (
                  <p className={`rounded-card border px-3 py-2 text-sm ${passwordMessage.tone === "success" ? "border-success/45 bg-success/10 text-success" : "border-danger/45 bg-danger/10 text-danger"}`}>
                    {passwordMessage.text}
                  </p>
                ) : null}
                <Button className="w-full" tone="ghost" type="submit" disabled={!currentPassword || newPassword.length < 8}>Zmień hasło</Button>
              </div>
            </form>

            <div className="mt-3 rounded-card border border-zinc-700/70 bg-surface-800/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-zinc-100">Dane konta</p>
                <span className="rounded-full border border-zinc-600/70 px-2.5 py-1 text-xs font-semibold text-zinc-400">eksport</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-zinc-400">Pobierz kopię danych zapisanych na koncie: profil, postępy, podejścia, płatności i trudne pytania.</p>
              <Button className="mt-3 w-full" tone="ghost" icon={<Download size={17} />} onClick={exportAccountData}>Pobierz moje dane</Button>
            </div>

            <div className="mt-3 rounded-card border border-danger/45 bg-danger/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-zinc-50">Usunięcie konta</p>
                <span className="rounded-full border border-danger/60 px-2.5 py-1 text-xs font-semibold text-danger">trwałe</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-zinc-300">Usunięcie konta jest trwałe. Znikną sesje, trudne pytania, postępy i historia przypisana do konta.</p>
              <div className="mt-3 space-y-3">
                <label className="flex items-start gap-2 text-sm text-zinc-300">
                  <input className="mt-1" type="checkbox" checked={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.checked)} />
                  <span>Rozumiem, że tej operacji nie można cofnąć.</span>
                </label>
                <input className="w-full rounded-button border border-danger/50 bg-surface-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-danger" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Hasło do konta" type="password" autoComplete="current-password" />
                <Button className="w-full" tone="danger" type="button" disabled={!deleteConfirm || !deletePassword} onClick={openDeleteModal}>Usuń konto</Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
      {deleteModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-panel border border-danger/60 bg-surface-800 p-6 shadow-lift">
            <div className="flex h-12 w-12 items-center justify-center rounded-card border border-danger/60 bg-danger/10 text-danger">
              <Trash2 size={25} />
            </div>
            <h2 className="mt-4 text-2xl font-extrabold text-zinc-50">Potwierdź usunięcie konta</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Ta operacja jest trwała. Konto, zapisane postępy, trudne pytania, historia egzaminów i dane powiązane z kontem zostaną usunięte.
            </p>
            <div className="mt-4 rounded-card border border-danger/45 bg-danger/10 px-4 py-3 text-sm text-zinc-200">
              {deleteCountdown > 0 ? (
                <span>Przycisk potwierdzenia będzie aktywny za <span className="font-bold text-danger">{deleteCountdown}s</span>.</span>
              ) : (
                <span className="font-semibold text-danger">Możesz teraz potwierdzić usunięcie konta.</span>
              )}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button tone="ghost" type="button" disabled={deleteLoading} onClick={() => setDeleteModalOpen(false)}>Anuluj</Button>
              <Button tone="danger" type="button" disabled={deleteCountdown > 0 || deleteLoading} onClick={deleteAccount}>
                {deleteLoading ? "Usuwanie..." : "Usuń konto"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PaywallCard({ title, text, onPricing, onTraining }: { title: string; text: string; onPricing: () => void; onTraining: () => void }) {
  return (
    <Card className="space-y-5">
      <div className="flex h-14 w-14 items-center justify-center rounded-card border border-accent/60 bg-surface-900 text-accent">
        <Lock size={28} />
      </div>
      <div>
        <p className="text-sm text-zinc-400">Funkcja premium</p>
        <h2 className="mt-2 text-3xl font-extrabold text-zinc-50">{title}</h2>
        <p className="mt-3 max-w-2xl text-zinc-400">{text}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button icon={<CreditCard size={18} />} onClick={onPricing}>Zobacz cennik</Button>
        <Button tone="ghost" icon={<Play size={18} />} onClick={onTraining}>Przejdź do treningu</Button>
      </div>
    </Card>
  );
}

function AdminView({ currentUser, plans, onPlansChange, onSelfSessionsCleared }: { currentUser: AuthUser; plans: Plan[]; onPlansChange: (plans: Plan[]) => void; onSelfSessionsCleared: () => void }) {
  const [summary, setSummary] = useState<{ users: number; admins: number; activeAccess: number; payments: number; attempts: number } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [historyModal, setHistoryModal] = useState<"access" | "attempts" | "payments" | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [adminPlans, setAdminPlans] = useState<Plan[]>(plans);

  const loadAdmin = useCallback(async () => {
    const [summaryResponse, usersResponse, plansResponse] = await Promise.all([
      fetch("/api/admin/summary", { credentials: "include" }),
      fetch(`/api/admin/users?q=${encodeURIComponent(query)}`, { credentials: "include" }),
      fetch("/api/admin/plans", { credentials: "include" })
    ]);
    if (!summaryResponse.ok || !usersResponse.ok || !plansResponse.ok) {
      setMessage("Brak dostępu do panelu administratora.");
      return;
    }
    const nextSummary = await summaryResponse.json();
    const nextUsers = await usersResponse.json();
    const nextPlans = await plansResponse.json();
    setSummary(nextSummary);
    setUsers(Array.isArray(nextUsers) ? nextUsers : []);
    setAdminPlans(Array.isArray(nextPlans) ? nextPlans : []);
    onPlansChange(Array.isArray(nextPlans) ? nextPlans.filter((plan) => plan.active !== false) : []);
  }, [onPlansChange, query]);

  const loadSelectedUser = useCallback(async (userId: string) => {
    const response = await fetch(`/api/admin/users/${userId}`, { credentials: "include" });
    if (!response.ok) return;
    setSelectedUser(await response.json());
    setSelectedUserId(userId);
  }, []);

  useEffect(() => { loadAdmin(); }, [loadAdmin]);

  async function updateUser(userId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setMessage(data?.message ?? "Nie udało się zapisać użytkownika.");
      return;
    }
    setMessage("Zapisano użytkownika.");
    await loadAdmin();
    await loadSelectedUser(userId);
  }

  async function grantAccess(userId: string, planCode: string) {
    const response = await fetch(`/api/admin/users/${userId}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ planCode })
    });
    if (!response.ok) return setMessage("Nie udało się wydać dostępu.");
    setMessage("Dostęp został wydany.");
    await loadSelectedUser(userId);
    await loadAdmin();
  }

  async function cancelAccess(userId: string, grantId: string) {
    const response = await fetch(`/api/admin/users/${userId}/access/${grantId}`, {
      method: "DELETE",
      credentials: "include"
    });
    if (!response.ok) return setMessage("Nie udało się anulować dostępu.");
    setMessage("Dostęp został anulowany.");
    await loadSelectedUser(userId);
    await loadAdmin();
  }

  async function clearSessions(userId: string) {
    await fetch(`/api/admin/users/${userId}/sessions`, { method: "DELETE", credentials: "include" });
    if (userId === currentUser.id) {
      onSelfSessionsCleared();
      return;
    }
    setMessage("Sesje użytkownika zostały zakończone.");
    await loadSelectedUser(userId);
  }

  async function updatePlan(code: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/admin/plans/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch)
    });
    if (!response.ok) return setMessage("Nie udało się zapisać cennika.");
    setMessage("Cennik zapisany.");
    await loadAdmin();
  }

  const historyTitle =
    historyModal === "access" ? "Historia dostępów" :
    historyModal === "attempts" ? "Historia egzaminów" :
    historyModal === "payments" ? "Historia płatności" : "";

  function renderHistoryItems() {
    if (!selectedUser || !historyModal) return null;
    if (historyModal === "access") {
      const grants = selectedUser.user.accessGrants ?? [];
      return grants.length ? grants.map((grant: any) => (
        <div key={grant.id} className="rounded-card border border-zinc-700/70 bg-surface-900 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className={grant.cancelledAt ? "font-semibold text-zinc-500 line-through" : "font-semibold text-zinc-50"}>{planName(grant.planCode, adminPlans)}</p>
              <p className="mt-1 text-sm text-zinc-400">Ważny do {formatAccessDate(grant.expiresAt)} · {accessSourceLabel(grant.source)}</p>
              {grant.cancelledAt ? <p className="mt-1 text-sm text-danger">Anulowano: {formatAccessDate(grant.cancelledAt)}</p> : null}
            </div>
            {!grant.cancelledAt && new Date(grant.expiresAt).getTime() > Date.now() ? (
              <Button tone="danger" onClick={() => cancelAccess(selectedUser.user.id, grant.id)}>Anuluj dostęp</Button>
            ) : (
              <span className="rounded-full border border-zinc-600/60 px-3 py-1 text-xs text-zinc-400">Zamknięty</span>
            )}
          </div>
        </div>
      )) : <div className="rounded-card bg-surface-900 p-4 text-zinc-400">Brak historii dostępów.</div>;
    }
    if (historyModal === "attempts") {
      const attempts = selectedUser.user.attempts ?? [];
      return attempts.length ? attempts.map((attempt: any) => (
        <div key={attempt.id} className="flex items-center justify-between gap-3 rounded-card border border-zinc-700/70 bg-surface-900 p-4">
          <div>
            <p className="font-semibold text-zinc-50">{formatAccessDate(attempt.finishedAt ?? attempt.startedAt)}</p>
            <p className="mt-1 text-sm text-zinc-400">{attempt.mode} · {attempt.passed ? "zdany" : "niezdany"}</p>
          </div>
          <div className={attempt.passed ? "text-2xl font-extrabold text-success" : "text-2xl font-extrabold text-danger"}>{attempt.score}/74</div>
        </div>
      )) : <div className="rounded-card bg-surface-900 p-4 text-zinc-400">Brak zapisanych egzaminów.</div>;
    }
    const payments = selectedUser.user.payments ?? [];
    return payments.length ? payments.map((payment: any) => (
      <div key={payment.id} className="flex items-center justify-between gap-3 rounded-card border border-zinc-700/70 bg-surface-900 p-4">
        <div>
          <p className="font-semibold text-zinc-50">{planName(payment.planCode, adminPlans)} · {formatPrice(payment.amount, payment.currency)}</p>
          <p className="mt-1 text-sm text-zinc-400">{payment.provider === "stripe" ? "Stripe" : payment.provider} · {formatAccessDate(payment.createdAt)}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${payment.status === "paid" ? "border-success/60 text-success" : payment.status === "failed" || payment.status === "expired" ? "border-danger/60 text-danger" : "border-zinc-600/60 text-zinc-300"}`}>{paymentStatusLabel(payment.status)}</span>
      </div>
    )) : <div className="rounded-card bg-surface-900 p-4 text-zinc-400">Brak płatności.</div>;
  }

  return (
    <Card className="space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-400">Panel właściciela</p>
        <h2 className="text-3xl font-extrabold text-zinc-50">Administracja</h2>
      </div>
      {message ? <div className="rounded-card border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-accent">{message}</div> : null}
      {summary ? (
        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["Użytkownicy", summary.users],
            ["Admini", summary.admins],
            ["Aktywne dostępy", summary.activeAccess],
            ["Płatności", summary.payments],
            ["Podejścia", summary.attempts]
          ].map(([label, value]) => (
            <div key={label} className="rounded-card bg-surface-900 p-3">
              <p className="text-xs text-zinc-400">{label}</p>
              <p className="mt-1 text-2xl font-bold text-zinc-50">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-card bg-surface-900 px-3 py-2">
            <Search size={18} className="text-zinc-500" />
            <input className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj użytkownika" />
            <Button className="min-h-9 px-3 py-1" onClick={loadAdmin}>Szukaj</Button>
          </div>
          <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
            {users.map((item) => (
              <button key={item.id} className={`w-full rounded-card p-3 text-left text-sm transition ${selectedUserId === item.id ? "bg-accent text-surface-950" : "bg-surface-900 text-zinc-200 hover:bg-surface-850"}`} onClick={() => loadSelectedUser(item.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{item.email}</span>
                  <span>{item.role}</span>
                </div>
                <p className={`mt-2 text-xs ${selectedUserId === item.id ? "text-surface-800" : "text-zinc-500"}`}>Sesje: {item.counts.sessions} · Dostępy: {item.counts.accessGrants} · Egzaminy: {item.counts.attempts}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {selectedUser ? (
            <div className="space-y-4 rounded-card bg-surface-900 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-zinc-50">{selectedUser.user.email}</h3>
                  <p className="text-sm text-zinc-400">Utworzono: {formatAccessDate(selectedUser.user.createdAt)} · Ostatnio: {formatAccessDate(selectedUser.user.lastLoginAt)}</p>
                </div>
                <div className={selectedUser.activeAccess.hasActiveAccess ? "text-success" : "text-zinc-400"}>{selectedUser.activeAccess.hasActiveAccess ? `Dostęp do ${formatAccessDate(selectedUser.activeAccess.expiresAt)}` : "Brak aktywnego dostępu"}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <input className="rounded-button border border-zinc-600/60 bg-surface-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" defaultValue={selectedUser.user.email} onBlur={(event) => updateUser(selectedUser.user.id, { email: event.target.value })} />
                <input className="rounded-button border border-zinc-600/60 bg-surface-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" defaultValue={selectedUser.user.name ?? ""} placeholder="Imię" onBlur={(event) => updateUser(selectedUser.user.id, { name: event.target.value })} />
                <select className="rounded-button border border-zinc-600/60 bg-surface-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" value={selectedUser.user.role} onChange={(event) => updateUser(selectedUser.user.id, { role: event.target.value })}>
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {adminPlans.filter((plan) => plan.active !== false).map((plan) => (
                    <Button key={plan.code} tone="ghost" onClick={() => grantAccess(selectedUser.user.id, plan.code)}>Daj {plan.name}</Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button tone="danger" onClick={() => clearSessions(selectedUser.user.id)}>Wyloguj ze wszystkich urządzeń</Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { id: "access" as const, label: "Dostępy", value: selectedUser.user.accessGrants?.length ?? 0, detail: selectedUser.activeAccess.hasActiveAccess ? "aktywny dostęp" : "brak aktywnego" },
                  { id: "attempts" as const, label: "Egzaminy", value: selectedUser.user.attempts?.length ?? 0, detail: "historia wyników" },
                  { id: "payments" as const, label: "Płatności", value: selectedUser.user.payments?.length ?? 0, detail: "transakcje" }
                ].map((item) => (
                  <button
                    key={item.id}
                    className="group rounded-card border border-zinc-700/70 bg-surface-800 p-4 text-left transition hover:border-accent/70 hover:bg-surface-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                    onClick={() => setHistoryModal(item.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-zinc-400">{item.label}</p>
                        <p className="mt-2 text-3xl font-extrabold text-zinc-50">{item.value}</p>
                        <p className="mt-1 text-xs text-zinc-500">{item.detail}</p>
                      </div>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/55 bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-surface-950">
                        <ExternalLink size={17} />
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-semibold text-accent">Otwórz historię</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-card bg-surface-900 p-4 text-zinc-400">Wybierz użytkownika z listy.</div>
          )}

          <div className="space-y-3 rounded-card bg-surface-900 p-4">
            <h3 className="text-xl font-bold text-zinc-50">Cennik</h3>
            <div className="space-y-3">
              {adminPlans.map((plan) => (
                <div key={plan.code} className="grid gap-2 rounded-card bg-surface-800 p-3 md:grid-cols-[1fr_90px_110px_90px_90px]">
                  <input className="rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" defaultValue={plan.name} onBlur={(event) => updatePlan(plan.code, { name: event.target.value })} />
                  <input className="rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" defaultValue={plan.days} type="number" onBlur={(event) => updatePlan(plan.code, { days: Number(event.target.value) })} />
                  <input className="rounded-button border border-zinc-600/60 bg-surface-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent" defaultValue={plan.amount} type="number" onBlur={(event) => updatePlan(plan.code, { amount: Number(event.target.value) })} />
                  <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" defaultChecked={plan.featured} onChange={(event) => updatePlan(plan.code, { featured: event.target.checked })} /> Top</label>
                  <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" defaultChecked={plan.active !== false} onChange={(event) => updatePlan(plan.code, { active: event.target.checked })} /> Aktywny</label>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500">Cena jest zapisywana w groszach: 1000 = 10 zł. Te same wartości trafią potem do Stripe Checkout.</p>
          </div>
        </div>
      </div>
      {historyModal && selectedUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-panel border border-zinc-700/70 bg-surface-800 shadow-lift">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-700/70 p-5">
              <div>
                <p className="text-sm text-zinc-400">{selectedUser.user.email}</p>
                <h3 className="mt-1 text-2xl font-extrabold text-zinc-50">{historyTitle}</h3>
              </div>
              <Button tone="ghost" className="min-h-10 px-3" onClick={() => setHistoryModal(null)}>Zamknij</Button>
            </div>
            <div className="max-h-[66vh] space-y-3 overflow-auto p-5">
              {renderHistoryItems()}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function SuccessHistory({
  user,
  access,
  onSelect
}: {
  user: AuthUser | null;
  access: AccessState;
  onSelect: (view: View) => void;
}) {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<any>(null);
  const canLoad = Boolean(user && (access.hasActiveAccess || user.role === "ADMIN"));

  useEffect(() => {
    if (!canLoad) {
      setAttempts([]);
      return;
    }
    fetch("/api/progress", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        const nextAttempts = Array.isArray(data?.attempts) ? data.attempts.slice(0, 20).reverse() : [];
        setAttempts(nextAttempts);
      })
      .catch(() => setAttempts([]));
  }, [canLoad]);

  return (
    <div className="rounded-card border border-zinc-700/70 bg-surface-900 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Historia sukcesów</p>

        </div>
        <button className="text-left text-xs font-semibold text-accent transition hover:text-accent/80" onClick={() => onSelect("stats")}>
          Szczegóły w warunkach
        </button>
      </div>
      {attempts.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {attempts.map((attempt, index) => (
            <button
              key={attempt.id ?? index}
              className={`h-5 w-5 rounded-full border transition hover:scale-110 ${attempt.passed ? "border-success bg-success/75 shadow-[0_0_0_4px_rgba(34,197,94,0.08)]" : "border-danger bg-danger/75 shadow-[0_0_0_4px_rgba(239,68,68,0.08)]"}`}
              title={`${formatAccessDate(attempt.finishedAt ?? attempt.startedAt)} - ${attempt.score}/74`}
              onClick={() => {
                playUiSound(attempt.passed ? "success" : "danger");
                setSelectedAttempt(attempt);
              }}
              aria-label={`Egzamin ${index + 1}: ${attempt.score}/74`}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-card border border-dashed border-zinc-700/80 bg-surface-800/70 px-4 py-3 text-sm text-zinc-400">
          {user ? "Po pierwszym zapisanym egzaminie pojawi się tutaj szybki wykres wyników." : "Zaloguj się, aby zapisywać i oglądać historię egzaminów."}
        </div>
      )}
      {selectedAttempt ? <AttemptResultModal attempt={selectedAttempt} onClose={() => setSelectedAttempt(null)} /> : null}
    </div>
  );
}

function HomeView({
  onSelect,
  user,
  access,
  onAuth,
  onLogout
}: {
  onSelect: (view: View) => void;
  user: AuthUser | null;
  access: AccessState;
  onAuth: (user: AuthUser, access: AccessState) => void;
  onLogout: () => void;
}) {
  const hasFullAccess = Boolean(access.hasActiveAccess || user?.role === "ADMIN");
  const proofItems = [
    { label: "Baza kat. B", value: "2138 pytań", text: "pytania do treningu teorii, stan: lipiec 2026" },
    { label: "Symulacja WORD", value: "32 pytania", text: "20 podstawowych i 12 specjalistycznych" },
    { label: "Próg zaliczenia", value: "68/74 pkt", text: "punktacja jak w trybie egzaminacyjnym" }
  ];
  const benefits = [
    "Codzienny trening bez materiałów pobocznych: pytanie, odpowiedź, wynik.",
    "Tryb egzaminu z timerem, jednym odtworzeniem wideo i blokadą powrotu.",
    "Historia podejść, trudne pytania i statystyki pokazujące słabe kategorie."
  ];
  const faq = [
    {
      question: "Czy mogę zacząć bez konta?",
      answer: "Tak. Darmowy trening pozwala sprawdzić działanie strony i rozwiązać limit pytań dziennie. Konto zapisuje postęp i historię nauki."
    },
    {
      question: "Co odblokowuje pełny dostęp?",
      answer: "Pełny dostęp usuwa dzienny limit treningu i włącza egzamin, trudne pytania, historię wyników oraz statystyki przygotowania."
    },
    {
      question: "Czy płatność odnawia się automatycznie?",
      answer: "Nie. Kupujesz dostęp na wybrany okres: 1 dzień, 7 dni, 30 dni albo 90 dni."
    }
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className="space-y-7">
        <div className="grid gap-6 lg:grid-cols-[1fr_260px] lg:items-start">
          <div className="space-y-4">
            <p className="text-sm font-semibold text-accent">Testy na prawo jazdy kat. B</p>
            <h2 className="max-w-3xl text-4xl font-extrabold leading-tight text-zinc-50 md:text-5xl">
              Przygotuj się do teorii szybciej: pytania, egzamin i powtórka błędów w jednym miejscu.
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-zinc-300">
              Zdaj B to prosty trening teorii kategorii B: aktualna baza pytań, tryb zgodny z formatem egzaminu WORD, materiały wideo, statystyki i lista trudnych pytań.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button icon={<Play size={18} />} onClick={() => onSelect("training")}>Rozpocznij darmowy test</Button>
              <Button tone="ghost" icon={<CreditCard size={18} />} onClick={() => onSelect("account")}>Zobacz ceny</Button>
            </div>
          </div>
          <div className="rounded-card border border-accent/35 bg-accent/10 p-4">
            <p className="text-sm font-semibold text-accent">Dlaczego warto?</p>
            <ul className="mt-3 space-y-3 text-sm leading-5 text-zinc-300">
              {benefits.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-success" size={16} />{item}</li>)}
            </ul>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {proofItems.map((item) => (
            <div key={item.label} className="rounded-card bg-surface-900 p-4">
              <p className="text-sm text-zinc-400">{item.label}</p>
              <p className="mt-2 text-3xl font-bold text-zinc-50">{item.value}</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{item.text}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button className="group rounded-card border border-accent/50 bg-accent/10 p-5 text-left transition hover:border-accent hover:bg-accent/15" onClick={() => onSelect("training")}>
            <div className="flex items-center gap-3 text-accent"><Play size={22} /><span className="font-bold">Rozpocznij trening</span></div>
            <p className="mt-2 text-sm text-zinc-400">Losowe pytania bez presji czasu. Dobre na codzienną naukę.</p>
          </button>
          <button className="group rounded-card border border-zinc-600/70 bg-surface-900 p-5 text-left transition hover:border-accent/70 hover:bg-surface-850" onClick={() => onSelect(hasFullAccess ? "exam" : "account")}>
            <div className="flex items-center gap-3 text-zinc-50"><TimerReset size={22} className="text-accent" /><span className="font-bold">{hasFullAccess ? "Uruchom egzamin" : "Odblokuj egzamin"}</span></div>
            <p className="mt-2 text-sm text-zinc-400">Symulacja z timerem, punktacją i zasadami wideo.</p>
          </button>
        </div>

        <div className="rounded-card border border-zinc-700/70 bg-surface-900 p-5">
          <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
            <div>
              <p className="text-sm font-semibold text-zinc-50">Darmowo</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">Limit pytań treningowych dziennie, podgląd działania strony i możliwość rozpoczęcia nauki bez płatności.</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-accent">Pełny dostęp</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">Trening bez limitu, egzamin, trudne pytania, statystyki, historia wyników i zapis postępów na koncie.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { view: "difficult" as const, label: "Trudne pytania", icon: Star },
            { view: "stats" as const, label: "Gotowość", icon: BarChart3 },
            { view: "account" as const, label: "Konto i dostęp", icon: UserRound }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.view} className="group flex items-center justify-between rounded-card border border-zinc-700/70 bg-surface-900 px-4 py-3 text-left transition hover:border-accent/70 hover:bg-surface-850" onClick={() => onSelect(item.view)}>
                <span className="flex items-center gap-2 font-semibold text-zinc-100"><Icon size={18} className="text-accent" />{item.label}</span>
                <ChevronRight size={18} className="text-zinc-500 transition group-hover:text-accent" />
              </button>
            );
          })}
        </div>

        <SuccessHistory user={user} access={access} onSelect={onSelect} />

        <div className="space-y-3">
          <div>
            <p className="text-sm text-zinc-400">Najczęstsze pytania</p>
            <h3 className="mt-1 text-2xl font-extrabold text-zinc-50">FAQ przed rozpoczęciem nauki</h3>
          </div>
          <div className="grid gap-3">
            {faq.map((item) => (
              <div key={item.question} className="rounded-card border border-zinc-700/70 bg-surface-900 p-4">
                <p className="font-semibold text-zinc-100">{item.question}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <AccountCard
        user={user}
        access={access}
        onAuth={onAuth}
        onLogout={onLogout}
        onPricing={() => onSelect("account")}
      />
    </div>
  );
}

const legalPages = {
  terms: {
    eyebrow: "Zasady korzystania",
    title: "Regulamin",
    intro: "Regulamin określa podstawowe zasady korzystania z serwisu Zdaj B, konta użytkownika oraz płatnego dostępu do funkcji przygotowujących do teorii prawa jazdy kategorii B.",
    sections: [
      {
        title: "Charakter serwisu",
        body: "Zdaj B jest internetowym narzędziem edukacyjnym do ćwiczenia pytań teoretycznych prawa jazdy kategorii B. Serwis nie jest szkołą jazdy, urzędem, ośrodkiem egzaminacyjnym ani oficjalnym systemem państwowego egzaminu."
      },
      {
        title: "Konto użytkownika",
        body: "Konto pozwala zapisywać postęp nauki, historię egzaminów, listę trudnych pytań, aktywny dostęp oraz dane potrzebne do obsługi płatności. Użytkownik odpowiada za podanie prawdziwego adresu e-mail i zachowanie poufności hasła."
      },
      {
        title: "Dostęp płatny",
        body: "Płatny dostęp odblokowuje funkcje premium: trening bez dziennego limitu, tryb egzaminu, trudne pytania, zapis wyników, statystyki oraz historię postępów. Dostęp jest przyznawany na wybrany okres i nie odnawia się automatycznie."
      },
      {
        title: "Płatności",
        body: "Płatności są obsługiwane przez zewnętrznego operatora Stripe. Po potwierdzeniu płatności przez operatora dostęp powinien zostać aktywowany automatycznie na koncie użytkownika."
      },
      {
        title: "Zasady korzystania",
        body: "Użytkownik nie powinien udostępniać konta innym osobom, obchodzić zabezpieczeń serwisu, kopiować materiałów poza normalnym korzystaniem z usługi ani podejmować działań, które mogłyby zakłócić działanie strony."
      },
      {
        title: "Ograniczenia odpowiedzialności",
        body: "Serwis pomaga w nauce, ale nie gwarantuje zdania egzaminu państwowego. Wynik zależy od przygotowania użytkownika, aktualnych wymagań egzaminacyjnych oraz przebiegu właściwego egzaminu."
      }
    ]
  },
  privacy: {
    eyebrow: "Dane i prywatność",
    title: "Polityka prywatności",
    intro: "Polityka prywatności wyjaśnia, jakie dane są przetwarzane w Zdaj B i po co są potrzebne do działania konta, nauki, płatności oraz bezpieczeństwa serwisu.",
    sections: [
      {
        title: "Administrator danych",
        body: "Administratorem danych jest operator serwisu Zdaj B. W sprawach dotyczących danych osobowych można skontaktować się przez adres kontakt@zdajb.pl."
      },
      {
        title: "Zakres danych",
        body: "Serwis może przetwarzać adres e-mail, imię podane dobrowolnie, zaszyfrowane hasło, informacje o sesjach, aktywnym dostępie, płatnościach, wynikach egzaminów, odpowiedziach i trudnych pytaniach."
      },
      {
        title: "Cel przetwarzania",
        body: "Dane są używane do obsługi konta, zapisu postępów, udostępniania funkcji płatnych, realizacji płatności, bezpieczeństwa serwisu i kontaktu z użytkownikiem."
      },
      {
        title: "Płatności i poczta",
        body: "Płatności obsługuje Stripe. Wiadomości e-mail, takie jak potwierdzenie adresu, reset hasła i informacje techniczne, mogą być wysyłane przez zewnętrznego dostawcę poczty."
      },
      {
        title: "Bezpieczeństwo",
        body: "Hasła są przechowywane w postaci zaszyfrowanego skrótu. Sesje logowania są zapisywane w celu utrzymania dostępu do konta i ochrony przed nieautoryzowanym użyciem."
      },
      {
        title: "Prawa użytkownika",
        body: "Użytkownik może poprosić o dostęp do danych, sprostowanie, eksport, usunięcie konta lub ograniczenie przetwarzania. Część tych działań jest dostępna bezpośrednio w panelu konta."
      }
    ]
  },
  refunds: {
    eyebrow: "Płatności",
    title: "Zwroty i reklamacje",
    intro: "Tu znajdują się podstawowe zasady dotyczące problemów z płatnością lub dostępem do funkcji premium.",
    sections: [
      {
        title: "Aktywacja dostępu",
        body: "Po poprawnej płatności dostęp powinien zostać aktywowany automatycznie. Jeśli tak się nie stanie, użytkownik powinien skontaktować się z obsługą i podać adres e-mail konta."
      },
      {
        title: "Reklamacje",
        body: "Reklamacje dotyczące działania konta, płatności, aktywnego dostępu lub błędów technicznych można zgłaszać na adres kontakt@zdajb.pl. W zgłoszeniu warto podać e-mail konta i krótki opis problemu."
      },
      {
        title: "Zwroty",
        body: "Zgłoszenia dotyczące zwrotu płatności są rozpatrywane indywidualnie zgodnie z obowiązującymi przepisami oraz stanem wykorzystania usługi. Jeśli dostęp nie został aktywowany mimo pobrania płatności, zgłoszenie ma pierwszeństwo w obsłudze."
      },
      {
        title: "Błędy techniczne",
        body: "Jeśli użytkownik opłacił dostęp, ale nie może korzystać z funkcji premium z powodu błędu technicznego po stronie serwisu, problem zostanie sprawdzony indywidualnie. W razie potrzeby dostęp może zostać przedłużony lub płatność zwrócona."
      }
    ]
  },
  contact: {
    eyebrow: "Pomoc",
    title: "Kontakt",
    intro: "Skontaktuj się w sprawie konta, płatności, błędu technicznego albo pytań dotyczących działania serwisu.",
    sections: [
      {
        title: "E-mail",
        body: "Adres kontaktowy serwisu: kontakt@zdajb.pl."
      },
      {
        title: "Co podać w zgłoszeniu",
        body: "Podaj adres e-mail konta, krótki opis problemu, datę płatności lub numer płatności, jeśli sprawa dotyczy dostępu premium."
      },
      {
        title: "Sprawy techniczne",
        body: "W przypadku błędów z materiałami wideo lub egzaminem warto dopisać nazwę przeglądarki, urządzenie oraz godzinę wystąpienia problemu."
      },
      {
        title: "Odpowiedź",
        body: "Zgłoszenia są obsługiwane przez e-mail. W sprawach związanych z płatnością lub dostępem premium odpowiedź powinna zostać udzielona możliwie szybko."
      }
    ]
  }
} satisfies Record<Extract<View, "terms" | "privacy" | "refunds" | "contact">, { eyebrow: string; title: string; intro: string; sections: { title: string; body: string }[] }>;

function LegalView({ page }: { page: keyof typeof legalPages }) {
  const content = legalPages[page];
  return (
    <Card className="space-y-6">
      <div>
        <p className="text-sm text-zinc-400">{content.eyebrow}</p>
        <h2 className="mt-2 text-3xl font-extrabold text-zinc-50">{content.title}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{content.intro}</p>
      </div>
      <div className="space-y-3">
        {content.sections.map((section) => (
          <div key={section.title} className="rounded-card bg-surface-900 p-4">
            <h3 className="font-bold text-zinc-50">{section.title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{section.body}</p>
          </div>
        ))}
      </div>
      <div className="rounded-card border border-accent/35 bg-accent/10 p-4 text-sm leading-6 text-zinc-300">
        Ostatnia aktualizacja: 06.07.2026. W sprawach dotyczących konta, płatności lub danych osobowych skontaktuj się przez kontakt@zdajb.pl.
      </div>
      {page === "contact" ? (
        <a className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-semibold text-surface-950 shadow-lift transition hover:brightness-110" href="mailto:kontakt@zdajb.pl">
          Napisz na kontakt@zdajb.pl
        </a>
      ) : null}
    </Card>
  );
}

function formatReviewDate(value?: string | null) {
  if (!value) return "brak";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "brak";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function isDue(item: DifficultItem) {
  return !item.mastered && new Date(item.nextReviewAt).getTime() <= Date.now();
}

function ExamResultDetails({
  score,
  answers,
  totalQuestions,
  finishedAt
}: {
  score: number;
  answers: ExamAnswer[];
  totalQuestions: number;
  finishedAt?: string | null;
}) {
  const passed = score >= passScore;
  const [difficultStatus, setDifficultStatus] = useState<Record<number, "saved" | "error">>({});

  async function addDifficult(questionId: number) {
    const response = await fetch(`/api/difficult/${questionId}`, { method: "POST", credentials: "include" }).catch(() => null);
    setDifficultStatus((current) => ({ ...current, [questionId]: response?.ok ? "saved" : "error" }));
    playUiSound(response?.ok ? "success" : "danger");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-zinc-400">{finishedAt ? formatAccessDate(finishedAt) : "Wynik egzaminu"}</p>
        <h2 className="mt-2 text-4xl font-extrabold text-zinc-50">{score}/{maxScore}</h2>
        <p className={passed ? "text-success" : "text-danger"}>{passed ? "Zdany" : "Niezdany"} - próg {passScore} pkt</p>
      </div>
      <div className="space-y-3">
        <h3 className="text-xl font-bold text-zinc-50">Lista pytań z tego egzaminu</h3>
        {[...answers].sort((a, b) => a.order - b.order).map((answer) => (
          <div key={`${answer.order}-${answer.question.id}`} className={`rounded-card border p-4 ${answer.correct ? "border-success/35 bg-success/8" : "border-danger/45 bg-danger/10"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-zinc-100">Pytanie {answer.order}/{totalQuestions}</p>
              <span className={answer.correct ? "rounded-full border border-success/60 px-3 py-1 text-xs font-semibold text-success" : "rounded-full border border-danger/60 px-3 py-1 text-xs font-semibold text-danger"}>
                {answer.correct ? "Poprawnie" : "Błąd"}
              </span>
            </div>
            <p className="mt-3 font-semibold text-zinc-100">{answer.question.text}</p>
            <div className="mt-2 space-y-1 text-sm text-zinc-400">
              <p>Twoja odpowiedź: <span className={answer.correct ? "text-success" : "text-danger"}>{answer.selected}</span></p>
              <p>Poprawna odpowiedź: <span className="font-semibold text-success">{answer.question.correctAnswer}</span></p>
            </div>
            {!answer.correct ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button tone={difficultStatus[answer.question.id] === "saved" ? "success" : "ghost"} onClick={() => addDifficult(answer.question.id)}>
                  {difficultStatus[answer.question.id] === "saved" ? "Dodano do trudnych" : "Dodaj do trudnych"}
                </Button>
                {difficultStatus[answer.question.id] === "error" ? <span className="text-sm text-danger">Wymagany pełny dostęp.</span> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function attemptToExamAnswers(attempt: any): ExamAnswer[] {
  return Array.isArray(attempt?.answers)
    ? attempt.answers.map((answer: any, index: number) => ({
      question: answer.question,
      selected: answer.selectedAnswer || "Brak odpowiedzi",
      correct: Boolean(answer.isCorrect),
      order: index + 1
    })).filter((answer: ExamAnswer) => answer.question)
    : [];
}

function AttemptResultModal({ attempt, onClose }: { attempt: any; onClose: () => void }) {
  const answers = attemptToExamAnswers(attempt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-panel border border-zinc-700/70 bg-surface-800 shadow-lift">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-700/70 p-5">
          <div>
            <p className="text-sm text-zinc-400">Szczegóły podejścia</p>
            <h3 className="mt-1 text-2xl font-extrabold text-zinc-50">Wynik egzaminu</h3>
          </div>
          <Button tone="ghost" className="min-h-10 px-3" onClick={onClose}>Zamknij</Button>
        </div>
        <div className="max-h-[72vh] overflow-auto p-5">
          {answers.length ? (
            <ExamResultDetails score={attempt.score ?? 0} answers={answers} totalQuestions={answers.length} finishedAt={attempt.finishedAt ?? attempt.startedAt} />
          ) : (
            <div className="rounded-card bg-surface-900 p-4 text-zinc-400">Brak szczegółów pytań dla tego podejścia.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrainingView({ questions, user, access, onPricing }: { questions: Question[]; user: AuthUser | null; access: AccessState; onPricing: () => void }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [difficultMessage, setDifficultMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [freeAnswersToday, setFreeAnswersToday] = useState(0);
  const question = questions[index % questions.length];
  const hasFullAccess = Boolean(access.hasActiveAccess || user?.role === "ADMIN");
  const trainingLimitKey = `zdajb-training-answers-${todayKey()}-${user?.id ?? "guest"}`;
  const freeRemaining = Math.max(0, freeTrainingDailyLimit - freeAnswersToday);
  const freeLimitReached = !hasFullAccess && freeRemaining <= 0;
  const next = () => { setSelected(undefined); setDifficultMessage(null); setIndex((value) => value + 1); };

  useEffect(() => {
    const stored = window.localStorage.getItem(trainingLimitKey);
    setFreeAnswersToday(Number(stored ?? 0) || 0);
  }, [trainingLimitKey]);

  function incrementFreeTrainingUsage() {
    if (hasFullAccess) return;
    setFreeAnswersToday((value) => {
      const nextValue = Math.min(freeTrainingDailyLimit, value + 1);
      window.localStorage.setItem(trainingLimitKey, String(nextValue));
      return nextValue;
    });
  }

  const markDifficult = async () => {
    if (!user) {
      setDifficultMessage({ tone: "danger", text: "Aby zapisać trudne pytanie, zaloguj się lub utwórz konto." });
      playUiSound("danger");
      return;
    }
    if (!hasFullAccess) {
      setDifficultMessage({ tone: "danger", text: "Funkcja „Trudne pytania” wymaga pełnego dostępu." });
      playUiSound("danger");
      return;
    }
    const response = await fetch(`/api/difficult/${question.id}`, { method: "POST", credentials: "include" }).catch(() => null);
    if (response?.ok) {
      setDifficultMessage({ tone: "success", text: "Dodano do trudnych pytań." });
      playUiSound("success");
    } else {
      const data = await response?.json().catch(() => null);
      setDifficultMessage({ tone: "danger", text: data?.message ?? "Nie udało się dodać pytania." });
      playUiSound("danger");
    }
  };
  const selectAnswer = (answer: string) => {
    if (freeLimitReached && !selected) {
      setDifficultMessage({ tone: "danger", text: "Dzisiejszy limit darmowego treningu został wykorzystany." });
      playUiSound("danger");
      return;
    }
    if (!selected) incrementFreeTrainingUsage();
    setSelected(answer);
    if (user) {
      fetch("/api/progress/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ questionId: question.id, selectedAnswer: answer, isCorrect: isCorrectAnswer(question, answer) })
      }).catch(() => undefined);
    }
  };

  if (freeLimitReached && !selected) {
    return (
      <Card className="space-y-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-card border border-accent/60 bg-accent/10 text-accent">
          <Lock size={28} />
        </div>
        <div>
          <p className="text-sm text-zinc-400">Darmowy trening</p>
          <h2 className="mt-2 text-3xl font-extrabold text-zinc-50">Limit 30 pytań na dziś został wykorzystany</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            W darmowej wersji możesz rozwiązać 30 pytań dziennie. Konto zapisuje postępy, a pełny dostęp odblokowuje trening bez limitu, egzamin, trudne pytania i statystyki.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button icon={<CreditCard size={18} />} onClick={onPricing}>Zobacz dostęp</Button>
          {!user ? <Button tone="ghost" icon={<UserRound size={18} />} onClick={onPricing}>Utwórz konto</Button> : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-6">
      {!hasFullAccess ? (
        <div className="rounded-card border border-accent/35 bg-accent/10 px-4 py-3 text-sm text-zinc-300">
          Darmowy trening: zostało dziś <span className="font-bold text-accent">{freeRemaining}</span> z {freeTrainingDailyLimit} pytań.
          {!user ? <span className="ml-1 text-zinc-400">Bez konta postępy nie są zapisywane.</span> : null}
        </div>
      ) : null}
      <QuestionPanel
        question={question}
        selected={selected}
        reveal={Boolean(selected)}
        onSelect={selectAnswer}
        canPlayVideo
      />
      <div className="flex flex-wrap gap-3">
        <Button icon={<Star size={18} />} tone={difficultMessage?.tone === "success" ? "success" : "ghost"} onClick={markDifficult}>
          {difficultMessage?.tone === "success" ? "Dodano do trudnych" : "Do trudnych"}
        </Button>
        <Button icon={<BookOpenCheck size={18} />} onClick={next}>Następne pytanie</Button>
      </div>
      {difficultMessage ? (
        <div className={`rounded-card border px-4 py-3 text-sm ${difficultMessage.tone === "success" ? "border-success/55 bg-success/10 text-success" : "border-danger/55 bg-danger/10 text-danger"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{difficultMessage.text}</span>
            {difficultMessage.tone === "danger" && user ? <Button className="min-h-9 px-3 py-1" onClick={onPricing}>Zobacz cennik</Button> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ExamView({ onActiveChange }: { onActiveChange: (active: boolean) => void }) {
  const [started, setStarted] = useState(false);
  const [loadingExam, setLoadingExam] = useState(false);
  const [examError, setExamError] = useState("");
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [answers, setAnswers] = useState<ExamAnswer[]>([]);
  const [finished, setFinished] = useState(false);
  const [phase, setPhase] = useState<ExamPhase>("answer");
  const [timeLeft, setTimeLeft] = useState(0);
  const [videoPlayed, setVideoPlayed] = useState(false);
  const question = examQuestions[current];
  const score = answers.reduce((sum, answer) => sum + (answer.correct ? answer.question.weight : 0), 0);
  const hasExamVideo = question ? isBrowserVideo(question) : false;
  const phaseMax = hasExamVideo && phase === "prep" ? examVideoPrepSeconds : hasExamVideo && phase === "answer" ? examVideoAnswerSeconds : question ? secondsForQuestion(question) : 1;
  const canAnswer = Boolean(question) && (!hasExamVideo || phase === "answer");
  const phaseLabel = hasExamVideo
    ? phase === "prep" ? "Czas na przeczytanie pytania" : phase === "playing" ? "Film egzaminacyjny" : "Czas na odpowiedź"
    : "Czas na odpowiedź";

  useEffect(() => {
    onActiveChange(started && !finished);
    return () => onActiveChange(false);
  }, [finished, onActiveChange, started]);

  const saveExamAttempt = useCallback((nextAnswers: ExamAnswer[]) => {
    fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        mode: "EXAM",
        answers: nextAnswers.map((answer) => ({
          questionId: answer.question.id,
          isCorrect: answer.correct,
          selectedAnswer: answer.selected,
          weight: answer.question.weight
        }))
      })
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!started) return;
    setLoadingExam(true);
    setExamError("");
    setExamQuestions([]);
    fetch("/api/exam", { credentials: "include" }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Nie udało się uruchomić egzaminu.");
      }
      return res.json();
    }).then((data) => {
      if (data?.questions?.length) setExamQuestions(data.questions);
      else setExamError("Nie udało się pobrać pytań egzaminacyjnych.");
    }).catch((error) => {
      setExamError(error instanceof Error ? error.message : "Nie udało się uruchomić egzaminu.");
    }).finally(() => setLoadingExam(false));
  }, [started]);

  useEffect(() => {
    if (!started || !question) return;
    setSelected(undefined);
    setVideoPlayed(false);
    if (isBrowserVideo(question)) {
      setPhase("prep");
      setTimeLeft(examVideoPrepSeconds);
    } else {
      setPhase("answer");
      setTimeLeft(secondsForQuestion(question));
    }
  }, [question?.id, started]);

  const commit = useCallback(() => {
    if (!question) return;
    const finalSelected = selected ?? "";
    const nextAnswers = [...answers, { question, selected: finalSelected || "Brak odpowiedzi", correct: finalSelected ? isCorrectAnswer(question, finalSelected) : false, order: current + 1 }];
    setAnswers(nextAnswers);
    setSelected(undefined);
    setVideoPlayed(false);
    if (current + 1 >= examQuestions.length) {
      saveExamAttempt(nextAnswers);
      setFinished(true);
    }
    else setCurrent((value) => value + 1);
  }, [answers, current, examQuestions.length, question, saveExamAttempt, selected]);

  const startVideo = useCallback(() => {
    if (!hasExamVideo || videoPlayed) return;
    setVideoPlayed(true);
    setPhase("playing");
  }, [hasExamVideo, videoPlayed]);

  const finishVideo = useCallback(() => {
    if (!hasExamVideo) return;
    setPhase("answer");
    setTimeLeft(examVideoAnswerSeconds);
  }, [hasExamVideo]);

  useEffect(() => {
    if (!question || finished || phase === "playing") return;
    const timer = window.setInterval(() => {
      setTimeLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          if (hasExamVideo && phase === "prep") startVideo();
          else commit();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [commit, finished, hasExamVideo, phase, question, startVideo]);

  if (!started) {
    return (
      <Card className="space-y-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-400">Tryb egzaminacyjny</p>
          <h2 className="text-3xl font-extrabold text-zinc-50">Egzamin teoretyczny kat. B</h2>
          <p className="max-w-2xl text-zinc-400">Po rozpoczęciu test działa jak symulacja egzaminu: pytania idą po kolei, czas jest liczony automatycznie, a do poprzednich pytań nie wracasz.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Liczba pytań</p><p className="mt-2 text-3xl font-bold text-zinc-50">32</p></div>
          <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Maksymalnie</p><p className="mt-2 text-3xl font-bold text-accent">74 pkt</p></div>
          <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Próg zdania</p><p className="mt-2 text-3xl font-bold text-success">68 pkt</p></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-card bg-surface-900 p-4">
            <h3 className="font-bold text-zinc-50">Plan egzaminu</h3>
            <div className="mt-3 space-y-2 text-sm text-zinc-400">
              <p>20 pytań podstawowych: 10x3, 6x2, 4x1.</p>
              <p>12 pytań specjalistycznych: 6x3, 4x2, 2x1.</p>
              <p>Wynik zapisze się w Twojej historii po zakończeniu egzaminu.</p>
            </div>
          </div>
          <div className="rounded-card bg-surface-900 p-4">
            <h3 className="font-bold text-zinc-50">Zasady wideo</h3>
            <div className="mt-3 space-y-2 text-sm text-zinc-400">
              <p>Masz 20 sekund na przeczytanie pytania przed filmem.</p>
              <p>Film można obejrzeć tylko raz, bez pauzy i powtórki.</p>
              <p>Po filmie masz 15 sekund na wybór odpowiedzi.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button icon={<TimerReset size={18} />} onClick={() => setStarted(true)}>Rozpocznij egzamin</Button>
        </div>
      </Card>
    );
  }

  if (loadingExam) {
    return (
      <Card className="space-y-4">
        <p className="text-sm text-zinc-400">Uruchamianie egzaminu</p>
        <h2 className="text-2xl font-bold text-zinc-50">Pobieram zestaw pytań...</h2>
        <div className="h-2 overflow-hidden rounded-full bg-surface-900">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-accent" />
        </div>
      </Card>
    );
  }

  if (examError || !question) {
    return (
      <Card className="space-y-5">
        <div>
          <p className="text-sm text-zinc-400">Egzamin niedostępny</p>
          <h2 className="mt-2 text-2xl font-bold text-zinc-50">{examError || "Nie udało się pobrać pytań egzaminacyjnych."}</h2>
          <p className="mt-2 text-sm text-zinc-400">Odśwież konto albo sprawdź, czy dostęp premium jest nadal aktywny.</p>
        </div>
        <Button tone="ghost" onClick={() => setStarted(false)}>Wróć do startu</Button>
      </Card>
    );
  }

  if (finished) {
    return (
      <Card className="space-y-6">
        <ExamResultDetails score={score} answers={answers} totalQuestions={examQuestions.length} />
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm text-zinc-400">
          <span>Pytanie {current + 1}/{examQuestions.length}</span>
          <span>{phaseLabel}: {phase === "playing" ? "trwa" : `${timeLeft}s`}</span>
        </div>
        <ProgressBar value={current + 1} max={examQuestions.length} />
        {phase !== "playing" ? <ProgressBar value={timeLeft} max={phaseMax} /> : null}
      </div>
      {question ? (
        <ExamQuestionPanel
          question={question}
          order={current + 1}
          total={examQuestions.length}
          selected={selected}
          canAnswer={canAnswer}
          phase={phase}
          prepLeft={timeLeft}
          videoPlayed={videoPlayed}
          onStartVideo={startVideo}
          onVideoEnded={finishVideo}
          onSelect={setSelected}
        />
      ) : null}
      <Button className="min-h-10" disabled={!canAnswer || !selected} onClick={commit}>Zapisz odpowiedź</Button>
    </Card>
  );
}

function DifficultView() {
  const [items, setItems] = useState<DifficultItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filter, setFilter] = useState<DifficultFilter>("due");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [reveal, setReveal] = useState(false);

  const loadItems = () => fetch("/api/difficult", { credentials: "include" }).then((res) => res.ok ? res.json() : []).then((data) => {
    const nextItems = Array.isArray(data) ? data : [];
    setItems(nextItems);
    setActiveId((current) => current ?? nextItems[0]?.questionId ?? null);
  }).catch(() => setItems([]));

  useEffect(() => { loadItems(); }, []);

  const counts = useMemo(() => {
    const due = items.filter(isDue).length;
    const mastered = items.filter((item) => item.mastered).length;
    return { due, active: items.length - mastered, mastered, all: items.length };
  }, [items]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "due" && isDue(item)) ||
        (filter === "active" && !item.mastered) ||
        (filter === "mastered" && item.mastered);
      const matchesQuery = !normalizedQuery ||
        item.question.text.toLowerCase().includes(normalizedQuery) ||
        item.question.category.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, items, query]);

  const activeItem = visibleItems.find((item) => item.questionId === activeId) ?? visibleItems[0] ?? items[0];

  useEffect(() => {
    setSelected(undefined);
    setReveal(false);
  }, [activeItem?.questionId]);

  async function review(isCorrect: boolean) {
    if (!activeItem) return;
    await fetch(`/api/difficult/${activeItem.questionId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isCorrect })
    });
    await loadItems();
  }

  async function setMastered(mastered: boolean) {
    if (!activeItem) return;
    await fetch(`/api/difficult/${activeItem.questionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mastered })
    });
    await loadItems();
  }

  async function removeItem(questionId: number) {
    await fetch(`/api/difficult/${questionId}`, { method: "DELETE", credentials: "include" });
    setActiveId(null);
    await loadItems();
  }

  const filters: Array<{ id: DifficultFilter; label: string; count: number }> = [
    { id: "due", label: "Do powtórki", count: counts.due },
    { id: "active", label: "Aktywne", count: counts.active },
    { id: "mastered", label: "Wyuczone", count: counts.mastered },
    { id: "all", label: "Wszystkie", count: counts.all }
  ];

  return (
    <Card className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm text-zinc-400">Powtórki zapisanych pytań</p>
          <h2 className="mt-1 text-2xl font-bold text-zinc-50">Trudne pytania</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-card bg-surface-900 px-3 py-2"><p className="font-bold text-accent">{counts.due}</p><p className="text-xs text-zinc-400">teraz</p></div>
          <div className="rounded-card bg-surface-900 px-3 py-2"><p className="font-bold text-zinc-50">{counts.active}</p><p className="text-xs text-zinc-400">aktywne</p></div>
          <div className="rounded-card bg-surface-900 px-3 py-2"><p className="font-bold text-success">{counts.mastered}</p><p className="text-xs text-zinc-400">wyuczone</p></div>
        </div>
      </div>

      {!items.length ? (
        <div className="rounded-card bg-surface-900 p-5 text-zinc-300">
          <p className="font-semibold text-zinc-100">Lista jest pusta.</p>
          <p className="mt-2 text-sm text-zinc-400">Dodawaj pytania gwiazdką w treningu albo po błędach na egzaminie.</p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[330px_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-card bg-surface-900 px-3 py-2">
              <Search size={18} className="text-zinc-500" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj w pytaniach"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {filters.map((item) => (
                <Button key={item.id} tone={filter === item.id ? "primary" : "ghost"} icon={<ListFilter size={16} />} onClick={() => { setFilter(item.id); setActiveId(null); }}>
                  {item.label} {item.count}
                </Button>
              ))}
            </div>
            <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
              {visibleItems.length ? visibleItems.map((item) => (
                <button
                  key={item.questionId}
                  className={`w-full rounded-card p-3 text-left text-sm transition ${activeItem?.questionId === item.questionId ? "bg-accent text-surface-950" : "bg-surface-900 text-zinc-200 hover:bg-surface-850"}`}
                  onClick={() => setActiveId(item.questionId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{item.mastered ? "Wyuczone" : isDue(item) ? "Do powtórki" : "Zaplanowane"}</span>
                    <span>{item.question.weight} pkt</span>
                  </div>
                  <p className="mt-2 line-clamp-3">{item.question.text}</p>
                  <p className={`mt-2 text-xs ${activeItem?.questionId === item.questionId ? "text-surface-800" : "text-zinc-500"}`}>
                    Powtórki: {item.timesReviewed} · Następna: {formatReviewDate(item.nextReviewAt)}
                  </p>
                </button>
              )) : (
                <div className="rounded-card bg-surface-900 p-4 text-sm text-zinc-400">Brak pytań dla tego filtra.</div>
              )}
            </div>
          </div>

          {activeItem ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-900 p-4">
                <div>
                  <p className="font-semibold text-zinc-100">{activeItem.mastered ? "Status: wyuczone" : isDue(activeItem) ? "Status: do powtórki teraz" : "Status: zaplanowane"}</p>
                  <p className="mt-1 text-sm text-zinc-400">Seria dobrych odpowiedzi: {activeItem.correctStreak}/2 · Ostatnio: {formatReviewDate(activeItem.lastReviewedAt)}</p>
                </div>
                <Button tone="danger" icon={<Trash2 size={17} />} onClick={() => removeItem(activeItem.questionId)}>Usuń</Button>
              </div>
              <QuestionPanel question={activeItem.question} selected={selected} reveal={reveal} onSelect={(answer) => { setSelected(answer); setReveal(true); }} />
              <div className="grid max-w-fit grid-cols-2 gap-3">
                <Button icon={reveal ? <EyeOff size={18} /> : <Eye size={18} />} tone="ghost" onClick={() => setReveal((value) => !value)}>
                  {reveal ? "Ukryj odpowiedź" : "Pokaż odpowiedź"}
                </Button>
                {activeItem.mastered ? (
                  <Button icon={<RotateCcw size={18} />} tone="ghost" onClick={() => setMastered(false)}>Wróć do aktywnych</Button>
                ) : (
                  <Button icon={<BookOpenCheck size={18} />} tone="ghost" onClick={() => setMastered(true)}>Oznacz jako wyuczone</Button>
                )}
                <Button icon={<XCircle size={18} />} tone="danger" onClick={() => review(false)}>Jeszcze trudne</Button>
                <Button icon={<CheckCircle2 size={18} />} tone="success" onClick={() => review(true)}>Umiem</Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function StatsView({ user, onPricing }: { user: AuthUser | null; onPricing: () => void }) {
  const [progress, setProgress] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<any>(null);
  const chartData = progress?.attempts?.length
    ? [...progress.attempts].reverse().map((attempt: any, index: number) => ({ name: `${index + 1}`, score: attempt.score }))
    : [
      { name: "Próg", score: passScore },
      { name: "Max", score: maxScore }
    ];
  const categoryData = progress?.categories?.map((item: any) => ({
    name: item.category.length > 16 ? `${item.category.slice(0, 16)}...` : item.category,
    score: item.totalAnswered ? Math.round((item.totalCorrect / item.totalAnswered) * 100) : 0
  })) ?? [];

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetch("/api/progress", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => setProgress(data))
      .catch(() => setProgress(null))
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <Card className="space-y-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-400">Warunki i postęp nauki</p>
        <h2 className="text-2xl font-bold text-zinc-50">Gotowość do egzaminu</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Próg zdania</p><p className="mt-2 text-3xl font-bold text-success">68</p></div>
        <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Maksymalnie</p><p className="mt-2 text-3xl font-bold text-accent">74</p></div>
        <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Pytania</p><p className="mt-2 text-3xl font-bold text-zinc-50">32</p></div>
      </div>

      {!user ? (
        <div className="rounded-card border border-zinc-600/60 bg-surface-900 p-4">
          <p className="font-semibold text-zinc-100">Zaloguj się, aby zapisywać statystyki.</p>
          <p className="mt-2 text-sm text-zinc-400">Po zalogowaniu zobaczysz historię egzaminów, procent gotowości, słabe kategorie i ostatnie błędy.</p>
          <Button className="mt-4" icon={<CreditCard size={18} />} onClick={onPricing}>Zobacz pełny dostęp</Button>
        </div>
      ) : loading ? (
        <div className="rounded-card bg-surface-900 p-4 text-zinc-400">Ładowanie statystyk...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-card border border-accent/50 bg-accent/10 p-4"><p className="text-sm text-zinc-300">Gotowość</p><p className="mt-2 text-4xl font-extrabold text-accent">{progress?.readiness ?? 0}%</p></div>
            <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Poznane pytania</p><p className="mt-2 text-3xl font-bold text-zinc-50">{progress?.answered ?? 0}/{progress?.totalQuestions ?? 0}</p></div>
            <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Średni wynik</p><p className="mt-2 text-3xl font-bold text-zinc-50">{progress?.avgScore ?? 0}/74</p></div>
            <div className="rounded-card bg-surface-900 p-4"><p className="text-sm text-zinc-400">Najlepszy wynik</p><p className="mt-2 text-3xl font-bold text-success">{progress?.bestScore ?? 0}/74</p></div>
          </div>
          <div className="rounded-card bg-surface-900 p-4">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" stroke="#a1a1aa" />
                  <YAxis stroke="#a1a1aa" />
                  <Tooltip cursor={{ fill: "rgba(79, 168, 232, 0.08)" }} contentStyle={{ background: "#2E2E34", border: 0, borderRadius: 8 }} />
                  <Bar dataKey="score" fill="#4FA8E8" radius={[8, 8, 8, 8]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 rounded-card border border-accent/25 bg-accent/10 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-100">Historia wyników</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">Każdy słupek to jeden zapisany egzamin. Wynik 68 punktów oznacza próg zdania, a 74 punkty to maksimum.</p>
            </div>
          </div>
          {categoryData.length ? (
            <div className="rounded-card bg-surface-900 p-4">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryData}>
                    <XAxis dataKey="name" stroke="#a1a1aa" />
                    <YAxis stroke="#a1a1aa" />
                    <Tooltip cursor={{ fill: "rgba(79, 168, 232, 0.08)" }} contentStyle={{ background: "#2E2E34", border: 0, borderRadius: 8 }} />
                    <Bar dataKey="score" fill="#22c55e" radius={[8, 8, 8, 8]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 rounded-card border border-success/25 bg-success/10 px-4 py-3">
                <p className="text-sm font-semibold text-zinc-100">Skuteczność według kategorii</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">Słupki pokazują procent poprawnych odpowiedzi w tematach, które już ćwiczyłeś. Niższy wynik wskazuje kategorię do powtórki.</p>
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-card bg-surface-900 p-4">
              <h3 className="font-bold text-zinc-50">Ostatnie egzaminy</h3>
              <div className="mt-3 space-y-2 text-sm text-zinc-300">
                {progress?.attempts?.slice(0, 8).map((attempt: any) => (
                  <button
                    key={attempt.id}
                    className="flex w-full items-center justify-between rounded-card border border-transparent bg-surface-800 px-3 py-2 text-left transition hover:border-accent/60 hover:bg-surface-850"
                    onClick={() => {
                      playUiSound(attempt.passed ? "success" : "danger");
                      setSelectedAttempt(attempt);
                    }}
                  >
                    <span>{formatAccessDate(attempt.finishedAt ?? attempt.startedAt)}</span>
                    <span className={attempt.passed ? "font-semibold text-success" : "font-semibold text-danger"}>{attempt.score}/74</span>
                  </button>
                )) ?? <p className="text-zinc-500">Brak zapisanych egzaminów.</p>}
              </div>
            </div>
            <div className="rounded-card bg-surface-900 p-4">
              <h3 className="font-bold text-zinc-50">Ostatnie błędy</h3>
              <div className="mt-3 space-y-2 text-sm text-zinc-300">
                {progress?.recentWrong?.length ? progress.recentWrong.map((item: any) => (
                  <div key={item.id} className="rounded-card bg-surface-800 px-3 py-2">
                    <p className="font-semibold text-zinc-100">{item.question.text}</p>
                    <p className="mt-1 text-xs text-zinc-500">{item.question.category} · poprawna: {item.question.correctAnswer}</p>
                  </div>
                )) : <p className="text-zinc-500">Brak zapisanych błędów.</p>}
              </div>
            </div>
          </div>
          {selectedAttempt ? <AttemptResultModal attempt={selectedAttempt} onClose={() => setSelectedAttempt(null)} /> : null}
        </>
      )}
    </Card>
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [examInProgress, setExamInProgress] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(fallbackQuestions);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [access, setAccess] = useState<AccessState>({ hasActiveAccess: false, planCode: "free", expiresAt: null });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [soundMuted, setSoundMuted] = useState(() => getUiSoundMuted());
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("zdajb-welcome-seen") !== "true";
  });

  const loadMe = useCallback(() => {
    fetch("/api/me", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        setUser(data.user ?? null);
        setAccess(data.access ?? { hasActiveAccess: false, planCode: "free", expiresAt: null });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/questions").then((res) => res.ok ? res.json() : null).then((data) => {
      if (Array.isArray(data) && data.length) setQuestions(data);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadMe();
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "success") {
      setCheckoutMessage("Płatność przyjęta. Sprawdzamy aktywny dostęp.");
      window.setTimeout(loadMe, 1200);
    }
    if (checkout === "cancelled") setCheckoutMessage("Płatność została anulowana.");
    const verifyEmail = params.get("verifyEmail");
    if (verifyEmail) {
      fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: verifyEmail })
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          setCheckoutMessage(ok ? "Adres e-mail został potwierdzony." : data?.message ?? "Nie udało się potwierdzić adresu e-mail.");
          if (ok && data?.user) {
            setUser(data.user);
            setAccess(data.access ?? { hasActiveAccess: false, planCode: "free", expiresAt: null });
          }
        })
        .catch(() => setCheckoutMessage("Brak połączenia z serwerem."));
    }
    fetch("/api/plans")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (Array.isArray(data) && data.length) setPlans(data);
      })
      .catch(() => undefined);
  }, [loadMe]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    setUser(null);
    setAccess({ hasActiveAccess: false, planCode: "free", expiresAt: null });
    setView("home");
  }

  const navigate = useCallback((nextView: View) => {
    if (examInProgress && view === "exam" && nextView !== "exam") {
      playUiSound("danger");
      setPendingView(nextView);
      return;
    }
    playUiSound("click");
    setView(nextView);
  }, [examInProgress, view]);

  const confirmLeaveExam = useCallback(() => {
    playUiSound("danger");
    if (pendingView) setView(pendingView);
    setPendingView(null);
    setExamInProgress(false);
  }, [pendingView]);

  function handleAuth(nextUser: AuthUser, nextAccess: AccessState) {
    setUser(nextUser);
    setAccess(nextAccess);
  }

  async function startCheckout(planCode: string) {
    setCheckoutMessage("");
    setCheckoutLoading(planCode);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planCode })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.url) {
        setCheckoutMessage(data?.message ?? "Nie udało się rozpocząć płatności.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutMessage("Brak połączenia z serwerem.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  const visibleNav = useMemo(() => (
    user?.role === "ADMIN"
      ? [...nav, { id: "admin" as const, label: "Admin", icon: Settings }]
      : nav
  ), [user?.role]);

  function toggleSound() {
    const nextMuted = !soundMuted;
    setUiSoundMuted(nextMuted);
    setSoundMuted(nextMuted);
    if (!nextMuted) window.setTimeout(() => playUiSound("success"), 0);
  }

  function closeWelcome(nextView?: View) {
    window.localStorage.setItem("zdajb-welcome-seen", "true");
    setWelcomeOpen(false);
    if (nextView) navigate(nextView);
  }

  const activeView = useMemo(() => {
    const hasFullAccess = Boolean(access.hasActiveAccess || user?.role === "ADMIN");
    if (view === "home") return <HomeView onSelect={navigate} user={user} access={access} onAuth={handleAuth} onLogout={logout} />;
    if (view === "account") return <AccountView user={user} access={access} plans={plans} onAuth={handleAuth} onLogout={logout} onSelect={navigate} />;
    if (view === "pricing") return <PricingView plans={plans} user={user} access={access} onNeedAuth={() => navigate("home")} onCheckout={startCheckout} checkoutMessage={checkoutMessage} checkoutLoading={checkoutLoading} />;
    if (view === "terms" || view === "privacy" || view === "refunds" || view === "contact") return <LegalView page={view} />;
    if (view === "admin") {
      return user?.role === "ADMIN"
        ? <AdminView currentUser={user} plans={plans} onPlansChange={setPlans} onSelfSessionsCleared={() => { setUser(null); setAccess({ hasActiveAccess: false, planCode: "free", expiresAt: null }); setView("home"); }} />
        : <PaywallCard title="Panel administratora" text="Ten widok jest dostępny tylko dla konta administratora." onPricing={() => navigate("account")} onTraining={() => navigate("training")} />;
    }
    if (view === "exam") {
      return hasFullAccess
        ? <ExamView onActiveChange={setExamInProgress} />
        : <PaywallCard title="Egzamin jest w pełnym dostępie" text="Tryb egzaminu zapisuje wynik, używa oficjalnego limitu czasu i odtwarza materiały wideo według zasad egzaminacyjnych." onPricing={() => navigate("account")} onTraining={() => navigate("training")} />;
    }
    if (view === "difficult") {
      return hasFullAccess
        ? <DifficultView />
        : <PaywallCard title="Trudne pytania są w pełnym dostępie" text="Zapisuj błędy, wracaj do nich według harmonogramu i buduj listę pytań, które trzeba powtórzyć przed egzaminem." onPricing={() => navigate("account")} onTraining={() => navigate("training")} />;
    }
    if (view === "stats") return <StatsView user={user} onPricing={() => navigate("account")} />;
    return <TrainingView questions={questions} user={user} access={access} onPricing={() => navigate("account")} />;
  }, [access, checkoutLoading, checkoutMessage, navigate, plans, questions, user, view]);

  const fullWidthView = view === "home" || view === "account" || view === "terms" || view === "privacy" || view === "refunds" || view === "contact";

  return (
    <main className="min-h-screen bg-surface-950 px-3 py-3 text-zinc-100 md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-panel bg-surface-900 p-3 shadow-soft md:flex-row md:items-center md:justify-between">
          <button
            className="flex items-center gap-3 rounded-card px-1 py-1 text-left transition hover:bg-surface-800 focus:outline-none"
            onClick={() => navigate("home")}
            aria-label="Przejdź do menu głównego"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-card bg-accent text-surface-950"><Car size={26} /></div>
            <div><p className="text-sm text-zinc-400">Trening teorii kat. B</p><h1 className="text-2xl font-extrabold tracking-normal text-zinc-50">Zdaj B</h1></div>
          </button>
          <nav className="grid grid-cols-3 gap-2 md:flex">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              return <Button key={item.id} tone={view === item.id ? "primary" : "ghost"} icon={<Icon size={17} />} onClick={() => navigate(item.id)}>{item.label}</Button>;
            })}
          </nav>
        </header>
        <section className={fullWidthView ? "block" : "grid gap-4 lg:grid-cols-[1fr_320px]"}>
          <div>{activeView}</div>
          {!fullWidthView ? (
            <aside className={view === "exam" ? "hidden space-y-4 xl:block" : "space-y-4"}>
              <AccountCard user={user} access={access} onAuth={handleAuth} onLogout={logout} onPricing={() => navigate("account")} />
            </aside>
          ) : null}
        </section>
        <footer className="flex flex-col gap-3 rounded-panel border border-zinc-800/80 bg-surface-900/70 px-4 py-4 text-sm text-zinc-400 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold text-zinc-200">Zdaj B</p>
            <p className="mt-1 text-xs">Trening teorii prawa jazdy kat. B. Serwis nie jest oficjalnym systemem egzaminacyjnym.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "terms" as const, label: "Regulamin" },
              { id: "privacy" as const, label: "Prywatność" },
              { id: "refunds" as const, label: "Zwroty" },
              { id: "contact" as const, label: "Kontakt" }
            ].map((item) => (
              <button key={item.id} className="rounded-button border border-zinc-700/70 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-accent/70 hover:text-accent" onClick={() => navigate(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </footer>
      </div>
      <button
        className={`fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border shadow-lift transition hover:scale-105 ${soundMuted ? "border-zinc-600/70 bg-surface-900 text-zinc-300" : "border-accent/70 bg-accent text-surface-950"}`}
        onClick={toggleSound}
        title={soundMuted ? "Włącz dźwięk" : "Wycisz dźwięk"}
        aria-label={soundMuted ? "Włącz dźwięk" : "Wycisz dźwięk"}
      >
        {soundMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}
      </button>
      {pendingView ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-panel border border-zinc-700/70 bg-surface-800 p-6 shadow-lift">
            <div className="flex h-12 w-12 items-center justify-center rounded-card border border-danger/60 bg-danger/10 text-danger">
              <XCircle size={26} />
            </div>
            <h2 className="mt-4 text-2xl font-extrabold text-zinc-50">Opuścić egzamin?</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Jeśli opuścisz egzamin teraz, aktualny wynik nie zostanie zapisany. Do tego podejścia nie będzie można wrócić.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button tone="danger" onClick={confirmLeaveExam}>Tak, opuść</Button>
              <Button tone="success" onClick={() => setPendingView(null)}>Nie, zostań</Button>
            </div>
          </div>
        </div>
      ) : null}
      {welcomeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/78 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="w-full max-w-lg rounded-panel border border-zinc-700/70 bg-surface-800 p-6 shadow-lift"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-accent text-surface-950">
                  <Car size={26} />
                </div>
                <div>
                  <p className="text-sm text-zinc-400">Witaj w</p>
                  <h2 className="text-2xl font-extrabold text-zinc-50">Zdaj B</h2>
                </div>
              </div>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-600/70 bg-surface-900 text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-50"
                onClick={() => closeWelcome()}
                aria-label="Zamknij"
              >
                <XCircle size={18} />
              </button>
            </div>
            <p className="mt-5 text-sm leading-6 text-zinc-300">
              Zdaj B pomaga ćwiczyć teorię prawa jazdy kat. B: szybki trening pytań, symulację egzaminu, powtórki błędów i statystyki postępów.
            </p>
            <div className="mt-4 rounded-card border border-accent/35 bg-accent/10 p-4">
              <p className="text-sm font-semibold text-zinc-100">Dlaczego warto korzystać ze Zdaj B?</p>
              <p className="mt-2 text-xs leading-5 text-zinc-300">
                Aktualna baza pytań kategorii B na lipiec 2026, filmy w treningu, wygodny interfejs, statystyki nauki i niskie ceny za pełny dostęp bez stałej subskrypcji.
              </p>
            </div>
            <div className="mt-5 grid gap-3">
              <div className="flex gap-3 rounded-card bg-surface-900 p-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={18} />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Trening jest dostępny od razu</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">Możesz ćwiczyć pytania i filmy bez presji czasu. Darmowy limit to 30 pytań dziennie.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-card bg-surface-900 p-3">
                <TimerReset className="mt-0.5 shrink-0 text-accent" size={18} />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Płatny dostęp odblokowuje przygotowanie pełne</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">Trening bez limitu, egzamin z limitem czasu, trudne pytania, zapis wyników i statystyki.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-card bg-surface-900 p-3">
                <CreditCard className="mt-0.5 shrink-0 text-accent" size={18} />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Dostęp kupujesz na wybrany czas</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">Bez stałej subskrypcji. Po zakończeniu okresu możesz zdecydować, czy przedłużyć dostęp.</p>
                </div>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button icon={<Play size={18} />} onClick={() => closeWelcome("training")}>Rozpocznij trening</Button>
              <Button tone="ghost" icon={<UserRound size={18} />} onClick={() => closeWelcome("account")}>Konto i dostęp</Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </main>
  );
}



