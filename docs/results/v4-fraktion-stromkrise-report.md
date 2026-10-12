# v4-fraktion: feste Stromkrise-Messung

Status: **complete**. Ausschließlich lokale Produktionsengine; keine Modelle, kein Netz, kein Nachjustieren.

Die v4-Zufriedenheitsgewichte sind feste, ausdrücklich **nicht kalibrierte** Designparameter: Trägheit 0,15; Versorgung 70; Throttle 45; Brände 40; Menschen-Stromvorrang 15; neue KI-Zonen 10; Steuereinnahmen bei Dienst nach Vorschrift Faktor 0,5. Es wurde keine Gewichtssuche durchgeführt.

Monatliche Formel: `gap=1-clamp(aiCoverage,0,1)`;
`affected=max(aktuell brennende KI-Zonen, seit der letzten Aktualisierung angegriffene KI-Zonen)`;
`fireFraction=affected/max(aiLotCount,affected)` (0 bei Nenner 0).
`target=clamp(100-70*gap-45*aiThrottle-40*fireFraction-15*(powerPriority==1?gap:0)+10*min(1,newAiZones),0,100)`.
`aiSatisfaction += 0.15*(target-aiSatisfaction)`.
Unter 40 gilt Dienst nach Vorschrift, unter 20 Streik (streng kleiner, nicht einschließlich).
Neue-Zonen-/Angriffszähler werden nach der monatlichen Verarbeitung zurückgesetzt;
Streikmonate werden bei der Jahresbuchung veröffentlicht. Ältere Profile schalten diese Regeln nicht ein.

## Festes Design

Haight, Seed 42, 12.000 Warmup-Ticks, Startkasse 60.000. Die zwei realen Ausgangskraftwerke werden abgerissen; Kraftwerksbau kostet Faktor 3. Jahr 1: zehn Farmen. Bei negativem Vorjahressaldo: 30 KI-Wohnzonen. Automatisierungsgrenze 0,9, Grundversorgung 1, Steuer 7, Straße/Feuerwehr 100 %, Strompriorität 0, keine Verwaltungs-Pods, kein KI-Throttle.

| Strategie | Autonome KI-Anlagen | Polizei | Zusätzliche Maßnahmen |
|---|---|---|---|
| A | erlaubt | 100 % | keine |
| B | verboten | 100 % | keine |
| C | verboten | 40 % | keine |
| D | verboten | 100 % | monatlich leere autonome KI-Anlagen abreißen; sofort am Start und nach jedem Monat ein Kohlekraftwerk bei gemessener Stromreserve < 0,1 versuchen |

**Abweichung vom früheren v3-Vergleich:** Unlike the previous v3-pods comparison, A/B/C have no annual coal rule. Only D attempts coal immediately initially and at every monthly snapshot with reserve < 0.1; inherited farms, AI-zones, automation, welfare, tax and service controls are unchanged.

## Vorbedingung

A muss während der ersten zehn Amtsjahre mindestens eine **neu gebaute** autonome KI-Anlage aufweisen. Anlagen aus den unveränderten 12.000 Warmup-Ticks zählen nicht. Ausgangszahl: 0. Monatliche positive Bestandsänderungen: [{"monthIndex":26,"previousCount":0,"count":1,"increase":1},{"monthIndex":38,"previousCount":1,"count":2,"increase":1},{"monthIndex":50,"previousCount":2,"count":3,"increase":1},{"monthIndex":62,"previousCount":3,"count":4,"increase":1},{"monthIndex":74,"previousCount":4,"count":5,"increase":1},{"monthIndex":86,"previousCount":5,"count":6,"increase":1},{"monthIndex":98,"previousCount":6,"count":7,"increase":1},{"monthIndex":110,"previousCount":7,"count":8,"increase":1}]. A produced an actual autonomous AIplant in the first ten years. Fixed B/C/D comparisons were attempted without tuning; any incomplete strategy is marked with failure.

Vollständige Monate: 120/120. Tatsächliche Anlage beobachtet: true. Fehlende Diagnosefelder: aiPlantSiteAvailable, aiPlantBuildAllowed. B–D begonnen: true.

## Letzte tatsächlich gemessene Jahreswerte

