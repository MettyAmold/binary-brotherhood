# BINARY BROTHERHOOD

Web-App für LAN-Partys und Online-Spielerunden. Sie läuft auf Cloudflare unter
https://binary-brotherhood.binary-brotherhood-cloud.workers.dev; die Android-App zeigt dieselbe Seite.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Web-App ohne Build-Schritt (ES-Module). `js/app.js` Shell und Routing, `account.js` Login und Realm-Auswahl, `admin.js` Admin-Dialoge, `views/` eine Datei pro Reiter |
| `cloud/` | Cloudflare Worker: API, Realms (Durable Objects), Konten (D1). Details in [cloud/README.md](cloud/README.md) |
| `app/` | Android-App: WebView auf die Cloud-Adresse plus Update-Funktion |

## Funktionen

- **Realms**: getrennte Gruppen, Art *LAN-Party* oder *Online-Spielesuche*. Ein Konto gilt in allen Realms, XP und Level je Realm.
- **Spiele** mit Steam-Suche, **Glücksrad** und Abstimmung (synchron auf allen Geräten), **Turniere** (Liga, Swiss, K.o.),
  **Vorschläge**, **Forum** mit Bildern und GIFs, **Mitglieder** mit XP und Rängen, **Discord**-Anbindung.
- Nur in LAN-Realms: **LAN-Party**-Ausgaben, **Anwesenheit**, **Kosten** teilen, **Ausrüstung**, **Spiele-Freigaben**
  (der PC meldet seine Spielordner per PowerShell-Befehl).
- Rollen: Realm-Admin und Super-Admin.

### XP

| Aktion | XP |
|---|---|
| Turniersieg | 100 |
| Runde gespielt | 50 |
| Vorschlag übernommen | 40 |
| Anwesenheitstag | 30 |
| Ausrüstung mitgebracht | 25 |
| Spiel hinzugefügt | 20 |
| Vorschlag, Einkauf | 15 |
| Forum-Beitrag | 10 |
| Kommentar, Abstimmung | 5 |

Level-Schwelle `50 · (n−1) · n` XP. Ränge: Novize, Laienbruder, Bruder, Mönch, Prior, Abt, Erzabt, Großmeister, Binärer Erleuchteter.

## Android-App

Jeder Push auf `main` baut eine signierte APK (Pre-Release „latest“), ein Tag `vX.Y.Z` ein reguläres Release
(`.github/workflows/android-release.yml`). Die App prüft beim Start auf neue Releases und installiert sie über das
Update-Symbol.

```bash
./gradlew :app:assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

Signatur: Die Secrets `BBL_KEYSTORE_BASE64`, `BBL_KEYSTORE_PASSWORD`, `BBL_KEY_ALIAS` und `BBL_KEY_PASSWORD` müssen
gesetzt sein, sonst wird mit dem Debug-Key signiert. Die Cloud-Adresse lässt sich mit `BBL_CLOUD_URL` überschreiben.
