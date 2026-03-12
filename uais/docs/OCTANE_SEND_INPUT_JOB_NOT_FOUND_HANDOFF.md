# Octane: "Send error – Job not found or process finished" when replying to duplicate-session prompt

**Audience:** Front-end / Octane app team  
**Purpose:** What to fix on your side when the UAIS process is waiting for yes/no and your "send input" call fails.

---

## What’s happening

1. User runs a UAIS job (e.g. Athletic Screen, Readiness Screen, Pro Sup) with **Existing Athlete**.
2. UAIS checks if that athlete already has data for the same session date. If **yes**, it prints a parseable message and **waits on stdin** for the user to reply "yes" or "no":
   - Line 1: `DUPLICATE_SESSION:YYYY-MM-DD`
   - Line 2: `It looks like you already ran this data for the following date: YYYY-MM-DD. Reply 'yes' to continue or 'no' to abort.`
3. Your app detects this in the job’s stream (e.g. regex `DUPLICATE_SESSION:(\d{4}-\d{2}-\d{2})`), shows a modal, and when the user clicks Yes/No you call your **“send input to job”** API to send `yes` or `no` to the process.
4. That API returns: **`[Send error] Job not found or process finished`**, so the process never receives the reply and may hang or time out.

So the failure is on the **Octane/front-end** side: the “send input” call is failing, not UAIS.

---

## What Octane needs to fix

- **Ensure the job is still considered active** when you send input.  
  If the job is treated as “finished” as soon as the last chunk of output is received (before the process has read stdin), the “send input” API will correctly report that the job/process is not found or finished.
- **Use the correct job/process handle** when calling “send input.”  
  The handle must refer to the same running process that is waiting on stdin (same job ID / process ID your runner started).
- **Timing:** Send the input **after** you’ve shown the modal and the user has clicked Yes or No. The process is blocking on `readline()`/`stdin.readline()` until it receives a line; your send must target that same process.

UAIS does not and cannot fix this: it only prints the message and waits on stdin. Delivery of the yes/no is entirely handled by the front end’s job runner and “send input” API.

---

## UAIS-side change that reduces how often you see this

UAIS is being updated so the **duplicate-session prompt only appears when a session for that athlete+date already existed *before* the current run** (not for sessions created in the same run). That will reduce how often the prompt appears, but when it does appear, your “send input” flow must work; otherwise the process will still hang until it gets a reply (e.g. from a timeout or manual stdin).

---

## Quick checklist for Octane

- [ ] “Send input” is called for the **same job/process** that is currently waiting on stdin (correct job ID / process handle).
- [ ] The job is not marked “finished” or closed before the process has read stdin (e.g. don’t close the job when the last stream chunk is received; wait until the process actually exits or you’ve sent input and the process has continued).
- [ ] When the user clicks Yes or No, you send exactly one line: `yes` or `no` (lowercase), then newline, to that job’s stdin.

Once this is fixed, the duplicate-session modal flow should work without the “Job not found or process finished” send error.
