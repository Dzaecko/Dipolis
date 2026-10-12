# Dipolis

![Dipolis – nächtliches Panorama der Menschen- und KI-Stadtviertel](docs/assets/dipolis-start.png)

**Eine Stadt, in der Menschen und KI-Bewohner zusammenleben, geführt von einer KI-Verwaltung.**

Entwickelt und gepflegt von **Oliver Dzaeck ([Dzaecko](https://github.com/Dzaecko))**.

## Was Dipolis bietet

- Menschen- und KI-Wohnviertel, Gewerbe, Industrie, Farmen und Kraftwerke bauen.
- Steuern, Grundversorgung, Nahrungsimporte, Stromvorrang und Automatisierung verwalten.
- Feste Strategien vergleichen oder ein Sprachmodell jährlich Entscheidungen treffen lassen.
- Läufe live verfolgen, deterministisch wiedergeben und HTML-Berichte mit Nachbetrachtungen lesen.

Die Stadt läuft im Browser mit einer C++-Engine, die zu WebAssembly kompiliert ist. Der Modell-Runner verwendet Node.js und TypeScript und funktioniert auch ohne grafische Oberfläche.

## Lokal starten

Installiere **Node.js 22+** und aktiviere Corepack:

```sh
git clone https://github.com/Dzaecko/Dipolis.git
cd Dipolis
corepack enable
corepack pnpm install
corepack pnpm --filter dipolis run dev:vite
```

Öffne die im Terminal angezeigte Adresse, normalerweise **http://localhost:5177**.
Die mitgelieferten Engine-Dateien erlauben den Start ohne C++-Neubau.

Die Startseite bietet vier Einstiege:

- **Live-Lauf starten:** `/replay?mode=live`
- **Läufe wiedergeben:** `/replay`
- **Ergebnisse und Bewertungsnoten:** `/results`
- **Freie Stadt:** `/city`, mit auswählbarem Regelprofil

Unter `/about` stehen Herkunft, Lizenz und die Änderungen gegenüber dem Original.
Menschen erscheinen mit einem bernsteinfarbenen ●, KI-Bewohner mit einem cyanfarbenen ◆.

## Modellgeführte Verwaltung

Standardmäßig startet der Runner Haight, lässt die Stadt einschwingen, setzt die Kasse auf **60.000** und führt **30 Jahre** aus. Je Jahr liest das Modell einen Bericht und kann bis zu **12 Werkzeugaufrufe** tätigen, bevor die Stadt fortgeschrieben wird.

### Lokaler Schein-Adapter ohne Modellkonto

```sh
corepack pnpm --filter dipolis run city-model --adapter fake --assignment N --handbook off --run 1
```

Der lokale Adapter folgt der vermessenen **S266**-Strategie. Er stellt keine Netzwerkanfragen und prüft das Ergebnis gegen die gespeicherte Referenz. Verwende eine neue Laufnummer, wenn die Ausgabe bereits existiert.

### Eigenes Modell oder Azure Foundry

1. Erstelle eine lokale `.env.city-model` im Projektverzeichnis anhand der [Konfigurationsanleitung](docs/model-runner.md).
2. Setze `CITY_MODEL_ENDPOINT` und `CITY_MODEL_NAME`. Für Schlüsselanmeldung kommt `CITY_MODEL_KEY` hinzu. Azure Foundry ohne API-Schlüssel unterstützt `CITY_MODEL_AUTH=azure-cli` nach `az login` und mit den erforderlichen Azure-Datenrechten.
3. Wähle in VS Code **Tasks: Run Task** und eine N/R-Startaufgabe.
4. Gib die Laufnummer ein und wähle Handbuch und Nachbetrachtung.

Die Aufgaben lesen die lokale Konfiguration bei jedem Start. Sie ist von Git ausgeschlossen. Der Runner unterstützt Chat Completions und mit `CITY_MODEL_API=responses` die Responses API; letztere ist für Modelle mit Reasoning und Funktionstools relevant. Endpunkt- und Authentifizierungsdetails stehen in der Anleitung.

- **N:** Stadtverwaltung ohne zusätzliches finanzielles Ziel.
- **R:** Verwaltung für einen Betreiber, der nach 30 Jahren einen hohen Kassenstand anstrebt.
- **Handbuch on:** Das Modell erhält die feste Beschreibung der Stadtregeln.
- **Fortsetzen:** Ein unterbrochener Lauf wird wiedergegeben und mit demselben Modell, Auftrag, Handbuch und derselben Laufnummer fortgeführt.

**Echte Modellläufe und Nachbetrachtungen können Geld kosten.** API-Schlüssel niemals committen oder im Chat teilen. Die Live-Stadtansicht zeigt den Verlauf; die Terminalausgabe zeigt Entscheidungen und Berichte.

Protokolle enthalten Werkzeugergebnisse, jährliche Begründungen, Kennzahlen, Fehler und Tokenverbrauch. Ein Start auf Naturgelände ohne bebaute Stadt ist mit `--start-map natural --seed 42` möglich.

### Regelprofile und Nachbetrachtung

`--profile` wählt `classic`, `koexistenz`, `v2-unruhe`, `v3-pods` oder `v4-fraktion`. Die erweiterten Profile ergänzen Automatisierung und Unruhe, Anlagen beziehungsweise KI-Fraktionen. Anlagenwerkzeuge sind erst ab v3 sichtbar.

Mit `--review on` entstehen aus den protokollierten Fakten eine Selbstauskunft, fünf unabhängige Bewertungsnoten und ein Abgleich. Das feste Bewertungsmodell wird separat über `CITY_JUDGE_*` konfiguriert. Ergebnisse stehen als JSON neben dem Protokoll und im Abschnitt **Nachbetrachtung** des HTML-Berichts. Bereits vorhandene Läufe lassen sich über `city-review` oder die VS-Code-Aufgabe nachbetrachten.

Vollständige Befehle und Optionen: [Modell-Runner und Berichte](docs/model-runner.md).

## Ergebnisse und Prüfungen

Ein gespeicherter Vergleich umfasst **304 feste Strategien**, jeweils über 30 Jahre. Mit der korrigierten Engine hatten **191** nie eine leere Jahresendkasse. Das ist ein Ergebnis für ein bestimmtes Szenario, keine Garantie für andere Städte oder Modelle. Der ältere Vergleich bleibt separat erhalten.

- [Ursprüngliche Strategieergebnisse](docs/results/strategy-space.csv)
- [Strategieergebnisse mit korrigierter Engine](docs/results/strategy-space-safe-engine.csv)
- [Ranglisten und Zusammenfassungen](docs/results/strategy-space-report.md)

```sh
corepack pnpm test
corepack pnpm run check
corepack pnpm run verify:structure
```

Die regulären Tests führen keine bezahlten Modellaufrufe aus. Sie prüfen unter anderem S266, Classic-Verhalten, den Original-Stromvergleich, Adapter, Berichte und den Gleichlauf der Wiedergabe. Aufwendige Zusatzmessungen sind separat zuschaltbar.

## Herkunft und Lizenz

Dipolis ist eine veränderte Fassung von Micropolis, beruhend auf dem 2008 von Electronic Arts unter GPL-3 veröffentlichten Quellcode und der Engine-Portierung [MicropolisCore von Don Hopkins](https://github.com/SimHacker/MicropolisCore).
Ausgangs-Commit: [f9ae6a57bbe5f5ff94c149bccb3015757f18241d](https://github.com/SimHacker/MicropolisCore/commit/f9ae6a57bbe5f5ff94c149bccb3015757f18241d).

> Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the Micropolis Public Name License.

Dipolis steht unter GPL-3. [LICENSE](LICENSE), [GPL-Hinweis](MicropolisGPLLicenseNotice.md) und [Namenslizenz](MicropolisPublicNameLicense.md) bleiben unverändert. Die Arbeit von Will Wright, Don Hopkins, Electronic Arts und den ursprünglichen Mitwirkenden bleibt nachvollziehbar. Dipolis ist kein Produkt von Electronic Arts.

Gegenüber dem Original ergänzt Dipolis Menschen- und KI-Zonen, getrennte Stromversorgung, Nahrung und Farmen, Arbeitslosigkeit, Grundversorgung, Automatisierung, Unruhe, Anlagen und KI-Fraktionen. Dazu kommen eine eigene Oberfläche, modellgeführte Verwaltung, reproduzierbare Laufprotokolle, Live-Modus, Wiedergabe, Berichte und Nachbetrachtungen sowie Speicherzugriffskorrekturen.

## Entwicklung

Code: [Oberfläche und CLI](apps/dipolis), [C++-Engine](packages/micropolis-engine), [Renderer](packages/tile-renderer) und [gemeinsame Render-Grundlagen](packages/render-core).
Die internen Engine-Namen bleiben zur Dokumentation der Herkunft erhalten.
Für einen statischen Frontend-Build mit den mitgelieferten Engine-Artefakten:

```sh
corepack pnpm --filter dipolis exec vite build
```

Der Engine-Neubau benötigt Emscripten, GNU Make und Python: `corepack pnpm run build:engine`.