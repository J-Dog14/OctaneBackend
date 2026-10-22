"""
Read vertical GRF from athletic-screen c3d files and compute jump kinetics
correctly (no Visual3D).

Why not V3D's PowZ: the QTM trials are cropped (CMJ/DJ start mid-movement,
c3d first_frame > 0), V3D integrates from frame 1 with v0 = 0 using the typed-in
mass, so velocity/power are wrong. Here velocity is integrated BACKWARD from
takeoff, where velocity is known from flight time (v_to = g*t_flight/2). That
needs no quiet start and works for CMJ, SLV, PPU and DJ alike; body weight only
matters over the short propulsive window.

Reads raw analog channels with ezc3d (extract_forceplat_data=False - the
platform extractor crashes on these files because FORCE_PLATFORM:USED=3 while
only one plate has channels).
"""
import re
import numpy as np
import ezc3d

G = 9.81


def read_fz(path):
    """Return (fz_newtons, fs_hz, meta). Fz positive up, NaN tail trimmed."""
    c = ezc3d.c3d(str(path))
    p = c["parameters"]
    labels = p["ANALOG"]["LABELS"]["value"]
    fs = float(p["ANALOG"]["RATE"]["value"][0])
    scale = np.asarray(p["ANALOG"]["SCALE"]["value"], float)
    gen = float(p["ANALOG"]["GEN_SCALE"]["value"][0])
    a = c["data"]["analogs"][0]
    iz = next(i for i, l in enumerate(labels) if re.search(r"Fz$", l))
    fz = a[iz] * scale[iz] * gen
    if np.nanmax(fz) < -np.nanmin(fz):           # guard: loaded = positive
        fz = -fz
    ok = np.where(np.isfinite(fz))[0]
    fz = fz[ok[0]: ok[-1] + 1]
    fz = np.interp(np.arange(fz.size), np.where(np.isfinite(fz))[0], fz[np.isfinite(fz)])
    meta = dict(fs_hz=fs, first_frame=int(c["header"]["points"]["first_frame"]),
                point_rate=float(p["POINT"]["RATE"]["value"][0]), n=fz.size)
    return fz, fs, meta


def flight(fz, fs, thr=20.0, min_s=0.15):
    """Longest run below thr (>= min_s) -> (takeoff_idx, landing_idx) or None."""
    below = fz < thr
    best, i, n = None, 0, len(fz)
    while i < n:
        if below[i]:
            j = i
            while j < n and below[j]:
                j += 1
            loaded_before = np.sum(fz[:i] > 200.0) / fs      # a real flight follows a contact
            if ((j - i) / fs >= min_s and j < n and loaded_before >= 0.1
                    and (best is None or j - i > best[1] - best[0])):
                best = (i, j)
            i = j
        else:
            i += 1
    return best


def quiet_bw(fz, fs, end_idx, win_s=0.3, max_cv=0.02, min_n=200.0):
    """Body weight from the steadiest window before end_idx; None if not quiet."""
    w = int(win_s * fs)
    if end_idx < w:
        return None
    best = None
    for s in range(0, end_idx - w, max(1, w // 10)):
        seg = fz[s:s + w]
        m, sd = seg.mean(), seg.std()
        if m > min_n and (best is None or sd / m < best[1]):
            best = (m, sd / m, s)
    if best and best[1] <= max_cv:
        return dict(bw_n=float(best[0]), cv=float(best[1]), start=best[2])
    return None


def kinetics(fz, fs, bw_n, movement):
    """Backward-integrated velocity/power over the contact before takeoff."""
    fl = flight(fz, fs)
    if fl is None:
        return dict(error="no flight phase")
    to, ld = fl
    t_fl = (ld - to) / fs
    v_to = G * t_fl / 2.0
    m = bw_n / G
    acc = (fz[:to] - bw_n) / m
    # v[i] = v_to - sum_{j>=i} acc[j]*dt
    v = v_to - np.cumsum(acc[::-1])[::-1] / fs
    # contact start: last time before takeoff the plate was unloaded (DJ landing),
    # else file start
    pre = np.where(fz[:to] < 20.0)[0]
    c0 = int(pre[-1]) + 1 if pre.size else 0
    P = fz[:to] * v
    seg = slice(c0, to)
    ipp = c0 + int(np.argmax(P[seg]))
    out = dict(takeoff_idx=to, landing_idx=ld, contact_start_idx=c0,
               flight_s=t_fl, jh_flight_in=G * t_fl ** 2 / 8 / 0.0254, v_takeoff=v_to,
               bw_n=bw_n, mass_kg=m,
               v_at_contact_start=float(v[c0]), contact_s=(to - c0) / fs,
               pp_w=float(P[ipp]), pp_w_per_kg=float(P[ipp] / m),
               v_at_pp=float(v[ipp]), f_at_pp=float(fz[ipp]),
               t_pp_before_takeoff_s=(to - ipp) / fs)
    if movement == "DJ":
        out["implied_drop_height_cm"] = float(v[c0] ** 2 / (2 * G) * 100) if v[c0] < 0 else np.nan
    return out, v, P
