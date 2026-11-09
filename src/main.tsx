import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import "./style.css";
type Player = { id: string; name: string; score: number };
type Source = { url: string; title: string; publisher: string };
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
  [key: string]: string | number;
};
const pendingKey = "vissig.pending.v1";
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
function Fish({ blue = false }: { blue?: boolean }) {
  return (
    <svg className="fish-art" viewBox="0 0 180 100" aria-hidden="true">
      <path
        d="M134 49 173 19v62l-39-30C115 97 44 94 12 50 44 6 115 4 134 49Z"
        fill={blue ? "#66bde8" : "#ef795d"}
      />
      <path
        d="M63 20 86 6l17 16M64 79l24 15 15-16"
        fill={blue ? "#2e82b1" : "#b44b36"}
      />
      <circle cx="43" cy="43" r="7" fill="#133f3b" />
      <path
        d="M110 30q-13 20 0 40"
        stroke="#133f3b"
        strokeWidth="4"
        fill="none"
      />
    </svg>
  );
}
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
    [lost, setLost] = useState(false),
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
    setLost(false);
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
      ) {
        setLost(true);
        setError(
          "Je sessie of kamer is verlopen of je bent verwijderd. Open opnieuw na het wissen van de sitegegevens om aan te sluiten.",
        );
      }
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
    if (!state?.code || !ready || !online || lost) return;
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
      setLost(true);
      setStreamConnected(false);
      setError("Je sessie of kamer is verlopen of je bent verwijderd.");
      stream.close();
    });
    stream.onerror = () => {
      if (current) setStreamConnected(false);
    };
    return () => {
      current = false;
      stream.close();
      setStreamConnected(false);
    };
  }, [state?.code, ready, online, lost]);
  useEffect(() => {
    if (!state?.code) return;
    QRCode.toDataURL(`${location.origin}/?code=${state.code}`, {
      width: 220,
      margin: 2,
      color: { dark: "#123f3b", light: "#fffdf5" },
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
    if (busy || !navigator.onLine || lost) return;
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
      accept(v, seq);
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
  function action(action: string, extra: Record<string, string | number> = {}) {
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
    lost ||
    !!pending ||
    recoveryBlocked ||
    (!!state && !streamConnected);
  const host = state?.host === state?.me,
    guesser = state?.guesser === state?.me;
  const who = (id?: string) =>
    state?.players.find((p) => p.id === id)?.name || "de rader";
  return (
    <>
      <header>
        <a className="brand" href="/" aria-label="Vissig start">
          <span className="brand-fish">◒</span> vissig
          <span className="brand-dot">.</span>
        </a>
        <span className="header-note">STERKE VERHALEN. SLECHTE LEUGENS.</span>
        <details className="help">
          <summary>Spel & app</summary>
          <div className="help-panel">
            <h2>Zo speel je</h2>
            <p>
              Speel met 4–10 mensen aan één tafel. Eén rader, één blauwe
              waarheidsvis en verder rode bluffers. Antwoorden vertel je hardop,
              niet op je telefoon.
            </p>
            <p>
              De rader draait met <b>Fout</b> één vis om. Elke rode vis is één
              voorlopig punt. Stop om die punten veilig te stellen. Blauw te
              vroeg? Alle voorlopige raderpunten vervallen. Blauw als laatste?
              Eén bonuspunt.
            </p>
            <p>
              Niet-omgedraaide rode vissen krijgen elk één punt. Blauw krijgt
              alleen een punt als die te vroeg is omgedraaid. <b>Goed</b> is
              alleen een geheugensteuntje, geen onthulling of punt.
            </p>
            <h3>Installeren</h3>
            {install && (
              <button
                onClick={() => {
                  void install.prompt();
                  setInstall(null);
                }}
              >
                Installeer Vissig
              </button>
            )}
            <p>
              iPhone/iPad: open in Safari, tik op Delen en kies ‘Zet op
              beginscherm’. Op Android gebruik je ‘App installeren’ in het
              browsermenu als dat beschikbaar is.
            </p>
            <h3>Privacy</h3>
            <p>
              Je naam en spel horen bij deze kamer. Je privésessie verloopt na 7
              dagen; kamers verlopen 7 dagen na de laatste spelactie. Verlopen
              gegevens worden bij nieuwe sessies opgeruimd. De
              privé-browsercookie staat niet in de deelcode. Voor
              misbruikpreventie bewaren we tijdelijk gehashte netwerkadressen.
              Geen advertenties, trackers of externe lettertypen. Wis geen
              sitegegevens als je wilt terugkeren: zonder cookie is herstel niet
              mogelijk.
            </p>
            <p>
              Onafhankelijk spel, met eigen vormgeving en vragen. Geen officiële
              uitgeversapp.
            </p>
          </div>
        </details>
      </header>
      <main>
        {state && online && !streamConnected && !lost && (
          <section className="notice" role="status">
            Liveverbinding herstellen… Je plek blijft bewaard.
          </section>
        )}
        {!online && (
          <section role="status" className="notice">
            <b>Je bent offline.</b> Internet is nodig om te spelen. Je browser
            bewaart je plek; zodra de verbinding terug is halen we de stand op.
          </section>
        )}
        {waiting && (
          <section className="notice" role="status">
            Een nieuwe versie staat klaar. Werk liever tussen twee beurten bij.{" "}
            <button
              disabled={busy || !!pending || !online}
              onClick={() => {
                opted.current = true;
                waiting.postMessage({ type: "ACTIVATE" });
              }}
            >
              Nu bijwerken
            </button>
          </section>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {pending && (
          <section className="notice">
            Deze actie is nog niet bevestigd. Opnieuw proberen voert hem nooit
            dubbel uit.
            <button
              disabled={busy || !online}
              onClick={() => void send(pending)}
            >
              Dezelfde actie opnieuw proberen
            </button>
          </section>
        )}
        {!state ? (
          <div className="welcome-grid">
            <section className="intro">
              <div className="eyebrow">
                HET SPEL WAAR IEDEREEN IETS UIT Z'N DUIМ ZUIGT
              </div>
              <h1>
                Er klopt hier
                <br />
                iets <em>niet.</em>
              </h1>
              <p className="lead">
                Eén waarheid. Een tafel vol sterke verhalen.
                <br />
                Haal jij de bluffers boven water?
              </p>
              <div className="school">
                <Fish />
                <Fish blue />
              </div>
              <div className="chips">
                <span>4–10 spelers</span>
                <span>Iedereen een telefoon</span>
                <span>Gewoon hardop</span>
              </div>
            </section>
            <section className="card join-card">
              <div className="eyebrow">SCHUIF MAAR AAN</div>
              <h2>Een visje wagen?</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!disabled)
                    action("join", {
                      name: name.trim(),
                      code: code.toUpperCase(),
                    });
                }}
              >
                <label htmlFor="name">Je naam</label>
                <input
                  id="name"
                  autoComplete="nickname"
                  maxLength={24}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Zo noemen ze je aan tafel"
                  required
                />
                <button
                  type="button"
                  className="primary"
                  disabled={disabled || !name.trim()}
                  onClick={() => action("create", { name: name.trim() })}
                >
                  Nieuwe tafel <span>↗</span>
                </button>
                <div className="divider">of sluit aan met een code</div>
                <label htmlFor="code">Kamercode</label>
                <input
                  id="code"
                  className="code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="ABC123"
                  pattern="[A-F0-9]{6}"
                />
                <button
                  className="secondary"
                  disabled={
                    disabled || !name.trim() || !/^[A-F0-9]{6}$/.test(code)
                  }
                >
                  Schuif aan
                </button>
              </form>
              <p className="small">
                Geen account. Wel samen aan tafel.
                <br />
                De lobby sluit zodra het spel begint.
              </p>
            </section>
          </div>
        ) : (
          <>
            <div className="room-heading">
              <div>
                <div className="eyebrow">
                  TAFEL <span data-testid="room-code">{state.code}</span>
                </div>
                <h1>
                  {state.phase === "lobby"
                    ? "De school is bijna compleet."
                    : state.phase === "finished"
                      ? "Boven water."
                      : `Beurt ${state.turn + 1} van ${state.totalTurns}`}
                </h1>
              </div>
              <span className="pill">Jij: {who(state.me)}</span>
            </div>
            {state.phase === "lobby" ? (
              <div className="game-grid">
                <section className="card">
                  <div className="section-head">
                    <h2>Wie schuiven aan?</h2>
                    <span>{state.players.length} / 10 spelers</span>
                  </div>
                  <ul className="player-list">
                    {state.players.map((p, i) => (
                      <li key={p.id}>
                        <span className="avatar">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <b>{p.name}</b>
                        {p.id === state.host && (
                          <span className="pill">host</span>
                        )}
                        {host && p.id !== state.host && (
                          <button
                            className="text-button"
                            disabled={disabled}
                            aria-label={`${p.name} verwijderen`}
                            onClick={() => action("remove", { target: p.id })}
                          >
                            Verwijder
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="small">
                    4–10 spelers. Na de start kan niemand meer aansluiten of
                    verwijderd worden. Verbinding kwijt? Open dit spel opnieuw
                    in dezelfde browser.
                  </p>
                  {host ? (
                    <>
                      <label htmlFor="turns">Beurten per persoon</label>
                      <select
                        id="turns"
                        value={state.turns}
                        disabled={disabled}
                        onChange={(e) =>
                          action("configure", { turns: Number(e.target.value) })
                        }
                      >
                        <option value={0} disabled>
                          Automatisch: 2 bij 4–5 spelers, anders 1
                        </option>
                        <option value={1}>1 beurt</option>
                        <option value={2}>2 beurten</option>
                      </select>
                      <button
                        className="primary"
                        disabled={disabled || state.players.length < 4}
                        onClick={() => action("start")}
                      >
                        Start het spel
                      </button>
                    </>
                  ) : (
                    <p className="waiting">Wachten op de host</p>
                  )}
                </section>
                <section className="card share-card">
                  <div className="eyebrow">NEEM JE VRIENDEN MEE</div>
                  <h2>Scan. Schuif aan.</h2>
                  {qr && (
                    <img
                      className="qr"
                      src={qr}
                      width="220"
                      height="220"
                      alt={`QR-code om aan te sluiten bij tafel ${state.code}`}
                    />
                  )}
                  <p className="big-code">{state.code}</p>
                  <label htmlFor="share">
                    Openbare deellink (geen privésleutel)
                  </label>
                  <input
                    id="share"
                    readOnly
                    value={`${location.origin}/?code=${state.code}`}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="secondary"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(`${location.origin}/?code=${state.code}`)
                        .catch(() =>
                          setError("Selecteer en kopieer de link hierboven."),
                        );
                    }}
                  >
                    Kopieer deellink
                  </button>
                </section>
              </div>
            ) : (
              <div className="game-grid">
                <div>
                  {state.phase === "ready" && (
                    <section className="card ready-card">
                      <Fish blue />
                      <div className="eyebrow">
                        {guesser ? "JIJ BENT AAN ZET" : "VOLGENDE DUIK"}
                      </div>
                      <h2>
                        {guesser
                          ? "Klaar om te vissen?"
                          : `${who(state.guesser)} gaat raden`}
                      </h2>
                      <p>
                        De anderen krijgen één blauwe vis of een rode vis.
                        Iedereen vertelt straks een antwoord aan tafel.
                      </p>
                      {guesser ? (
                        <button
                          className="primary"
                          disabled={disabled}
                          onClick={() => action("deal")}
                        >
                          Visjes uitdelen
                        </button>
                      ) : (
                        <p className="waiting">
                          Wachten tot de rader uitdeelt…
                        </p>
                      )}
                    </section>
                  )}
                  {(state.phase === "playing" || state.phase === "settled") && (
                    <>
                      <section className="question-card">
                        <div className="eyebrow">
                          {state.category} · DE VRAAG
                        </div>
                        <h2>{state.question}</h2>
                      </section>
                      {state.phase === "playing" &&
                        (guesser ? (
                          <section className="card">
                            <div className="eyebrow">Jij bent de rader</div>
                            <h2>Wie klinkt er té overtuigend?</h2>
                            <p>
                              Laat iedereen een antwoord hardop geven. Draai
                              rode vissen om, maar blijf van de blauwe af.
                            </p>
                            <div className="risk">
                              <strong>
                                {state.provisional}{" "}
                                {state.provisional === 1 ? "punt" : "punten"} op
                                het spel
                              </strong>
                              <span>Blauw te vroeg = alles kwijt</span>
                            </div>
                            <div className="fish-list">
                              {state.players
                                .filter((p) => p.id !== state.me)
                                .map((p) => (
                                  <article
                                    className="suspect"
                                    data-testid={"fish-" + p.id}
                                    key={p.id}
                                  >
                                    <div className="section-head">
                                      <h3>{p.name}</h3>
                                      {state.revealed?.[p.id] ? (
                                        <span
                                          className={
                                            "role " + state.revealed[p.id]
                                          }
                                        >
                                          {state.revealed[p.id] === "red"
                                            ? "Rood · bluffer"
                                            : "Blauw · waarheid"}
                                        </span>
                                      ) : (
                                        <span className="pill">
                                          {state.kept?.[p.id]
                                            ? "✓ Laten staan"
                                            : "Nog dicht"}
                                        </span>
                                      )}
                                    </div>
                                    {!state.revealed?.[p.id] && (
                                      <div className="fish-actions">
                                        <button
                                          className="reveal"
                                          disabled={disabled}
                                          onClick={() =>
                                            action("reveal", { target: p.id })
                                          }
                                        >
                                          Fout / omdraaien
                                        </button>
                                        <button
                                          className="secondary"
                                          disabled={disabled}
                                          aria-pressed={!!state.kept?.[p.id]}
                                          onClick={() =>
                                            action("keep", { target: p.id })
                                          }
                                        >
                                          Goed / laten staan
                                        </button>
                                      </div>
                                    )}
                                  </article>
                                ))}
                            </div>
                            <p className="small">
                              ‘Goed’ is alleen jouw notitie. Het onthult niets
                              en levert geen punten op.
                            </p>
                            <button
                              className="primary bank"
                              disabled={disabled}
                              onClick={() => action("bank")}
                            >
                              Stop & punten pakken
                            </button>
                          </section>
                        ) : (
                          <section
                            className={"card private-card " + state.role}
                          >
                            <div className="eyebrow">
                              ALLEEN VOOR JOU · HOUD JE SCHERM PRIVÉ
                            </div>
                            <Fish blue={state.role === "blue"} />
                            <h2>
                              {state.role === "blue"
                                ? "Jij bent de blauwe vis."
                                : "Jij bent een rode vis."}
                            </h2>
                            <p>
                              {state.role === "blue"
                                ? "Vertel de waarheid. Klink gerust een beetje verdacht."
                                : "Verzin hardop een geloofwaardig ander antwoord. Laat je niet betrappen."}
                            </p>
                            <div className="answer-box">
                              <span>Het echte antwoord</span>
                              <strong data-testid="private-answer">
                                {state.answer}
                              </strong>
                            </div>
                            <p className="small">
                              Wacht op de rader. Antwoorden vertel je aan tafel.
                            </p>
                          </section>
                        ))}
                      {state.phase === "settled" && (
                        <section className="card">
                          <div className="eyebrow">DE BEURT IS AFGELOPEN</div>
                          <h2>
                            {state.result === "bank"
                              ? "Veilig binnen"
                              : state.result === "bust"
                                ? "Helaas. Blauwe vis."
                                : "Alle bluffers gevangen!"}
                          </h2>
                          <p>
                            {state.result === "bust"
                              ? "Blauw te vroeg omgedraaid: de rader krijgt 0. Blauw krijgt 1, net als elke rode vis die nog dicht lag."
                              : state.result === "last-blue"
                                ? "Blauw als laatste: alle rode punten én één bonuspunt voor de rader."
                                : "De rader krijgt de omgedraaide rode punten. Elke rode vis die nog dicht lag krijgt 1 punt; blauw krijgt 0."}
                          </p>
                          <div className="answer-box">
                            <span>Het echte antwoord</span>
                            <strong data-testid="settled-answer">
                              {state.answer}
                            </strong>
                          </div>
                          <p>{state.explanation}</p>
                          <details>
                            <summary>Bekijk de bronnen</summary>
                            <ul>
                              {state.sources?.map((s, i) => (
                                <li key={i}>
                                  <a
                                    href={s.url}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {s.publisher} · {s.title}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                          <ul className="settlement">
                            {state.players.map((p) => (
                              <li key={p.id}>
                                <span>
                                  {p.name}{" "}
                                  <small>
                                    {p.id === state.guesser
                                      ? "rader"
                                      : state.roles?.[p.id] === "blue"
                                        ? "blauwe vis"
                                        : "rode vis"}
                                  </small>
                                </span>
                                <b>+{state.gains?.[p.id] || 0}</b>
                              </li>
                            ))}
                          </ul>
                          {guesser ? (
                            <button
                              className="primary"
                              disabled={disabled}
                              onClick={() => action("next")}
                            >
                              Volgende beurt
                            </button>
                          ) : (
                            <p className="waiting">
                              {who(state.guesser)} sluit de beurt af.
                            </p>
                          )}
                        </section>
                      )}
                    </>
                  )}
                  {state.phase === "finished" && (
                    <section className="card ready-card">
                      <Fish blue />
                      <div className="eyebrow">EINDE VAN HET SPEL</div>
                      <h2>
                        {[...state.players]
                          .sort((a, b) => b.score - a.score)
                          .filter(
                            (p) =>
                              p.score ===
                              Math.max(...state.players.map((p) => p.score)),
                          )
                          .map((p) => p.name)
                          .join(" & ")}{" "}
                        {state.players.filter(
                          (p) =>
                            p.score ===
                            Math.max(...state.players.map((p) => p.score)),
                        ).length > 1
                          ? "winnen!"
                          : "wint!"}
                      </h2>
                      <p>
                        De beste verhalen komen nog. Nog een potje? Eerdere
                        vragen blijven in deze kamer uit de stapel.
                      </p>
                      {host && (
                        <button
                          className="primary"
                          disabled={disabled}
                          onClick={() => action("new-game")}
                        >
                          Nieuw spel met deze tafel
                        </button>
                      )}
                    </section>
                  )}
                </div>
                <aside className="card scoreboard">
                  <div className="eyebrow">DE STAND</div>
                  <h2>Wie zwemt voorop?</h2>
                  <ol>
                    {[...state.players]
                      .sort((a, b) => b.score - a.score)
                      .map((p, i) => (
                        <li key={p.id}>
                          <span className="rank">{i + 1}</span>
                          <span>
                            {p.name}
                            {p.id === state.guesser &&
                              state.phase !== "finished" && (
                                <small>rader deze beurt</small>
                              )}
                          </span>
                          <b>
                            {p.score}
                            <small>{p.score === 1 ? "punt" : "punten"}</small>
                          </b>
                        </li>
                      ))}
                  </ol>
                  <p className="small">
                    Punten worden pas aan het einde van een beurt definitief.
                  </p>
                </aside>
              </div>
            )}
          </>
        )}
      </main>
      <footer>
        <span>
          vissig. <b>Neem niet alles voor zoete vis aan.</b>
        </span>
        <span>Gemaakt om samen te spelen.</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
