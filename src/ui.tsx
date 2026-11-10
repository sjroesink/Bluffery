import React from "react";
import host from "../internal/catalog/host.nl.json";
export type Player = {
  id: string;
  name: string;
  score: number;
  character?: string;
};
export type Source = {
  url: string;
  title: string;
  publisher: string;
  rightsNote: string;
};
export type State = {
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
  audio?: string;
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
  // Tv-modus
  tv?: boolean;
  screens?: number;
  screen?: boolean;
  submitted?: string[];
  myAnswer?: string;
  answers?: Record<string, string>;
  answerAudio?: string;
};
export type FaceProps = {
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
  accessory?: string;
};
const mouths = {
  smirk: "M17 35 Q 26 39 33 33",
  sly: "M15 33 Q 25 38 34 30",
  grin: "M14 31 Q 24 40 34 31",
  flat: "M17 34 H 31",
};
export function Face({
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
  accessory,
}: FaceProps) {
  // Een accessoire steekt boven het hoofd uit; het vlak groeit dan naar boven mee.
  const top = accessory ? 14 : 0;
  return (
    <svg
      className={("face " + className).trim()}
      width={size}
      height={(size * (48 + top)) / 48}
      viewBox={`0 ${-top} 48 ${48 + top}`}
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
      {accessory && accessoryArt[accessory]}
    </svg>
  );
}
const ink = "#14112b",
  gold = "#ffd08a";
const accessoryArt: Record<string, React.ReactNode> = {
  tophat: (
    <>
      <rect x="12" y="-12" width="24" height="15" rx="2" fill={ink} />
      <rect x="12" y="-2" width="24" height="3" fill={gold} />
      <rect x="6" y="1" width="36" height="4" rx="2" fill={ink} />
    </>
  ),
  cap: (
    <>
      <path d="M9 4 Q 10 -9 24 -9 Q 38 -9 39 4 Z" fill="#fff" />
      <rect x="6" y="2" width="36" height="5" rx="2.5" fill={ink} />
      <circle cx="24" cy="-3" r="2.6" fill={gold} />
    </>
  ),
  crown: (
    <path
      d="M10 5 L11 -8 L18 -1 L24 -11 L30 -1 L37 -8 L38 5 Z"
      fill={gold}
      stroke={gold}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  ),
  halo: (
    <ellipse
      cx="24"
      cy="-6"
      rx="14"
      ry="4"
      fill="none"
      stroke={gold}
      strokeWidth="3"
    />
  ),
  bow: (
    <>
      <path d="M36 3 L27 -5 L28 10 Z M36 3 L45 -5 L44 10 Z" fill={ink} />
      <circle cx="36" cy="3" r="3.2" fill={ink} />
    </>
  ),
  glasses: (
    <g fill="none" stroke={ink} strokeWidth="2.6">
      <circle cx="17" cy="21" r="8.6" />
      <circle cx="31" cy="21" r="8.6" />
    </g>
  ),
  monocle: (
    <g fill="none" stroke={gold} strokeWidth="2.4">
      <circle cx="31" cy="21" r="8.6" />
      <path d="M38 26 Q 43 34 40 46" strokeWidth="1.4" />
    </g>
  ),
  moustache: (
    <path
      d="M13 32 Q 18 25 24 30 Q 30 25 35 32 Q 29 34 24 31.5 Q 19 34 13 32 Z"
      fill={ink}
    />
  ),
};
export type Character = (typeof host.characters)[number];
export const characters: Character[] = host.characters;
export const characterOf = (p?: Player) =>
  characters.find((c) => c.id === p?.character);
/** Het personage van een speler, of een gewoon gezicht als die er (nog) geen heeft. */
export function Avatar({
  player,
  size = 44,
  className,
}: {
  player?: Player;
  size?: number;
  className?: string;
}) {
  const c = characterOf(player);
  return (
    <Face
      fill={c?.color}
      accessory={c?.accessory}
      mouth={c ? "smirk" : undefined}
      look={player ? lookFor(player.id) : 0}
      size={size}
      className={className}
    />
  );
}
export const faces = {
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
export function lookFor(id: string) {
  let n = 0;
  for (const c of id) n += c.charCodeAt(0);
  return [-3, 0, 3][n % 3];
}
export function Confetti({ big = false }: { big?: boolean }) {
  return (
    <span className={"burst" + (big ? " big" : "")} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="cf" />
      ))}
    </span>
  );
}
export function Icon({ d, size = 20 }: { d: string; size?: number }) {
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
export const icons = {
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
  sound: "M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
  mute: "M4 9v6h4l5 4V5L8 9H4ZM17 9l5 6M22 9l-5 6",
  tv: "M3 6h18v11H3ZM8 21h8M12 17v4",
};
