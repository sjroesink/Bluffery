import React, { useEffect, useRef, useState } from "react";
import host from "../internal/catalog/host.nl.json";
import {
  Avatar,
  Face,
  Icon,
  characterOf,
  faces,
  icons,
  type Player,
  type State,
} from "./ui";

// Een uitspraak is een rij clips die samen één ondertitel vormen, bijvoorbeeld
// "De volgende rader is…" + "Baron von Bluf" + "Succes.".
type Clip = { src?: string; text: string };
type Utterance = { clips: Clip[]; focus?: string };

const variants: Record<string, { id: string; text: string }[]> = {};
for (const l of host.lines) (variants[l.moment] ??= []).push(l);
const lastPick: Record<string, string> = {};
function say(moment: string): Clip {
  const options = variants[moment] || [];
  const pool =
    options.length > 1
      ? options.filter((o) => o.id !== lastPick[moment])
      : options;
  const l = pool[Math.floor(Math.random() * pool.length)];
  if (!l) return { text: "" };
  lastPick[moment] = l.id;
  return { src: `/audio/host/${l.id}.mp3`, text: l.text };
}
function nameOf(p?: Player): Clip {
  const c = characterOf(p);
  return c
    ? { src: `/audio/host/char.${c.id}.mp3`, text: c.name }
    : { text: p?.name || "" };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quote = (s: string) => `“${s}”`;

/**
 * De presentator: vergelijkt elke nieuwe stand met de vorige en zet daar
 * uitspraken voor in de wachtrij. Zonder geluid (of zonder mp3) blijft de
 * ondertitel net zo lang staan als het voorlezen ongeveer zou duren.
 */
function useNarrator(state: State, sound: boolean) {
  const [caption, setCaption] = useState(""),
    [focus, setFocus] = useState("");
  const queue = useRef<Utterance[]>([]),
    running = useRef(false),
    alive = useRef(true),
    audio = useRef<HTMLAudioElement | null>(null),
    soundOn = useRef(sound),
    prev = useRef<State | null>(null);
  soundOn.current = sound;
  useEffect(
    () => () => {
      alive.current = false;
      audio.current?.pause();
    },
    [],
  );
  async function play(c: Clip) {
    if (c.src && soundOn.current) {
      const a = (audio.current ??= new Audio());
      a.src = c.src;
      const played = await new Promise<boolean>((resolve) => {
        a.onended = () => resolve(true);
        a.onerror = () => resolve(false);
        a.play().catch(() => resolve(false));
      });
      if (played) return;
    }
    if (c.text) await wait(Math.min(5000, 500 + c.text.length * 55));
  }
  async function run() {
    if (running.current) return;
    running.current = true;
    while (alive.current && queue.current.length) {
      const u = queue.current.shift()!;
      setCaption(
        u.clips
          .map((c) => c.text)
          .filter(Boolean)
          .join(" "),
      );
      setFocus(u.focus || "");
      for (const c of u.clips) await play(c);
      await wait(300);
    }
    running.current = false;
  }
  function enqueue(items: Utterance[], fresh = false) {
    // Een nieuwe beurt of vraag maakt wat nog in de rij stond overbodig.
    if (fresh) queue.current = [];
    queue.current.push(...items);
    void run();
  }
  useEffect(() => {
    const p = prev.current,
      s = state;
    prev.current = s;
    const player = (id?: string) => s.players.find((x) => x.id === id);
    const out: Utterance[] = [];
    if (!p) {
      if (s.phase === "lobby") enqueue([{ clips: [say("welcome")] }]);
      return;
    }
    if (s.phase === "lobby") {
      if (p.phase !== "lobby") out.push({ clips: [say("welcome")] });
      for (const x of s.players)
        if (!p.players.some((y) => y.id === x.id))
          out.push({ clips: [nameOf(x), say("join")], focus: x.id });
      return enqueue(out);
    }
    if (s.phase === "ready" && (p.phase !== "ready" || p.turn !== s.turn)) {
      if (p.phase === "lobby") out.push({ clips: [say("start")] });
      out.push({
        clips: [say("turn.pre"), nameOf(player(s.guesser)), say("turn.post")],
        focus: s.guesser,
      });
      return enqueue(out, true);
    }
    if (s.phase === "playing" && s.question && s.question !== p.question) {
      if (p.phase === "playing") out.push({ clips: [say("skip")] });
      out.push({
        clips: [say("question.pre"), { src: s.audio, text: s.question }],
      });
      if (s.tv) out.push({ clips: [say("writing")] });
      return enqueue(out, true);
    }
    if (s.phase === "playing" && s.answers && !p.answers) {
      out.push({ clips: [say("all-in")] });
      for (const x of s.players)
        if (s.answers[x.id] !== undefined)
          out.push({
            clips: [say("present"), nameOf(x), { text: quote(s.answers[x.id]) }],
            focus: x.id,
          });
      out.push({ clips: [say("judge")] });
    }
    if (s.question === p.question)
      for (const [id, role] of Object.entries(s.revealed || {}))
        if (role === "red" && !p.revealed?.[id])
          out.push({ clips: [say("caught")], focus: id });
    if (s.phase === "settled" && p.phase !== "settled") {
      out.push({
        clips: [
          say(
            s.result === "bust"
              ? "bust"
              : s.result === "last-blue"
                ? "last-blue"
                : "bank",
          ),
        ],
      });
      out.push({ clips: [say("answer.pre"), { text: s.answer || "" }] });
      const leader = [...s.players].sort((a, b) => b.score - a.score)[0];
      if (leader?.score)
        out.push({
          clips: [say("leader.pre"), nameOf(leader)],
          focus: leader.id,
        });
    }
    if (s.phase === "finished" && p.phase !== "finished") {
      const top = [...s.players].sort((a, b) => b.score - a.score)[0];
      return enqueue(
        [
          {
            clips: [say("finish.pre"), nameOf(top), say("finish.post")],
            focus: top?.id,
          },
        ],
        true,
      );
    }
    enqueue(out);
  }, [state]);
  return { caption, focus };
}

function Who({ p, size = 56 }: { p: Player; size?: number }) {
  const c = characterOf(p);
  return (
    <div className="tv-who">
      <Avatar player={p} size={size} />
      <span>
        <b>{c?.name || p.name}</b>
        {c && <small>{p.name}</small>}
      </span>
    </div>
  );
}

export function TvView({
  state,
  qr,
  notices,
  onLeave,
}: {
  state: State;
  qr: string;
  notices: React.ReactNode;
  onLeave: () => void;
}) {
  const [sound, setSound] = useState(false);
  const { caption, focus } = useNarrator(state, sound);
  const player = (id?: string) => state.players.find((p) => p.id === id);
  const guesser = player(state.guesser);
  const others = state.players.filter((p) => p.id !== state.guesser);
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const revealed = state.revealed || {};
  const lit = (id: string) => (focus === id ? " lit" : "");

  let stage: React.ReactNode;
  if (state.phase === "lobby") {
    stage = (
      <div className="tv-lobby">
        <div className="tv-join">
          {qr && (
            <img
              className="qr"
              src={qr}
              width="260"
              height="260"
              alt={`QR-code om mee te doen aan tafel ${state.code}`}
            />
          )}
          <p>
            Doe mee op <b>{location.host}</b>
          </p>
          <span className="tv-room-code" data-testid="tv-code">
            {state.code}
          </span>
        </div>
        <ul className="tv-cast">
          {state.players.map((p) => (
            <li className={"tv-seat" + lit(p.id)} key={p.id}>
              <Who p={p} size={88} />
            </li>
          ))}
          {state.players.length < 4 && (
            <li className="tv-seat empty">
              Nog {4 - state.players.length} nodig
            </li>
          )}
        </ul>
      </div>
    );
  } else if (state.phase === "ready") {
    stage = (
      <div className="tv-center">
        <Avatar player={guesser} size={180} className="tv-hero" />
        <h1>{characterOf(guesser)?.name || guesser?.name} raadt</h1>
        <p>{others.length} verhalen. 1 is waar.</p>
        <ol className="tv-strip">
          {sorted.map((p) => (
            <li key={p.id}>
              <Avatar player={p} size={40} />
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  } else if (state.phase === "playing") {
    const sent = new Set(state.submitted || []);
    stage = (
      <div className="tv-play">
        <section className="tv-question">
          <span className="chip">{state.category}</span>
          <h1>{state.question}</h1>
        </section>
        <ul className="tv-cards" data-testid="tv-cards">
          {others.map((p) => {
            const role = revealed[p.id],
              text = state.answers?.[p.id];
            return (
              <li
                key={p.id}
                className={
                  "tv-card" +
                  (role ? " " + role : "") +
                  (sent.has(p.id) ? " sent" : "") +
                  lit(p.id)
                }
              >
                <Who p={p} />
                <p className="tv-card-text">
                  {text
                    ? quote(text)
                    : state.tv
                      ? sent.has(p.id)
                        ? "Ingestuurd"
                        : "Schrijft…"
                      : ""}
                </p>
                {role && (
                  <span className="stamp-wrap">
                    <span className="stamp">
                      {role === "red" ? "Bluffer" : "Eerlijk"}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="tv-status">
          {state.tv && !state.answers
            ? `${sent.size} / ${others.length} antwoorden binnen`
            : `${characterOf(guesser)?.name || guesser?.name} kiest · ${state.provisional ?? 0} op het spel`}
        </p>
      </div>
    );
  } else if (state.phase === "settled") {
    stage = (
      <div className="tv-play">
        <section className="tv-truth">
          <span>{state.question}</span>
          <strong data-testid="tv-answer">{state.answer}</strong>
          {state.explanation && <p>{state.explanation}</p>}
        </section>
        <ul className="tv-cards">
          {others.map((p) => {
            const role = state.roles?.[p.id],
              text = state.answers?.[p.id];
            return (
              <li
                key={p.id}
                className={"tv-card " + (role || "") + lit(p.id)}
              >
                <Who p={p} />
                {text && <p className="tv-card-text">{quote(text)}</p>}
                {revealed[p.id] && (
                  <span className="stamp-wrap">
                    <span className="stamp">
                      {role === "red" ? "Bluffer" : "Eerlijk"}
                    </span>
                  </span>
                )}
                <span className="tv-gain">+{state.gains?.[p.id] || 0}</span>
              </li>
            );
          })}
        </ul>
        <p className="tv-status">
          {characterOf(guesser)?.name || guesser?.name} raadde: +
          {state.gains?.[state.guesser] || 0}
        </p>
      </div>
    );
  } else {
    const top = sorted[0]?.score ?? 0;
    stage = (
      <div className="tv-center">
        <div className="rain" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <h1>
          {sorted
            .filter((p) => p.score === top)
            .map((p) => characterOf(p)?.name || p.name)
            .join(" & ")}{" "}
          wint
        </h1>
        <ol className="tv-podium">
          {sorted.map((p, i) => (
            <li key={p.id} className={(i === 0 ? "first" : "") + lit(p.id)}>
              <span className="rank">{i + 1}</span>
              <Who p={p} size={i === 0 ? 96 : 56} />
              <span className="score">{p.score}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="tv">
      <header className="tv-top">
        <Face {...faces.mark} size={52} look={3} />
        <span className="wordmark">bluffery</span>
        <span className="grow" />
        {state.phase !== "lobby" && state.phase !== "finished" && (
          <span className="tv-turn">
            Beurt {Math.min(state.turn + 1, state.totalTurns)} /{" "}
            {state.totalTurns}
          </span>
        )}
        {state.phase !== "lobby" && (
          <span className="tv-turn">{state.code}</span>
        )}
        {sound ? (
          <button
            className="icon-btn"
            aria-label="Geluid uit"
            onClick={() => setSound(false)}
          >
            <Icon d={icons.sound} />
          </button>
        ) : (
          // Browsers spelen pas geluid af na een tik op de pagina.
          <button className="btn small tv-unmute" onClick={() => setSound(true)}>
            <Icon d={icons.mute} />
            Geluid aan
          </button>
        )}
        <button
          className="icon-btn"
          aria-label="Stoppen met meekijken"
          onClick={onLeave}
        >
          <Icon d={icons.exit} />
        </button>
      </header>
      {notices}
      <main className="tv-stage">{stage}</main>
      <footer className="tv-caption" aria-live="polite">
        {caption}
      </footer>
    </div>
  );
}
