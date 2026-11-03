# BINARY BROTHERHOOD – LAN-Party-App

Android-App, die auf dem Host-Smartphone einen lokalen Server startet. Alle Teilnehmer im selben WLAN
öffnen die App im Browser (`http://<IP-des-Hosts>:8080`). Alle Daten liegen ausschließlich in der
SQLite-Datenbank auf dem Host-Handy; Änderungen werden per WebSocket sofort an alle Geräte verteilt.
Keine Cloud, keine Konten, keine Kosten.

## Funktionen

| Reiter | Inhalt |
|---|---|
| **Spiele** | Gemeinsame Spieleliste mit Steam-Suche (automatisch, manuell korrigierbar), Beschreibung, Bild, Spieleranzahl. Markierung „für nächste Runde“, Reiter *Läuft gerade* und *Historie* (pro LAN-Ausgabe, mit Teilnehmern). |
| **Glücksrad** | Echtes Canvas-Rad mit farbigen Segmenten, Beschleunigung/Abbremsen, Tick-Sound, Zeiger, Gewinner-Highlight und Konfetti. Die Drehung wird vom Server entschieden und läuft auf **allen Geräten synchron** ab. Filter: nur markierte Spiele, bereits gespielte ausschließen. Alternative **Abstimmung** mit Live-Zwischenstand. |
| **Vorschläge** | Getrennt für *diese LAN* und *nächstes Jahr*. Up-/Downvotes, Kommentare, Übernahme in die Spieleliste. Beim Anlegen der nächsten LAN-Party werden „nächstes Jahr“-Vorschläge automatisch übernommen. |
| **Mitglieder** | Profile mit Name, Motto, Farbe, Profilbild (Upload vom Handy, wird clientseitig verkleinert), Statistik, XP, Level und Rang (Novize … Binärer Erleuchteter), XP-Protokoll. |
| **Forum** | Beiträge, Kommentare, angepinnte organisatorische Hinweise, Avatar + Name + Zeitstempel. |
| **Kosten** | Splitwise-artig: Anwesenheitstage pro Mitglied, Einkäufe (ganze LAN gewichtet nach Anwesenheit, oder nur ein Tag, oder individuelle Teilnehmer), Salden, „Wer schuldet wem“ mit minimalen Transfers, Ausgleich als bezahlt markieren. |
| **Ausrüstung** | Kategorisierte Liste (Switch, Beamer, Kabel, Getränke …), Zusagen „Ich bring's“, erledigt-Haken, offene Gegenstände, Vorlage aus der letzten LAN inklusive vorausgefüllter Zusagen. |
| **LAN-Party** | Ausgaben verwalten (Name, Jahr, Start, Dauer), neue Ausgabe anlegen, Host-Adresse, verbundene Geräte. |

### XP-System

| Aktion | XP |
|---|---|
| Runde gespielt (Teilnahme) | 50 |
| Vorschlag übernommen | 40 |
| Anwesenheitstag | 30 |
| Ausrüstung mitgebracht | 25 |
| Spiel hinzugefügt | 20 |
| Vorschlag / Einkauf vorgestreckt | 15 |
| Forum-Beitrag | 10 |
| Kommentar / Abstimmung | 5 |

Level-Schwelle: `50 · (n−1) · n` XP. Ränge: Novize (1), Laienbruder (3), Bruder (5), Mönch (8), Prior (11), Abt (15), Erzabt (20), Großmeister (26), Binärer Erleuchteter (33).

## Cloud-Variante (empfohlen für die Vorbereitung vor der LAN)

Derselbe Funktionsumfang läuft als Cloudflare Worker mit D1-Datenbank und ist von überall erreichbar, ohne dass
das Host-Handy an sein muss. Einrichtung, Deploy über GitHub Actions und Datenumzug vom Handy stehen in
[cloud/README.md](cloud/README.md). Unterschiede: Admin-Rolle statt Host, Registrierung nur mit Einladungscode,
Spielordner meldet der PC per Skript, Internet nötig.

