"""Fill missing emails on resolved athletes; never resolve or merge by email."""
from collections import defaultdict


def fill_missing_emails(conn, records, dry_run=False):
    """Records must already link an email to a known athlete_uuid.

    Conflicting source emails or an email owned by another athlete need review.
    The caller owns the transaction. Returns (filled UUIDs, review UUIDs).
    """
    emails = defaultdict(set)
    for row in records:
        uuid, raw = row.get("athlete_uuid"), row.get("email")
        email = raw.strip().lower() if isinstance(raw, str) else ""
        if isinstance(uuid, str) and uuid and "@" in email:
            emails[uuid].add(email)
    owners = defaultdict(set)
    for uuid, values in emails.items():
        for email in values:
            owners[email].add(uuid)
    filled, review = [], []
    with conn.cursor() as cur:
        for uuid, values in sorted(emails.items()):
            cur.execute("SELECT email FROM analytics.d_athletes WHERE athlete_uuid = %s", (uuid,))
            existing = cur.fetchone()
            if existing is None or (existing[0] or "").strip():
                continue
            if len(values) != 1 or any(len(owners[email]) > 1 for email in values):
                review.append(uuid)
                continue
            email = next(iter(values))
            cur.execute("""SELECT 1 FROM analytics.d_athletes
                           WHERE LOWER(TRIM(email)) = %s AND athlete_uuid <> %s LIMIT 1""", (email, uuid))
            if cur.fetchone():
                review.append(uuid)
                continue
            if dry_run:
                filled.append(uuid)
                continue
            cur.execute("""UPDATE analytics.d_athletes SET email = %s, updated_at = NOW()
                           WHERE athlete_uuid = %s AND NULLIF(TRIM(email), '') IS NULL""", (email, uuid))
            if cur.rowcount:
                filled.append(uuid)
    return filled, review
