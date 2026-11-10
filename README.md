# Bluffery

Onafhankelijk Nederlands tafelspel voor 4–10 spelers. Go + SQLite, React/TypeScript/Vite, eigen illustraties en PWA. `PRODUCT.md` is het productcontract. Geen runtime-LLM, externe fonts, trackers of uitgeversmateriaal.

## Status en inhoud

De backend-only productiecatalogus bevat **976** Nederlandse vragen met onverwachte antwoorden: de206 bestaande kaarten zijn ongewijzigd behouden, met770 onafhankelijk geaccepteerde, ontdubbelde aanvullingen uit WikiDYK, Wikipedia Unusual Articles, Ig Nobel, Atlas Obscura, Guinness en institutionele/natuurbronnen; Open Trivia Database blijft vertegenwoordigd in de bestaande selectie. Alle negen door de gebruiker goedgekeurde voorbeelden zijn behouden. `internal/catalog/provenance.json` bewaart de oorspronkelijke bronpakketten, beschikbare bronrecords, collectie-/datasetlidmaatschap, bronrevisies, responsehashes, rechtenvermeldingen en onafhankelijke beoordelingen met eventuele herstel-lineage. De bewijsdekking verschilt per bron en record: de overgeërfde provenance beschreef slechts59 van de206 bestaande kaarten; voor147 bestaande ID's ontbreekt daarin per-ID metadata. Die beperking en de oorspronkelijke metadata blijven expliciet bewaard, zonder verzonnen bronbewijzen of claim van nieuwe feitelijke verificatie van deze147 kaarten. Iedere publicatie vereist onafhankelijke bron- en codereview van de exacte kandidaat. Normaal opstarten valideert en importeert deze seed. Een lege of ongeldige catalogus wordt geweigerd. Alleen expliciete lokale fixturemodus vervangt de vragen door30 duidelijk gemarkeerde `TESTVRAAG`/`TESTANTWOORD`-kaarten; dat zijn geen geverifieerde feiten. Fixturemodus weigert zowel een niet-loopback `PUBLIC_BASE_URL` als een niet-loopback `LISTEN_ADDR`. Zet de vlag nooit in productie.

## Bouwen en lokaal spelen

Vereist: Node 26, npm, Go 1.27.1 of nieuwer. Alle npm-versies zijn exact en `package-lock.json`/`go.sum` zijn vastgelegd. `dist` wordt gegenereerd, niet gecommit. Voer de frontendbuild uit vóór Go-tests/builds vanwege `go:embed`.

```sh
npm ci
npm run build
go test -race ./...
go vet ./...
CGO_ENABLED=0 go build -trimpath -o ./bluffery .
LISTEN_ADDR=127.0.0.1:18088 DATA_DIR=./data \
  PUBLIC_BASE_URL=http://127.0.0.1:18088 BLUFFERY_DEV_FIXTURES=1 ./bluffery
```

Open `http://127.0.0.1:18088` in vier aparte browserprofielen/contexten. Tabbladen in hetzelfde browserprofiel delen bewust één speler. De host sluit de lobby met Start; de huidige rader deelt uit. Antwoorden worden hardop verteld. Het vinkje (`Geloof ik`) is alleen een niet-onthullende notitie; `Bluf!` ontmaskert één speler. `Stop & pak` stelt de punten van ontmaskerde bluffers veilig. De oorspronkelijke risicopunten worden één keer server-side afgerekend, daarna zijn antwoord, alle rollen en bronnen zichtbaar. De rader sluit de beurt af; automatisch wisselende rader, eindstand en nieuw spel zijn ingebouwd.

## Runtimecontract

| Variabele | Productie/default | Betekenis |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | Bindadres; voor fixtures expliciet loopback |
| `DATA_DIR` | image: `/data`; lokaal: `./data` | Enige schrijfbare persistente map |
| `PUBLIC_BASE_URL` | image: `https://bluffery.roesink.dev`; lokaal: `http://localhost:8080` | Exacte vertrouwde Origin, geen pad/query |
| `TRUSTED_PROXY_CIDRS` | leeg | Komma-gescheiden expliciete socket-peer CIDR's |
| `BLUFFERY_DEV_FIXTURES` | uit | Alleen `1` activeert lokale fictieve kaarten |

