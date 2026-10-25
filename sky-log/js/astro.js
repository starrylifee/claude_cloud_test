/* 하늘 수첩 — astronomy helpers: time, projection, planets, Moon, comets, constellation lookup.
   Accuracy target is "good enough to put a marker on a star chart" (arcminutes for planets, ~0.3° for the Moon). */
(function () {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const OBLIQUITY = 23.43928 * D2R;
  const GAUSS_K = 0.01720209895;

  const norm360 = (a) => ((a % 360) + 360) % 360;
  const wrap180 = (a) => ((a + 540) % 360) - 180;

  // ---------- time
  const julianDay = (date) => date.getTime() / 86400000 + 2440587.5;
  const centuriesJ2000 = (jd) => (jd - 2451545.0) / 36525;
  function gmst(jd) {
    const t = centuriesJ2000(jd);
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t);
  }
  const localSiderealTime = (jd, lonDeg) => norm360(gmst(jd) + lonDeg);

  // ---------- coordinates
  function eclipticToEquatorial(x, y, z) {
    const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
    const ye = y * ce - z * se, ze = y * se + z * ce;
    return { ra: norm360(Math.atan2(ye, x) * R2D), dec: Math.atan2(ze, Math.hypot(x, ye)) * R2D, dist: Math.hypot(x, y, z) };
  }
  function eclipticLonLatToEquatorial(lonDeg, latDeg) {
    const l = lonDeg * D2R, b = latDeg * D2R;
    return eclipticToEquatorial(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b));
  }
  function angularDistance(ra1, dec1, ra2, dec2) {
    const a = Math.sin(dec1 * D2R) * Math.sin(dec2 * D2R) + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.cos((ra1 - ra2) * D2R);
    return Math.acos(Math.max(-1, Math.min(1, a))) * R2D;
  }
  function toHorizontal(ra, dec, jd, latDeg, lonDeg) {
    const H = (localSiderealTime(jd, lonDeg) - ra) * D2R, d = dec * D2R, p = latDeg * D2R;
    const alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H));
    const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H));
    return { alt: alt * R2D, az: norm360(az * R2D) };
  }
  function fromHorizontal(az, alt, jd, latDeg, lonDeg) {
    const A = az * D2R, h = alt * D2R, p = latDeg * D2R;
    const dec = Math.asin(Math.sin(p) * Math.sin(h) + Math.cos(p) * Math.cos(h) * Math.cos(A));
    const H = Math.atan2(-Math.sin(A) * Math.cos(h), Math.cos(p) * Math.sin(h) - Math.sin(p) * Math.cos(h) * Math.cos(A));
    return { ra: norm360(localSiderealTime(jd, lonDeg) - H * R2D), dec: dec * R2D };
  }

  // ---------- stereographic projection, east to the left as seen from inside the sphere
  class Projection {
    constructor() { this.ra0 = 83; this.dec0 = 10; this.fov = 90; this.w = 1; this.h = 1; this.update(); }
    setSize(w, h) { this.w = w; this.h = h; this.update(); }
    update() {
      this.sd0 = Math.sin(this.dec0 * D2R); this.cd0 = Math.cos(this.dec0 * D2R);
      // fov is the angular width of the shorter side
      this.scale = Math.min(this.w, this.h) / 2 / (2 * Math.tan(this.fov * D2R / 4));
      this.cx = this.w / 2; this.cy = this.h / 2;
    }
    // returns [x, y, cosc] — cosc < 0 means the far hemisphere
    project(ra, dec) {
      const dl = (ra - this.ra0) * D2R, sd = Math.sin(dec * D2R), cd = Math.cos(dec * D2R), cdl = Math.cos(dl);
      const cosc = this.sd0 * sd + this.cd0 * cd * cdl;
      const k = 2 / (1 + Math.max(cosc, -0.999));
      return [this.cx - k * cd * Math.sin(dl) * this.scale, this.cy - k * (this.cd0 * sd - this.sd0 * cd * cdl) * this.scale, cosc];
    }
    unproject(sx, sy) {
      const x = -(sx - this.cx) / this.scale, y = -(sy - this.cy) / this.scale;
      const rho = Math.hypot(x, y);
      if (rho < 1e-12) return { ra: this.ra0, dec: this.dec0 };
      const c = 2 * Math.atan(rho / 2), sc = Math.sin(c), cc = Math.cos(c);
      const dec = Math.asin(cc * this.sd0 + y * sc * this.cd0 / rho) * R2D;
      const ra = this.ra0 + Math.atan2(x * sc, rho * this.cd0 * cc - y * this.sd0 * sc) * R2D;
      return { ra: norm360(ra), dec };
    }
    pxPerDeg() { return this.scale * D2R; }
  }

  // ---------- Kepler orbits
  function solveKepler(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 30; i++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    return E;
  }
  function orbitToEcliptic(r, nu, i, peri, node) {
    const u = nu + peri;
    return [
      r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(i)),
      r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(i)),
      r * Math.sin(u) * Math.sin(i),
    ];
  }
  // JPL "Approximate positions of the planets" elements (a, e, i, L, W = long. perihelion, N = node)
  function planetHelio(el, jd) {
    const T = centuriesJ2000(jd);
    const a = el.a + el.da * T, e = el.e + el.de * T, i = (el.i + el.di * T) * D2R;
    const L = el.L + el.dL * T, W = el.W + el.dW * T, N = el.N + el.dN * T;
    const M = wrap180(L - W) * D2R;
    const E = solveKepler(M, e);
    const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
    return orbitToEcliptic(Math.hypot(xv, yv), Math.atan2(yv, xv), i, (W - N) * D2R, N * D2R);
  }

  const PLANET_KEYS = ['mer', 'ven', 'mar', 'jup', 'sat', 'ura', 'nep'];
  function planetPosition(key, jd) {
    const P = window.SKY_CATALOG.planets;
    const earth = planetHelio(P.ter.el, jd);
    if (key === 'sun') return eclipticToEquatorial(-earth[0], -earth[1], -earth[2]);
    const p = planetHelio(P[key].el, jd);
    const g = eclipticToEquatorial(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]);
    g.helioDist = Math.hypot(p[0], p[1], p[2]);
    return g;
  }

  // Low-precision lunar position (Astronomical Almanac), ~0.3°
  function moonPosition(jd) {
    const T = centuriesJ2000(jd), s = (a) => Math.sin(a * D2R);
    const lon = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T)
      + 0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T)
      - 0.11 * s(186.5 + 966404.03 * T);
    const lat = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T)
      - 0.17 * s(217.6 - 407332.21 * T);
    const eq = eclipticLonLatToEquatorial(norm360(lon), lat);
    const sun = planetPosition('sun', jd);
    const elong = angularDistance(eq.ra, eq.dec, sun.ra, sun.dec);
    eq.illum = (1 - Math.cos(elong * D2R)) / 2;
    eq.waxing = wrap180(eq.ra - sun.ra) > 0;
    return eq;
  }

  /* Comet from osculating elements (J2000 ecliptic):
     q perihelion distance [AU], e eccentricity, i inclination, peri argument of perihelion (ω), node (Ω) [deg],
     tp time of perihelion as an ISO date string. Handles elliptic, near-parabolic and hyperbolic orbits. */
  function cometPosition(el, jd) {
    const q = +el.q, e = +el.e, i = +el.i * D2R, w = +el.peri * D2R, N = +el.node * D2R;
    const dt = jd - julianDay(new Date(el.tp));
    let r, nu;
    if (Math.abs(e - 1) < 1e-4) {
      const W = 3 * GAUSS_K / Math.sqrt(2 * q * q * q) * dt;
      const y = Math.cbrt(W / 2 + Math.sqrt(W * W / 4 + 1));
      const s = y - 1 / y;
      nu = 2 * Math.atan(s); r = q * (1 + s * s);
    } else if (e < 1) {
      const a = q / (1 - e), M = GAUSS_K * dt / Math.pow(a, 1.5);
      const E = solveKepler(((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI, e);
      const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
      r = Math.hypot(xv, yv); nu = Math.atan2(yv, xv);
    } else {
      const a = q / (e - 1), M = GAUSS_K * dt / Math.pow(a, 1.5);
      let H = Math.asinh(M / e);
      for (let k = 0; k < 50; k++) {
        const dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
        H -= dH;
        if (Math.abs(dH) < 1e-12) break;
      }
      r = a * (e * Math.cosh(H) - 1);
      nu = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
    }
    const c = orbitToEcliptic(r, nu, i, w, N);
    const earth = planetHelio(window.SKY_CATALOG.planets.ter.el, jd);
    const g = eclipticToEquatorial(c[0] - earth[0], c[1] - earth[1], c[2] - earth[2]);
    g.helioDist = r;
    return g;
  }

  // ---------- which constellation contains (ra, dec): ray-casting toward the north pole
  const NORTH_POLE_INSIDE = { UMi: true };
  function constellationAt(ra, dec) {
    const B = window.SKY_CATALOG.bounds;
    for (const id in B) {
      let n = NORTH_POLE_INSIDE[id] ? 1 : 0;
      for (const ring of B[id]) {
        for (let k = 0, m = ring.length; k < m; k++) {
          const p1 = ring[k], p2 = ring[(k + 1) % m];
          const d = wrap180(p2[0] - p1[0]);
          if (d === 0) continue;
          const u = wrap180(ra - p1[0]);
          if (((u >= 0 && u < d) || (u >= d && u < 0)) && p1[1] + (u / d) * (p2[1] - p1[1]) > dec) n++;
        }
      }
      if (n % 2 === 1) return id;
    }
    return '';
  }

  // ---------- formatting
  function fmtRA(ra) {
    const h = norm360(ra) / 15, hh = Math.floor(h), mm = (h - hh) * 60;
    return `${hh}h ${mm.toFixed(1).padStart(4, '0')}m`;
  }
  function fmtDec(dec) {
    const s = dec < 0 ? '−' : '+', a = Math.abs(dec), d = Math.floor(a), m = Math.round((a - d) * 60);
    return `${s}${d}° ${String(m === 60 ? 59 : m).padStart(2, '0')}′`;
  }
  // accepts "10.68", "0h42m44s", "00 42 44", "+41 16" etc.
  function parseAngle(str, isRA) {
    if (str == null) return NaN;
    const s = String(str).trim().replace(/[−–]/g, '-');
    if (!s) return NaN;
    const neg = s.startsWith('-');
    const parts = s.replace(/^[+-]/, '').split(/[^0-9.]+/).filter(Boolean).map(Number);
    if (!parts.length) return NaN;
    const hasHour = /h/i.test(s);
    let v = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
    if (isRA && (hasHour || parts.length > 1)) v *= 15;
    return neg ? -v : v;
  }

  window.Astro = {
    D2R, R2D, norm360, wrap180, julianDay, gmst, localSiderealTime, angularDistance,
    toHorizontal, fromHorizontal, eclipticLonLatToEquatorial, Projection,
    PLANET_KEYS, planetPosition, moonPosition, cometPosition, constellationAt, fmtRA, fmtDec, parseAngle,
  };
})();
