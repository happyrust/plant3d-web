# Compare models by delivery-unit sesno

Model viewing comparison uses two versions of the same minimum delivery unit, identified by `(dbnum, unit_refno, sesno)`, rather than release records or `model_version_id`. This matches the immutable DuckLake model index consumed by plant3d-web, keeps NoOp commits visible while reusing their earlier assets, and makes A/B comparison independent of a separate release workflow.
