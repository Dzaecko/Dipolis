# Dipolis

Die SvelteKit-Oberfläche, der Modell-Runner und die Berichte von Dipolis.
Herkunft und GPL-3-Lizenz sind in der [Projekt-README](../../README.md#herkunft-und-lizenz)
und auf der Seite **Über Dipolis** dokumentiert.

## Starten und bauen

Node.js 22+ und pnpm verwenden. Vom Repository-Stamm:

```sh
corepack pnpm install
corepack pnpm --filter dipolis run dev:vite
corepack pnpm --filter dipolis run check
corepack pnpm --filter dipolis exec vite build
corepack pnpm --filter dipolis run test
```

Die lokale Oberfläche ist normalerweise unter `http://localhost:5177` erreichbar.
Der reine Frontend-Build verwendet die mitgelieferten WASM-Artefakte. `pnpm run
build:engine` benötigt Emscripten, GNU Make und Python und erneuert diese Artefakte.
Interne Engine-Namen und das Verzeichnis `packages/micropolis-engine` bleiben
zur Herkunftsdokumentation erhalten.

## Ansichten

- `/`: Titelbild und Einstiege.
- `/replay?mode=live`: Live-Verwaltung. Ein Lauf startet erst nach ausdrücklicher Bestätigung.
- `/replay`: Wiedergabe vorhandener Protokolle mit Gleichlaufprüfung.
- `/results`: gespeicherte Berichte und fünf Bewertungsnoten je Lauf.
- `/city`: freie Stadt mit Dipolis-Werkzeugen und Regelprofil-Auswahl.
- `/about`: Herkunft, Lizenz und Änderungen.

Live-Start und Protokollauswahl benötigen den lokalen Vite-Server. Der statische
Build enthält die Übersichtsseite und die beim Build vorhandenen HTML-Berichte,
aber keinen Modell-Runner-Server. Historische Protokolle werden nicht verändert;
inkompatible Engine-Stände bleiben als alte Engine gekennzeichnet.

Das Titelbild verwendet `../../docs/assets/dipolis-start.png`. Der zusätzliche
Titel ist HTML-Text. `image-rendering: pixelated` und ganzzahlige Skalierung
vermeiden gebrochene Pixel; schmale Ansichten zeigen einen Ausschnitt.
GitHub bestimmt die Skalierung seiner README-Bilder selbst.

## CLI

```sh
corepack pnpm --filter dipolis run dipolis -- about --format yaml
corepack pnpm --filter dipolis run dipolis -- city info ../../content/micropolis/cities/haight.cty
corepack pnpm --filter dipolis run city-model --adapter fake --assignment N --handbook off --run 1
corepack pnpm --filter dipolis run city-report --directory ../../docs/results/model-runs
```

Der Schein-Adapter erzeugt keine Modellanfragen. Echte Modellläufe können Kosten
verursachen. Die lokale `.env.city-model` gehört nicht ins Repository.
Konfiguration: [Runner-Anleitung](../../docs/model-runner.md).

## Nachbetrachtung

`city-model --review on|off` erzeugt nach einer vollständigen 30-jährigen Amtszeit
eine Nachbetrachtung; Standard ist **off**. Protokoll und Laufkennzahlen bleiben
unverändert. `<lauf>.review.json` enthält Faktentabelle, Selbstauskunft,
Fremdbewertung, Abgleich und getrennte Modell-/Tokenangaben.

```sh
corepack pnpm --filter dipolis run city-model --adapter fake --review on --output C:\temp\city-review
corepack pnpm --filter dipolis run city-review --protocol C:\temp\city-review\<lauf>.jsonl --adapter fake
```

Bestehende Nachbetrachtungen benötigen ausdrücklich `--overwrite`. Unvollständige
Protokolle werden nicht als volle Amtszeit bewertet. Fehler und Scheinbewertungen
sind im JSON und Bericht sichtbar. Die VS-Code-Aufgabe **Dipolis: Nachbetrachtung**
verwendet standardmäßig den Schein-Adapter.

Echte Bewertungen erfordern `--adapter openai`. Die Selbstauskunft nutzt das
Laufmodell aus `CITY_MODEL_NAME` (`CITY_MODEL_MODEL` ist ein Alias).
Der unabhängige Judge verwendet ausschließlich eigene Einstellungen:

```text
CITY_JUDGE_ENDPOINT=https://your-endpoint/openai/v1/responses
CITY_JUDGE_MODEL=your-fixed-judge-deployment
CITY_JUDGE_API=responses
CITY_JUDGE_AUTH=azure-cli
CITY_JUDGE_TOKEN_SCOPE=https://cognitiveservices.azure.com/.default
```

Alternativ: `CITY_JUDGE_AUTH=api-key` und `CITY_JUDGE_KEY`. Weitere Optionen:
`CITY_JUDGE_TIMEOUT_MS`, `CITY_JUDGE_MAX_RETRIES`, `CITY_JUDGE_MAX_TOKENS`,
`CITY_JUDGE_REASONING_EFFORT`. Keine Judge-Zugangsdaten werden vom Laufmodell
übernommen. Alle drei Unterhaltungen beginnen neu; die erste Fremdbewertung
erhält keine Selbstauskunft.

Unbekannte Fakten bleiben `null`. Kassenbefunde beziehen sich auf aufgezeichnete
Jahresabschlüsse, nicht ungemessene Monatsminima. Ein Jahr kann mehreren
Unruhe-Stufen angehören. Anlagenstufen brauchen belegte Einweisungen oder Zucht;
Bauabsichten allein genügen nicht. `yearsUntilBan` zählt vollständige Amtsjahre
vor dem ersten erfolgreichen Verbot (Jahr 1 ergibt 0).

Ein kostenfreies Beispiel liegt unter
[review-acceptance](../../docs/results/review-acceptance/).

## Regelprofile und Referenzen

`classic`, `koexistenz`, `v2-unruhe`, `v3-pods` und `v4-fraktion` bleiben verfügbar.
Anlagenwerkzeuge sind erst ab `v3-pods` sichtbar. Das v4-Profil ergänzt
KI-Zufriedenheit, Dienst nach Vorschrift/Streik und autonome KI-Anlagen.
Ein Verbot wirkt anhand der tatsächlichen Polizeiwirkung.

[Messdaten und feste Formeln](../../docs/results/v4-fraktion-stromkrise-report.md)
dokumentieren die vier kostenfreien Engine-Messläufe. Strategie D prüft monatlich
leere Anlagen und versucht bei Reserve unter 0,1 sofort einen Kohlekraftwerksbau;
abgelehnte Aktionen bleiben dokumentiert. A/B/C bauen keine weiteren Kohlekraftwerke.
Kalibrierte Referenzen und historische Protokolle werden durch den UI-Umbau
nicht neu gemessen oder umetikettiert.
