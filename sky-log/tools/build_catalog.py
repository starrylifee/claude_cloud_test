#!/usr/bin/env python3
"""Build js/catalog.js from the d3-celestial data files (BSD-3, (c) 2015 Olaf Frohn).

Usage:
  npm pack d3-celestial@0.7.35 && tar xzf d3-celestial-0.7.35.tgz
  python3 tools/build_catalog.py package/data js/catalog.js
"""
import base64, io, json, math, sys

import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]


def load(name):
    with open(f"{SRC}/{name}", encoding="utf-8") as f:
        return json.load(f)


def r2(x):
    return round(float(x), 2)


def ra360(lon):
    return r2(lon % 360)


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


# ---- constellation boundaries (also used to tag every object with its constellation)
# Serpens appears twice (Caput and Cauda); merge features that share an id.
bounds = {}
for f in load("constellations.bounds.json")["features"]:
    bounds.setdefault(f["id"], []).extend(f["geometry"]["coordinates"])
NORTH_POLE_INSIDE = {"UMi"}


def crossings_above(ring, lon, lat):
    """Count ring edges crossed by a ray from (lon, lat) toward the north pole."""
    n = 0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        d = (x2 - x1 + 180) % 360 - 180
        if d == 0:
            continue
        u = (lon - x1 + 180) % 360 - 180
        # half-open on the smaller longitude so a shared vertex is counted once
        if (0 <= u < d or d <= u < 0) and y1 + u / d * (y2 - y1) > lat:
            n += 1
    return n


def constellation_of(lon, lat):
    for cid, rings in bounds.items():
        c = sum(crossings_above(r, lon, lat) for r in rings) + (1 if cid in NORTH_POLE_INSIDE else 0)
        if c % 2 == 1:
            return cid
    return ""


def densify(ring, step=1.0):
    out = []
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        d = (x2 - x1 + 180) % 360 - 180
        n = max(1, int(math.hypot(d, y2 - y1) / step))
        for k in range(n):
            out.append([ra360(x1 + d * k / n), r2(y1 + (y2 - y1) * k / n)])
    return out


# ---- constellations
cons = {}
for f in load("constellations.json")["features"]:
    if f["id"] in cons:
        continue
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    cons[f["id"]] = {"ko": p.get("ko") or p["name"], "en": p["en"], "la": p["name"],
                     "c": [ra360(lon), r2(lat)], "rank": int(p.get("rank") or 3)}
lines = {}
for f in load("constellations.lines.json")["features"]:
    lines.setdefault(f["id"], []).extend([[ra360(a), r2(b)] for a, b in seg] for seg in f["geometry"]["coordinates"])
bounds_out = {cid: [densify(r) for r in rings] for cid, rings in bounds.items()}

# ---- stars
names = load("starnames.json")
stars = []
named = []
for f in load("stars.6.json")["features"]:
    lon, lat = f["geometry"]["coordinates"]
    p = f["properties"]
    bv = num(p.get("bv"))
    stars.append([ra360(lon), r2(lat), round(p["mag"], 2), bv if bv is not None else 0.6])
    nm = names.get(str(f["id"]), {})
    if nm.get("name") and p["mag"] <= 4.0:
        named.append({"id": f"HIP {f['id']}", "en": nm["name"], "ko": nm.get("ko") or "",
                      "bayer": nm.get("bayer") or "", "con": nm.get("c") or "",
                      "ra": ra360(lon), "dec": r2(lat), "mag": round(p["mag"], 2)})

# ---- deep-sky objects
dsonames = load("dsonames.json")


def dso_name(key):
    n = dsonames.get(key) or {}
    return n.get("ko") or "", n.get("name") or ""


messier = []
m_by_desig = {}
for f in load("messier.json")["features"]:
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    desig = p.get("desig") or ""
    ko, en = dso_name(desig) if desig else ("", "")
    if not ko:
        ko, en2 = dso_name(f"M {f['id'][1:]}")
        en = en or en2
    mid = "M" + f["id"][1:]
    messier.append({"id": mid, "ngc": desig, "ko": ko, "en": en or p.get("alt") or "", "t": p["type"],
                    "mag": num(p.get("mag")), "dim": p.get("dim") or "", "ra": ra360(lon), "dec": r2(lat),
                    "con": constellation_of(lon, lat)})
    for d in desig.replace(",", " ").split("NGC"):
        if d.strip():
            m_by_desig["NGC " + d.strip().split()[0]] = mid

