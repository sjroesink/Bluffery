# Bluffery — agreed product and delivery contract

An independent Dutch, mobile-first multiplayer PWA at https://bluffery.roesink.dev. Original graphics/name/text and independently sourced factual questions; no publisher question cards, artwork or branding copied. User explicitly chose original risk rules, not simultaneous classification.

## Gameplay

- One person creates a room with their nickname; share a public QR/join URL and short room code. Other phones join without accounts. Creator is also a player. 4–10 players, lobby join before game starts. Explain lobby locks after start. Reconnection/refresh on same browser restores membership and round; private per-device credentials never enter shared QR/URLs.
- Automatic turn order. Default each guesses twice with 4–5 players, once with 6–10; configurable 1–5 turns each in lobby. Host starts game, current guesser presses `Uitdelen` for each turn.
- Atomic dealing chooses a not-yet-used approved question and uniformly shuffles exactly one honest role (`blue` in the API) and bluffer roles (`red`) for the remaining players among everyone except the current guesser. All see the question; only non-guesser round participants get their OWN role and the correct answer. Bluffers invent an answer aloud; the honest player tells the real answer aloud, trying to sound suspicious. Guesser NEVER receives answer, provenance URLs, unrevealed roles or hidden catalogue records through HTML/API/SSE/assets until the turn ends. Host privilege must not bypass this.
- Answers are spoken at the table; no typed bluff submission required. A short optional preparation cue is fine, no forced timed elimination.
- Per-person `Bluf!` reveals a suspect. Bluffer revealed: one provisional point, continue or bank. Honest player revealed before all bluffers: immediate end, zero guesser points. Honest player revealed LAST: one extra point; end. The `Geloof ik` check may be a clearly labelled non-revealing guesser annotation (it does NOT earn points or change the original risk rules). Separate `Stop & pak` safely banks revealed-bluffer points and ends the turn.
- Basic original scoring: guesser gets banked red count, or red count+1 when blue is last, or 0 on early blue. Revealed reds get 0; unrevealed reds get 1. Blue gets 1 only if caught early, otherwise 0. All scoring settles exactly once. Show explanation, all roles, correct answer and source links AFTER settlement to everyone. Next turn rotates guesser. Scoreboard and final result, allow a new game without repeated questions in the same room if feasible.
- Host can remove a player ONLY in lobby. Joining after start is politely rejected rather than altering a dealt roster. A disconnected phone does not silently lose its role. No unsafe automatic host takeover.

## Architecture and safeguards

Go backend, SQLite durable storage, React/TypeScript mobile UI (Vite) embedded into one unprivileged static Go runtime image. Existing local toolchain /opt/data/tools/go/bin/go is Go1.27.1; latest official Go stable was checked as1.27.3. Do not replace shared toolchain. All production game authority stays server-side. Authenticated per-member SSE real-time updates (explicit user requirement), with ordinary HTTP commands and no periodic state polling. Re-fetch after SSE reconnect, with revision ordering; no global secret broadcasts hidden only by frontend.

Bounded validated nickname/code/body input; escaped text; no public room list/question-bank endpoint. Opaque >=256-bit HttpOnly SameSite per-device session with production Secure cookie; server hashes credentials. Same-origin mutation checks, explicit trusted-proxy IP handling, persistent abuse counters compatible with 10 phones behind one Wi-Fi, expiration/storage quotas, SQLite WAL and private data permissions. All state transitions use optimistic revision + actor authorization and retry-safe command IDs; double deal/score/advance and stale commands cannot mutate twice. Unauthenticated/non-member requests do not disclose private game contents. No third-party trackers, remote fonts or runtime LLM dependency. Seed data is backend-only, never bundled in public assets.

Real PWA: own 192/512/maskable/apple PNG icons, manifest, production worker, offline explanation (internet needed to play), explicit update consent without forced reload mid-round, install/iOS help. Cache only public static assets; NEVER APIs, SSE, roles, answers, room state or cookies/credentials. Public worker no-cache/no-store including Cloudflare directive. Verify persistent-browser installability, real offline refresh, reconnection, cached resource boundary, waiting-update behavior, narrow 320/390px layouts. Physical phone install not claimed from browser tests.

## Question catalog contract

Curated content delivered independently; application implementer may use clearly marked local fixtures, NOT ship fake facts. Production backend seed file: `internal/catalog/questions.nl.json`. JSON shape:

```json
{"schemaVersion":1,"questions":[{"id":"q_24hexchars","question":"Eigen Nederlandse vraag?","answer":"Kort eenduidig antwoord","aliases":[],"category":"Ruimte","explanation":"Eigen korte uitleg van het geverifieerde feit.","sources":[{"url":"https://primary.example/fact","title":"Source title","publisher":"Publisher","accessedAt":"2026-11-07","rightsNote":"Eigen formulering van feit; geen artikeltekst overgenomen."}],"verifiedAt":"2026-11-07","approved":true}]}
```

ID = `q_` + first24 hex of SHA256(question + newline + first source URL), generated in code. ID must not contain the answer. No changing unspecific records (current moon counts etc.), ambiguity, misleading folklore, sensitive medical advice or unsupported AI assertions. Each row source-checked, original wording, concise answer usable aloud. Multiple independent public source organizations. Preserve attribution, review status and provenance. Import is reproducible, idempotent, validated/deduplicated, updates local SQLite from vetted catalog; no unreviewed web-generated material becomes playable. Provide documented import/validation command to grow catalog safely. Count questions from real validated data, never invented totals.

## Delivery boundaries

App implementer works only in /opt/data/repos/bluffery and scoped scratch. No commits/push/deploy, production credentials/data/infra or service restarts. Parent owns content merge, independent review, scoped GitHub/infra release and live verification. Infra preparation is separate and read-only to production. Do not overwrite other agents' work. Strict vertical RED/GREEN/refactor with real backend and multi-context browser tests, plus restart persistence and hidden-information/access-control negative tests. Capture concise reproducible evidence and any actual blockers.
