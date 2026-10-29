"""Name evidence for identity review, separate from automatic fuzzy matching."""
import re
from difflib import SequenceMatcher


def name_tokens(name):
    """Ignore separators and trailing initial suffixes when reviewing a name."""
    value = re.sub(r'_[A-Z]{2,3}\s*$', '', (name or '').strip()).replace('_', ' ')
    return tuple(re.findall(r"[^\W_]+", value.casefold(), flags=re.UNICODE))


def same_name_reordered(left, right):
    a, b = name_tokens(left), name_tokens(right)
    return len(a) >= 2 and a != b and sorted(a) == sorted(b)


def review_similarity(left, right):
    """Reordered names must reach review even when their ordered score is low.

    This score is for candidate discovery, never permission to auto-merge.
    """
    a, b = name_tokens(left), name_tokens(right)
    if not a or not b:
        return 0.0
    return max(SequenceMatcher(None, ' '.join(a), ' '.join(b)).ratio(),
               SequenceMatcher(None, ' '.join(sorted(a)), ' '.join(sorted(b))).ratio())
