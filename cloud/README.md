# BINARY BROTHERHOOD – Cloud

Cloudflare Worker mit API (TypeScript) und Web-App (`app/src/main/assets/web`).
Live: https://binary-brotherhood.binary-brotherhood-cloud.workers.dev

## Aufbau

- **Realm**: eine Gruppe mit eigenen Daten (Spiele, Forum, Turniere, XP …). Jeder Realm ist ein Durable Object
  (`src/realm.ts`) mit eigener SQLite-Datenbank. Die API läuft in `src/api.ts`.
  - Das Schema liegt in `realm-schema/` und steht in `SCHEMA` (`src/realm.ts`). Neue Dateien nur anhängen.
  - Art `lan` oder `online`. `online` blendet LAN-Party, Kosten, Ausrüstung und Freigaben aus (`LAN_ONLY`).
- **Konto**: Name, Passwort und Profil gelten in allen Realms (D1: `users`, `user_tokens`, `realm_members`).
  Profiländerungen gleicht `pushProfile` (`src/link.ts`) in alle Realms des Kontos ab.
- **Rollen**: Realm-Admin (je Realm) und Super-Admin (Konto, darf alles, `/api/super/*`).
- **Worker** (`src/index.ts`): Konto-Routen, Realm-Verzeichnis, Verwaltung. Alles Übrige leitet er an den Realm weiter,
  das Konto dabei im Header `X-Auth`. `/internal/*` erreicht nur der Worker selbst.
- **Realm-Auswahl im Client**: Header `X-Realm`; Bilder und Audio per `?realm=` oder Cookie `bb_realm`.
  Ohne Angabe gilt `binary-brotherhood`.
- **Einladungslink**: `/?realm=<slug>&invite=<code>`.

Das D1-Schema (`migrations/`) legt der Worker beim Start selbst an, denn `wrangler d1 migrations apply --remote`
funktioniert mit dem Token nicht.

## Befehle

```bash
npm run deploy    # Änderungsprotokoll aus git erzeugen + veröffentlichen
npm test          # Turnierlogik
npx wrangler dev --port 8787 --local
```
