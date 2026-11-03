# BINARY BROTHERHOOD in der Cloud

Derselbe Funktionsumfang wie die Android-App, aber als Cloudflare Worker: API in TypeScript, Datenbank D1 (SQLite),
Web-Oberfläche aus `app/src/main/assets/web` als statische Dateien, Live-Updates über ein Durable Object.
Erreichbar von überall unter `https://binary-brotherhood.<konto>.workers.dev`.

## Realms

Jede Gruppe ist ein eigener **Realm** mit vollständig getrennten Daten: Mitglieder, Logins, Spiele, Forum und Einstellungen.
Technisch hat jeder Realm ein eigenes Durable Object (`Realm`) mit eigener SQLite-Datenbank. Das Schema liegt in
`realm-schema/` und wird beim ersten Zugriff angewendet. Neue Schema-Dateien hängst du dort an und trägst sie in
`src/realm.ts` (`SCHEMA`) ein. D1 enthält nur noch das Realm-Verzeichnis (`realms`) und den Altbestand von vor den Realms.
Den Altbestand übernimmt der Realm `binary-brotherhood` beim ersten Aufruf automatisch.

- **Art**: `lan` (mit LAN-Party, Anwesenheit, Kosten, Ausrüstung, Freigaben) oder `online` (nur Spiele, Glücksrad,
  Turniere, Vorschläge, Forum, Discord). Der Admin kann die Art unter Profil-Menü → Realm-Einstellungen umschalten.
  LAN-Daten werden dabei nur ausgeblendet.
- **Login**: Zuerst wählst du den Realm, dann das Profil. Wer einen Realm gründet und das erste Profil anlegt, wird Admin.
  Direktlink zum Realm: `https://…/?realm=<slug>`.
- Der Client schickt den Realm als Header `X-Realm`. Bilder und Audio schicken ihn als `?realm=` bzw. Cookie `bb_realm`,
  die Freigabe-Skripte als `?realm=`. Ohne Angabe gilt `binary-brotherhood`, damit alte Skripte weiterlaufen.

## Einmalige Einrichtung (ca. 15 Minuten)

1. Kostenloses Konto auf https://dash.cloudflare.com anlegen.
2. Im Projektordner `cloud/` anmelden und die Datenbank anlegen:
   ```bash
   cd cloud
   npm install
   npx wrangler login                        # öffnet den Browser
   npx wrangler d1 create binary-brotherhood # gibt eine database_id aus
   ```
3. Die ausgegebene `database_id` in `wrangler.toml` eintragen (Platzhalter `00000000-…` ersetzen).
4. Schema anlegen und veröffentlichen:
   ```bash
   npx wrangler d1 migrations apply binary-brotherhood --remote
   npx wrangler deploy
   ```
   Die Ausgabe nennt die Adresse. Diese Adresse an alle verteilen.
5. Das erste Profil, das sich registriert, wird automatisch Admin. Danach braucht jede Registrierung den
   Einladungscode (Profil-Menü oben rechts → „Einladungscode“).

## Automatisches Ausrollen über GitHub

Der Workflow `.github/workflows/cloud-deploy.yml` veröffentlicht bei jedem Push auf `main`, der `cloud/` oder die
Web-Oberfläche berührt. Dafür im Repository:
- Secrets `CLOUDFLARE_API_TOKEN` (Dashboard → My Profile → API Tokens → Vorlage „Edit Cloudflare Workers“,
  zusätzlich D1-Berechtigung „Edit“) und `CLOUDFLARE_ACCOUNT_ID` (Dashboard → Workers & Pages, rechts).
- Variable `CLOUD_DEPLOY_ENABLED` = `true` (Settings → Secrets and variables → Actions → Variables).

## Daten vom Handy übernehmen

Android-App → Host-Ansicht → „Daten exportieren“ legt `binary-brotherhood-export.json` im Download-Ordner ab.
In der Cloud als Admin anmelden → Profil-Menü → „Daten vom Handy importieren“. Der Import ersetzt alle Daten;
Passwörter bleiben gültig, alle Geräte müssen sich neu anmelden.

## Unterschiede zur Handy-Variante

- Admin-Rolle statt „Host“: Admins setzen Passwörter zurück, ernennen Admins, sehen den Einladungscode.
- Registrierung nur mit Einladungscode.
- Spiele-Freigaben: Die Cloud kommt nicht ins LAN. Der Assistent erzeugt ein PowerShell-Skript, das die Ordnerliste
  des PCs hochlädt (und auf Wunsch die Windows-Freigabe einrichtet). Bei neuen Spielen das Skript erneut ausführen.
- Internet nötig, auch auf der LAN-Party.

## Lokal entwickeln

```bash
cd cloud
npx wrangler d1 migrations apply binary-brotherhood --local
npx wrangler dev        # http://127.0.0.1:8787
```
