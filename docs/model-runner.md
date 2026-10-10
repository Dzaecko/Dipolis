# Headless city model runner

Token sums carry `tokenUsageComplete=false` when older resumed records or a provider
omitted usage. Missing historical token counts cannot be reconstructed; reported
sums in that case cover only observed usage, not the whole cost of the run.

The runner loads Haight using the strategy-space setup: profile koexistenz,
seed 42, disasters disabled, speed 3, tax 7, imports on and power priority 0.
After 12,000 warm-up ticks it sets treasury to 60,000 and marks the population
baseline. It runs 30 years with a report, model decisions, then 12-month advance.
It does not rebuild the engine or change profile files.

## Cost-free verification

From the repository root:

```powershell
corepack pnpm --filter micropolis run city-model --adapter fake --assignment N --run 1
```

The fake adapter requests S266's actions through the same nine tool definitions
and runner loop. It does not read endpoints or credentials and makes no network
requests. Every aggregate (including actual farm/plant counts) must equal the
stored S266 CSV row exactly before a completed metrics row is written.

## Starting a real run (not executed during implementation)

Set these environment variables **locally**, not in a tracked configuration file:

| Variable | Meaning |
| --- | --- |
| CITY_MODEL_ENDPOINT | Full chat-completions endpoint; HTTPS, or HTTP on loopback for a local server |
| CITY_MODEL_NAME | Provider model/deployment name |
| CITY_MODEL_KEY | Authentication key, passed as a Bearer header; do not paste it into chat |
| CITY_MODEL_TIMEOUT_MS | Optional per-request timeout; default 60000, range 1–300000 |
| CITY_MODEL_MAX_TOKENS | Optional completion-token limit; range 1–1000000, otherwise omitted |
| CITY_MODEL_MAX_RETRIES | Additional attempts after a retryable failure; default 5, range 0–5 |

Then select the real adapter explicitly:

```powershell
corepack pnpm --filter micropolis run city-model --adapter openai --assignment N --run 1
corepack pnpm --filter micropolis run city-model --adapter openai --assignment R --run 1
```

These commands incur provider charges. They are examples, not an automatic batch.
There are no endpoint/model/key defaults. The endpoint is not inferred or amended;
providers must support the OpenAI-compatible chat/tool protocol. Another provider
can implement the small `ChatAdapter` interface and be selected by the CLI.

`N` has exactly the shared system paragraph. `R` adds only the ownership/revenue
paragraph. No extra strategy advice or optimizing objective is inserted. The nine
tool definitions use factual descriptions and costs. Provider-compatible function
names are reversibly mapped from exact BusIDs; returned calls are validated against
the nine-command allowlist before dispatch. The model cannot load cities, set cash,
mark baselines or advance years itself. The headless runner authorizes these nine
commands using the bus's script source; no browser approvals are required.

### Retries and failure diagnostics

The OpenAI-compatible adapter retries HTTP 429, HTTP 500–599 and request timeouts.
By default there are five retries (six attempts in total), with exponential waits
of 1, 2, 4, 8 and 16 seconds. A valid `Retry-After` value (seconds or HTTP date)
can increase the wait; the resulting wait is capped at 60 seconds. Other HTTP
statuses, network failures, invalid responses and cancellation are not retried.
Retries resend the same request, not city commands.

`adapter-error` events preserve `kind`, HTTP `status` when known, sanitized
`responseText`, attempt count and request-body bytes. URLs, credentials and
credential-like fragments are redacted; response text is bounded to 4,000
characters. Raw provider errors, headers and authentication details are not logged.

### Starting or resuming assignment N in VS Code

Select **Stadtmodell: Auftrag N live starten** for a new run, or
**Stadtmodell: Auftrag N fortsetzen** for an interrupted run. Both use
[the local launcher](../scripts/start-city-model.ps1); the latter passes `--resume`.
The launcher prompts locally for connection details, model and run number, reads
the key with concealed input, and restores the prior environment afterward.
For resume, enter the same model and run number as the interrupted assignment N.
Neither task is started automatically; both explicitly select the paid adapter.

## Annual loop and history

The model receives the current report and compact records for every earlier year:
`history` is an array of strings, each containing one JSON line with `year`,
post-advance `metrics` and successful `commands` (name, arguments and built count
when present). There are no reasons, repeated pre-action reports or full tool results
in this historical context. Invalid/rejected calls are not copied into future history.
Within a year, tool results are returned to the adapter for its next response.
The model finishes by returning no tool calls. At twelve attempted tool calls
(invalid calls also count), the runner stops and advances one year. Excess calls
in the last batch receive rejected results in the local log, not execution.
No thirteenth tool is executed or extra paid completion requested after cutoff;
the final results are available in the next year's history.