## Bauen und installieren

Voraussetzungen: Android Studio (Ladybug oder neuer) bzw. JDK 17+ und Android SDK 35.

```bash
./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Oder das Projekt in Android Studio öffnen und auf das Host-Handy ausführen. Mindest-Android: 8.0 (API 26).

### Fertige APK von GitHub

Jeder Push auf `main` baut automatisch eine signierte Release-APK (GitHub Actions, `.github/workflows/android-release.yml`)
und hängt sie an das Rolling-Release **„latest“** (Pre-Release) an. Ein Tag `vX.Y.Z` erzeugt zusätzlich ein
versioniertes Release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Die APK heißt `BinaryBrotherhood-<Version>.apk` und liegt unter *Releases*. Auf dem Handy herunterladen,
„Installation aus unbekannten Quellen“ erlauben, fertig. Updates installieren sich über die alte Version,
weil alle Builds mit demselben Schlüssel signiert sind.

**In-App-Update:** Das Pfeil-Symbol oben rechts in der App prüft die GitHub-Releases, lädt die neueste APK
und startet den Installer (beim ersten Mal fragt Android nach der Erlaubnis „Unbekannte Apps installieren“).
Beim App-Start wird still geprüft; gibt es etwas Neues, bekommt das Symbol einen roten Punkt. Verglichen wird
über die Build-Nummer, die der Workflow als unsichtbaren Marker in die Release-Notes schreibt. Wer einen
Dev-Build (Versionsname mit `-dev`) installiert hat, bekommt auch das Rolling-Release „latest“ angeboten,
alle anderen nur reguläre Releases.

Signatur: Der Workflow erwartet die Repository-Secrets `BBL_KEYSTORE_BASE64`, `BBL_KEYSTORE_PASSWORD`,
`BBL_KEY_ALIAS` und `BBL_KEY_PASSWORD`. Fehlen sie, wird mit dem Debug-Key signiert. Lokal signiert
`./gradlew :app:assembleRelease`, wenn `BBL_KEYSTORE_PATH` und die Passwort-Variablen gesetzt sind.

## Spiele-Freigaben im LAN

Liegen die Spiele auf PCs im LAN, richtet man sie unter *Spiele → Freigaben* mit dem **Assistenten** ein, am
besten im Browser des PCs mit den Spielen: Der Assistent erkennt dessen Adresse, erzeugt ein PowerShell-Skript
(als Administrator einfügen), das einen eigenen Lesebenutzer, die Freigabe, die Rechte und die Firewall-Regel
anlegt, testet danach die Verbindung mit Vorschau der gefundenen Ordner und trägt die Freigabe ein. Alternativ
lassen sich vorhandene Freigaben und Unterordner per Tippen auswählen, oder Profis tragen den Pfad direkt ein,
z. B. `\\192.168.0.10\Spiele` mit Benutzer und Passwort. Die App durchsucht die Freigabe als SMB-Client: Jeder Unterordner wird zu einem Spiel. Dubletten werden
über den Namen (ohne Groß/Kleinschreibung und Satzzeichen) und den Pfad erkannt, einmal gesehene und wieder
gelöschte Ordner tauchen nicht erneut auf. Eingelesen wird beim Serverstart, alle 15 Minuten und per Knopf. Auf der
Spielkarte steht der Pfad mit „Kopieren“, die Dateien holt sich jeder direkt vom PC im Explorer. Eine eigene
Freigabe kann das Handy nicht anbieten (kein SMB-Server ohne Root).

## Login

Jedes Profil hat ein Passwort. Beim ersten Besuch wählt man sein Profil und legt das Passwort fest (bestehende
Profile ohne Passwort bekommen es beim ersten Login), neue Profile werden mit Name und Passwort angelegt. Der Browser
merkt sich die Anmeldung per Token, bis man sich abmeldet oder das Passwort ändert. Nur das eigene Profil lässt sich
bearbeiten oder löschen. Der Host (die App selbst, Zugriff über 127.0.0.1) kann Passwörter zurücksetzen, falls jemand
seines vergisst: Mitglied öffnen → „Zurücksetzen“, danach legt die Person beim nächsten Login ein neues fest.

## Benutzung

1. App auf dem Host-Handy starten. Der Server läuft als Vordergrund-Dienst (Benachrichtigung), WLAN und CPU werden wach gehalten.
2. Oben rechts auf das Teilen-Symbol tippen: QR-Code und Adresse (z. B. `http://192.168.0.42:8080`) erscheinen.
3. Alle anderen scannen den QR-Code oder tippen die Adresse im Browser ein und wählen bzw. erstellen ihr Profil.
4. Der Host nutzt dieselbe Web-Oberfläche in der App.

