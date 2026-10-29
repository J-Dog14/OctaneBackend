# Athlete identity safeguards

Use `common.athlete_manager.get_or_create_athlete` for normal Python intake and its R wrapper for hitting/pitching. Name spelling is evidence, not a universal identifier. QTM files sometimes put `First, Last` into a field whose standard interpretation is `Last, First`.

The shared manager resolves a unique reversed two-part name when the DOB also matches. If a reordered name remains unresolved, creation is stopped with `IDENTITY_REVIEW` and the candidate UUIDs. Verify the source DOB/name or resolve the athlete explicitly. Never generate a replacement UUID in response to an identity-resolution error.

Automatic fuzzy matching uses ordered similarity. Duplicate review and Trackman near-miss review additionally consider token order. A high review score flags a candidate; it does not authorize an automatic merge. Same-DOB siblings, twins, shared contact emails, and conflicting birth dates require care.

The database's unique `normalized_name` index prevents identical names, not every possible representation of the same person. Source IDs are scoped to their source system; QTM initials are not globally unique and must not be equated to Trackman player IDs.

Run the warehouse-wide audit independently of ingestion:

```
uais/venv/Scripts/python.exe uais/python/scripts/audit_athlete_identity.py
```

It uses a read-only, repeatable-read transaction and writes a dated local snapshot, candidate CSV, counts, and Trackman link-integrity findings under `outputs/`. It compares all profiles and checks linked Trackman player IDs, portal pitches, source mappings, source links, aliases, orphaned identities, and DOB differences. It never writes to the database. Local snapshots contain personal data.

Regression checks:

```
uais/venv/Scripts/python.exe -m unittest discover -s uais/python/common/tests -v
uais/venv/Scripts/python.exe -m unittest discover -s uais/python/athleticScreen/tests -v
Rscript uais/R/common/tests/test_identity_failure.R
```