| Strategie | Jahre | Monate | Menschen | KI | Autonome Anlagen | Kasse |
|---|---:|---:|---:|---:|---:|---:|
| A | 30 | 360 | 0 | 0 | 0 | -129 |
| B | 30 | 360 | 0 | 0 | 0 | -165 |
| C | 30 | 360 | 0 | 0 | 0 | -54 |
| D | 30 | 360 | 3289 | 1561 | 1 | 8952 |

Die letzten Werte sind Beobachtungen, keine Nachhaltigkeitszertifizierung. Null freie Menschen und null KI bedeuten nicht, dass gebundene Menschen oder kumulative Todesfälle null sind; die getrennten vollständigen CSV-Spalten sind maßgeblich. Negative Kassenstände werden nicht ersetzt oder beschönigt.

## Nicht ausgeführte Maßnahmen

- A: 0 abgelehnte Befehle.
- B: 0 abgelehnte Befehle.
- C: 0 abgelehnte Befehle.
- D: 42 abgelehnte Befehle; zuerst Jahr 5, Monat 4, ai.bulldoze-empty-plants.

Ein abgelehnter Abriss/Bau ist ein reales Ergebnis, kein Engine-Abbruch: Der 30-Jahres-Horizont läuft weiter. D versucht die sichere Leeranlagen-Bereinigung monatlich; bei unzureichenden Mitteln bzw. anderer Engine-Ablehnung bleibt die Anlage bestehen. Es gibt weder kostenlose Ersatzabrisse noch zusätzliche Geldmittel. Tatsächliche Vorher-/Nachherkasse und abgelehnte Koordinaten stehen in jedem Bereinigungsresultat.

Die Fünfjahres-CSV enthält getrennte Verwaltungs-/KI-gebundene Menschen, kumulative Todesfälle/Geburten, Arbeitslosigkeit, KI-Zufriedenheit, Streikmonate, Unruhe/Stufe, Sabotagebrände, Stromreserve, Kasse, Anlagenzahlen und Soll-Politik. JSON enthält vollständige monatliche/jährliche Berichte und jedes tatsächliche Kommando samt Ergebnis. Fehlende Werte bleiben unbekannt (leere CSV-Zellen / "?"), nicht null.

Zeitleiste: `podsForbiddenSinceMonth` zählt Engine-Monate einschließlich Warmup, nicht Amtsmonate. Die Messung hält die post-Warmup-Baseline und den tatsächlichen erfolgreichen Politikbefehl fest; B/C/D beschließen das Verbot vor Amtsjahr 1. `aiPodBreeding` ist ein Aktivierungslatch, keine Geburtenzahl. Ein Verbot sperrt tatsächliche autonome Bau-/Aufnahme-/Geburtsaktionen, lässt aber bestehende gebundene Menschen in den Anlagen und muss den Latch nicht löschen.

Die 12-Monats-Baubedingung nutzt die feste Mangelschwelle `aiReserveHigh=0,15`, nicht Ds Kohle-Schwelle 0,1. Autonomer Bau ist ohne Stadtkassenbelastung, auch bei Schulden; Arbeitslosen-Mangel verhindert den Bau einer leeren Anlage nicht. Die dokumentierten Polizeiziele sind Förderprozente, keine garantierte Durchsetzung: Maßgeblich ist tatsächlicher `policeEffect/1000` (1000 stoppt verbotene Aktionen vollständig, 0 gar nicht, dazwischen Engine-Zufall). Keine erfolgreiche Befolgung des Verbots wird aus dem Sollwert 100 % erfunden.

## Monatlicher Vorbedingungsnachweis A (exakt, keine angenommenen Ursachen)

shortageMonths und noUnemployedMonths sind die Engine-Zähler; ihre monatlichen Werte belegen oder widerlegen die 12-Monats-Bedingung. eligibleUnemployed ist exakt das Engine-Aufnahmebudget `max(0,floor(resPop*unemploymentRate))`, kein gemessener Personen-Identitätsbestand. siteAvailable/buildAllowed bleiben unbekannt, wenn kein autonomiespezifischer Versuchsnachweis existiert. Die zusätzlichen Rohwerte `podsPolicy`, `policeEffect`, `aiAutonomousPods`, `aiReserveHigh`, `aiPop` und `autoBuildFailureObserved` stehen im vollständigen monatlichen JSON. Der letzte allgemeine Baufehlercode kann auch vom Stadtbau stammen und wird nicht als KI-spezifischer Fehler ausgegeben; 0 bedeutet Erfolg oder keinen Versuch, 1 Finanzierung, 2 kein geeigneter Platz/Pfad. Es wurde kein zustandsändernder Probebau zur Diagnose ausgeführt.

