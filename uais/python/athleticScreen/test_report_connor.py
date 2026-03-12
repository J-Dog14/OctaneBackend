"""
Test script to generate PDF report for Connor Wong
"""
import sys
from pathlib import Path

# Add python directory to path
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import get_warehouse_connection
from athleticScreen.pdf_report import generate_pdf_report

# Connect to database
conn = get_warehouse_connection()

try:
    # Find Connor Wong's UUID
    with conn.cursor() as cur:
        cur.execute("""
            SELECT athlete_uuid, name
            FROM analytics.d_athletes
            WHERE LOWER(name) LIKE '%connor%wong%' OR LOWER(name) LIKE '%wong%connor%'
            ORDER BY created_at DESC
            LIMIT 1
        """)
        result = cur.fetchone()
        
        if not result:
            print("Could not find Connor Wong in database")
            # Try alternative search
            cur.execute("""
                SELECT athlete_uuid, name
                FROM analytics.d_athletes
                WHERE LOWER(name) LIKE '%wong%'
                ORDER BY created_at DESC
                LIMIT 1
            """)
            result = cur.fetchone()
        
        if not result:
            print("ERROR: Could not find Connor Wong")
            sys.exit(1)
        
        athlete_uuid = result[0]
        athlete_name = result[1]
        print(f"Found athlete: {athlete_name} (UUID: {athlete_uuid})")
        
        # Find most recent session date for this athlete
        cur.execute("""
            SELECT DISTINCT session_date
            FROM (
                SELECT session_date FROM public.f_athletic_screen_cmj WHERE athlete_uuid = %s
                UNION
                SELECT session_date FROM public.f_athletic_screen_dj WHERE athlete_uuid = %s
                UNION
                SELECT session_date FROM public.f_athletic_screen_ppu WHERE athlete_uuid = %s
                UNION
                SELECT session_date FROM public.f_athletic_screen_slv WHERE athlete_uuid = %s
            ) AS all_dates
            ORDER BY session_date DESC
            LIMIT 1
        """, (athlete_uuid, athlete_uuid, athlete_uuid, athlete_uuid))
        
        date_result = cur.fetchone()
        if not date_result:
            print("ERROR: No athletic screen data found for this athlete")
            sys.exit(1)
        
        session_date = date_result[0]
        print(f"Using session date: {session_date}")
        
        # Generate report
        output_dir = r'G:\My Drive\Athletic Screen 2.0 Reports\Reports 2.0'
        logo_path = Path(__file__).parent / "8ctnae - Faded 8 to Blue.png"
        
        print(f"\nGenerating PDF report...")
        print(f"Output directory: {output_dir}")
        print(f"Logo path: {logo_path}")
        
        report_path = generate_pdf_report(
            athlete_uuid=athlete_uuid,
            athlete_name=athlete_name,
            session_date=str(session_date),
            output_dir=output_dir,
            logo_path=str(logo_path) if logo_path.exists() else None
        )
        
        if report_path:
            print(f"\nSuccessfully generated report: {report_path}")
        else:
            print("\nFailed to generate report")
            
finally:
    conn.close()

