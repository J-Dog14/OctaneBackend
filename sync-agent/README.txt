OctaneSync Agent — Setup Instructions
======================================

FIRST TIME SETUP (do this once):

  1. Install Python from https://python.org
     - During install, CHECK the box "Add Python to PATH"

  2. Open the config.json file in this folder with Notepad
     - Fill in your Railway app URL and agent token
     - (Get the token from the web app: Settings -> Sync Agent -> Generate Token)

  3. Open PowerShell or Command Prompt in this folder:
     - Hold Shift, right-click inside the folder -> "Open PowerShell window here"

  4. Run:
        pip install -r requirements.txt

  5. Run:
        python octane_sync.py

  You should see: "Agent online. Polling for requests..."
  The web app will show a green dot on the UAIS Maintenance page.

EVERY DAY (to start the agent):

  - Double-click start_agent.bat
    OR open PowerShell in this folder and run: python octane_sync.py

  - Leave the terminal window open while processing athletes.
  - You can minimize it — it runs in the background.

TROUBLESHOOTING:

  - "python not found"  -> Re-install Python and check "Add to PATH"
  - "Unauthorized"      -> Regenerate the token in Settings and update config.json
  - Green dot not showing -> Make sure the terminal shows "Agent online" with no errors