Tipp: Im Browser „Zum Startbildschirm hinzufügen“ gibt ein App-Gefühl. Ohne WLAN-Router funktioniert auch der Hotspot des Host-Handys.

Die Steam-Suche benötigt Internet auf dem Host-Handy (öffentliche Steam-Store-API, kein Key). Ohne Internet bleibt die manuelle Eingabe.

## Architektur

```
app/src/main/java/at/binarybrotherhood/app/
├── data/        Room-Entities, DAOs, AppDatabase (SQLite auf dem Host)
├── domain/      Repository (gesamte Geschäftslogik), XP-Regeln/Level, CostSplitter
├── server/      Ktor-Server (CIO) mit REST-API + WebSocket, DTOs, Steam-Client, Foreground-Service
├── ui/          Compose-Host-Oberfläche (Status, QR-Code, eingebettete WebView)
└── util/        IP-Ermittlung, QR-Code-Rendering
app/src/main/assets/web/
├── index.html, css/app.css      Web-App (kein Build-Schritt, reines ES-Module-JavaScript)
├── js/app.js                    Shell, Navigation, Profilwahl
├── js/store.js                  Zustand + WebSocket mit Auto-Reconnect
├── js/api.js, js/ui.js, js/steam.js
└── js/views/*.js                Eine Datei pro Reiter (games, wheel, suggestions, members, forum, costs, equipment, organisation)
```

### REST-API (Auszug)

Alle Endpunkte unter `/api`, JSON. Der Browser schickt die eigene Mitglieds-ID im Header `X-Member-Id`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/bootstrap` | aktuelle LAN-Ausgabe, alle Ausgaben, Mitglieder |
| GET/POST/PUT/DELETE | `/members`, `/members/{id}` | Profile; `POST /members/{id}/avatar` (Bild-Body), `GET /members/{id}/xp` |
| GET/POST/PUT/DELETE | `/games`, `/games/{id}` | Spiele; `POST /games/{id}/select` |
| GET/POST/PUT/DELETE | `/sessions` | Runden; `POST /sessions/{id}/end` |
| POST | `/wheel/spin` | Server wählt Gewinner und sendet den Spin an alle (`GET /wheel/state` für Nachzügler) |
| GET/POST | `/polls/current`, `/polls`, `/polls/{id}/vote`, `/polls/{id}/close` | Abstimmung |
| … | `/suggestions`, `/forum`, `/events`, `/costs`, `/equipment`, `/steam/search?q=` | siehe `server/LanServer.kt` |

WebSocket `/ws`: Nachrichten `{"type":"change","topic":"games"|"members"|…}`; der Spin wird als `topic: "wheel"` mit Nutzlast verteilt.

## Daten sichern

Die Datenbank liegt unter `/data/data/at.binarybrotherhood.app/databases/binary_brotherhood.db`, Profilbilder unter `files/avatars/`.
Beides ist in das Android-Backup eingeschlossen (`backup_rules.xml`).
