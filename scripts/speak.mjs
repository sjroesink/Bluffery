// Genereert per catalogusvraag een uitspraak via ElevenLabs naar
// internal/catalog/audio/<id>.mp3. Bestaande bestanden worden overgeslagen,
// dus het script kan na een onderbreking of catalogusuitbreiding opnieuw.
//
//   node scripts/speak.mjs --dry-run      telt ontbrekende vragen en tekens
//   node scripts/speak.mjs --limit 5      genereert er maximaal vijf
//   node scripts/speak.mjs --only q_…     (her)genereert één vraag
//   node scripts/speak.mjs --prune        verwijdert audio van vervallen ID's
import { readFile, readdir, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const catalog = "internal/catalog/questions.nl.json";
const dir = "internal/catalog/audio";
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const known = ["--dry-run", "--limit", "--only", "--prune"];
for (let i = 0; i < args.length; i++) {
  if (!known.includes(args[i]))
    throw Error(`Onbekende optie ${args[i]}. Opties: ${known.join(" ")}`);
  if (args[i] === "--limit" || args[i] === "--only") i++;
}

if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.env.ELEVENLABS_API_KEY;
const voice = process.env.ELEVENLABS_VOICE_ID;
const model = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const format = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_64";
if (!format.startsWith("mp3_"))
  throw Error("ELEVENLABS_OUTPUT_FORMAT moet een mp3_-formaat zijn.");

const { questions } = JSON.parse(await readFile(catalog, "utf8"));
await mkdir(dir, { recursive: true });
const have = new Set(
  (await readdir(dir)).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)),
);
const ids = new Set(questions.map((q) => q.id));
const orphans = [...have].filter((id) => !ids.has(id));

if (flag("--prune")) {
  for (const id of orphans) await rm(`${dir}/${id}.mp3`);
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
  `${have.size - orphans.length}/${questions.length} vragen hebben audio; ` +
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
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * attempt;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw Error(`${q.id}: HTTP ${res.status} ${body}`);
  }
}

// Twee tegelijk past binnen de gelijktijdigheidslimiet van elk ElevenLabs-abonnement.
let next = 0;
let done = 0;
async function worker() {
  while (next < todo.length) {
    const q = todo[next++];
    const audio = await speak(q);
    const target = `${dir}/${q.id}.mp3`;
    await writeFile(target + ".pending", audio);
    await rename(target + ".pending", target);
    console.log(`[${++done}/${todo.length}] ${q.id} ${(audio.length / 1024).toFixed(0)} kB`);
  }
}
await Promise.all([worker(), worker()]);