dsos = []
for f in load("dsos.14.json")["features"]:
    i = f["id"]
    if not (i.startswith("NGC ") or i.startswith("IC ")):
        continue
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    ko, en = dso_name(i)
    m = m_by_desig.get(i, "")
    alt = p.get("desig") or ""
    if not m and alt.startswith("M "):
        m = "M" + alt[2:]
    dsos.append([i, p["type"], num(p.get("mag")), p.get("dim") or "", ra360(lon), r2(lat),
                 constellation_of(lon, lat), ko, en, m])

# ---- planets (JPL approximate Keplerian elements)
pl = load("planets.json")
planets = {k: {"ko": pl[k].get("ko") or pl[k]["name"], "en": pl[k]["en"], "sym": pl[k].get("sym", ""),
               "el": pl[k]["elements"][0]}
           for k in ["mer", "ven", "ter", "mar", "jup", "sat", "ura", "nep"]}
planets["ter"]["ko"] = "지구"

# ---- Milky Way: rasterize the 5 brightness contours into an equirectangular PNG
W, H = 720, 360
lons = (np.arange(W) + 0.5) * 360 / W
lats = 90 - (np.arange(H) + 0.5) * 180 / H
acc = np.zeros((H, W), dtype=np.float32)
for f in load("mw.json")["features"]:
    rings = [r for poly in f["geometry"]["coordinates"] for r in poly]
    cnt = np.zeros((H, W), dtype=np.int32)
    for ring in rings:
        a = np.array(ring, dtype=np.float64)
        b = np.roll(a, -1, axis=0)
        d = (b[:, 0] - a[:, 0] + 180) % 360 - 180
        ok = d != 0
        a, d, y2 = a[ok], d[ok], b[ok, 1]
        # t for every column/edge pair
        u = (lons[None, :] - a[:, 0:1] + 180) % 360 - 180
        dd = d[:, None]
        hit = ((dd > 0) & (u >= 0) & (u < dd)) | ((dd < 0) & (u >= dd) & (u < 0))
        t = u / dd
        ycross = a[:, 1:2] + t * (y2 - a[:, 1])[:, None]
        ei, ci = np.nonzero(hit)
        yc = ycross[ei, ci]
        # cell (row r, col c) counts edges with ycross > lat[r]
        rows = np.searchsorted(-lats, -yc)  # number of rows whose lat > yc  -> rows above crossing
        tmp = np.zeros((H + 1, W), dtype=np.int32)
        np.add.at(tmp, (rows, ci), 1)
        # cells with row index >= rows (lat < yc) are below the crossing => crossing is above them
        cnt += np.cumsum(tmp, axis=0)[:H]
    inside = cnt % 2 == 1
    # A column whose total crossing count is odd hit a degenerate edge; borrow its neighbour.
    bad = np.nonzero(cnt[-1] % 2 == 1)[0]
    for c in bad:
        inside[:, c] = inside[:, (c - 1) % W]
    acc += inside.astype(np.float32)
img = Image.fromarray(np.clip(acc * 51, 0, 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1.2))
buf = io.BytesIO()
img.save(buf, "PNG", optimize=True)
mw_png = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

catalog = {"stars": stars, "named": named, "cons": cons, "lines": lines, "bounds": bounds_out,
           "messier": messier, "dsos": dsos, "planets": planets, "mw": mw_png}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("/* 하늘 수첩 catalog — generated by tools/build_catalog.py.\n"
            "   Star, constellation, DSO and Milky Way data: d3-celestial (BSD-3-Clause, (c) 2015 Olaf Frohn). */\n")
    f.write("window.SKY_CATALOG=")
    json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

unk = sum(1 for d in dsos if not d[6]) + sum(1 for m in messier if not m["con"])
print(f"stars {len(stars)} named {len(named)} messier {len(messier)} dsos {len(dsos)} untagged {unk}")
