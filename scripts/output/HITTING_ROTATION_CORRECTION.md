# Hitting Rotation (Z) Correction

## Rule

**If the pelvis is negative at the lead_foot_off event (Lead_Foot_Down), we flip ALL rotation variables for that specific trial.**

- **Reference event:** Lead_Foot_Down (lead leg off).
- **Reference metric:** `Pelvis_Angle@Lead_Foot_Down` (source: `PROCESSED.Pelvis_Angle@Lead_Foot_Down` or `PROCESSED.Pelvis_Angle@Lead_Foot_Down_MEAN` from `f_kinematics_hitting`).
- **Action:** If `Pelvis_Angle@Lead_Foot_Down < 0` for an athlete’s trial/session, multiply by **-1** every rotation metric listed below for that athlete.

No handedness is used; the sign of pelvis at lead foot off is the flip criterion (left/right coordinate convention).

---

## Trunk at foot contact

- **Display name:** Trunk @ Lead Foot Down  
- **Source variable:** `PROCESSED.Trunk_Angle@Lead_Foot_Down` (or `PROCESSED.Trunk_Angle@Lead_Foot_Down_MEAN`).  
- **Output key:** `Trunk_Angle@Lead_Foot_Down`  
- **Corrected in:** Yes (included in rotation flip list).

---

## Rotation variables that are flipped

When pelvis at Lead_Foot_Down is negative, these metrics are multiplied by -1 for that athlete:

| Output key | Display name |
|------------|--------------|
| `Pelvis_Angle@Lead_Foot_Down` | Pelvis @ Lead Foot Down |
| `Pelvis_Angle@Contact` | Pelvis @ Contact |
| `Trunk_Angle@Lead_Foot_Down` | Trunk @ Lead Foot Down |
| `Trunk_Angle@Contact` | Trunk @ Contact |
| `Pelvis_Shoulders_Separation@Lead_Foot_Down` | Hip-Shoulder Sep @ Lead Foot Down |
| `Trunk_Total_Rotation` | Trunk translation Lead Foot Down→Contact |
| `Pelvis_Total_Rotation` | Pelvis translation Lead Foot Down→Contact |
| `Trunk_Angle@Lead_Foot_Down.X` | Trunk @ Lead Foot Down X (trials) |
| `Trunk_Angle@Contact.X` | Trunk @ Contact X (trials) |
| `Pelvis_Angle@Lead_Foot_Down.X` | Pelvis @ Lead Foot Down X (trials) |

Non-rotation hitting metrics (e.g. Lead_Knee_Extension, Lead_Knee_Angle@…) are **not** flipped.

---

## Output files

| File | Description |
|------|-------------|
| `kinematics-thresholds.csv` | Uncorrected thresholds (raw values). |
| `kinematics-thresholds-corrected.csv` | **Corrected** thresholds: hitting rotation metrics use the rule above; pitching unchanged. |
| `kinematics-thresholds-corrected.json` | Same corrected thresholds in JSON. |

---

## How to verify the change

1. **Run the script**
   ```bash
   npx tsx scripts/compute-kinematics-thresholds.ts
   ```
2. **Console:** Check the line  
   `[Hitting rotation] Athletes with rotation at Lead_Foot_Down: N | Negative (flipped to positive): M`  
   So M athletes had pelvis &lt; 0 at Lead_Foot_Down and had all rotation vars flipped.
3. **Corrected CSV:** Open `scripts/output/kinematics-thresholds-corrected.csv`.
   - Compare hitting rows to `kinematics-thresholds.csv`: rotation metrics (e.g. Pelvis @ Lead Foot Down, Trunk @ Lead Foot Down) should differ where the flip was applied; percentiles are recomputed from the corrected values.
4. **Logic check:** In the script, the reference is `Pelvis_Angle@Lead_Foot_Down`; the flip is applied in `applyHittingRotationCorrection()` when that value is negative, and only the keys in `HITTING_ROTATION_KEYS` are multiplied by -1.

---

## Code reference

- **Flip reference:** `LEAD_LEG_OFF_REF_KEY = "Pelvis_Angle@Lead_Foot_Down"` in `scripts/compute-kinematics-thresholds.ts`.
- **Rotation keys:** `HITTING_ROTATION_KEYS` in the same file.
- **Function:** `applyHittingRotationCorrection()`.
