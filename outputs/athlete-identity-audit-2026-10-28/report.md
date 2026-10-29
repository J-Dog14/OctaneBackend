# Athlete identity audit — October 28, 2026

The audit read all 794 warehouse athlete profiles and all 1,112 Trackman player records in a consistent, read-only database snapshot. There are 243 profiles whose origin is Trackman and 478 profiles linked to Trackman through player records, source mappings, or source links. No records were merged or changed during this audit. Calvin's previously approved consolidation remains applied.

## How Calvin's duplicate happened

The original hitting XML at `D:/Hitting/Data/Calvin, Madenspacher/Baseball Hitting Sports/session.xml` contains `<Name>Calvin, Madenspacher</Name>`, ID `CM`, and DOB `05/27/2011`. The shared name cleaner interprets a comma as the usual “Last, First” format, so it generated `MADENSPACHER CALVIN`. His Trackman profile is `CALVIN MADENSPACHER`.

The ordered similarity between these strings is **63.2%**. This missed both the automatic matcher (90%) and the hitting post-import check (80%). The database has a unique index on `normalized_name`, which stops identical normalized strings but permits these two different strings. His email was on the original Trackman profile; the new hitting profile had no email.

The original Trackman profile was created October 14, 2026. The duplicate hitting profile was created October 28, 2026 at 12:10 p.m. America/New_York. Thus this duplicate was created by the later hitting intake, rather than by the Trackman bulk import itself.

The investigation also found an independent failure path: hitting and pitching could generate a local UUID when shared identity resolution failed or was unavailable. That did not explain Calvin's successful warehouse creation, but it bypassed the resolver and could cause invalid foreign-key writes. Those warehouse fallbacks now stop the import with an explicit error.

## Remaining candidates

Four pairs have the same reordered-name pattern:

| Names | Evidence | Trackman linked? |
| --- | --- | --- |
| Will Connolly / Connolly Will | Same DOB; identical name tokens in reverse order | Yes |
| Gabe Martinez / Martinez Gabe | Same DOB; identical name tokens in reverse order | No |
| Lucas Gensler / Gensler Lucas | Identical name tokens; one profile has no DOB | Yes |
| Levi Mills / Mills Levi | Identical name tokens; one profile has no DOB | Yes |

The first two are strong duplicate candidates. The other two require DOB or source verification before consolidation. All four pairs' profiles already existed before Calvin's Trackman profile was created on October 14; they are not newly created Trackman-origin pairs.

The broader search produced **26 candidate pairs involving 45 profiles**, including these four pairs. **17 pairs involve a Trackman-linked profile**. The search checks normalized names, reordered name tokens, shared emails and app UUIDs, fuzzy names, and similar names with a shared DOB. A candidate is not a confirmed duplicate. Shared birthdays and surnames can belong to siblings or twins.

Only **two candidate pairs involve a Trackman-origin profile**: Liam Bailey / Levi Bailey and Mac Corney / Eli Corney. Both pairs have different first names, different Trackman player IDs, and the same DOB within the pair. They require human confirmation; this audit does not establish that either pair is duplicated.

All pair details, UUIDs, birth-date evidence, origins, and creation timestamps are in [candidates.csv](candidates.csv). No additional profiles were consolidated based on name similarity or a shared birthday.

## Trackman link integrity

- **0** conflicting ID owners across Trackman player records, source mappings, source links, portal pitch rows, and TMBB/AMA aliases.
- **0** links pointing to missing athlete profiles.
- **13** linked players have a non-placeholder DOB that differs from the warehouse profile. **All 13 links have status `manual`.** These are existing manual decisions or date-entry discrepancies, not evidence of duplicate profiles by themselves. They were preserved for review in [trackman-link-audit.json](trackman-link-audit.json).
- Trackman statuses: 233 `created`, 202 `matched_exact`, 51 `manual`, 2 `linked`, 2 `matched_fuzzy`, 2 `conflict`, and 620 `unmatched`. Unmatched player records include roster-only players who do not create warehouse athletes; they should not be counted as duplicate profiles.

## Changes and validation

- A unique reversed two-part name with the same DOB resolves to the existing profile (the Calvin fix from the previous task).
- Unresolved reordered names are now held before insertion, including when a DOB is missing or conflicts; the error lists the existing candidate UUIDs.
- Post-import duplicate review considers word order, so Calvin's original example reaches review even at a 90% threshold. Ordered automatic fuzzy matching remains separate from this broader review score.
- Trackman near-miss review also detects reordered names without a DOB, holding them before creating a new identity.
- Hitting and pitching warehouse imports stop when identity resolution fails or the shared manager is unavailable; they do not substitute a generated UUID.
- Added a repeatable, read-only audit command: `uais/venv/Scripts/python.exe uais/python/scripts/audit_athlete_identity.py`.

Validation: 26 Python regression tests passed (12 identity/audit tests and 14 athletic screen/email tests). R tests exercised the actual resolution branch in both importers: failed resolution stops, successful resolution preserves the canonical UUID, and an unavailable manager stops warehouse ingestion. Both R files parsed successfully. Full live ingestion was not rerun because that would write assessment data.

Machine-readable counts: [summary.json](summary.json). The private local snapshot used for the audit is `snapshot.json` in this directory. It contains personal athlete data and is not a public report.