Reverse proxy: behoud Host/Origin, geef de client-IP als één geldige `X-Forwarded-For` IP door en vertrouw alleen de expliciet ingestelde proxy-peer. Meerdere XFF-hops worden niet blind geïnterpreteerd. Zonder trusted CIDR telt het socketadres. Een groep van tien telefoons op dezelfde wifi past binnen de quota.

`GET /healthz` en `/bluffery healthcheck` controleren de SQLiteverbinding. Het scratch-runtime-image draait standaard als UID99:GID100, met ingebedde frontend en zonder shell of netwerkafhankelijkheden. De host moet de datavolume aan deze UID/GID geven. De applicatie dwingt map0700 en database/WAL/SHM0600 af en weigert bij onvoldoende rechten. Aanbevolen runtime: read-only rootfs, alleen `/data` schrijfbaar, capabilities weg, no-new-privileges en begrensde resources. Eén app-instance per datamap; geen multi-replica eventbus.

## API en echte SSE

- `GET /api/session`: mint of behoud een 256-bit HttpOnly SameSite=Strict browsercookie; Secure op HTTPS. Alleen SHA256 van credentials wordt opgeslagen. Cross-site sessievervanging wordt geweigerd.
- `GET /api/state`: uitsluitend de geautoriseerde eigen projectie. Geen openbare kamerlijst of vraagbank.
- `POST /api/command`: strikte begrensde JSON met `id`, `action`, `version` en actiespecifieke velden. Exacte Origin vereist. Een transactie controleert actor, revisie, invarianten en het commandologboek. Exact herhalen van een succesvol ID is veilig; een ander payload met hetzelfde ID of een nieuwe verouderde actie wordt geweigerd. De reactie geeft de actuele persoonlijke projectie terug.
- **`GET /api/events`: echte geauthenticeerde SSE.** Elke verbinding wordt op lidmaatschap gecontroleerd. Alleen `event: revision` met `{"version":N}` wordt gestuurd, nooit vragen, rollen of antwoorden. De client haalt daarna `/api/state` met de eigen cookie op. Iedere reconnect stuurt meteen de actuele revisie. Er is **geen periodieke statepolling**. Een heartbeat elke12s houdt de stream open en hercontroleert sessie/lidmaatschap/expiry. `event: expired` sluit een ongeldige verbinding. Headers: no-store, `X-Accel-Buffering: no`. Proxy moet SSE zonder buffering doorgeven, met read-timeout langer dan12s.

SSE: maximaal1024 totale streams,64 per IP en3 per sessie; coalescing kanaal van één wake-up per subscriber; writes max5s; disconnect verwijdert de subscriber; geen storage/eventhub-lock tijdens body-read of netwerk-write. Elke kamer heeft eigen wake-ups. EventSource reconnect is native. Versienummer en requestgeneration voorkomen dat oudere fetches een nieuwere stand overschrijven.

Sessies verlopen na7dagen; kamers na7dagen sinds de laatste spelactie; verlopen rijen en commando's worden bij nieuwe sessie-aanmaak opgeruimd. Limits zijn in SQLite persistent:120 nieuwe sessies per IP/uur,900 commandoverzoeken per IP/minuut,20.000 sessies,2.000 kamers,5.000 succesvolle commands per sessie en200.000 commands totaal. De browser bewaart alleen een onbevestigd commandopayload in localStorage, geen rollen/antwoorden of credentials. Een netwerkfout bewaart exact dezelfde intent voor handmatige retry; corrupt aanwezige intent blokkeert nieuwe mutaties in plaats van hem stil te vervangen. Verloren/verwijderde cookies hebben bewust geen accountloos herstelpad.

## Catalogus veilig uitbreiden

Vragen conform `PRODUCT.md`: eigen Nederlandse formulering, expliciet `approved:true`, datum en volledige bronverantwoording, menselijke broncontrole. Een boolean is geen factcheck; reviewers moeten werkelijk de bron en bruikbaarheid controleren. De importer schrijft geen webgegenereerde/onbeoordeelde inhoud automatisch goed.

