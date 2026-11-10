// Genereert per catalogusvraag een uitspraak via ElevenLabs naar
// internal/catalog/audio/<id>.mp3. Bestaande bestanden worden overgeslagen,
// dus het script kan na een onderbreking of catalogusuitbreiding opnieuw.
//
//   node scripts/speak.mjs --dry-run      telt ontbrekende vragen en tekens
//   node scripts/speak.mjs --limit 5      genereert er maximaal vijf
//   node scripts/speak.mjs --only q_…     (her)genereert één vraag
//   node scripts/speak.mjs --prune        verwijdert audio van vervallen ID's
//   node scripts/speak.mjs --set host     presentatorzinnen en personagenamen voor de tv
//                                         (internal/catalog/host.nl.json → audio/host/)
//   node scripts/speak.mjs --set answers  het echte antwoord per vraag (→ audio/answers/)
import { readFile, readdir, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const known = ["--dry-run", "--limit", "--only", "--prune", "--set"];
for (let i = 0; i < args.length; i++) {
  if (!known.includes(args[i]))
    throw Error(`Onbekende optie ${args[i]}. Opties: ${known.join(" ")}`);
  if (args[i] === "--limit" || args[i] === "--only" || args[i] === "--set") i++;
}
const set = value("--set") ?? "questions";
if (!["questions", "host", "answers"].includes(set))
  throw Error("--set is questions, host of answers.");

if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.env.ELEVENLABS_API_KEY;
const voice =
  (set !== "questions" && process.env.ELEVENLABS_HOST_VOICE_ID) ||
  process.env.ELEVENLABS_VOICE_ID;
const model = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const format = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_64";
if (!format.startsWith("mp3_"))
  throw Error("ELEVENLABS_OUTPUT_FORMAT moet een mp3_-formaat zijn.");

// Vragen dragen een ID dat al met hun tekst verandert. Presentatorzinnen hebben vaste
// ID's, dus het manifest onthoudt per ID welke tekst is ingesproken.
let dir, questions;
const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const manifestPath = "internal/catalog/audio/host/manifest.json";
let manifest = {};
// Beide workers schrijven het manifest; een keten voorkomt dat ze elkaars .pending raken.
let saving = Promise.resolve();
const saveManifest = () =>
  (saving = saving.then(async () => {
    const sorted = Object.fromEntries(Object.entries(manifest).sort());
    await writeFile(manifestPath + ".pending", JSON.stringify(sorted, null, 2) + "\n");
    await rename(manifestPath + ".pending", manifestPath);
  }));
if (set === "host") {
  dir = "internal/catalog/audio/host";
  const host = JSON.parse(await readFile("internal/catalog/host.nl.json", "utf8"));
  questions = [
    ...host.characters.map((c) => ({ id: `char.${c.id}`, question: c.name })),
    ...host.lines.map((l) => ({ id: l.id, question: l.text })),
  ];
  if (existsSync(manifestPath)) manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} else {
  dir = "internal/catalog/audio";
  ({ questions } = JSON.parse(await readFile("internal/catalog/questions.nl.json", "utf8")));
}
if (set === "answers") {
  // Het vraag-ID is zichtbaar voor de rader; de bestandsnaam hangt daarom ook aan het
  // antwoord, zodat niemand de mp3 vóór de uitslag kan opvragen (zie answerAudio in main.go).
  dir = "internal/catalog/audio/answers";
  questions = questions.map((q) => ({
    id: "a_" + createHash("sha256").update(`${q.answer}\n${q.id}`).digest("hex").slice(0, 24),
    question: q.answer,
  }));
}
await mkdir(dir, { recursive: true });
const have = new Set(
  (await readdir(dir)).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)),
);
if (set === "host")
  for (const q of questions) if (manifest[q.id] !== sha(q.question)) have.delete(q.id);
const ids = new Set(questions.map((q) => q.id));
const orphans = [...have].filter((id) => !ids.has(id));

if (flag("--prune")) {
  for (const id of orphans) {
    await rm(`${dir}/${id}.mp3`);
    delete manifest[id];
  }
  if (set === "host") await saveManifest();
  console.log(`${orphans.length} vervallen bestand(en) verwijderd.`);
  process.exit(0);
}

const only = value("--only");
let todo = only
  ? questions.filter((q) => q.id === only)
  : questions.filter((q) => !have.has(q.id));
if (only && todo.length === 0) throw Error(`Vraag ${only} staat niet in de catalogus.`);
const limit = Number(value("--limit") ?? Infinity);
if (!(limit > 0)) throw Error("--limit moet een positief getal zijn.");
todo = todo.slice(0, limit);
const chars = todo.reduce((n, q) => n + q.question.length, 0);

console.log(
  `${have.size - orphans.length}/${questions.length} ${{ host: "zinnen", answers: "antwoorden" }[set] || "vragen"} hebben audio; ` +
    `${todo.length} te genereren (${chars} tekens).` +
    (orphans.length ? ` ${orphans.length} vervallen (--prune).` : ""),
);
if (flag("--dry-run") || todo.length === 0) process.exit(0);
if (!key || !voice)
  throw Error("Zet ELEVENLABS_API_KEY en ELEVENLABS_VOICE_ID in .env (zie README).");

async function speak(q) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}` +
    `?output_format=${encodeURIComponent(format)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: q.question, model_id: model }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = (await res.text()).slice(0, 300);
    // 409 already_running: de stem wordt bij eerste gebruik aan het account toegevoegd.
    if ((res.status === 409 || res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * attempt;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    // De inhoudsfilter van ElevenLabs slaat soms onschuldige tekst af; dan geen mp3 en
    // toont de tv alleen de ondertitel. Elke andere fout stopt het script.
    if (res.status === 403 && body.includes("content_against_policy")) return null;
    throw Error(`${q.id}: HTTP ${res.status} ${body}`);
  }
}

// Twee tegelijk past binnen de gelijktijdigheidslimiet van elk ElevenLabs-abonnement.
// De eerste vraag gaat alleen, zodat ElevenLabs de stem eenmalig kan toevoegen.
let next = 0;
let done = 0;
const blocked = [];
async function one() {
  const q = todo[next++];
  const audio = await speak(q);
  if (!audio) {
    blocked.push(q);
    console.log(`[${++done}/${todo.length}] ${q.id} geweigerd door de inhoudsfilter`);
    return;
  }
  const target = `${dir}/${q.id}.mp3`;
  await writeFile(target + ".pending", audio);
  await rename(target + ".pending", target);
  if (set === "host") {
    manifest[q.id] = sha(q.question);
    await saveManifest();
  }
  console.log(`[${++done}/${todo.length}] ${q.id} ${(audio.length / 1024).toFixed(0)} kB`);
}
async function worker() {
  while (next < todo.length) await one();
}
await one();
await Promise.all([worker(), worker()]);
if (blocked.length)
  console.log(
    `${blocked.length} geweigerd (blijft ondertitel):\n` +
      blocked.map((q) => `  ${q.id} ${JSON.stringify(q.question)}`).join("\n"),
  );