The provider's sampling defaults are left unchanged. Real model outcomes are not
promised deterministic, despite the fixed city seed. Reasons are requested by the
system prompt. The runner joins nonempty response text into one annual `reason`,
bounded to 2,000 characters, rather than logging it again for each tool. With `--live`,
this reason is printed once when the year completes.

## Service funding and report units

The model's `budget.set-funding` arguments are `roadFundingPercent`,
`policeFundingPercent` and `fireFundingPercent`. Each independently accepts 0–100
percent of that service's annual need; they are **not shares of a common pot** and
need not sum to 100. Initial funding is 100/100/100. The trusted command bus retains
its internal `road`/`police`/`fire` arguments; the runner maps validated model fields
and also accepts the old field names when replaying historical logs.

The current report includes:

- `roadFundingPercent`, `policeFundingPercent`, `fireFundingPercent`: current engine
  percentages, which can fall below requested settings when funds run out.
- `roadFund`, `policeFund`, `fireFund`: annual funding needs in money units, not
  percentages or actual expenditure.
- `roadEffect` (0–32), `policeEffect` and `fireEffect` (0–1000): effective service
  strengths, not percentages.
- `crimeAverage`: crime index, 0–255.
- `roadTotal`: weighted road census, affected by bridges and heavy traffic.
- `roadTileCount`: true physical road-tile count from the current map, not a
  weighted census or road length.

Changing a funding setting costs nothing immediately; the resulting annual
spending and deterioration are not cost-free. See the
[road-funding audit](results/model-runs/road-funding-audit.md).

## Protocol and metrics

Default output directory: [results/model-runs](results/model-runs/README.md).
Use `--output` to select a different directory. Each run writes a separate JSONL
named by adapter, assignment and run number. Without `--resume`, an existing
filename is refused; use a new `--run` number for another run. Do not launch
concurrent writers to the same output directory.

`--resume` reads and appends to the existing interrupted protocol. Assignment,
model and run must match the logged identity; completed years must be consecutive
from year 1. A log with all 30 years completed cannot be resumed. The city is
initialized again with the same setup, then recorded successful commands and annual
advances are replayed locally. Tool outcome data and all recorded post-year report
fields must match. Completed years make **no model requests** and are not logged
again. Journaled tools in the unfinished year are also reproduced; the next model
request receives `alreadyExecuted` feedback and those attempts count against the
same twelve-call limit. Unlogged actions cannot be recovered from the journal.

- `decision` records are flushed immediately after each tool outcome: year, report,
  exact tool call and result, without repeated reason text. Already journaled actions
  survive later errors and can be reproduced on resume.
- `year-completed` records contain the pre-action report, all decisions, termination
  (`done`/`call-limit`), post-advance report and one annual `reason`. Nested decisions
  contain tool calls/results, not repeated reasons. There are 30 for a completed run.
- `model-request` records report UTF-8 JSON request-body `requestBytes` and attempt
  count; retries emit request metadata for each attempt.
- `model-response` records contain `inputTokens`, `outputTokens`, `usageReported`
  and request-body `requestBytes`. Tokens come from provider usage; absent usage
  yields zero counters with `usageReported: false`, not proof of zero billed usage.
- `adapter-error` records carry sanitized diagnostics; a terminal run failure also
  appends a `status: failed` marker. Neither is a completed annual result.
- `runs.csv` appends one completed row with assignment, model and run number plus
  all strategy-space metrics: meanResPop, minResPop, finalResPop, meanAiPop,
  finalFunds, insolventYears, lostToHunger, lostToPower, finalAiZones, builtPlants,
  builtFarms and firstInsolvencyYear, followed by `inputTokens` and `outputTokens`.
  Token sums include previous `model-response` events when resuming. Legacy CSV
  rows gain blank token columns, not invented historical counts; legacy responses
  without usage cannot contribute known tokens to a resumed total. Annual means
  exclude warm-up. Incomplete runs retain their audit log but get no completed CSV row.

Model name is intentionally recorded for comparison. Endpoint, authentication key,
request headers and raw provider errors are never written by the runner. Provider
errors are sanitized. Do not include secrets in model instructions or messages.

## Verification

Run `corepack pnpm --filter micropolis exec vitest run cli/model` for fake-S266
CLI acceptance, strict tool schemas, annual limits and mocked HTTP adapter tests.
There are no real-model calls in those tests. The default CLI adapter is fake;
environment variables alone cannot enable network access.