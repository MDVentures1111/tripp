#!/usr/bin/env python3
"""Fail-closed static check for production-shaped D04 migration ordering.
No network, credentials, or database connections.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[2]
migrations=sorted(root.joinpath("supabase/migrations").glob("*.sql"))
versions={p.name.split("_",1)[0]:p.name for p in migrations}
expected=("20261010000000","20261011000000","20261012000000")
ai="20261016010702"
assert all(re.fullmatch(r"\d{14}",v) for v in versions), "invalid migration version"
assert len(migrations)==len(versions), "duplicate migration version"
assert all(v in versions for v in expected), "missing baseline migration file"
assert "20261016000000" in versions and "20261017000000" in versions, "D04 boundaries missing"
assert "20261016000000" < ai < "20261017000000", "AI migration interleaving changed"
assert ai not in versions, "AI migration appears on D04 branch: check for conflicting ledger history"
print("PASS: D04 migration files unique; baseline present; AI quota migration is an external, interleaved production-ledger entry")
print("BLOCKED: This static check is not a production-shaped database rehearsal and does not authorize ledger repair.")