```sh
# Dry-run: genereert alleen ontbrekende ID's, valideert alles; bronbestand/seed onveranderd.
node scripts/import-catalog.mjs /pad/naar/menselijk-gecontroleerd.json
# Alleen na bronreview: vervangt de canonical backend-only seed atomair.
node scripts/import-catalog.mjs /pad/naar/menselijk-gecontroleerd.json --write
# Rechtstreekse strikte validatie, zonder import:
go run . catalog internal/catalog/questions.nl.json
# Dan opnieuw npm run build + go build / docker build en gecontroleerd herstarten.
```

ID = `q_` + eerste24 hex SHA256(question + newline + firstSourceURL). Bestaande onjuiste ID's worden niet gerepareerd. Duplicaten, ongoedgekeurde rijen, verkeerde schema's/ID's, toekomstige verificatiedata en ongeldige attributie worden geweigerd. De backend valideert de volledige embedded seed en vereist minimaal20 vragen (10 spelers ×2 beurten) voordat catalogusrijen worden geschreven. De seed is bij startup transactioneel/idempotent **autoritair** in SQLite: bestaande ID's worden bijgewerkt en alleen ontbrekende catalogus-ID's verwijderd. Bij validatiefouten of een mislukte transactie blijft de bestaande catalogus onveranderd; startup faalt gesloten. Sessies, kamers, scores en commandologboeken worden niet door de import aangepast. Speelbare kandidaten komen uitsluitend uit de **actuele goedgekeurde embedded seed**. Oude reeds gedeelde rondes behouden hun volledige oorspronkelijke vraag/antwoord/rol/bron-snapshot. Binnen de kamer worden gebruikte vraag-ID's niet opnieuw gekozen, ook niet na Nieuw spel; historische gepensioneerde ID's blijven bewaard maar tellen niet mee als gebruikte huidige kaarten. Er moeten genoeg ongebruikte huidige vragen zijn voor alle geplande beurten.

Bewaar naast een gereviewd pakket een private `provenance.json` met bronfamilie, originele record-/revisie-ID's, opgehaalde respons-SHA256, ophaaldatum en reviewbewijs per vraag-ID. Dit is reviewmateriaal, geen extra runtime-schema of publieke antwoordbank; de parent controleert het tegen de definitieve seed. Alleen de backend-seed wordt ingebed. Het importcommando valideert ook losse reviewdeelsets; succesvolle validatie van minder dan20 vragen betekent niet dat zo'n seed kan opstarten. De app toont generieke links naar WikiDYK, Wikipedia Unusual articles en Open Trivia Database in ‘Spel & app’, maar vraagspecifieke bronnen en `rightsNote` uitsluitend na afrekening. Geen algemene CC0-/vrije-licentieclaim: de rechtennotitie volgt de werkelijk beoordeelde bron; een code-licentie van een datasetrepository geldt niet automatisch voor Wikipedia-afgeleide tekst.

## Vragen voorlezen (ElevenLabs)

`scripts/speak.mjs` genereert per vraag een mp3 in `internal/catalog/audio/<id>.mp3`. Die bestanden worden gecommit en in de binary ingebed. De server serveert ze op `/audio/<id>.mp3` en zet het pad als `audio` in de state zodra er een uitspraak voor de huidige vraag bestaat. De service worker cachet ze niet. ElevenLabs wordt alleen tijdens het genereren aangeroepen, nooit tijdens het spelen.

Maak in de repo-root een `.env`-bestand (staat in `.gitignore` en `.dockerignore`):

```sh
ELEVENLABS_API_KEY=...            # API-sleutel met Text to Speech-rechten
ELEVENLABS_VOICE_ID=...           # voice ID, niet de naam
# optioneel
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_64
```

```sh
node scripts/speak.mjs --dry-run   # hoeveel vragen en tekens nog ontbreken
node scripts/speak.mjs --limit 5   # proefje
node scripts/speak.mjs             # de rest; bestaande mp3's worden overgeslagen
node scripts/speak.mjs --only q_…  # één vraag opnieuw, bv. na stemwissel
node scripts/speak.mjs --prune     # mp3's van vervallen vraag-ID's opruimen
```

Een vraag-ID verandert als de vraagtekst verandert. Na een catalogusimport kun je het script dus gewoon opnieuw draaien. Voor een andere stem verwijder je de mp3's en genereer je ze opnieuw.

### Tv-modus: presentator en personages