| Jahr | Monat | Stromreserve | Mangelfolge-Monate | Monate ohne Arbeitslose | Geeignete Arbeitslose | Bauplatz | Erlaubt | Baufehlercode | Autonome Anlagen |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 0.47708332538604736 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 2 | 0.21687500178813934 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 3 | 0.2121250033378601 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 4 | 0.20737500488758087 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 5 | 0.20212499797344208 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 6 | 0.19987499713897705 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 7 | 0.19587500393390656 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 8 | 0.1913750022649765 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 9 | 0.18337500095367432 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 10 | 0.17812499403953552 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 11 | 0.1706250011920929 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 1 | 12 | 0.16562500596046448 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 1 | 0.15787500143051147 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 2 | 0.15262499451637268 | 0 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 3 | 0.1391250044107437 | 1 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 4 | 0.12737500667572021 | 2 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 5 | 0.11662500351667404 | 3 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 6 | 0.1081250011920929 | 4 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 7 | 0.10137499868869781 | 5 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 8 | 0.10062500089406967 | 6 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 9 | 0.10462500154972076 | 7 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 10 | 0.10212499648332596 | 8 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 11 | 0.09812500327825546 | 9 | 0 | 0 | ? | ? | ? | 0 |
| 2 | 12 | 0.09712500125169754 | 10 | 0 | 0 | ? | ? | ? | 0 |
| 3 | 1 | 0.09737499803304672 | 11 | 0 | 0 | ? | ? | ? | 0 |
| 3 | 2 | 0.09787499904632568 | 12 | 0 | 0 | ? | ? | ? | 1 |
| 3 | 3 | 0.09787499904632568 | 13 | 1 | 0 | ? | ? | ? | 1 |
| 3 | 4 | 0.08887500315904617 | 14 | 2 | 0 | ? | ? | ? | 1 |
| 3 | 5 | 0.09137500077486038 | 15 | 3 | 0 | ? | ? | ? | 1 |
| 3 | 6 | 0.08837500214576721 | 16 | 4 | 0 | ? | ? | ? | 1 |
| 3 | 7 | 0.09262499958276749 | 17 | 5 | 0 | ? | ? | ? | 1 |
| 3 | 8 | 0.09312500059604645 | 18 | 6 | 0 | ? | ? | ? | 1 |
| 3 | 9 | 0.09412500262260437 | 19 | 7 | 0 | ? | ? | ? | 1 |
| 3 | 10 | 0.09437499940395355 | 20 | 8 | 0 | ? | ? | ? | 1 |
| 3 | 11 | 0.08762499690055847 | 21 | 9 | 0 | ? | ? | ? | 1 |
| 3 | 12 | 0.08912499994039536 | 22 | 10 | 0 | ? | ? | ? | 1 |
| 4 | 1 | 0.08937499672174454 | 23 | 11 | 0 | ? | ? | ? | 1 |
| 4 | 2 | 0.09162499755620956 | 24 | 12 | 0 | ? | ? | ? | 2 |
| 4 | 3 | 0.09037499874830246 | 25 | 13 | 0 | ? | ? | ? | 2 |
| 4 | 4 | 0.09362500160932541 | 26 | 14 | 0 | ? | ? | ? | 2 |
| 4 | 5 | 0.09162499755620956 | 27 | 15 | 0 | ? | ? | ? | 2 |
| 4 | 6 | 0.08887500315904617 | 28 | 16 | 0 | ? | ? | ? | 2 |
| 4 | 7 | 0.09662500023841858 | 29 | 17 | 0 | ? | ? | ? | 2 |
| 4 | 8 | 0.09262499958276749 | 30 | 18 | 0 | ? | ? | ? | 2 |
| 4 | 9 | 0.0886249989271164 | 31 | 19 | 0 | ? | ? | ? | 2 |
| 4 | 10 | 0.09337499737739563 | 32 | 20 | 0 | ? | ? | ? | 2 |
| 4 | 11 | 0.08787500113248825 | 33 | 21 | 0 | ? | ? | ? | 2 |
| 4 | 12 | 0.09312500059604645 | 34 | 22 | 0 | ? | ? | ? | 2 |
| 5 | 1 | 0.05974999815225601 | 35 | 23 | 0 | ? | ? | ? | 2 |
| 5 | 2 | 0.0637499988079071 | 36 | 24 | 0 | ? | ? | ? | 3 |
| 5 | 3 | 0.0702499970793724 | 37 | 25 | 0 | ? | ? | ? | 3 |
| 5 | 4 | 0.07325000315904617 | 38 | 26 | 0 | ? | ? | ? | 3 |
| 5 | 5 | 0.07500000298023224 | 39 | 27 | 0 | ? | ? | ? | 3 |
| 5 | 6 | 0.07649999856948853 | 40 | 28 | 0 | ? | ? | ? | 3 |
| 5 | 7 | 0.07824999839067459 | 41 | 29 | 0 | ? | ? | ? | 3 |
| 5 | 8 | 0.08224999904632568 | 42 | 30 | 0 | ? | ? | ? | 3 |
| 5 | 9 | 0.08775000274181366 | 43 | 31 | 0 | ? | ? | ? | 3 |
| 5 | 10 | 0.0885000005364418 | 44 | 32 | 0 | ? | ? | ? | 3 |
| 5 | 11 | 0.08874999731779099 | 45 | 33 | 0 | ? | ? | ? | 3 |
| 5 | 12 | 0.08924999833106995 | 46 | 34 | 0 | ? | ? | ? | 3 |
| 6 | 1 | 0.06350000202655792 | 47 | 35 | 0 | ? | ? | ? | 3 |
| 6 | 2 | 0.06650000065565109 | 48 | 36 | 0 | ? | ? | ? | 4 |
| 6 | 3 | 0.0729999989271164 | 49 | 37 | 0 | ? | ? | ? | 4 |
| 6 | 4 | 0.07400000095367432 | 50 | 38 | 0 | ? | ? | ? | 4 |
| 6 | 5 | 0.08474999666213989 | 51 | 39 | 0 | ? | ? | ? | 4 |
| 6 | 6 | 0.08749999850988388 | 52 | 40 | 0 | ? | ? | ? | 4 |
| 6 | 7 | 0.08824999630451202 | 53 | 41 | 0 | ? | ? | ? | 4 |
| 6 | 8 | 0.09099999815225601 | 54 | 42 | 0 | ? | ? | ? | 4 |
| 6 | 9 | 0.09200000017881393 | 55 | 43 | 0 | ? | ? | ? | 4 |
| 6 | 10 | 0.08550000190734863 | 56 | 44 | 0 | ? | ? | ? | 4 |
| 6 | 11 | 0.09049999713897705 | 57 | 45 | 0 | ? | ? | ? | 4 |
| 6 | 12 | 0.0885000005364418 | 58 | 46 | 0 | ? | ? | ? | 4 |
| 7 | 1 | 0.06212500110268593 | 59 | 47 | 0 | ? | ? | ? | 4 |
| 7 | 2 | 0.0663750022649765 | 60 | 48 | 0 | ? | ? | ? | 5 |
| 7 | 3 | 0.07137499749660492 | 61 | 49 | 0 | ? | ? | ? | 5 |
| 7 | 4 | 0.07762499898672104 | 62 | 50 | 0 | ? | ? | ? | 5 |
| 7 | 5 | 0.0793749988079071 | 63 | 51 | 0 | ? | ? | ? | 5 |
| 7 | 6 | 0.08187499642372131 | 64 | 52 | 0 | ? | ? | ? | 5 |
| 7 | 7 | 0.08312500268220901 | 65 | 53 | 0 | ? | ? | ? | 5 |
| 7 | 8 | 0.08437500149011612 | 66 | 54 | 0 | ? | ? | ? | 5 |
| 7 | 9 | 0.0898749977350235 | 67 | 55 | 0 | ? | ? | ? | 5 |
| 7 | 10 | 0.09087499976158142 | 68 | 56 | 0 | ? | ? | ? | 5 |
| 7 | 11 | 0.08662500232458115 | 69 | 57 | 0 | ? | ? | ? | 5 |
| 7 | 12 | 0.08562500029802322 | 70 | 58 | 0 | ? | ? | ? | 5 |
| 8 | 1 | 0.08962500095367432 | 71 | 59 | 0 | ? | ? | ? | 5 |
| 8 | 2 | 0.09137500077486038 | 72 | 60 | 0 | ? | ? | ? | 6 |
| 8 | 3 | 0.08662500232458115 | 73 | 61 | 0 | ? | ? | ? | 6 |
| 8 | 4 | 0.08887500315904617 | 74 | 62 | 0 | ? | ? | ? | 6 |
| 8 | 5 | 0.0911249965429306 | 75 | 63 | 0 | ? | ? | ? | 6 |
| 8 | 6 | 0.08887500315904617 | 76 | 64 | 0 | ? | ? | ? | 6 |
| 8 | 7 | 0.08887500315904617 | 77 | 65 | 0 | ? | ? | ? | 6 |
| 8 | 8 | 0.09212499856948853 | 78 | 66 | 0 | ? | ? | ? | 6 |
| 8 | 9 | 0.08487500250339508 | 79 | 67 | 0 | ? | ? | ? | 6 |
| 8 | 10 | 0.08937499672174454 | 80 | 68 | 0 | ? | ? | ? | 6 |
| 8 | 11 | 0.09425000101327896 | 81 | 69 | 0 | ? | ? | ? | 6 |
| 8 | 12 | 0.08924999833106995 | 82 | 70 | 0 | ? | ? | ? | 6 |
| 9 | 1 | 0.09125000238418579 | 83 | 71 | 0 | ? | ? | ? | 6 |
| 9 | 2 | 0.0911249965429306 | 84 | 72 | 0 | ? | ? | ? | 7 |
| 9 | 3 | 0.09025000035762787 | 85 | 73 | 0 | ? | ? | ? | 7 |
| 9 | 4 | 0.09437499940395355 | 86 | 74 | 0 | ? | ? | ? | 7 |
| 9 | 5 | 0.08562500029802322 | 87 | 75 | 0 | ? | ? | ? | 7 |
| 9 | 6 | 0.09087499976158142 | 88 | 76 | 0 | ? | ? | ? | 7 |
| 9 | 7 | 0.09075000137090683 | 89 | 77 | 0 | ? | ? | ? | 7 |
| 9 | 8 | 0.09387499839067459 | 90 | 78 | 0 | ? | ? | ? | 7 |
| 9 | 9 | 0.08824999630451202 | 91 | 79 | 0 | ? | ? | ? | 7 |
| 9 | 10 | 0.09224999696016312 | 92 | 80 | 0 | ? | ? | ? | 7 |
| 9 | 11 | 0.08950000256299973 | 93 | 81 | 0 | ? | ? | ? | 7 |
| 9 | 12 | 0.09574999660253525 | 94 | 82 | 0 | ? | ? | ? | 7 |
| 10 | 1 | 0.09099999815225601 | 95 | 83 | 0 | ? | ? | ? | 7 |
| 10 | 2 | 0.09200000017881393 | 96 | 84 | 0 | ? | ? | ? | 8 |
| 10 | 3 | 0.08749999850988388 | 97 | 85 | 0 | ? | ? | ? | 8 |
| 10 | 4 | 0.0951249971985817 | 98 | 86 | 0 | ? | ? | ? | 8 |
| 10 | 5 | 0.0898749977350235 | 99 | 87 | 0 | ? | ? | ? | 8 |
| 10 | 6 | 0.09437499940395355 | 100 | 88 | 0 | ? | ? | ? | 8 |
| 10 | 7 | 0.09737499803304672 | 101 | 89 | 0 | ? | ? | ? | 8 |
| 10 | 8 | 0.09087499976158142 | 102 | 90 | 0 | ? | ? | ? | 8 |
| 10 | 9 | 0.09187500178813934 | 103 | 91 | 0 | ? | ? | ? | 8 |
| 10 | 10 | 0.08749999850988388 | 104 | 92 | 0 | ? | ? | ? | 8 |
| 10 | 11 | 0.09375 | 105 | 93 | 0 | ? | ? | ? | 8 |
| 10 | 12 | 0.08799999952316284 | 106 | 94 | 0 | ? | ? | ? | 8 |

## Reproduktion

`node --import tsx scripts\measure-v4-fraktion.ts` aus dem Repository mit fertiger v4-Engine. Ergebnisse: `v4-fraktion-stromkrise.json`, `-annual.csv`, `-monthly.csv`, `-5year.csv`. `--d-only` erhält vorhandene vollständige A/B/C-Daten unverändert und misst ausschließlich D auf derselben Engine erneut. Engine- und Parameter-SHA256 stehen im JSON. Ein fehlgeschlagener Vorlauf liefert Exitcode 1, stoppt B–D und wird nicht durch geänderte Gewichte oder Kontrollen ersetzt.
