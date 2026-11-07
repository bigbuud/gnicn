# gnicn

Kleine webapp die video's uit een map op je server afspeelt: **willekeurig** of **op volgorde**, na elkaar, met **vorige / volgende / wissen**. Geen dependencies (enkel Node.js), draait in één Docker-container.

## Starten

```bash
# 1. Zet dit project op GitHub (main-branch) -> de workflow bouwt automatisch
#    ghcr.io/<jouw-naam>/gnicn:latest (amd64 + arm64, dus ook Raspberry Pi)
# 2. Pas docker-compose.yml aan (image-naam + videomap) en start:
docker compose up -d
```

Of lokaal bouwen en draaien:

```bash
docker build -t gnicn .
docker run -d --name gnicn -p 8080:8080 \
  -v /pad/naar/je/videos:/videos gnicn
```

Open daarna `http://<server>:8080`.

## Bediening

| Actie | Knop | Toets |
|---|---|---|
| Volgende | Volgende | `N` |
| Vorige | Vorige | `P` |
| Willekeurig / op volgorde | Modus-knop | `R` |
| Wissen (met bevestiging) | Wissen | `Delete` |
| Pauze / play | | spatie |
| ±10 s spoelen | | pijltjes links/rechts |
| Volledig scherm | | `F` |

- Willekeurig = elke video komt één keer aan bod in een geschudde lijst; "Vorige" gaat netjes terug in die lijst. Is de lijst op, dan wordt opnieuw geschud.
- Submappen worden mee ingelezen. Met ↻ lees je de map opnieuw in.
- Een video die niet afspeelt (codec) wordt na 1,5 s overgeslagen.

## Instellingen (omgevingsvariabelen)

| Variabele | Standaard | Uitleg |
|---|---|---|
| `VIDEO_DIR` | `/videos` | Map in de container |
| `ALLOW_DELETE` | `true` | `false` verbergt en blokkeert wissen |
| `TRASH_DIR` | – | Als gezet: wissen = verplaatsen naar deze map (veiliger) |
| `AUTH_USER` / `AUTH_PASS` | – | Basic-auth login |
| `EXTENSIONS` | `mp4,m4v,webm,mkv,mov,ogv,avi` | Welke bestanden meetellen |
| `PORT` | `8080` | |

## Let op

- **Rechten:** om te wissen moet de container schrijfrechten op de map hebben. De container draait als uid 1000; heb je een andere eigenaar (bv. op een NAS), zet `user: "uid:gid"` in de compose.
- **Codecs:** de browser speelt af, de server transcodeert niet. `mp4` (H.264/AAC) en `webm` werken overal; `mkv`/`avi`/HEVC enkel als je browser dat ondersteunt.
- **Beveiliging:** wissen kan elke bezoeker. Zet `AUTH_USER`/`AUTH_PASS` of een reverse proxy met login voor je de app buiten je LAN openzet.
