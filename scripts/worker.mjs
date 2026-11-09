import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = "dist";
async function walk(dir) {
  let a = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + f.name;
    if (f.isDirectory()) a.push(...(await walk(p)));
    else a.push(p);
  }
  return a;
}
const files = (await walk(base)).filter((p) => !p.endsWith("/sw.js")).sort();
const paths = files.map((p) => "/" + p.slice(base.length + 1));
const template = `const CACHE=__CACHE__;const PUBLIC=__PUBLIC__;
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);try{for(const path of PUBLIC){const response=await fetch(path,{credentials:'omit',cache:'reload'});if(!response.ok)throw Error('precache');await c.put(path,response)}}catch(error){await caches.delete(CACHE);throw error}})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{const names=(await caches.keys()).filter(k=>k.startsWith('vissig-shell-'));const retain=names.filter(k=>k!==CACHE).slice(-1);await Promise.all(names.filter(k=>k!==CACHE&&!retain.includes(k)).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('message',e=>{if(e.data?.type==='ACTIVATE')self.skipWaiting()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET'||u.pathname.startsWith('/api/')||u.pathname==='/healthz')return;
if(e.request.mode==='navigate'&&u.pathname==='/'){e.respondWith(caches.open(CACHE).then(c=>c.match('/index.html')));return}
if(!u.search&&PUBLIC.includes(u.pathname)){e.respondWith(caches.open(CACHE).then(async c=>(await c.match(u.pathname))||fetch(e.request)));}});
`;
let hash = createHash("sha256").update(template);
for (const f of files) hash.update(f).update(await readFile(f));
const cache = "vissig-shell-" + hash.digest("hex").slice(0, 24);
await writeFile(
  base + "/sw.js",
  template
    .replace("__CACHE__", JSON.stringify(cache))
    .replace("__PUBLIC__", JSON.stringify(paths)),
);
console.log("Public shell:", paths.length, "files;", cache);
