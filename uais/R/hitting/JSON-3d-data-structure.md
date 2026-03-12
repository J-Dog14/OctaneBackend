# Swing Sports 4 – 3D Data JSON Structure

This document describes the structure of exported 3D JSON files (e.g. `Swing Sports 4-3d-data.json`) so you can interpret **segment**, **marker**, and **frame** data correctly.

---

## Top-level keys

| Key | Type | Description |
|-----|------|-------------|
| `startTime` | number | Clip start time (seconds) |
| `endTime` | number | Clip end time (seconds) |
| `frameRate` | number | Frames per second (e.g. 300) |
| `uncroppedLength` | number | Total clip length in seconds |
| **`labels`** | array | **Marker names** – order = index into `frame.markers` |
| **`bones`** | array | Skeleton edges as `[fromLabel, toLabel]` pairs |
| **`segments`** | array | **Body/bat segments** – order = index into `frame.segmentPos` and `frame.segmentRot` |
| **`frames`** | array | One object per frame (time step) |

---

## How to attach context to frame data

### 1. **Markers** → use `labels`

- **Where:** `frames[i].markers` is an array of 3D points `[x, y, z]`.
- **Length:** Same as `labels` (e.g. 39).
- **Meaning:**  
  **`frame.markers[j]`** is the 3D position of the marker named **`labels[j].name`**.

Example:  
`labels[0].name` is `"Bat_Knob"` → `frame.markers[0]` is the Bat_Knob position for that frame.

**Label list (order = marker index):**  
Bat_Knob, Bat_Taper1, Bat_Taper2, Bat_Taper3, Chest, HeadFront, HeadL, HeadR, LAnkleOut, LElbowIn, LElbowOut, LForefoot2, LForefoot5, LHand2, LHeelBack, LKneeOut, LShinFrontHigh, LShoulderTop, LThighFrontLow, LWristIn, LWristOut, RAnkleOut, RElbowIn, RElbowOut, RForefoot2, RForefoot5, RHand2, RHeelBack, RKneeOut, RShinFrontHigh, RShoulderTop, RThighFrontLow, RWristIn, RWristOut, SpineThoracic12, SpineThoracic2, WaistBack, WaistLFront, WaistRFront.

---

### 2. **Segment position and rotation** → use `segments`

- **Where:**  
  - `frames[i].segmentPos` – array of 3D positions `[x, y, z]` (one per segment).  
  - `frames[i].segmentRot` – array of 3D rotations (one per segment; likely Euler angles in degrees).
- **Length:** Same as `segments` (16 in your file).
- **Meaning:**  
  **`frame.segmentPos[k]`** and **`frame.segmentRot[k]`** belong to the segment named **`segments[k].name`**.

**Segment index → name (use this to classify segmentPos/segmentRot):**

| Index | Segment name |
|-------|----------------|
| 0  | Pelvis   |
| 1  | RThigh   |
| 2  | RLeg     |
| 3  | RFoot    |
| 4  | LThigh   |
| 5  | LLeg     |
| 6  | LFoot    |
| 7  | Thorax   |
| 8  | RArm     |
| 9  | RForearm |
| 10 | RHand    |
| 11 | LArm     |
| 12 | LForearm |
| 13 | LHand    |
| 14 | Head     |
| 15 | Bat      |

Each segment also has a **`length`** (mm) in `segments[k].length`.

---

### 3. **Bones**

- **Where:** `bones` at the top level.
- **Meaning:** Each entry is `[fromLabel, toLabel]` and defines the skeleton connectivity (which markers are connected).  
  Useful for visualization and for understanding which markers belong to which limb/segment.

---

### 4. **Force**

- **Where:** `frames[i].force`.
- **Meaning:** Force plate (or similar) data when present. In your sample file this array is empty (0 items) in every frame, so this export has no force data.

---

## Quick reference: “What does this array belong to?”

| You see…           | In…                | Interpretation |
|--------------------|--------------------|-----------------|
| `frame.markers[j]`| Each frame         | 3D position of **`labels[j].name`** |
| `frame.segmentPos[k]` | Each frame    | 3D position of segment **`segments[k].name`** |
| `frame.segmentRot[k]` | Each frame    | Rotation of segment **`segments[k].name`** (likely °) |
| `frame.force`      | Each frame         | Force data (empty in your file) |
| `frame.frame`     | Each frame         | Frame number (1-based) |

---

## Example (pseudocode)

```r
# In R, after parsing JSON into 'j':
segment_names <- sapply(j$segments, function(s) s$name)
# segment_names[1] is "Pelvis", segment_names[16] is "Bat"

label_names <- sapply(j$labels, function(l) l$name)
# label_names[1] is "Bat_Knob", etc.

# For frame 1:
frame1 <- j$frames[[1]]
# Pelvis position (segment index 0):
pelvis_pos <- frame1$segmentPos[[1]]   # [x, y, z]
# Bat rotation (segment index 16):
bat_rot <- frame1$segmentRot[[16]]
# Bat_Knob marker position (label index 0):
bat_knob_pos <- frame1$markers[[1]]
```

---

## Summary

- **Markers** are identified by **position in `frame.markers`** = same position in the **`labels`** array.
- **Segment position/rotation** are identified by **position in `frame.segmentPos` / `frame.segmentRot`** = same position in the **`segments`** array (0 = Pelvis … 15 = Bat).
- **Force** is present only when the export includes force plate data; in your file it is always empty.