In de tv-modus kijkt een tv mee via `/tv`. Hij leest de vraag voor en praat het spel aan elkaar met vooraf ingesproken zinnen. Die zinnen en de twaalf personages staan in `internal/catalog/host.nl.json`. Elk moment (`turn.pre`, `caught`, …) heeft een paar varianten; de tv kiest er willekeurig een en noemt spelers bij hun personagenaam. Getypte antwoorden worden alleen getoond, niet uitgesproken.

```sh
ELEVENLABS_HOST_VOICE_ID=...       # optioneel: andere stem voor de presentator
```

```sh
node scripts/speak.mjs --set host --dry-run   # hoeveel zinnen en tekens nog ontbreken
node scripts/speak.mjs --set host             # schrijft internal/catalog/audio/host/<id>.mp3
node scripts/speak.mjs --set host --prune     # mp3's van verwijderde zinnen opruimen
```

`audio/host/manifest.json` onthoudt welke tekst bij elke mp3 hoort. Pas je een zin aan, dan telt die vanzelf weer als te genereren. Ontbreekt een mp3, dan toont de tv alleen de ondertitel.

## PWA en privacygrens

Eigen opaque PNG192/512, maskable512 en Apple180; manifest en productie-SW. De build genereert een gesloten allowlist van alleen publieke shellbestanden, met hash van assets én worker-template als cache-identiteit. Navigaties zijn aan bijpassende HTML/assets gepind. Maximaal één vorige buildcache blijft bewaard voor open tabs. **Geen API, SSE, antwoord, rol, roomstate, cookie of credential in CacheStorage.** API-misses krijgen nooit SPA-HTML. `sw.js`: `Cache-Control: no-cache, no-store` én `Cloudflare-CDN-Cache-Control: no-store`.

Offline start alleen de openbare shell met eerlijke uitleg en uitgeschakelde spelacties. Reconnect haalt de echte stand op. Nieuwe workers wachten op expliciete toestemming; alleen het instemmende tabblad herlaadt, andere tabbladen behouden hun invoer. Browser-installability/offlineproeven zijn geen bewijs van fysieke iPhone/Android-installatie. Live HTTPS/CDN-headers moeten na afzonderlijk geautoriseerde deployment opnieuw worden getest.

## Exacte voorgestelde CI-volgorde

Geen workflows door de app-implementer aangemaakt; de parent beheert de infra-workflow.

```sh
npm ci
npm run build
node --test scripts/catalog.test.mjs
go test -race ./...
go vet ./...
go build -trimpath -o "$RUNNER_TEMP/bluffery" .
BLUFFERY_BINARY="$RUNNER_TEMP/bluffery" node scripts/restart-smoke.mjs
npm exec playwright install --with-deps chromium
# Start disposable backend in background; shell trap ruimt eigen PID op.
LISTEN_ADDR=127.0.0.1:18088 DATA_DIR="$RUNNER_TEMP/bluffery-data" \
  PUBLIC_BASE_URL=http://127.0.0.1:18088 BLUFFERY_DEV_FIXTURES=1 \
  "$RUNNER_TEMP/bluffery" &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT
# Wacht begrensd op GET http://127.0.0.1:18088/healthz =200.
E2E_BASE_URL=http://127.0.0.1:18088 npm run test:e2e
npm audit --audit-level=high
docker build -t bluffery:candidate .
```

Browserdefaults zijn portable: Playwright gebruikt zijn geïnstalleerde Chromium; optioneel `CHROMIUM_PATH` voor een lokale executable. `BLUFFERY_EVIDENCE_DIR` is optioneel (default `test-results/evidence`); `E2E_BASE_URL` default loopback18088. Tests gebruiken uitsluitend disposable fixturedata. De PWA waiting-updateproef gebruikt een expliciet gelabelde lokale proxy die alleen workerbytes verandert; de daadwerkelijke Go shell/API blijven upstream. Installability, geauthenticeerde cachegrens, native offline refresh en reconnect draaien rechtstreeks op de productie-Go-handler.

## Releasepoort

Onafhankelijke review van exacte sourcehashes en de volledig gemergde inhoud is vereist. Dockerbuild/runtime kon lokaal niet worden bewezen zonder bereikbare Dockerdaemon; doe dit in CI. Daarna pas een afzonderlijk geautoriseerde infra-release. Geen secrets, staging, commits, push, productieherstart of deployment zijn onderdeel van dit appwerk.
