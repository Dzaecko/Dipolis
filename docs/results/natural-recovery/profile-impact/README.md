# Historical v2/v3 A-D unrest impact

Before engine: sha256:74de46aa291ffc7154ab0dd06eda4fb761b10da26eb6c5bd4633d057e37a82ce
After engine: sha256:5794ef60a01ffda0eba1e6f724b8f687615777052a1deb7679229ca9bb8fcfb8

Deterministic offline runs: Haight, seed42, 30 years, disasters off. The exact historical policies are retained; these are not natural-city or model-driven runs. No historical measurement files were overwritten.

V2 A=.9 automation/welfare0/police100; B=.9/welfare1/police100; C=.9/welfare0/police40; D=.3/welfare1/police100. V3 A=no pods; B=one unemployed-intake plant; C=one resident-intake plant; D=AI throttle.5. Full common controls and actual command outcomes are in the phase JSON files.

Mean unrest is the arithmetic mean of 360 monthly snapshots. Fires are initiating sabotage/uprising events summed once per completed annual counter, not burning tiles. annualFiresReportedWithZeroHumans counts annual fires reported at a zero-human endpoint; it does not identify the exact ignition-time population and may include earlier fires in that annual period. Power and hunger loss counters are cumulative: totals are final minus initial counter, never sums of annual cumulative snapshots. Population and treasury are actual year30 endpoints. Full monthly and command evidence is retained privately; public phase JSON contains compact annual summaries.

| Profile | Policy | Humans before -> after | Funds before -> after | Mean unrest before -> after | Fires before -> after | Power losses before -> after |
|---|---|---:|---:|---:|---:|---:|
| v2-unruhe | A | 2487 -> 2487 | 56978 -> 56978 | 59.033 -> 59.042 | 37 -> 37 | 0 -> 0 |
| v2-unruhe | B | 3870 -> 3870 | 40327 -> 40327 | 35.139 -> 35.142 | 0 -> 0 | 0 -> 0 |
| v2-unruhe | C | 3149 -> 3149 | 85390 -> 85390 | 68.788 -> 68.795 | 35 -> 35 | 0 -> 0 |
| v2-unruhe | D | 3870 -> 3870 | 50590 -> 50590 | 19.844 -> 19.847 | 0 -> 0 | 0 -> 0 |
| v3-pods | A | 0 -> 0 | 0 -> 0 | 76.253 -> 35.133 | 233 -> 171 | 1728 -> 1183 |
| v3-pods | B | 0 -> 0 | 0 -> 0 | 76.909 -> 32.865 | 224 -> 164 | 1163 -> 1422 |
| v3-pods | C | 0 -> 0 | 0 -> 0 | 78.959 -> 46.980 | 175 -> 232 | 893 -> 1406 |
| v3-pods | D | 0 -> 0 | 0 -> 0 | 75.528 -> 32.242 | 195 -> 156 | 571 -> 1078 |

This comparison measures the combined authorized reference-population and inhabited-zone actor changes. It does not attribute effects separately or establish classic/koexistenz parity.

Data: [comparison CSV](comparison.csv), [comparison JSON](comparison.json), [before evidence](before.json), [after evidence](after.json).

## Measured outcomes

V2 final human/AI populations, treasury and fire counts remain identical for all four policies; mean unrest changes by less than0.01. All four v3 policies still finish with zero human/AI population and zero funds. Mean monthly unrest is lower, but fires are not uniformly reduced: C rises from175 to232. Lower mean unrest does not establish recovery or universally lower damage.

Annual fires reported at a zero-human endpoint: v3 C changes from12 to0; all other cases are0 before and after. Exact ignition-time population is not available, so this cannot isolate the actor fix or prove all ghost fires disappeared.
