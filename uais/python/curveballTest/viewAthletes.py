"""
Script to view athlete/client summary information.

Usage:
    python viewAthletes.py [participant_name]
    
If participant_name is provided, shows only that athlete's data.
Otherwise, shows all athletes.
"""

import sys
from athletes import get_athlete_summary


def view_athletes(participant_name=None):
    """Display athlete summary information."""
    print("=" * 100)
    print("ATHLETE/CLIENT SUMMARY")
    print("=" * 100)
    
    results = get_athlete_summary(participant_name)
    
    if not results:
        if participant_name:
            print(f"\nNo data found for athlete: {participant_name}")
        else:
            print("\nNo athlete data found in database.")
        return
    
    print(f"\nFound {len(results)} record(s):\n")
    print("-" * 100)
    print(f"{'Name':<25} {'Date':<15} {'Type':<12} {'Pitches':<10} {'Avg Score':<12} {'Sessions':<10} {'Last Session':<20}")
    print("-" * 100)
    
    for row in results:
        name, date, ptype, num_pitches, avg_score, sessions, last_session = row
        avg_str = f"{avg_score:.2f}" if avg_score else "N/A"
        last_str = last_session[:19] if last_session else "N/A"
        print(f"{name:<25} {date:<15} {ptype:<12} {num_pitches:<10} {avg_str:<12} {sessions:<10} {last_str:<20}")
    
    print("-" * 100)
    
    # Summary statistics
    if participant_name:
        total_pitches = sum(r[3] for r in results)
        dates = set(r[1] for r in results)
        print(f"\nSummary for {participant_name}:")
        print(f"  Total pitches: {total_pitches}")
        print(f"  Test dates: {len(dates)}")
        print(f"  Pitch types: {', '.join(set(r[2] for r in results))}")
    else:
        athletes = set(r[0] for r in results)
        total_pitches = sum(r[3] for r in results)
        dates = set(r[1] for r in results)
        print(f"\nOverall Summary:")
        print(f"  Total athletes: {len(athletes)}")
        print(f"  Total pitches: {total_pitches}")
        print(f"  Test dates: {len(dates)}")
    
    print("=" * 100)


if __name__ == "__main__":
    participant_name = sys.argv[1] if len(sys.argv) > 1 else None
    view_athletes(participant_name)

