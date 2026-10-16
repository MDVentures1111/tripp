# D04 production audit release gate

Production document changes remain disabled. Preserve working Deal Intelligence.

## Required evidence

1. Inventory production schema metadata using a read-only database role and a manually approved workflow.
2. Compare tables, constraints, indexes, RLS policies, grants, triggers, storage policies, and migration ledger with the D04 migration preflight.
3. Do not expose credentials or customer rows in CI output.
4. Do not deploy document Edge Functions or run migrations before staging verification and explicit production approval.
5. Document the discrepancy report, test evidence, rollback rehearsal, and GO/NO-GO decision in Issue #1.

The production database currently contains a manually provisioned baseline; migration replay without reconciliation is prohibited.
