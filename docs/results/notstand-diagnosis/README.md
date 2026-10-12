# Diagnose des bisherigen Notstand-Laufs

Dieser Bericht untersucht den bereits gescheiterten Lauf „rettet“, Stufe 3, vor der überarbeiteten Kalibrierung.
Er ist keine erfolgreiche Abnahme. Die v3-Leistung pro Mensch wurde nicht verändert.

- Zusammenbruch: Laufmonat 244, Jahr 21.
- Ereignis endet: Laufmonat 168.
- Nächste höhere Stromkapazität: Laufmonat 169.
- Erste vollständige Erschöpfung der belegten Kohorte: Laufmonat 197.
- Monate mit Unruhe-Stufe ≥2 trotz null freien und null gebundenen Menschen: 42.

## Befund

Die Strategie nahm einmalig Menschen auf und beendete danach weitere Einweisungen. Die v3-Kohorte altert;
ihre Leistung sinkt schon vor den Todesfällen. Die ursprüngliche Lebensdauer beträgt 120 Monate, nicht 20 Jahre.
Nahrungsmangel beschleunigt das Altern zusätzlich. Erschöpfung ohne Nachbelegung oder Zucht ist daher ein
physikalischer Befund, kein Fehler der Pod-Leistung. Die überarbeitete Rettungsstrategie darf nach Bedarf nachbelegen.

Das Brennstoffembargo wird tatsächlich aufgehoben. Die Kapazitätsmessung der letzten Stromabfrage kann
am Umschaltmonat noch den vorherigen Zustand zeigen; der folgende Monat bestätigt die wiederhergestellte Leistung.
Ein dauerhafter Fehler der Brennstoff-Wiederherstellung ist in diesem Verlauf nicht nachgewiesen.

Die Arbeitslosenquote ist in großen Teilen des Abstiegs null, nicht durch eine Division bei wenigen Menschen
aufgebläht. Unruhe und Aufstände bleiben dagegen lange hoch. Der historische Bevölkerungsrückgang ist
ein bestehender Bestandteil der v2/v3-Regeln. Leere Wohnzentren dürfen jedoch keine lebenden Demonstrierenden
ersetzen: Sabotage bei null freien Menschen ist gesondert als mechanischer Fehler zu behandeln.
Diese Korrektur darf weder Pod-Leistung erhöhen noch gewöhnliche Läufe oder Stufe 0 ändern.

| Laufmonat | Jahr/Monat | Menschen | KI | In Pods | Pod-Tote gesamt | Pod-Strom | Stromkapazität | Unruhe | Arbeitslosigkeit | Nahrung | Kasse |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 96 | 8/12 | 3731 | 2040 | 714 | 0 | 1271.7 | 13483 | 45.2 | 0.0 % | 100.0 % | 11189 |
| 108 | 9/12 | 2210 | 16 | 714 | 0 | 1131.7 | 1143 | 64.1 | 0.0 % | 100.0 % | 10625 |
| 120 | 10/12 | 1513 | 0 | 714 | 0 | 991.7 | 991 | 94.3 | 0.0 % | 100.0 % | 9361 |
| 168 | 14/12 | 425 | 0 | 714 | 0 | 431.7 | 443 | 100.0 | 0.0 % | 100.0 % | 1773 |
| 169 | 15/1 | 426 | 0 | 714 | 0 | 420.0 | 7931 | 100.0 | 0.0 % | 100.0 % | 1773 |
| 180 | 15/12 | 864 | 17 | 714 | 0 | 268.5 | 7068 | 100.0 | 6.1 % | 62.3 % | 126 |
| 192 | 16/12 | 1034 | 20 | 714 | 0 | 80.8 | 6195 | 100.0 | 0.0 % | 74.6 % | 0 |
| 204 | 17/12 | 580 | 4 | 0 | 714 | 0.0 | 5400 | 100.0 | 0.0 % | 100.0 % | 0 |
| 228 | 19/12 | 31 | 0 | 0 | 714 | 0.0 | 5400 | 100.0 | 0.0 % | 100.0 % | 0 |
| 240 | 20/12 | 1 | 0 | 0 | 714 | 0.0 | 4700 | 100.0 | 0.0 % | 100.0 % | 0 |
| 252 | 21/12 | 0 | 0 | 0 | 714 | 0.0 | 2000 | 100.0 | 0.0 % | 100.0 % | 0 |
| 264 | 22/12 | 0 | 0 | 0 | 714 | 0.0 | 0 | 100.0 | 0.0 % | 100.0 % | 0 |

## Vollständiger Monatsverlauf

[monthly.csv](monthly.csv) enthält alle 360 Monate einschließlich monatlicher Einweisungen,
Pod-Todesfälle und Hungerverluste sowie kumulierter Zähler, Bewohner, Strom, Unruhe, Arbeitslosigkeit
und Nahrung. `sabotageFiresAnnualReport` ist der jeweils zuletzt veröffentlichte Jahreswert, kein Monatszähler.
Kapazität und Pod-Strom werden aus den originalen Berichtsfeldern übernommen; es wird keine
scheinbar exakte konventionelle Leistung durch Subtraktion unterschiedlich getakteter Messwerte erfunden.

Quell-Datensatz SHA-256: `87e78fbc4e00ca00ca1ff9c4d7b0008828f049b16e085f73e07308e8578793ef`.
