# Workout-App aufs iPhone bringen

Die App ist eine Web-App (PWA). Sie wird einmal online gestellt und dann wie eine normale App auf den Homescreen gelegt. Danach funktioniert sie auch **ohne Internet**.

## 1. Einmalig: Online stellen (GitHub Pages, kostenlos)

1. Auf <https://github.com> ein kostenloses Konto anlegen (falls noch keins vorhanden).
2. Rechts oben **+ → New repository**
   - Name: `workout-app`
   - **Public** auswählen. GitHub Pages ist im Gratis-Tarif nur für öffentliche Repos verfügbar. Im Repo liegt nur der App-Code, **keine Trainingsdaten**.
   - **Create repository**
3. Den Code hochladen (eine der beiden Varianten):
   - **Einfach:** Im neuen Repo auf „uploading an existing file“ klicken und den *Inhalt* des Ordners `workout-app` (alle Dateien und Unterordner) hineinziehen → **Commit changes**.
   - **Per Terminal:** Claude pusht den Code für dich, sobald du die Repo-Adresse nennst.
4. Im Repo: **Settings → Pages → Source: „Deploy from a branch“ → Branch `main`, Ordner `/ (root)` → Save**
5. Nach ca. 1 Minute ist die App erreichbar unter:
   `https://DEIN-GITHUB-NAME.github.io/workout-app/`

## 2. Aufs iPhone legen

1. Die Adresse oben in **Safari** öffnen. Andere Browser auf dem iPhone können das nicht so zuverlässig.
2. Unten auf **Teilen** tippen (Quadrat mit Pfeil nach oben).
3. Nach unten scrollen → **„Zum Home-Bildschirm“** → **Hinzufügen**.
4. Ab jetzt die App **immer über das neue Icon** öffnen, nicht über Safari. Nur dann sind die Daten dauerhaft gespeichert.

## 3. Deinen Plan laden

1. Die Datei `workout-plan-import.json` (liegt auf dem Mac-Schreibtisch) per **AirDrop** oder über **iCloud Drive** aufs iPhone schicken und in **Dateien** speichern.
2. In der App: **Mehr → Plan importieren** → Datei auswählen.
3. Fertig: Plan und deine bisherigen Trainings vom 18.11. und 23.11. sind übernommen.

## 4. Updates

Wenn Claude etwas an der App ändert und es online stellt, erscheint beim nächsten Öffnen oben **„Neue Version verfügbar – Neu laden“**. Deine Trainingsdaten bleiben dabei erhalten.

## 5. Datensicherung

- Alle Trainings liegen **nur auf deinem iPhone**.
- In der App unter **Mehr → Backup exportieren** die Datei in **iCloud Drive / Dateien** speichern, am besten alle paar Wochen.
- Bei einem neuen iPhone: App wie oben installieren → **Mehr → Backup wiederherstellen**.
- Achtung: Wer die App vom Homescreen löscht, löscht auch die Daten. Vorher also ein Backup machen.

## Hinweise

- Der Pausentimer piept am Ende, solange die App offen ist. Bei gesperrtem Display gibt es keinen Ton, weil iOS das für Web-Apps nicht erlaubt. Die Zeit läuft aber korrekt weiter.
- Das Display bleibt während des Trainings an.
