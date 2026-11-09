import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
const binary = resolve(process.env.VISSIG_BINARY || "./vissig");
const dir = await mkdtemp(join(tmpdir(), "vissig-restart-"));
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const base = `http://127.0.0.1:${port}`;
let child;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function start() {
  child = spawn(binary, [], {
    env: {
      ...process.env,
      LISTEN_ADDR: `127.0.0.1:${port}`,
      PUBLIC_BASE_URL: base,
      DATA_DIR: dir,
      VISSIG_DEV_FIXTURES: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (b) => (errors += b));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(errors);
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) return child.pid;
    } catch {}
    await delay(50);
  }
  throw Error("fixture startup timed out: " + errors);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await exit;
}
async function read(cookie) {
  const r = await fetch(base + "/api/state", { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  return r.json();
}
async function command(cookie, body) {
  const r = await fetch(base + "/api/command", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  return r.json();
}
try {
  const firstPID = await start();
  let state,
    code = "";
  const cookies = [];
  for (let i = 0; i < 4; i++) {
    const r = await fetch(base + "/api/session");
    const cookie = r.headers.get("set-cookie").split(";")[0];
    cookies.push(cookie);
    state = await command(cookie, {
      id: "member-00000001",
      action: i ? "join" : "create",
      name: "Restart " + i,
      code,
    });
    code = state.code;
  }
  state = await command(cookies[0], {
    id: "start-00000001",
    action: "start",
    version: state.version,
  });
  const deal = { id: "deal-00000001", action: "deal", version: state.version };
  state = await command(cookies[0], deal);
  const before = await Promise.all(cookies.map(read));
  assert.equal(before[0].answer, undefined);
  await stop();
  const secondPID = await start();
  assert.notEqual(firstPID, secondPID);
  const after = await Promise.all(cookies.map(read));
  assert.deepEqual(after, before);
  const retry = await command(cookies[0], deal);
  assert.deepEqual(retry, before[0]);
  console.log(
    "PASS real process restart: 4 memberships, private projections, exact roles/question/revision and retry ledger survive; PID changed.",
  );
} finally {
  await stop();
  await rm(dir, { recursive: true, force: true });
}
