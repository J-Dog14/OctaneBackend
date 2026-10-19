"""Clean a TrackMan game CSV (a team's in-season export) before uploading it on
Dashboard -> Pitch Intel -> Upload, which does the linking, preview and saving.

    python uais/python/trackman/prepare_trackman_game_csv.py "Chasse Season.csv" --pitcher-id 805989 --pitcher "Chasse, Ryan" --types auto

Writes "<file>_clean.csv" next to the input and prints what it changed. It never
changes a measurement; it only fixes what keeps the uploader from reading the
file the way it should:

* Line endings: Excel-saved files with \\r\\r\\n read as a blank row after every pitch.
* Pitcher name / ID: typos ("Chaase"), stray non-breaking spaces and blank
  PitcherId split one pitcher into several. --pitcher / --pitcher-id set them on
  every row (single-pitcher files only).
* PitchNo: missing from these exports, and Time is often Excel-mangled to mm:ss
  (hour dropped), so pitches couldn't be ordered. PitchNo = order within each
  date, after checking the file is in inning / PA / pitch order.
* Pitch type (--types): "tagged" keeps the operator's TaggedPitchType (falls back
  to AutoPitchType when Undefined, the uploader's default); "auto" uses TrackMan's
  AutoPitchType for every pitch. The operator's tag is always kept in a new
  OperatorTaggedPitchType column (saved in each pitch's raw JSON).
"""
from __future__ import annotations

import argparse
import collections
import csv
import io
import sys
from pathlib import Path

AUTO_TO_TAG = {"four-seam": "Fastball", "sinker": "Sinker", "cutter": "Cutter", "slider": "Slider",
               "sweeper": "Sweeper", "curveball": "Curveball", "splitter": "Splitter", "changeup": "ChangeUp"}


def clean_name(s: str) -> str:
    return " ".join(s.replace("\xa0", " ").split())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--pitcher", help='name to set on every row, "Last, First"')
    ap.add_argument("--pitcher-id", help="PitcherId to set on every row")
    ap.add_argument("--types", choices=("tagged", "auto"), default="tagged")
    args = ap.parse_args()

    src = Path(args.file)
    text = src.read_bytes().decode("utf-8-sig").replace("\r\r\n", "\n").replace("\r\n", "\n").replace("\r", "\n")
    rows = [r for r in csv.DictReader(io.StringIO(text)) if any((v or "").strip() for v in r.values())]
    if not rows:
        print("No rows found.")
        return 1
    headers = list(rows[0].keys())
    changes = collections.Counter()

    names = collections.Counter(clean_name(r.get("Pitcher", "")) for r in rows)
    ids = collections.Counter((r.get("PitcherId") or "").strip() for r in rows)
    print(f"{len(rows)} pitches, {len({r['Date'] for r in rows})} dates")
    print(f"Pitcher names in file: {dict(names)}")
    print(f"PitcherIds in file:    {dict(ids)}")
    if (args.pitcher or args.pitcher_id) and len(names) > 3:
        print("This looks like a multi-pitcher file; --pitcher/--pitcher-id only make sense for one pitcher.")
        return 1

    if "PitchNo" not in headers:
        headers.insert(0, "PitchNo")
    if "OperatorTaggedPitchType" not in headers:
        headers.insert(headers.index("TaggedPitchType") + 1, "OperatorTaggedPitchType")

    per_date = collections.Counter()
    last_key: dict[str, tuple] = {}
    for r in rows:
        if args.pitcher and r.get("Pitcher") != args.pitcher:
            r["Pitcher"] = args.pitcher
            changes["Pitcher set"] += 1
        elif r.get("Pitcher") != clean_name(r.get("Pitcher", "")):
            r["Pitcher"] = clean_name(r["Pitcher"])
            changes["Pitcher whitespace"] += 1
        if args.pitcher_id and (r.get("PitcherId") or "").strip() != args.pitcher_id:
            r["PitcherId"] = args.pitcher_id
            changes["PitcherId filled"] += 1

        d = r["Date"]
        key = (int(r.get("Inning") or 0), int(r.get("PAofInning") or 0), int(r.get("PitchofPA") or 0))
        if d in last_key and key < last_key[d]:
            changes[f"out of order on {d}"] += 1
        last_key[d] = key
        if not (r.get("PitchNo") or "").strip():
            per_date[d] += 1
            r["PitchNo"] = str(per_date[d])
            changes["PitchNo added"] += 1

        op = r.get("TaggedPitchType", "")
        r.setdefault("OperatorTaggedPitchType", op)
        r["OperatorTaggedPitchType"] = r["OperatorTaggedPitchType"] or op
        if args.types == "auto":
            auto = AUTO_TO_TAG.get((r.get("AutoPitchType") or "").strip().lower())
            if auto and auto != op:
                r["TaggedPitchType"] = auto
                changes["type from AutoPitchType"] += 1

    bad = [k for k in changes if k.startswith("out of order")]
    if bad:
        print("WARNING: rows aren't in inning/PA/pitch order on " + ", ".join(k.split(" on ")[1] for k in bad) + "; PitchNo follows file order.")

    out = src.with_name(src.stem + "_clean.csv")
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print("Changes: " + (", ".join(f"{k} {v}" for k, v in changes.items() if not k.startswith("out of order")) or "none"))
    print("Pitch types: " + ", ".join(f"{k} {v}" for k, v in collections.Counter(r["TaggedPitchType"] for r in rows).most_common()))
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
