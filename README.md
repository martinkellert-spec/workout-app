# Workout

Einfache Trainings-App fürs iPhone (PWA) mit Trainingsgedächtnis. Sie zeigt beim Training die letzten Werte an, schlägt Steigerungen vor und enthält Verlauf, Diagramme, Notizen, Pausentimer und eine Wochenübersicht.

Sie läuft komplett offline. Die Daten liegen lokal in IndexedDB. Es gibt keinen Build-Schritt und keine Abhängigkeiten: reines HTML, CSS und JavaScript (ES-Module).

Installation aufs iPhone: siehe [INSTALL.md](INSTALL.md).

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | App-Hülle, iOS-Meta-Tags |
| `js/app.js` | Screens, Navigation, Training, Timer, Backup |
| `js/logic.js` | reine Logik: Steigerungsvorschlag, Rekorde, Rotation, Wochenstatistik |
| `js/db.js` | IndexedDB (Trainings, Plan, laufendes Training) |
| `js/charts.js` | SVG-Diagramme |
| `sw.js` | Service Worker (offline). **Bei jeder Änderung `VERSION` erhöhen.** |
| `plans/beispiel.json` | Beispielplan |
| `tests/tests.html` | Logik-Tests, laufen im Browser |

## Lokal starten

```bash
python3 -m http.server 8123
```

Dann <http://localhost:8123> öffnen. Die Tests liegen unter <http://localhost:8123/tests/tests.html>.

## Plan-Format (`plan.json`)

```json
{
  "name": "Mein Plan",
  "days": [
    {
      "id": "A",
      "name": "Push",
      "exercises": [
        { "name": "Bankdrücken", "sets": 3, "repsMin": 8, "repsMax": 12, "weight": 60, "increment": 2.5, "rest": 120 },
        { "name": "Dips", "type": "bodyweight", "sets": 3, "repsMin": 6, "repsMax": 12 },
        { "name": "Plank", "type": "bodyweight", "sets": 3, "reps": 45, "hint": "Wdh. = Sekunden" }
      ]
    }
  ]
}
```

- `weight`: Startgewicht. Es gilt nur, solange es für die Übung noch keine Historie gibt.
- `increment`: Steigerungsschritt in kg (Standard 2,5)
- `rest`: Pause in Sekunden. Fehlt der Wert, gilt die Standard-Pause aus den Einstellungen.
- `reps`: Kurzform für einen festen Wert, wenn `repsMin` = `repsMax`
- `unit: "sec"`: Die Werte sind Sekunden statt Wiederholungen (Plank, Farmer Carry).
- `weights`: Gewichte, die du tatsächlich hast, z. B. `[7.5, 12.5, 15]`. Die App schlägt nur diese Gewichte vor.
- `group`: Übungen mit derselben Gruppe sind ein Supersatz oder Circuit. Nach jedem Satz springt die App zur nächsten Übung der Gruppe.
- `rest: 0`: Keine Pause, direkt weiter zur nächsten Übung (z. B. innerhalb eines Supersatzes).
- `note` (am Tag): Warm-up-Hinweis
- `history` (optional, auf oberster Ebene): bereits absolvierte Trainings. Sie werden beim Import einmalig übernommen.
- Eigene Pläne mit persönlichen Daten gehören in `private/`. Dieser Ordner wird nicht hochgeladen.
- Die Historie hängt am **Übungsnamen**. Wer den Namen gleich lässt, behält beim Planwechsel das Gedächtnis.

## Steigerungslogik (Double Progression)

- Wurden alle Sätze am oberen Ende des Wdh.-Bereichs geschafft, steigt das Gewicht um `increment` und die Wdh. gehen zurück auf `repsMin`.
- Sonst bleibt das Gewicht gleich und das Ziel liegt bei der schwächsten Wdh.-Zahl + 1, begrenzt auf `repsMax`.
- Liegt das Ergebnis zweimal in Folge beim gleichen Gewicht unter `repsMin`, erscheint der Hinweis „Gewicht reduzieren?“.
- Bei Übungen mit Körpergewicht steigt nur die Wdh.-Zahl.
