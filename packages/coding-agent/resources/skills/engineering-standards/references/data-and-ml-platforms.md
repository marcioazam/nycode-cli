# Data and ML platforms

Define source ownership, freshness, schema expectations, lineage, privacy classification, and failure handling before building ingestion. Make pipelines idempotent, observable, restartable, and explicit about late or duplicate data. Prefer incremental processing and reversible backfills.

For ML platforms, version data, features, code, model artifacts, evaluation criteria, and deployment configuration. Separate offline evaluation from online monitoring; track drift and rollback signals. Never claim model quality without a pinned, reproducible evaluation.

Current specifics:

- Pipelines: define source and target grain, stable keys, event versus processing time and schema evolution before implementation. Bound batches, retries and quarantine storage, and make rejected records and partial completion observable. Retries alone never make a pipeline exactly-once; state the backfill and checkpoint semantics. Test replay, duplicate delivery, interruption and resume, and poison records with supplied fixtures. For analytical claims, check grain, join multiplicity, nulls, denominators, cohort maturity and time windows (`validate-data`).
- ML: define the prediction decision, baseline, error costs and acceptance slices before adding model complexity. Split by time and entity where leakage is possible and verify point-in-time feature and label joins. Check training-serving preprocessing parity, schema drift, missing features and fallback behavior. Make promotion criteria and model rollback reviewable; offline metrics do not establish online benefit. Bound experiment compute and record actual versus unknown consumption; never start training, publish artifacts or promote models outside the assigned scope.
