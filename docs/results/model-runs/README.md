# City model run outputs

The headless runner writes a separate JSONL audit file per adapter/assignment/run,
plus one completed metrics row per run in [runs.csv](runs.csv). See
[runner instructions](../../model-runner.md) for retries, resume, report units and
token accounting.

[fake-N-1.jsonl](fake-N-1.jsonl) records the completed fake S266 verification.
[openai-N-1.jsonl](openai-N-1.jsonl) is an interrupted historical assignment N run:
17 years completed, followed by a failure in year 18, with no journaled partial
year-18 tools. It has no completed CSV row. Its old failure marker contains no
original HTTP status or response text, so the provider failure cannot be diagnosed
from that marker alone.

Current runs add request/response usage events and sanitized adapter errors, save
one reason per completed year, and send compact reason-free historical JSON lines.
Legacy logs remain historical evidence, not examples of every current field.
Completed CSV rows now include summed `inputTokens` and `outputTokens`; existing
legacy rows are migrated with blank token cells when a new completed row is written.

The **Stadtmodell: Auftrag N fortsetzen** VS Code task resumes the same logged
model/run locally before making further paid requests. Completed years skip the
model; any journaled partial-year tools are replayed with `alreadyExecuted` feedback.

The [road-funding audit](road-funding-audit.md) documents offline replay, physical
versus weighted road counts, the historical request-size reconstruction and the
limits of the fixed-policy comparisons. No additional real-model calls were made
for that audit or this documentation update. No credentials are included here.