import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import "./style.css";
type Player = { id: string; name: string; score: number };
type Source = {
  url: string;
  title: string;
  publisher: string;
  rightsNote: string;
};
type State = {
  code: string;
  version: number;
  phase: "lobby" | "ready" | "playing" | "settled" | "finished";
  players: Player[];
  me: string;
  host: string;
  guesser: string;
  turn: number;
  turns: number;
  totalTurns: number;
  skips?: boolean;
  question?: string;
  category?: string;
  answer?: string;
  role?: string;
  provisional?: number;
  revealed?: Record<string, string>;
  kept?: Record<string, boolean>;
  roles?: Record<string, string>;
  gains?: Record<string, number>;
  result?: string;
  sources?: Source[];
  explanation?: string;
};
type Intent = {
  id: string;
  action: string;
  version: number;
  [key: string]: string | number | boolean;
};
const pendingKey = "bluffery.pending.v1";
function getPending(): Intent | null {
  try {
    const raw = localStorage.getItem(pendingKey);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (
      !v ||
      typeof v.id !== "string" ||
      typeof v.action !== "string" ||
      typeof v.version !== "number"
    )
      throw Error("corrupt");
    return v;
  } catch {
    throw Error(
      "Een bewaarde actie is onleesbaar. Wis de sitegegevens alleen als je zeker weet dat je wilt stoppen.",
    );
  }
}
type FaceProps = {
  fill?: string;
  eye?: string;
  pupil?: string;
  look?: number;
  size?: number;
  squint?: boolean;
  shifty?: boolean;
  mouth?: "smirk" | "sly" | "grin" | "flat";
  mouthColor?: string;
  className?: string;
};
const mouths = {
  smirk: "M17 35 Q 26 39 33 33",
  sly: "M15 33 Q 25 38 34 30",
  grin: "M14 31 Q 24 40 34 31",
  flat: "M17 34 H 31",
};
function Face({
  fill = "#3a3370",
  eye = "#fff",
  pupil = "#14112b",
  look = 0,
  size = 44,
  squint = false,
  shifty = false,
  mouth,
  mouthColor = "#14112b",
  className = "",
}: FaceProps) {
  return (
    <svg
      className={("face " + className).trim()}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="44" height="44" rx="14" fill={fill} />
      {squint ? (
        <>
          <path d="M10.5 21 Q 17 15 23.5 21 Q 17 24 10.5 21Z" fill={eye} />
          <path d="M24.5 21 Q 31 15 37.5 21 Q 31 24 24.5 21Z" fill={eye} />
          <circle cx="20" cy="20.5" r="2.4" fill={pupil} />
          <circle cx="34" cy="20.5" r="2.4" fill={pupil} />
        </>
      ) : (
        <>
          <ellipse cx="17" cy="21" rx="6.5" ry="7.5" fill={eye} />
          <ellipse cx="31" cy="21" rx="6.5" ry="7.5" fill={eye} />
          <g className={shifty ? "shifty" : undefined}>
            <circle cx={17 + look} cy="22" r="3.2" fill={pupil} />
            <circle cx={31 + look} cy="22" r="3.2" fill={pupil} />
          </g>
        </>
      )}
      {mouth && (
        <path
          d={mouths[mouth]}
          stroke={mouthColor}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
const faces = {
  mark: { fill: "#ff8a3d", mouth: "smirk" },
  bluffer: { fill: "#14112b", squint: true, mouth: "sly", mouthColor: "#fff" },
  truth: {
    fill: "#fff",
    eye: "#3b5bf5",
    pupil: "#fff",
    mouth: "flat",
    mouthColor: "#3b5bf5",
  },
  red: { fill: "#ff8a3d" },
  blue: { fill: "#3b5bf5" },
  light: { fill: "#f6f3ff", eye: "#14112b", pupil: "#f6f3ff" },
  winner: { fill: "#ff8a3d", squint: true, mouth: "grin" },
} satisfies Record<string, FaceProps>;
function lookFor(id: string) {
  let n = 0;
  for (const c of id) n += c.charCodeAt(0);
  return [-3, 0, 3][n % 3];
}
function Confetti({ big = false }: { big?: boolean }) {
  return (
    <span className={"burst" + (big ? " big" : "")} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="cf" />
      ))}
    </span>
  );
}
function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const icons = {
  trophy:
    "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5",
  lock: "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM8 11V7a4 4 0 0 1 8 0v4",
  eye: "M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  eyeOff:
    "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a12 12 0 0 1-3 4.1M6.6 6.6A12 12 0 0 0 2 12c1 2.5 5 7 10 7a10 10 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  refresh: "M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5",
  crown: "M4 19h16M4 15 3 7l5 4 4-6 4 6 5-4-1 8Z",
  exit: "M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H10",
};
const maxTurns = 5;
const gone = "Je zit niet meer aan deze tafel.";
function App() {
  const [state, setState] = useState<State | null>(null),
    [name, setName] = useState(""),
    [code, setCode] = useState(
      new URLSearchParams(location.search)
        .get("code")
        ?.toUpperCase()
        .slice(0, 6) || "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [ready, setReady] = useState(false),
    [pending, setPending] = useState<Intent | null>(null),
    [qr, setQr] = useState(""),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [install, setInstall] = useState<any>(null),
    [recoveryBlocked, setRecoveryBlocked] = useState(false),
    [streamConnected, setStreamConnected] = useState(false);
  const alive = useRef(true),
    opted = useRef(false),
    latest = useRef<State | null>(null),
    sequence = useRef(0),
    applied = useRef(0);
  function accept(v: State, seq: number) {
    if (!alive.current || seq < applied.current) return;
    const old = latest.current;
    if (old && v.code === old.code && v.version < old.version) return;
    applied.current = seq;
    latest.current = v;
    setState(v);
  }
  // Back to the start screen after leaving, being removed or an expired session.
  function dropped(message = "") {
    applied.current = ++sequence.current;
    latest.current = null;
    setState(null);
    setSheet(null);
    setCode("");
    setError(message);
    void fetch("/api/session", { cache: "no-store" }).catch(() => {});
  }
  async function refresh(initial = false) {
    const seq = ++sequence.current;
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) accept(await r.json(), seq);
      else if (
        r.status === 404 &&
        !initial &&
        seq >= applied.current &&
        latest.current
      )
        dropped(gone);
    } catch {
      /* Online state and pending actions remain intact. */
    }
  }
  useEffect(() => {
    alive.current = true;
    try {
      setPending(getPending());
    } catch (e) {
      setRecoveryBlocked(true);
      setError((e as Error).message);
    }
    const bootstrap = async () => {
      try {
        if (navigator.onLine) {
          const r = await fetch("/api/session", { cache: "no-store" });
          if (!r.ok)
            throw Error(
              "Een sessie maken lukt nu niet. Probeer later opnieuw.",
            );
          await refresh(!latest.current);
        }
        if (alive.current) setReady(true);
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
    };
    void bootstrap();
    const on = () => {
        setOnline(true);
        void bootstrap();
      },
      off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      alive.current = false;
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (!state?.code || !ready || !online) return;
    let current = true;
    const stream = new EventSource("/api/events");
    stream.onopen = () => {
      if (current) setStreamConnected(true);
    };
    stream.addEventListener("revision", () => {
      if (current) void refresh();
    });
    stream.addEventListener("expired", () => {
      if (!current) return;
      stream.close();
      dropped(gone);
    });
    stream.onerror = () => {
      if (current) setStreamConnected(false);
    };
    return () => {
      current = false;
      stream.close();
      setStreamConnected(false);
    };
  }, [state?.code, ready, online]);
  useEffect(() => {
    if (!state?.code) return;
    QRCode.toDataURL(`${location.origin}/?code=${state.code}`, {
      width: 256,
      margin: 2,
      color: { dark: "#14112b", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [state?.code]);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration;
    const update = () => {
      if (reg?.waiting && navigator.serviceWorker.controller)
        setWaiting(reg.waiting);
    };
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((r) => {
        reg = r;
        update();
        r.addEventListener("updatefound", () =>
          r.installing?.addEventListener("statechange", update),
        );
        void r.update();
      })
      .catch(() => {});
    const controller = () => {
      setWaiting(null);
      if (opted.current) location.reload();
    };
    const offer = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    const installed = () => setInstall(null);
    navigator.serviceWorker.addEventListener("controllerchange", controller);
    addEventListener("beforeinstallprompt", offer);
    addEventListener("appinstalled", installed);
    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controller,
      );
      removeEventListener("beforeinstallprompt", offer);
      removeEventListener("appinstalled", installed);
    };
  }, []);
  async function send(intent: Intent) {
    if (busy || !navigator.onLine) return;
    setBusy(true);
    setError("");
    const seq = ++sequence.current;
    try {
      localStorage.setItem(pendingKey, JSON.stringify(intent));
      setPending(intent);
      const r = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
        cache: "no-store",
      });
      let v: any;
      try {
        v = await r.json();
      } catch {
        throw Error("Antwoord onleesbaar. Probeer dezelfde actie opnieuw.");
      }
      if (r.status >= 500 || r.status === 429)
        throw Error(
          v.error || "Nog geen bevestiging. Probeer dezelfde actie opnieuw.",
        );
      if (localStorage.getItem(pendingKey) === JSON.stringify(intent)) {
        localStorage.removeItem(pendingKey);
        if (alive.current) setPending(null);
      }
      if (!r.ok) {
        if (alive.current) setError(v.error || "Actie geweigerd.");
        await refresh();
        return;
      }
      if (intent.action === "leave") dropped();
      else accept(v, seq);
    } catch (e) {
      if (alive.current)
        setError(
          (e as Error).message ||
            "Geen bevestiging. Probeer dezelfde actie opnieuw.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function action(
    action: string,
    extra: Record<string, string | number | boolean> = {},
  ) {
    if (pending) {
      setError("Bevestig eerst de bewaarde actie.");
      return;
    }
    void send({
      id: crypto.randomUUID(),
      action,
      version: state?.version || 0,
      ...extra,
    });
  }
  const disabled =
    busy ||
    !online ||
    !ready ||
    !!pending ||
    recoveryBlocked ||
    (!!state && !streamConnected);
  const host = state?.host === state?.me,
    guesser = state?.guesser === state?.me;
  const who = (id?: string) =>
    state?.players.find((p) => p.id === id)?.name || "de rader";
  const [sheet, setSheet] = useState<"help" | "stand" | "leave" | null>(null),
    [armed, setArmed] = useState(""),
    [outcome, setOutcome] = useState<string | null>(null),
    [veiled, setVeiled] = useState(false),
    [copied, setCopied] = useState(false),
    [turnsDraft, setTurnsDraft] = useState<string | null>(null);
  const prevPhase = useRef<string | undefined>(undefined),
    reveals = useRef({
      key: "",
      known: new Set<string>(),
      fresh: new Set<string>(),
    });
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = state?.phase;
    if (state?.phase !== "settled") {
      setOutcome(null);
      return;
    }
    if (prev !== "playing") return;
    setOutcome(state.result || "bank");
    const t = setTimeout(() => setOutcome(null), 2800);
    return () => clearTimeout(t);
  }, [state?.phase, state?.turn]);
  useEffect(() => setVeiled(false), [state?.turn, state?.phase]);
  const theme =
    state?.phase === "playing" && !guesser && state.role
      ? state.role === "blue"
        ? "theme-blue"
        : "theme-red"
      : "";
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        theme === "theme-red"
          ? "#ff8a3d"
          : theme === "theme-blue"
            ? "#3b5bf5"
            : "#14112b",
      );
  }, [theme]);

  // Only reveals that happen while this screen is open get the big entrance;
  // a reload mid-turn shows earlier reveals at rest.
  const revealed = state?.revealed || {};
  const revealedIds = Object.keys(revealed);
  const memo = reveals.current;
  const turnKey = state ? `${state.code}:${state.turn}` : "";
  if (memo.key !== turnKey || revealedIds.length === 0) {
    memo.key = turnKey;
    memo.known = new Set(revealedIds);
    memo.fresh = new Set();
  } else
    for (const id of revealedIds)
      if (!memo.known.has(id)) {
        memo.known.add(id);
        memo.fresh.add(id);
      }

  const others = state
    ? state.players.filter((p) => p.id !== state.guesser)
    : [];
  const redsTotal = Math.max(0, others.length - 1);
  const redsCaught = revealedIds.filter((id) => revealed[id] === "red").length;
  const freshReds = [...memo.fresh].filter(
    (id) => revealed[id] === "red",
  ).length;
  const allRedsCaught = redsTotal > 0 && redsCaught === redsTotal;
  const sorted = state
    ? [...state.players].sort((a, b) => b.score - a.score)
    : [];
  const sentTurns =
    busy && pending?.action === "configure" ? Number(pending.turns) : 0;
  const effectiveTurns = state
    ? sentTurns || state.turns || (state.players.length <= 5 ? 2 : 1)
    : 0;
  const skipsOn =
    busy && pending?.action === "allow-skips"
      ? !!pending.skips
      : !!state?.skips;
  const skipToggle = (
    <div className="stepper">
      <label htmlFor="skips">Vragen overslaan</label>
      <button
        id="skips"
        type="button"
        role="switch"
        className="switch"
        aria-checked={skipsOn}
        disabled={disabled}
        onClick={() => action("allow-skips", { skips: !skipsOn })}
      />
    </div>
  );
  function setTurns(n: number) {
    setTurnsDraft(null);
    if (!state || !Number.isInteger(n)) return;
    const turns = Math.min(maxTurns, Math.max(1, n));
    if (turns !== state.turns) action("configure", { turns });
  }
  const blueName = state?.roles
    ? state.players.find((p) => state.roles?.[p.id] === "blue")?.name
    : undefined;
  const outcomeText =
    state?.result === "bust"
      ? `${blueName || "Iemand"} was eerlijk`
      : state?.result === "last-blue"
        ? "Allemaal ontmaskerd"
        : "Binnen";
  const guesserGain = (state && state.gains?.[state.guesser]) || 0;
  const shareUrl = state ? `${location.origin}/?code=${state.code}` : "";
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Bluffery", url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError("Delen lukt niet. Laat de QR-code scannen.");
    }
  }
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(""), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  // Irreversible host actions take a second tap on the same button.
  const twoTap = (o: {
    key: string;
    className: string;
    label: string;
    confirm: string;
    icon: string;
    run: () => void;
  }) => (
    <button
      className={o.className + (armed === o.key ? " armed" : "")}
      aria-label={armed === o.key ? `${o.label}: bevestig` : o.label}
      disabled={disabled}
      onClick={() => {
        if (armed !== o.key) return setArmed(o.key);
        setArmed("");
        o.run();
      }}
    >
      <span>{armed === o.key ? o.confirm : <Icon d={o.icon} size={14} />}</span>
    </button>
  );
  const helpButton = (
    <button
      className="icon-btn"
      aria-label="Spelregels"
      onClick={() => setSheet("help")}
    >
      ?
    </button>
  );
  const brandBar = (
    <div className="topbar">
      <Face {...faces.mark} size={32} look={3} />
      <span className="wordmark">bluffery</span>
      {state && (
        <button
          className="icon-btn"
          aria-label="Tafel verlaten"
          onClick={() => setSheet("leave")}
        >
          <Icon d={icons.exit} />
        </button>
      )}
      {helpButton}
    </div>
  );
  const gameBar = state && (
    <div className="topbar">
      <Face {...faces.mark} size={32} look={3} />
      <div className="progress">
        <span>
          Beurt {Math.min(state.turn + 1, state.totalTurns)} /{" "}
          {state.totalTurns}
        </span>
        <div className="progress-track">
          <span
            style={{
              width: `${(Math.min(state.turn + 1, state.totalTurns) / Math.max(1, state.totalTurns)) * 100}%`,
            }}
          />
        </div>
      </div>
      <button
        className="icon-btn"
        aria-label="Stand"
        onClick={() => setSheet("stand")}
      >
        <Icon d={icons.trophy} />
      </button>
      {helpButton}
    </div>
  );
  const notices = (
    <>
      {state && online && !streamConnected && (
        <div className="notice" role="status">
          Verbinding herstellen…
        </div>
      )}
      {!online && (
        <div role="status" className="notice">
          <b>Je bent offline.</b> Internet is nodig om te spelen.
        </div>
      )}
      {waiting && (
        <div className="notice" role="status">
          Nieuwe versie klaar.
          <button
            disabled={busy || !!pending || !online}
            onClick={() => {
              opted.current = true;
              waiting.postMessage({ type: "ACTIVATE" });
            }}
          >
            Nu bijwerken
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {/* While the request is in flight the buttons show it; this only appears once it failed. */}
      {pending && !busy && (
        <div className="notice">
          Actie nog niet bevestigd.
          <button
            disabled={busy || !online}
            onClick={() => void send(pending)}
          >
            Dezelfde actie opnieuw proberen
          </button>
        </div>
      )}
    </>
  );

  let screen: React.ReactNode;
  if (!state) {
    screen = (
      <>
        <div className="topbar">
          <span className="grow" />
          {helpButton}
        </div>
        {notices}
        <div className="hero">
          <Face {...faces.mark} size={112} className="mark-bob" shifty />
          <h1>bluffery</h1>
          <p>Eén waarheid. De rest blufft.</p>
        </div>
        <form
          className="start-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled)
              action("join", { name: name.trim(), code: code.toUpperCase() });
          }}
        >
          <div className="name-block">
            <label className="field-label" htmlFor="name">
              Je naam
            </label>
            <input
              id="name"
              className="field name-field"
              autoComplete="nickname"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="choices">
            {/* Arriving with a code (QR link) means joining; creating only shows once the code is cleared. */}
            {!code && (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || !name.trim()}
                  onClick={() => action("create", { name: name.trim() })}
                >
                  Nieuwe tafel
                </button>
                <div className="divider">of</div>
              </>
            )}
            <div className={"join-row" + (code ? " filled" : "")}>
              <label className="sr-only" htmlFor="code">
                Tafelcode
              </label>
              <input
                id="code"
                className="field code-field"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Tafelcode"
                pattern="[A-F0-9]{6}"
              />
              <button
                className="btn"
                disabled={
                  disabled || !name.trim() || !/^[A-F0-9]{6}$/.test(code)
                }
              >
                Doe mee
              </button>
            </div>
          </div>
        </form>
      </>
    );
  } else if (state.phase === "lobby") {
    screen = (
      <>
        {brandBar}
        {notices}
        <section className="share">
          {qr && (
            <img
              className="qr"
              src={qr}
              width="128"
              height="128"
              alt={`QR-code om mee te doen aan tafel ${state.code}`}
            />
          )}
          <div className="share-info">
            <span className="field-label">Tafelcode</span>
            <span className="room-code" data-testid="room-code">
              {state.code}
            </span>
            <button
              className="btn small"
              data-share-url={shareUrl}
              onClick={() => void share()}
            >
              <Icon d={copied ? icons.check : icons.share} size={18} />
              {copied ? "Gekopieerd" : "Delen"}
            </button>
          </div>
        </section>
        <section className="grow" style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="section-head">
            <h1>Aan tafel</h1>
            <span>{state.players.length} / 10</span>
          </div>
          <ul className="players">
            {state.players.map((p, i) => (
              <li
                className="player"
                key={p.id}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Face
                  {...(p.id === state.host ? faces.red : {})}
                  look={lookFor(p.id)}
                  size={48}
                />
                <b>{p.name}</b>
                {p.id === state.host && <span className="badge">host</span>}
                {host &&
                  p.id !== state.host &&
                  twoTap({
                    key: "host:" + p.id,
                    className: "promote",
                    label: `${p.name} host maken`,
                    confirm: "Host?",
                    icon: icons.crown,
                    run: () => action("make-host", { target: p.id }),
                  })}
                {host && p.id !== state.host && (
                  <button
                    className="remove"
                    disabled={disabled}
                    aria-label={`${p.name} verwijderen`}
                    onClick={() => action("remove", { target: p.id })}
                  >
                    <span>
                      <Icon d={icons.close} size={14} />
                    </span>
                  </button>
                )}
              </li>
            ))}
            {state.players.length < 10 && (
              <li className="seat" aria-hidden="true">
                <Icon d={icons.plus} size={26} />
              </li>
            )}
          </ul>
        </section>
        {host ? (
          <>
            <div className="stepper">
              <label htmlFor="turns">Beurten per speler</label>
              <button
                type="button"
                aria-label="Minder beurten"
                disabled={disabled || effectiveTurns <= 1}
                onClick={() => setTurns(effectiveTurns - 1)}
              >
                <Icon d={icons.minus} size={18} />
              </button>
              <input
                id="turns"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxTurns}
                value={turnsDraft ?? String(effectiveTurns)}
                disabled={disabled}
                onChange={(e) => setTurnsDraft(e.target.value)}
                onBlur={() =>
                  turnsDraft !== null && setTurns(parseInt(turnsDraft, 10))
                }
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.target as HTMLInputElement).blur()
                }
              />
              <button
                type="button"
                aria-label="Meer beurten"
                disabled={disabled || effectiveTurns >= maxTurns}
                onClick={() => setTurns(effectiveTurns + 1)}
              >
                <Icon d={icons.plus} size={18} />
              </button>
            </div>
            {skipToggle}
            <button
              className={"btn" + (busy && state.players.length >= 4 ? " loading" : "")}
              aria-busy={busy && state.players.length >= 4}
              disabled={disabled || state.players.length < 4}
              onClick={() => action("start")}
            >
              {state.players.length < 4
                ? `Nog ${4 - state.players.length} nodig`
                : "Start"}
            </button>
          </>
        ) : (
          <p className="waiting">Wachten op de host</p>
        )}
      </>
    );
  } else if (state.phase === "ready") {
    screen = (
      <>
        {gameBar}
        {notices}
        <div className="center-stage">
          <div className="fan" aria-hidden="true">
            {others.map((p, i) => (
              <div
                className="fan-card"
                key={p.id}
                style={{
                  transform: `rotate(${(i - (others.length - 1) / 2) * (others.length > 5 ? 9 : 12)}deg)`,
                }}
              >
                <Face
                  fill="transparent"
                  eye="#f6f3ff"
                  look={lookFor(p.id)}
                  size={44}
                />
              </div>
            ))}
          </div>
          <div>
            <h1>{guesser ? "Jij raadt" : `${who(state.guesser)} raadt`}</h1>
            <p>{others.length} verhalen. 1 is waar.</p>
          </div>
        </div>
        {guesser ? (
          <button
            className="btn nudge"
            disabled={disabled}
            onClick={() => action("deal")}
          >
            Uitdelen
          </button>
        ) : (
          <p className="waiting">Wachten op uitdelen</p>
        )}
      </>
    );
  } else if (state.phase === "playing" && guesser) {
    screen = (
      <>
        {gameBar}
        {notices}
        <section className="question">
          <div className="question-head">
            <span className="chip">{state.category}</span>
            {state.skips && revealedIds.length === 0 && (
              <button
                className="skip"
                disabled={disabled}
                onClick={() => action("skip")}
              >
                <Icon d={icons.refresh} size={14} />
                Andere vraag
              </button>
            )}
          </div>
          <h1>{state.question}</h1>
        </section>
        <div className="pot">
          <span className="pot-n" data-testid="pot">
            {state.provisional ?? 0}
          </span>
          <span className="pot-label">op het spel</span>
          <div className="pips" aria-hidden="true">
            {Array.from({ length: redsTotal }, (_, i) => (
              <span
                key={i}
                className={
                  "pip" +
                  (i < redsCaught
                    ? " on" + (i >= redsCaught - freshReds ? " fresh" : "")
                    : "")
                }
              />
            ))}
          </div>
        </div>
        <ul className="suspects grow">
          {others.map((p) => {
            const role = revealed[p.id],
              fresh = memo.fresh.has(p.id),
              kept = !!state.kept?.[p.id],
              last = allRedsCaught && !role,
              label = last ? "+1 bonus" : "Bluf!";
            return (
              <li
                className="suspect"
                key={p.id}
                data-testid={"suspect-" + p.id}
              >
                {!role ? (
                  <div className={"row" + (kept ? " kept" : "")}>
                    <Face look={lookFor(p.id)} />
                    <b>{p.name}</b>
                    <button
                      className="keep"
                      aria-label={`Geloof ik: ${p.name}`}
                      aria-pressed={kept}
                      disabled={disabled}
                      onClick={() => action("keep", { target: p.id })}
                    >
                      <Icon d={icons.check} />
                    </button>
                    <button
                      className={"accuse" + (last ? " bonus" : "")}
                      aria-label={`${label} ${p.name}`}
                      disabled={disabled}
                      onClick={() => action("reveal", { target: p.id })}
                    >
                      {label}
                    </button>
                  </div>
                ) : role === "red" ? (
                  <div className={"row caught" + (fresh ? " fresh" : "")}>
                    <Face {...faces.bluffer} />
                    <b>{p.name}</b>
                    <span className="stamp-wrap">
                      <span className="stamp">Bluffer</span>
                      {fresh && (
                        <>
                          <Confetti />
                          <span className="plus" aria-hidden="true">
                            +1
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                ) : (
                  <div className={"row honest" + (fresh ? " fresh" : "")}>
                    <Face {...faces.truth} />
                    <b>{p.name}</b>
                    <span className="row-tag">Eerlijk</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button
          className="btn ghost"
          disabled={disabled}
          onClick={() => action("bank")}
        >
          Stop &amp; pak {state.provisional ?? 0}
        </button>
      </>
    );
  } else if (state.phase === "playing") {
    const red = state.role !== "blue",
      caught = revealed[state.me] === "red";
    screen = (
      <>
        <div className="role-top">
          <span>
            <Icon d={icons.lock} size={18} />
            Alleen voor jou
          </span>
          <button
            className="icon-btn"
            aria-label="Antwoord verbergen"
            aria-pressed={veiled}
            onClick={() => setVeiled((v) => !v)}
          >
            <Icon d={veiled ? icons.eye : icons.eyeOff} />
          </button>
        </div>
        {notices}
        <p className="role-question">{state.question}</p>
        <div className="role-stage" key={state.question}>
          <div
            className={
              "role-face" + (caught && memo.fresh.has(state.me) ? " fresh" : "")
            }
          >
            {red ? (
              <Face {...faces.bluffer} size={150} className="smug" />
            ) : (
              <Face {...faces.truth} size={150} className="steady" />
            )}
            {caught && (
              <span className="stamp-wrap">
                <span className="stamp">Betrapt</span>
              </span>
            )}
          </div>
          <h1>{red ? "Jij blufft" : "Jij bent eerlijk"}</h1>
          <p>
            {red ? "Verzin een ander antwoord." : "Zeg de waarheid. Klink verdacht."}
          </p>
        </div>
        <div className={"answer" + (veiled ? " veiled" : "")}>
          <span>{red ? "Niet zeggen" : "Het antwoord"}</span>
          <strong data-testid="private-answer">{state.answer}</strong>
        </div>
      </>
    );
  } else if (state.phase === "settled") {
    const rows = [...state.players].sort(
      (a, b) =>
        Number(b.id === state.guesser) - Number(a.id === state.guesser) ||
        (state.gains?.[b.id] || 0) - (state.gains?.[a.id] || 0),
    );
    screen = (
      <>
        {gameBar}
        {notices}
        <h1 className="outcome-title">{outcomeText}</h1>
        <section className="reveal-card">
          <span>{state.question}</span>
          <strong data-testid="settled-answer">{state.answer}</strong>
          {state.explanation && <p>{state.explanation}</p>}
          {!!state.sources?.length && (
            <details>
              <summary>Bronnen</summary>
              <ul>
                {state.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} rel="noreferrer" target="_blank">
                      {s.publisher} · {s.title}
                    </a>
                    <span className="rights">{s.rightsNote}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <ul className="results grow">
          {rows.map((p, i) => {
            const role = state.roles?.[p.id],
              isGuesser = p.id === state.guesser,
              gain = state.gains?.[p.id] || 0;
            return (
              <li
                className="result"
                key={p.id}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Face
                  {...(isGuesser
                    ? faces.light
                    : role === "blue"
                      ? faces.blue
                      : faces.red)}
                  look={lookFor(p.id)}
                  size={40}
                />
                <span className="result-name">
                  <b>{p.name}</b>
                  {isGuesser ? (
                    <span className="tag-rader">Rader</span>
                  ) : role === "blue" ? (
                    <span className="tag-blue">Eerlijk</span>
                  ) : (
                    <span className="tag-red">
                      Bluffer · {revealed[p.id] ? "betrapt" : "ontsnapt"}
                    </span>
                  )}
                </span>
                <b className={"gain" + (gain ? "" : " zero")}>+{gain}</b>
              </li>
            );
          })}
        </ul>
        {guesser ? (
          <button
            className="btn"
            disabled={disabled}
            onClick={() => action("next")}
          >
            Volgende beurt
          </button>
        ) : (
          <p className="waiting">{who(state.guesser)} gaat verder</p>
        )}
      </>
    );
  } else {
    const top = Math.max(...state.players.map((p) => p.score));
    const winners = state.players.filter((p) => p.score === top);
    const steps = [
      { rank: 1, face: faces.light, height: 110 },
      { rank: 0, face: faces.winner, height: 160 },
      { rank: 2, face: faces.blue, height: 80 },
    ];
    screen = (
      <>
        <div className="rain" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        {brandBar}
        {notices}
        <h1 className="winner">
          {winners.map((p) => p.name).join(" & ")}{" "}
          {winners.length > 1 ? "winnen" : "wint"}
        </h1>
        <div className="podium">
          {steps.map(({ rank, face, height }) => {
            const p = sorted[rank];
            if (!p) return <div key={rank} />;
            return (
              <div className={"step" + (rank === 0 ? " first" : "")} key={rank}>
                {rank === 0 && (
                  <svg
                    className="crown"
                    width="40"
                    height="28"
                    viewBox="0 0 40 28"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 24 L6 6 L14 15 L20 3 L26 15 L34 6 L37 24 Z"
                      fill="#ffd08a"
                      stroke="#ffd08a"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                <Face {...face} look={lookFor(p.id)} size={rank === 0 ? 76 : 56} />
                <b>{p.name}</b>
                <div
                  className="block"
                  style={{ height, animationDelay: `${[0, 150, 300][rank]}ms` }}
                >
                  <span>{p.score}</span>
                  <span>{rank + 1}e</span>
                </div>
              </div>
            );
          })}
        </div>
        <ol className="standings grow" start={4}>
          {sorted.slice(3).map((p, i) => (
            <li key={p.id}>
              <span className="rank">{i + 4}</span>
              <span className="who">{p.name}</span>
              <span className="score">{p.score}</span>
            </li>
          ))}
        </ol>
        {host ? (
          <button
            className="btn"
            disabled={disabled}
            onClick={() => action("new-game")}
          >
            Nog een potje
          </button>
        ) : (
          <p className="waiting">Wachten op de host</p>
        )}
      </>
    );
  }

  return (
    <div className={"app " + (state ? theme : "start")}>
      <main
        className={
          "wrap" +
          (state?.phase === "finished" ? " finished" : "") +
          (outcome === "bust" ? " shake" : "")
        }
      >
        {screen}
      </main>
      {sheet && (
        <div
          className="backdrop"
          onClick={() => {
            setSheet(null);
            setArmed("");
          }}
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setSheet(null)}
          >
            <div className="sheet-head">
              <h2 id="sheet-title">
                {sheet === "help"
                  ? "Zo speel je"
                  : sheet === "stand"
                    ? "Stand"
                    : "Tafel verlaten?"}
              </h2>
              <button
                className="icon-btn"
                aria-label="Sluiten"
                autoFocus
                onClick={() => {
                  setSheet(null);
                  setArmed("");
                }}
              >
                <Icon d={icons.close} />
              </button>
            </div>
            {sheet === "stand" ? (
              <>
                <ol className="standings">
                  {sorted.map((p, i) => (
                    <li key={p.id}>
                      <span className="rank">{i + 1}</span>
                      <span className="who">
                        {p.name}
                        {p.id === state?.guesser &&
                          state?.phase !== "finished" && <small>raadt nu</small>}
                      </span>
                      <span className="score">{p.score}</span>
                      {host && p.id !== state?.host && (
                        <>
                          {twoTap({
                            key: "host:" + p.id,
                            className: "kick",
                            label: `${p.name} host maken`,
                            confirm: "Host",
                            icon: icons.crown,
                            run: () => action("make-host", { target: p.id }),
                          })}
                          {twoTap({
                            key: "kick:" + p.id,
                            className: "kick",
                            label: `${p.name} verwijderen`,
                            confirm: "Eruit",
                            icon: icons.close,
                            run: () => action("remove", { target: p.id }),
                          })}
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                {host && state?.phase !== "finished" && skipToggle}
                <button
                  className="btn small ghost"
                  onClick={() => {
                    setArmed("");
                    setSheet("leave");
                  }}
                >
                  <Icon d={icons.exit} size={18} />
                  Tafel verlaten
                </button>
              </>
            ) : sheet === "leave" ? (
              <>
                {host && state && state.players.length > 1 && (
                  <p>
                    {state.players.find((p) => p.id !== state.me)?.name} wordt
                    host.
                  </p>
                )}
                <button
                  className={"btn" + (busy ? " loading" : "")}
                  aria-busy={busy}
                  disabled={disabled}
                  onClick={() => action("leave")}
                >
                  Verlaten
                </button>
              </>
            ) : (
              <>
                <ul className="rules">
                  <li>
                    <span>
                      Eén speler <b>raadt</b>. De rest krijgt stiekem een rol:
                      één is <b>eerlijk</b>, de anderen <b>bluffen</b>.
                    </span>
                  </li>
                  <li>
                    <span>
                      Iedereen geeft hardop een antwoord. Bluffers verzinnen
                      er een.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>Bluf!</b> ontmaskert iemand. Elke bluffer is een punt
                      in de pot. Stop wanneer je wilt en pak de pot.
                    </span>
                  </li>
                  <li>
                    <span>
                      Eerlijke speler te vroeg? Pot kwijt. Als laatste?{" "}
                      <b>+1 bonus</b>.
                    </span>
                  </li>
                  <li>
                    <span>
                      Elke bluffer die ontsnapt krijgt 1 punt. De eerlijke
                      speler alleen als die te vroeg is ontmaskerd. Het vinkje
                      is alleen een notitie voor jezelf.
                    </span>
                  </li>
                  {state?.skips && (
                    <li>
                      <span>
                        <b>Andere vraag</b> kan tot de eerste Bluf!
                      </span>
                    </li>
                  )}
                </ul>
                <h3>Installeren</h3>
                {install && (
                  <button
                    className="btn small"
                    onClick={() => {
                      void install.prompt();
                      setInstall(null);
                    }}
                  >
                    Installeer Bluffery
                  </button>
                )}
                <p>
                  iPhone/iPad: Safari › Delen › Zet op beginscherm. Android:
                  ‘App installeren’ in het browsermenu.
                </p>
                <h3>Privacy</h3>
                <p>
                  Geen account, advertenties, trackers of externe lettertypen.
                  Je naam en spel horen bij deze tafel. Je sessie verloopt na 7
                  dagen, een tafel 7 dagen na de laatste actie. Voor
                  misbruikpreventie bewaren we tijdelijk gehashte
                  netwerkadressen. De privécookie zit nooit in de deelcode;
                  zonder die cookie kun je niet terugkeren.
                </p>
                <h3>Bronnen &amp; rechten</h3>
                <p>
                  Rechten verschillen per bron; de bronverantwoording en
                  rechtennotitie bij een vraag verschijnen pas na de beurt.
                </p>
                <ul className="rules">
                  <li>
                    <a
                      href="https://huggingface.co/datasets/YWZBrandon/wikidyk"
                      target="_blank"
                      rel="noreferrer"
                    >
                      WikiDYK
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Wikipedia · Unusual articles
                    </a>
                  </li>
                  <li>
                    <a href="https://opentdb.com/" target="_blank" rel="noreferrer">
                      Open Trivia Database
                    </a>
                  </li>
                </ul>
                <p>
                  Onafhankelijk spel met eigen vormgeving en Nederlandse
                  vraagbewerkingen.
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {outcome && state?.phase === "settled" && (
        <>
          {outcome === "bust" && <div className="flash" aria-hidden="true" />}
          <div className="backdrop" onClick={() => setOutcome(null)}>
            <section
              className={
                "sheet outcome " +
                (outcome === "bust"
                  ? "blue"
                  : outcome === "last-blue"
                    ? "red"
                    : "light")
              }
              role="dialog"
              aria-modal="true"
              aria-label="Uitslag"
            >
              {outcome === "last-blue" && <Confetti big />}
              <span className="outcome-n">
                {outcome === "bust" ? "0" : "+" + guesserGain}
              </span>
              <span className="outcome-label">{outcomeText}</span>
              <button
                className={"btn " + (outcome === "bust" ? "light" : "ink")}
                autoFocus
                onClick={() => setOutcome(null)}
              >
                Verder
              </button>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
