# Product outcomes and metric contracts

Read for a feature's success criteria, a product metrics review, or evidence-backed
prioritization. Identify the user problem, observable outcome, current evidence,
non-goals, constraints, and rollback/guardrail conditions. Do not invent a roadmap,
business target, or product policy merely to fill a template.

For each success metric specify population, event, numerator/denominator, units,
window/timezone, cohort, exclusion rules, data source, freshness, baseline, and
owner when known. Mark absent baselines/targets as unknown. Define active users,
activation, funnel conversion, and retention explicitly before comparing values.

Distinguish leading indicators, outcome measures, and guardrails. A count of
shipped features or closed tickets is an output, not proof of user value. Prefer
a small metric set relevant to the decision over a mandatory dashboard hierarchy.

Compare like windows and cohorts; account for seasonality, outages, instrumentation
changes, and segment mix. A change after launch is descriptive until an experiment
or defensible causal design supports attribution. For analysis QA use validate-data.
Define experiment acceptance and guardrails in the feature specification;
instrumentation belongs to observability-and-instrumentation with existing
telemetry conventions.

Output a compact scorecard when values exist: metric, current, comparison, absolute
and relative change where defined, target if established, source, limitations.
Turn findings into testable acceptance criteria or a bounded investigation.
Draft recommendations without automatically creating tasks, sending stakeholder
updates, adding analytics, or scheduling external reporting.

Adapted and modified for this Codex harness from anthropics/knowledge-work-plugins@67e216dbe5621470581dd3d944df22d1cc8231ce (Apache-2.0), 2026-09-20. Source: `product-management/skills/metrics-review/SKILL.md`.

License copies and provenance: [integration record]($CLAUDE_CONFIG_DIR/docs/third-party/knowledge-work-plugins/README.md).
