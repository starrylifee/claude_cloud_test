/* 하늘 수첩 — star chart renderer.
   Two stacked canvases: `base` holds the sky and is redrawn only when the view or data changes;
   `fx` runs the animation loop (selection reticle, breathing glow on collected objects, celebration bursts). */
(function () {
  'use strict';
  const A = window.Astro;
  const C = window.SKY_CATALOG;
  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // B−V colour index → star tint
  function bvColor(bv) {
    const t = clamp((bv + 0.3) / 2.0, 0, 1);
    const stops = [[0, [155, 182, 255]], [0.22, [205, 218, 255]], [0.38, [255, 250, 240]], [0.55, [255, 230, 190]], [0.75, [255, 200, 140]], [1, [255, 165, 110]]];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
        return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
      }
    }
    return 'rgb(255,165,110)';
  }
  const STAR_COLORS = C.stars.map((s) => bvColor(s[3]));

  // centre and angular radius of each stick figure, for the claimed-constellation glow
  const FIGURES = {};
  for (const id in C.lines) {
    let x = 0, y = 0, z = 0;
    const pts = C.lines[id].flat();
    for (const [ra, dec] of pts) {
      const r = ra * A.D2R, d = dec * A.D2R;
      x += Math.cos(d) * Math.cos(r); y += Math.cos(d) * Math.sin(r); z += Math.sin(d);
    }
    const ra = A.norm360(Math.atan2(y, x) * A.R2D), dec = Math.atan2(z, Math.hypot(x, y)) * A.R2D;
    FIGURES[id] = { ra, dec, r: Math.max(4, ...pts.map((p) => A.angularDistance(ra, dec, p[0], p[1]))) };
  }

  const GALAXY = { g: 1, s: 1, s0: 1, sd: 1, i: 1, e: 1, gg: 1 };
  const NEBULA = { bn: 1, en: 1, rn: 1, sfr: 1, dn: 1 };

  function parseDim(dim) {
    if (!dim) return [0, 0];
    const p = String(dim).split('x').map(Number);
    return [p[0] || 0, p[1] || p[0] || 0];
  }

  class SkyView {
    constructor(host, base, fx, hooks) {
      this.host = host; this.base = base; this.fx = fx; this.hooks = hooks;
      this.bctx = base.getContext('2d'); this.fctx = fx.getContext('2d');
      this.P = new A.Projection();
      this.hits = []; this.marked = []; this.effects = []; this.dirty = true;
      this.mwCanvas = document.createElement('canvas');
      this.mwData = null;
      this.loadMilkyWay();
      this.refreshColors();
      this.bindInput();
      new ResizeObserver(() => this.resize()).observe(host);
      this.resize();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    refreshColors() {
      this.col = {
        seen: css('--seen'), photo: css('--photo'), known: css('--known'),
        a: css('--obs-a'), b: css('--obs-b'), ink: css('--ink'), muted: css('--muted'), red: document.documentElement.dataset.theme === 'red',
      };
      this.dirty = true;
    }

    loadMilkyWay() {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        this.mwW = c.width; this.mwH = c.height;
        this.mwData = new Uint8Array(c.width * c.height);
        for (let i = 0; i < this.mwData.length; i++) this.mwData[i] = d[i * 4];
        this.dirty = true;
      };
      img.src = C.mw;
    }

    resize() {
      const r = this.host.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      for (const c of [this.base, this.fx]) { c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr); }
      this.P.setSize(this.w, this.h);
      this.dirty = true;
    }

    // ---------------------------------------------------------------- camera
    setView(ra, dec, fov) {
      if (ra != null) this.P.ra0 = A.norm360(ra);
      if (dec != null) this.P.dec0 = clamp(dec, -89.9, 89.9);
      if (fov != null) this.P.fov = clamp(fov, 1.5, 200);
      this.P.update();
      this.dirty = true;
      this.hooks.onViewChange && this.hooks.onViewChange(this.P);
    }
    zoomAt(factor, sx, sy) {
      const before = this.P.unproject(sx, sy);
      this.setView(null, null, this.P.fov * factor);
      const after = this.P.unproject(sx, sy);
      this.setView(this.P.ra0 + A.wrap180(before.ra - after.ra), this.P.dec0 + (before.dec - after.dec));
    }
    flyTo(ra, dec, fov, dur = 1100) {
      const s = { ra: this.P.ra0, dec: this.P.dec0, fov: this.P.fov };
      const dRa = A.wrap180(ra - s.ra), targetFov = fov || s.fov;
      const sep = A.angularDistance(s.ra, s.dec, ra, dec);
      // pull back a little on long hops, so the flight reads as travel across the sky
      const peak = Math.max(s.fov, targetFov, Math.min(140, sep * 1.1));
      if (reduceMotion) { this.setView(ra, dec, targetFov); return Promise.resolve(); }
      return new Promise((resolve) => {
        const t0 = performance.now();
        this.flight = (now) => {
          const t = clamp((now - t0) / dur, 0, 1), e = easeInOut(t);
          const zoomCurve = sep > s.fov * 0.6 ? Math.sin(Math.PI * t) : 0;
          const f = s.fov + (targetFov - s.fov) * e;
          this.setView(s.ra + dRa * e, s.dec + (dec - s.dec) * e, f + (peak - Math.max(f, 0)) * zoomCurve * 0.6);
          if (t >= 1) { this.flight = null; resolve(); }
        };
      });
    }

    // ---------------------------------------------------------------- input
    bindInput() {
      const el = this.host;
      const pts = new Map();
      let drag = null, pinch = null, moved = false, downAt = null;
      const local = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

      el.addEventListener('pointerdown', (e) => {
        if (e.target !== this.fx && e.target !== this.base) return;
        el.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, local(e));
        moved = false; downAt = local(e);
        this.flight = null;
        if (pts.size === 1) drag = { anchor: this.P.unproject(...downAt) };
        if (pts.size === 2) {
          const [p1, p2] = [...pts.values()];
          pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), fov: this.P.fov };
          drag = null;
        }
      });
      el.addEventListener('pointermove', (e) => {
        const p = local(e);
        if (!pts.has(e.pointerId)) {
          if (e.pointerType === 'mouse') this.hooks.onHover && this.hooks.onHover(this.hitTest(p[0], p[1]), p);
          return;
        }
        pts.set(e.pointerId, p);
        if (downAt && Math.hypot(p[0] - downAt[0], p[1] - downAt[1]) > 5) moved = true;
        if (pinch && pts.size === 2) {
          const [p1, p2] = [...pts.values()];
          const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
          this.zoomAt((pinch.fov * pinch.d / d) / this.P.fov, (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
        } else if (drag && moved) {
          el.classList.add('dragging');
          for (let i = 0; i < 2; i++) {
            const now = this.P.unproject(p[0], p[1]);
            this.setView(this.P.ra0 + A.wrap180(drag.anchor.ra - now.ra), this.P.dec0 + (drag.anchor.dec - now.dec));
          }
          this.hooks.onHover && this.hooks.onHover(null);
        }
      });
      const end = (e) => {
        if (!pts.has(e.pointerId)) return;
        const p = local(e);
        pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
        if (pts.size === 1) drag = { anchor: this.P.unproject(...[...pts.values()][0]) };
        if (pts.size === 0) {
          el.classList.remove('dragging');
          if (!moved && e.type === 'pointerup') this.click(p[0], p[1]);
          drag = null;
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', () => this.hooks.onHover && this.hooks.onHover(null));
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = local(e);
        this.flight = null;
        this.zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), x, y);
      }, { passive: false });
    }

    click(x, y) {
      const sky = this.P.unproject(x, y);
      if (this.pickMode) { this.pickMode = false; this.hooks.onPick && this.hooks.onPick(sky); return; }
      const hit = this.hitTest(x, y);
      if (hit) { this.hooks.onSelect(hit.item); return; }
      const con = A.constellationAt(sky.ra, sky.dec);
      if (con) this.hooks.onSelect({ kind: 'con', key: con });
    }

    hitTest(x, y) {
      let best = null, bd = Infinity;
      for (const h of this.hits) {
        const d = Math.hypot(h.x - x, h.y - y) - h.r;
        const lim = 9;
        if (d < lim) {
          const score = d - h.prio * 6;
          if (score < bd) { bd = score; best = h; }
        }
      }
      return best;
    }

    // ---------------------------------------------------------------- base render
    render() {
      const S = this.hooks.state();
      const ctx = this.bctx, P = this.P, w = this.w, h = this.h;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this.hits = []; this.marked = []; this.labels = []; this.ground = null;
      // chart overlays (controls, legend, field-of-view chip) are keep-out zones for labels and photo bubbles
      const hr = this.host.getBoundingClientRect();
      this.keepOut = [...this.host.querySelectorAll('.sky-hud > *, .legend')].filter((el) => el.offsetParent !== null).map((el) => {
        const r = el.getBoundingClientRect();
        return [r.left - hr.left - 4, r.top - hr.top - 4, r.right - hr.left + 4, r.bottom - hr.top + 4];
      });
      const L = S.layers, fov = P.fov, ppd = P.pxPerDeg();
      const red = this.col.red;
      this.S = S;

      if (L.mw && this.mwData) this.drawMilkyWay(ctx);
      if (L.grid) this.drawGrid(ctx);
      if (L.ecliptic) this.drawEcliptic(ctx);
      this.drawConstellations(ctx, S, L);
      this.drawStars(ctx, fov);

      const mineOnly = L.mineOnly;
      if (L.ngc) {
        const magLimit = fov > 80 ? -99 : fov > 50 ? 8.5 : fov > 30 ? 10.5 : fov > 12 ? 12.5 : 99;
        for (const o of S.dsos) {
          const mk = S.marks.get(o.key);
          if (!mk && (mineOnly || (o.mag ?? 13) > magLimit)) continue;
          if (!mk && fov > 100) continue;
          this.drawDSO(ctx, o, mk, ppd, fov < 22, 1);
        }
      }
      if (L.messier) {
        for (const o of S.messier) {
          const mk = S.marks.get(o.key);
          if (!mk && (mineOnly || fov > 110)) continue;
          // zoomed out, unrecorded Messier objects show only if they are bright and above the horizon
          if (!mk && fov > 80 && ((o.mag ?? 9) > 7 || (S.site && A.toHorizontal(o.ra, o.dec, S.jd, S.site.lat, S.site.lon).alt < 0))) continue;
          this.drawDSO(ctx, o, mk, ppd, fov < 75, 3);
        }
      }
      for (const o of S.named) {
        const mk = S.marks.get(o.key);
        const q = P.project(o.ra, o.dec);
        if (q[2] < 0.05 || q[0] < -20 || q[0] > w + 20 || q[1] < -20 || q[1] > h + 20) continue;
        const r = this.starRadius(o.mag, fov);
        this.hits.push({ x: q[0], y: q[1], r: r + 2, item: o, prio: 2 });
        if (mk) this.drawMarkRing(ctx, q[0], q[1], r + 5, mk, o);
        const showName = mk || o.mag < (fov > 120 ? 0.6 : fov > 70 ? 1.6 : fov > 35 ? 2.6 : 4.1);
        if (showName && (o.ko || (mk && o.en))) {
          this.label(ctx, o.ko || o.en, q[0] + r + 5, q[1] + 4, mk ? this.markColor(mk) : 'rgba(205,214,240,.62)', 11.5, 'left', true, false, this.isSel(o) ? 100 : mk ? 80 : o.mag < 1.5 ? 58 : 30);
        }
      }
      if (L.solar) this.drawSolar(ctx, S, fov);
      if (L.horizon && S.site) this.drawHorizon(ctx, S);
      // photos are the user's own layer: keep them above the ground shade
      if (L.photos && fov <= 150) this.drawPhotos(ctx, S, fov);
      const hint = this.hooks.hint && this.hooks.hint();
      if (hint && hint.ra != null) {
        const q = P.project(hint.ra, hint.dec);
        if (q[2] > 0.05) {
          ctx.save(); ctx.strokeStyle = hexA(this.col.seen, 0.85); ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(q[0], q[1], 16, 0, TAU); ctx.stroke(); ctx.restore();
          this.label(ctx, `오늘 밤 추천 · ${hint.id} ${hint.name}`, q[0] + 22, q[1] + 4, this.col.seen, 12.5, 'left', true, false, 96);
        }
      }
      this.flushLabels(ctx);
      if (red) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#ff2a1a'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
      this.dirty = false;
    }

    drawMilkyWay(ctx) {
      const P = this.P, k = this.flight ? 6 : 4;
      const W = Math.ceil(this.w / k), H = Math.ceil(this.h / k);
      const c = this.mwCanvas;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.mwImg = c.getContext('2d').createImageData(W, H); }
      const img = this.mwImg, d = img.data, mw = this.mwData, MW = this.mwW, MH = this.mwH;
      let i = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i += 4) {
          const s = P.unproject(x * k + k / 2, y * k + k / 2);
          const fx = s.ra / 360 * MW - 0.5, fy = (90 - s.dec) / 180 * MH - 0.5;
          const x0 = Math.floor(fx), y0 = clamp(Math.floor(fy), 0, MH - 1), y1 = Math.min(MH - 1, y0 + 1);
          const tx = fx - x0, ty = fy - Math.floor(fy);
          const xa = (x0 + MW) % MW, xb = (x0 + 1) % MW;
          const v = (mw[y0 * MW + xa] * (1 - tx) + mw[y0 * MW + xb] * tx) * (1 - ty) + (mw[y1 * MW + xa] * (1 - tx) + mw[y1 * MW + xb] * tx) * ty;
          d[i] = 150; d[i + 1] = 172; d[i + 2] = 255; d[i + 3] = v * 0.30;
        }
      }
      c.getContext('2d').putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(c, 0, 0, W * k, H * k);
      ctx.restore();
    }

    polyline(ctx, pts, closed) {
      const P = this.P;
      let pen = false, last = null;
      ctx.beginPath();
      const n = pts.length + (closed ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const p = pts[i % pts.length];
        const q = P.project(p[0], p[1]);
        if (q[2] < -0.15 || (last && Math.hypot(q[0] - last[0], q[1] - last[1]) > this.w * 1.5)) { pen = false; last = null; continue; }
        if (pen) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); pen = true; }
        last = q;
      }
      ctx.stroke();
    }

    drawGrid(ctx) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,140,200,.13)'; ctx.lineWidth = 1;
      const stepDec = this.P.fov > 60 ? 30 : this.P.fov > 20 ? 10 : 5, stepRa = this.P.fov > 60 ? 30 : this.P.fov > 20 ? 15 : 5;
      for (let dec = -90 + stepDec; dec < 90; dec += stepDec) {
        const pts = []; for (let ra = 0; ra <= 360; ra += 2) pts.push([ra, dec]);
        this.polyline(ctx, pts, false);
      }
      for (let ra = 0; ra < 360; ra += stepRa) {
        const pts = []; for (let dec = -88; dec <= 88; dec += 2) pts.push([ra, dec]);
        this.polyline(ctx, pts, false);
      }
      ctx.restore();
    }

    drawEcliptic(ctx) {
      if (!this.eclipticPts) {
        this.eclipticPts = [];
        for (let l = 0; l <= 360; l += 2) { const e = A.eclipticLonLatToEquatorial(l, 0); this.eclipticPts.push([e.ra, e.dec]); }
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(246,199,110,.22)'; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
      this.polyline(ctx, this.eclipticPts, false);
      ctx.restore();
    }

    drawConstellations(ctx, S, L) {
      const P = this.P, fov = P.fov;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // claimed constellations: a soft glow around the figure — the "fog lifting" layer
      for (const [id, lvl] of S.conMarks) {
        const f = FIGURES[id];
        if (!f) continue;
        const q = P.project(f.ra, f.dec);
        if (q[2] < 0) continue;
        const R = Math.max(30, f.r * P.pxPerDeg() * 1.15);
        const a = lvl.level === 2 ? 0.16 : 0.07;
        const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
        g.addColorStop(0, hexA(lvl.color, a)); g.addColorStop(0.55, hexA(lvl.color, a * 0.45)); g.addColorStop(1, hexA(lvl.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(q[0], q[1], R, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (L.bounds && fov <= 75) {
        ctx.strokeStyle = 'rgba(130,150,210,.13)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        for (const id in C.bounds) for (const ring of C.bounds[id]) this.polyline(ctx, ring, true);
        ctx.setLineDash([]);
      }
      const sel = this.hooks.selected && this.hooks.selected();
      if (sel && sel.kind === 'con' && C.bounds[sel.key]) {
        ctx.strokeStyle = 'rgba(255,236,190,.45)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
        for (const ring of C.bounds[sel.key]) this.polyline(ctx, ring, true);
        ctx.setLineDash([]);
      }
      if (L.lines) {
        for (const id in C.lines) {
          const lvl = S.conMarks.get(id);
          if (lvl) {
            ctx.lineCap = 'round';
            // claimed figures stay quieter than the objects; the selected one is at full strength
            const on = sel && sel.kind === 'con' && sel.key === id;
            ctx.strokeStyle = hexA(lvl.color, on ? 0.16 : lvl.level === 2 ? 0.07 : 0.04); ctx.lineWidth = on ? 6 : 4;
            for (const seg of C.lines[id]) this.polyline(ctx, seg, false);
            ctx.strokeStyle = hexA(lvl.color, on ? 0.95 : lvl.level === 2 ? 0.6 : 0.36); ctx.lineWidth = on ? 1.8 : 1.25;
          } else {
            ctx.strokeStyle = fov > 80 ? 'rgba(140,165,230,.16)' : 'rgba(140,165,230,.22)'; ctx.lineWidth = fov > 120 ? 0.7 : 1;
          }
          for (const seg of C.lines[id]) this.polyline(ctx, seg, false);
        }
      }
      if (L.conNames) {
        for (const id in C.cons) {
          const c = C.cons[id];
          if (!S.conMarks.get(id) && ((fov > 110 && c.rank > 1) || (fov > 70 && c.rank > 2))) continue;
          const q = P.project(c.c[0], c.c[1]);
          if (q[2] < 0.1 || q[0] < 0 || q[0] > this.w || q[1] < 0 || q[1] > this.h) continue;
          const lvl = S.conMarks.get(id);
          const color = lvl ? hexA(lvl.color, 0.95) : 'rgba(165,182,232,.66)';
          const size = fov > 120 ? 11 : 12.5;
          this.label(ctx, c.ko, q[0], q[1], color, size, 'center', true, false, this.isSel({ key: id }) ? 100 : lvl ? 76 : 50 - c.rank);
          this.hits.push({ x: q[0], y: q[1], r: 14, item: { kind: 'con', key: id }, prio: 0 });
        }
      }
      ctx.restore();
    }

    starRadius(mag, fov) {
      const z = clamp(Math.sqrt(90 / fov), 0.75, 2.1);
      return clamp((6.4 - mag) * 0.52 * z, 0.45, 7.5);
    }

    drawStars(ctx, fov) {
      const P = this.P, w = this.w, h = this.h, S = C.stars;
      const limit = fov > 150 ? 4.6 : fov > 90 ? 5.4 : 6.5;
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        if (s[2] > limit) continue;
        const q = P.project(s[0], s[1]);
        if (q[2] < 0 || q[0] < -10 || q[0] > w + 10 || q[1] < -10 || q[1] > h + 10) continue;
        const r = this.starRadius(s[2], fov);
        if (s[2] < 1.6) {
          const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * 4);
          g.addColorStop(0, STAR_COLORS[i].replace('rgb', 'rgba').replace(')', ',.38)'));
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(q[0], q[1], r * 4, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = STAR_COLORS[i];
        ctx.globalAlpha = clamp(1.25 - s[2] / 7.5, 0.35, 1);
        ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    markColor(mk) {
      if (this.S && this.S.mode === 'both') {
        if (mk.who.a && mk.who.b) return '#F3EEFF';
        return mk.who.a ? this.col.a : this.col.b;
      }
      return mk.photo ? this.col.photo : mk.seen ? this.col.seen : this.col.known;
    }
    markStatuses(mk) {
      // in "both" mode the badge ring shows who, not how
      if (this.S && this.S.mode === 'both') return [mk.who.a && this.col.a, mk.who.b && this.col.b].filter(Boolean);
      const out = [];
      if (mk.seen) out.push(this.col.seen);
      if (mk.photo) out.push(this.col.photo);
      if (mk.identified) out.push(this.col.known);
      return out;
    }

    drawMarkRing(ctx, x, y, r, mk, item) {
      const col = this.markColor(mk);
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.4);
      g.addColorStop(0, hexA(col, 0.35)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
      // one arc per status — a tiny "badge ring"
      const st = this.markStatuses(mk);
      ctx.lineWidth = 1.8;
      const gap = st.length > 1 ? 0.35 : 0;
      st.forEach((c, i) => {
        const a0 = -Math.PI / 2 + (TAU / st.length) * i + gap / 2, a1 = a0 + TAU / st.length - gap;
        ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
      });
      this.marked.push({ x, y, r, col, item });
    }

    drawDSO(ctx, o, mk, ppd, showLabel, prio) {
      const P = this.P;
      const q = P.project(o.ra, o.dec);
      if (q[2] < 0.02 || q[0] < -40 || q[0] > this.w + 40 || q[1] < -40 || q[1] > this.h + 40) return;
      const [a, b] = parseDim(o.dim);
      const minR = prio === 3 ? 4.2 : 3;
      const cap = mk || prio === 3 ? 60 : 12;
      const rx = clamp(a / 120 * ppd, minR, cap), ry = clamp(b / 120 * ppd, minR * 0.6, cap);
      const col = mk ? this.markColor(mk) : prio === 3 ? 'rgba(204,194,245,.78)' : 'rgba(150,160,200,.30)';
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = mk ? 1.6 : prio === 3 ? 1.1 : this.P.fov > 60 ? 0.7 : 1;
      if (mk) {
        const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], Math.max(rx, 6) * 2.6);
        g.addColorStop(0, hexA(this.markColor(mk), 0.42)); g.addColorStop(1, hexA(this.markColor(mk), 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(rx, 6) * 2.6, 0, TAU); ctx.fill();
      }
      const t = o.t;
      ctx.beginPath();
      if (GALAXY[t]) {
        ctx.ellipse(q[0], q[1], rx, Math.max(ry * (rx > minR ? 1 : 0.55), 2), -0.5, 0, TAU);
      } else if (t === 'gc') {
        ctx.arc(q[0], q[1], rx, 0, TAU);
        ctx.moveTo(q[0] - rx, q[1]); ctx.lineTo(q[0] + rx, q[1]); ctx.moveTo(q[0], q[1] - rx); ctx.lineTo(q[0], q[1] + rx);
      } else if (t === 'oc' || t === 'pos') {
        ctx.setLineDash([2, 2.5]); ctx.arc(q[0], q[1], rx, 0, TAU);
      } else if (t === 'pn') {
        ctx.arc(q[0], q[1], rx * 0.6, 0, TAU);
        for (let k = 0; k < 4; k++) { const an = k * Math.PI / 2; ctx.moveTo(q[0] + Math.cos(an) * rx * 0.6, q[1] + Math.sin(an) * rx * 0.6); ctx.lineTo(q[0] + Math.cos(an) * rx * 1.15, q[1] + Math.sin(an) * rx * 1.15); }
      } else if (t === 'snr') {
        ctx.setLineDash([1, 2]); ctx.arc(q[0], q[1], rx, 0, TAU);
      } else if (NEBULA[t]) {
        if (t === 'dn' || !mk) ctx.setLineDash([1.5, 2.5]);
        // nebulae: a soft diamond, so they never read as an empty UI box
        const s = Math.max(rx, ry) * 1.15;
        ctx.moveTo(q[0], q[1] - s); ctx.lineTo(q[0] + s, q[1]); ctx.lineTo(q[0], q[1] + s); ctx.lineTo(q[0] - s, q[1]); ctx.closePath();
      } else {
        ctx.arc(q[0], q[1], rx, 0, TAU);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (mk) {
        const st = this.markStatuses(mk);
        st.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(q[0] - (st.length - 1) * 3.5 + i * 7, q[1] + Math.max(ry, rx) + 6, 2.2, 0, TAU); ctx.fill();
        });
        this.marked.push({ x: q[0], y: q[1], r: Math.max(rx, 6), col: this.markColor(mk), item: o });
      }
      ctx.restore();
      if (showLabel || mk) {
        const txt = prio === 3 ? o.id : o.m ? o.m : o.id;
        this.label(ctx, txt, q[0] + rx + 4, q[1] - rx * 0.3 - 2, mk ? this.markColor(mk) : prio === 3 ? 'rgba(206,196,245,.82)' : 'rgba(170,178,215,.55)', prio === 3 ? 11.5 : 10.5, 'left', true, true, this.isSel(o) ? 100 : mk ? 82 : prio === 3 ? 42 - (o.mag || 9) : 14);
      }
      this.hits.push({ x: q[0], y: q[1], r: Math.max(rx, 5), item: o, prio });
    }

    drawPhotos(ctx, S, fov) {
      this.photoBoxes = [];
      // photos stay small and quiet; the selected object's photo opens up. They step aside during a celebration.
      if (performance.now() < (this.celebrateUntil || 0)) return;
      const sel = this.hooks.selected && this.hooks.selected();
      const DIRS = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
      for (const [key, img] of S.thumbs) {
        const o = S.lookup(key);
        if (!o || o.ra == null || !img.complete || !img.naturalWidth) continue;
        const q = this.P.project(o.ra, o.dec);
        if (q[2] < 0.1) continue;
        const isSel = sel && sel.key === o.key;
        const R = isSel ? 16 : 9, M = 12;
        const below = S.site && A.toHorizontal(o.ra, o.dec, S.jd, S.site.lat, S.site.lon).alt < 0;
        // pick the diagonal with the fewest objects and labels under the bubble
        let best = null;
        for (const [dx, dy] of DIRS) {
          const x = q[0] + dx * (R * 1.2 + 26), y = q[1] + dy * (R * 1.2 + 26);
          if (x < R + M || x > this.w - R - M || y < R + M || y > this.h - R - M) continue;
          let cost = 0;
          for (const h of this.hits) if (Math.hypot(h.x - x, h.y - y) < R + 10) cost += h.prio + 1;
          for (const L of this.labels) if (Math.abs(L.x - x) < R + 30 && Math.abs(L.y - y) < R + 8) cost += L.prio / 10;
          for (const b of this.photoBoxes) if (Math.hypot(b.x - x, b.y - y) < R * 2.2) cost += 50;
          for (const k of this.keepOut) if (x + R > k[0] && x - R < k[2] && y + R > k[1] && y - R < k[3]) cost += 1000;
          if (!best || cost < best.cost) best = { x, y, dx, dy, cost };
        }
        if (!best || best.cost >= 1000) continue;
        const { x, y, dx, dy } = best;
        this.photoBoxes.push({ x, y, r: R });
        ctx.save();
        ctx.globalAlpha = isSel ? (below ? 0.45 : 1) : below ? 0.3 : 0.8;
        if (below && 'filter' in ctx) ctx.filter = 'saturate(35%)';
        ctx.strokeStyle = 'rgba(210,218,240,.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(q[0] + dx * 7, q[1] + dy * 7); ctx.lineTo(x - dx * R * 0.72, y - dy * R * 0.72); ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.closePath();
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6;
        ctx.fillStyle = '#000'; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.clip();
        const s = Math.max(R * 2 / img.naturalWidth, R * 2 / img.naturalHeight);
        ctx.drawImage(img, x - img.naturalWidth * s / 2, y - img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
        ctx.restore();
        // a neutral frame: photos are keepsakes, not status marks, and must never outshine the selection
        ctx.strokeStyle = isSel ? 'rgba(235,240,255,.85)' : 'rgba(210,218,240,.55)'; ctx.lineWidth = isSel ? 1.4 : 1;
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
        this.hits.push({ x, y, r: R, item: o, prio: 4 });
      }
      // photographed but no picture uploaded yet: an empty dashed frame waiting for one
      if (S.mode === 'both') return;
      for (const [key, mk] of S.marks) {
        if (!mk.photo || S.thumbs.has(key)) continue;
        const o = S.lookup(key);
        if (!o || o.ra == null) continue;
        const q = this.P.project(o.ra, o.dec);
        if (q[2] < 0.1 || q[0] < 20 || q[0] > this.w - 20 || q[1] < 20 || q[1] > this.h - 20) continue;
        const x = q[0] + 16, y = q[1] - 16;
        ctx.save();
        ctx.strokeStyle = hexA(this.col.photo, 0.7); ctx.lineWidth = 1.1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = hexA(this.col.photo, 0.85);
        ctx.fillRect(x - 3.2, y - 1.6, 6.4, 4.2); ctx.fillRect(x - 1.2, y - 2.8, 2.4, 1.4);
        ctx.restore();
      }
    }

    drawSolar(ctx, S, fov) {
      const P = this.P;
      // logged positions of moving targets, linked by date
      for (const trail of S.trails) {
        const pts = trail.points.map((p) => [P.project(p.ra, p.dec), p]).filter(([q]) => q[2] > 0);
        if (!pts.length) continue;
        ctx.save();
        ctx.strokeStyle = hexA(trail.color, 0.45); ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath();
        pts.forEach(([q], i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.stroke(); ctx.setLineDash([]);
        for (const [q, p] of pts) {
          ctx.fillStyle = hexA(p.color, 0.95);
          ctx.beginPath(); ctx.arc(q[0], q[1], 3.2, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(6,9,20,.9)'; ctx.lineWidth = 1; ctx.stroke();
          if (fov < 75) this.label(ctx, p.label, q[0] + 6, q[1] + 12, hexA(p.color, 0.85), 10.5, 'left', true, true, 34);
          this.hits.push({ x: q[0], y: q[1], r: 4, item: trail.item, prio: 3 });
        }
        ctx.restore();
      }
      for (const b of S.bodies) {
        const q = P.project(b.ra, b.dec);
        if (q[2] < 0.02 || q[0] < -30 || q[0] > this.w + 30 || q[1] < -30 || q[1] > this.h + 30) continue;
        const mk = S.marks.get(b.key);
        const r = b.kind === 'moon' ? clamp(0.26 * P.pxPerDeg(), 6, 60) : b.key === 'sun' ? clamp(0.27 * P.pxPerDeg(), 7, 60) : b.r || 4.5;
        ctx.save();
        if (b.kind === 'comet' && b.sunRa != null) {
          // tail points away from the Sun
          const qs = P.project(b.sunRa, b.sunDec);
          const ang = Math.atan2(q[1] - qs[1], q[0] - qs[0]);
          const len = clamp(2.2 * P.pxPerDeg() / Math.max(0.3, b.helioDist || 1), 18, 160);
          const g = ctx.createLinearGradient(q[0], q[1], q[0] + Math.cos(ang) * len, q[1] + Math.sin(ang) * len);
          g.addColorStop(0, 'rgba(170,240,225,.55)'); g.addColorStop(1, 'rgba(170,240,225,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(q[0] + Math.cos(ang + Math.PI / 2) * 3, q[1] + Math.sin(ang + Math.PI / 2) * 3);
          ctx.lineTo(q[0] + Math.cos(ang + 0.12) * len, q[1] + Math.sin(ang + 0.12) * len);
          ctx.lineTo(q[0] + Math.cos(ang - 0.12) * len, q[1] + Math.sin(ang - 0.12) * len);
          ctx.lineTo(q[0] + Math.cos(ang - Math.PI / 2) * 3, q[1] + Math.sin(ang - Math.PI / 2) * 3);
          ctx.fill();
        }
        const glow = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r * 3.2);
        glow.addColorStop(0, hexA(b.color, 0.5)); glow.addColorStop(1, hexA(b.color, 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(q[0], q[1], r * 3.2, 0, TAU); ctx.fill();
        if (b.kind === 'moon' && b.illum != null) {
          // dark disc, then the lit part: a half disc on the sunward side plus/minus a terminator ellipse.
          // West is to the right on this chart, so a waxing Moon is lit on the right.
          ctx.fillStyle = 'rgb(38,44,66)'; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.fill();
          const right = b.waxing, gibbous = b.illum > 0.5;
          ctx.fillStyle = b.color; ctx.beginPath();
          ctx.arc(q[0], q[1], r, -Math.PI / 2, Math.PI / 2, !right);
          ctx.ellipse(q[0], q[1], Math.abs(1 - 2 * b.illum) * r, r, 0, Math.PI / 2, -Math.PI / 2 + (gibbous === right ? TAU : 0), gibbous !== right);
          ctx.fill();
        } else {
          ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.fill();
        }
        if (b.key === 'sat') { ctx.strokeStyle = b.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(q[0], q[1], r * 2.1, r * 0.7, -0.35, 0, TAU); ctx.stroke(); }
        ctx.restore();
        if (mk) this.drawMarkRing(ctx, q[0], q[1], r + 5, mk, b);
        this.label(ctx, b.name, q[0] + r + 6, q[1] + 4, mk ? this.markColor(mk) : hexA(b.color, 0.95), 12, 'left', true, false, this.isSel(b) ? 100 : 88);
        if (b.key !== 'sun') this.hits.push({ x: q[0], y: q[1], r: r + 2, item: b, prio: 5 });
      }
    }

    drawHorizon(ctx, S) {
      const P = this.P, { lat, lon } = S.site;
      const pts = [];
      for (let az = 0; az <= 360; az += 2) { const s = A.fromHorizontal(az, 0, S.jd, lat, lon); pts.push([s.ra, s.dec]); }
      // the horizon is a great circle; under stereographic projection it is a circle on screen
      const proj = pts.map((p) => P.project(p[0], p[1])).filter((q) => q[2] > -0.6);
      if (proj.length > 6) {
        const [p1, p2, p3] = [proj[0], proj[Math.floor(proj.length / 3)], proj[Math.floor(proj.length * 2 / 3)]];
        const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(d) > 1e-6) {
          const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
          const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
          const R = Math.hypot(ax - ux, ay - uy);
          const zen = A.fromHorizontal(0, 90, S.jd, lat, lon), zq = P.project(zen.ra, zen.dec);
          const zenithInside = zq[2] > -0.9 ? Math.hypot(zq[0] - ux, zq[1] - uy) < R : false;
          ctx.save();
          ctx.beginPath();
          if (zenithInside) { ctx.rect(0, 0, this.w, this.h); ctx.arc(ux, uy, R, 0, TAU, true); }
          else ctx.arc(ux, uy, R, 0, TAU);
          this.ground = { ux, uy, R, zenithInside };
          ctx.fillStyle = 'rgba(2,4,5,.8)';
          ctx.fill('evenodd');
          ctx.restore();
        }
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(140,200,160,.45)'; ctx.lineWidth = 1.4;
      this.polyline(ctx, pts, false);
      ctx.restore();
      const names = [['북', 0], ['북동', 45], ['동', 90], ['남동', 135], ['남', 180], ['남서', 225], ['서', 270], ['북서', 315]];
      for (const [n, az] of names) {
        const s = A.fromHorizontal(az, 1.5, S.jd, lat, lon), q = P.project(s.ra, s.dec);
        if (q[2] < 0.05 || q[0] < 0 || q[0] > this.w || q[1] < 0 || q[1] > this.h) continue;
        this.label(ctx, n, q[0], q[1], n.length === 1 ? 'rgba(185,240,200,1)' : 'rgba(165,215,180,.7)', n.length === 1 ? 13 : 11, 'center', true, false, n.length === 1 ? 66 : 24);
      }
    }

    isSel(o) { const s = this.hooks.selected && this.hooks.selected(); return !!(s && o && s.key === o.key); }

    // Labels are queued during a render and placed afterwards, highest priority first; a label that would
    // overlap one already placed, or poke out of the chart, is dropped.
    label(ctx, text, x, y, color, size, align, halo, mono, prio = 10) {
      this.labels.push({ text, x, y, color, size, align: align || 'left', halo: halo !== false, mono, prio });
    }
    flushLabels(ctx) {
      const placed = [...this.keepOut];
      if (this.burst && performance.now() < this.celebrateUntil) {
        const q = this.P.project(this.burst.ra, this.burst.dec);
        if (q[2] > 0) placed.push([q[0] - this.burst.r, q[1] - this.burst.r, q[0] + this.burst.r, q[1] + this.burst.r]);
      }
      // every drawn symbol is solid for point labels; constellation names (centred, haloed) only avoid other labels
      const solid = [];
      for (const h of this.hits) if (h.prio >= 1 && h.prio !== 4) { const r = Math.min(h.r, 7) * 0.9; solid.push([h.x - r, h.y - r, h.x + r, h.y + r]); }
      for (const m of this.marked) solid.push([m.x - m.r * 0.8, m.y - m.r * 0.8, m.x + m.r * 0.8, m.y + m.r * 0.8]);
      const G = this.ground;
      const underground = (x, y) => G && ((Math.hypot(x - G.ux, y - G.uy) < G.R) !== G.zenithInside);

      for (const b of this.photoBoxes || []) placed.push([b.x - b.r - 2, b.y - b.r - 2, b.x + b.r + 2, b.y + b.r + 2]);
      // keep the selection reticle clear; the selected object's own label sits just outside it
      const sel = this.hooks.selected && this.hooks.selected();
      if (sel && sel.ra != null) {
        const q = this.P.project(sel.ra, sel.dec);
        if (q[2] > 0.05) {
          placed.push([q[0] - 26, q[1] - 26, q[0] + 26, q[1] + 26]);
          let one = false;
          const busy = performance.now() < (this.celebrateUntil || 0);
          for (const L of this.labels) if (L.prio === 100) {
            if (one || busy) { L.prio = -1; continue; }
            one = true;
            Object.assign(L, { x: q[0], y: q[1] - 33, align: 'center', pill: true, size: 12.5, color: '#FFF1D2' });
          }
        }
      }
      const pad = 2, w = this.w, h = this.h;
      this.labels.sort((a, b) => b.prio - a.prio);
      for (const L of this.labels) {
        ctx.font = `500 ${L.size}px ${L.mono ? '"IBM Plex Mono", ui-monospace, monospace' : '"IBM Plex Sans KR", "Apple SD Gothic Neo", sans-serif'}`;
        const tw = ctx.measureText(L.text).width;
        const x0 = L.align === 'center' ? L.x - tw / 2 : L.x, y0 = L.y - L.size * 0.85;
        const box = [x0 - pad, y0 - pad, x0 + tw + pad, y0 + L.size * 1.1 + pad];
        if (box[0] < 12 || box[2] > w - 12 || box[1] < 8 || box[3] > h - 8) continue;
        let hit = (b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1];
        if (!L.pill) {
          // try the label where it was asked for, then nudged below/above; drop it if all three collide
          let ok = false;
          for (const dy of L.align === 'center' ? [0, 15, -15] : [0, 11, -11]) {
            const bb = [box[0], box[1] + dy, box[2], box[3] + dy];
            const h2 = (b) => bb[0] < b[2] && bb[2] > b[0] && bb[1] < b[3] && bb[3] > b[1];
            if (!placed.some(h2) && !solid.some(h2)) { box[1] = bb[1]; box[3] = bb[3]; L.y += dy; ok = true; break; }
          }
          if (!ok) continue;
        } else {
          box[0] -= 10; box[1] -= 6; box[2] += 10; box[3] += 6;
        }
        ctx.globalAlpha = L.prio < 90 && underground(L.x, L.y) ? 0.42 : 1;
        placed.push(box);
        ctx.textAlign = L.align;
        if (L.prio < 0) continue;
        if (L.pill) {
          ctx.fillStyle = 'rgba(12,18,34,.9)'; ctx.strokeStyle = 'rgba(255,236,190,.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(box[0] - 7, box[1] - 3, box[2] - box[0] + 14, box[3] - box[1] + 6, 9); ctx.fill(); ctx.stroke();
          ctx.fillStyle = L.color; ctx.fillText(L.text, L.x, L.y);
          continue;
        }
        if (L.halo) { ctx.lineWidth = L.align === 'center' ? 4.5 : 3.5; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,8,18,.82)'; ctx.strokeText(L.text, L.x, L.y); }
        ctx.fillStyle = L.color; ctx.fillText(L.text, L.x, L.y);
      }
      ctx.globalAlpha = 1;
      this.labels = [];
    }

    // ---------------------------------------------------------------- fx loop
    loop(now) {
      requestAnimationFrame(this.loop);
      if (this.flight) this.flight(now);
      if (this.dirty) this.render();
      const ctx = this.fctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      if (!reduceMotion) this.drawBreathing(ctx, now);
      this.drawReticle(ctx, now);
      this.drawHint(ctx, now);
      this.effects = this.effects.filter((e) => e.draw(ctx, now) !== false);
    }

    drawBreathing(ctx, now) {
      if (this.marked.length > 400) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.marked.length; i++) {
        const m = this.marked[i];
        const ph = (now / 1000) * 1.6 + i * 1.7;
        const a = 0.10 + 0.10 * Math.sin(ph);
        const R = m.r * (2.1 + 0.25 * Math.sin(ph));
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, R);
        g.addColorStop(0, hexA(m.col, a)); g.addColorStop(1, hexA(m.col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, R, 0, TAU); ctx.fill();
        // a glint that travels around the ring now and then
        const gl = (now / 1000 + i * 0.37) % 4.5;
        if (gl < 1) {
          const an = gl * TAU - Math.PI / 2;
          ctx.fillStyle = hexA('#FFFFFF', 0.75 * Math.sin(gl * Math.PI));
          ctx.beginPath(); ctx.arc(m.x + Math.cos(an) * (m.r + 4), m.y + Math.sin(an) * (m.r + 4), 1.4, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }

    drawReticle(ctx, now) {
      const sel = this.hooks.selected && this.hooks.selected();
      if (!sel || sel.ra == null) return;
      const q = this.P.project(sel.ra, sel.dec);
      if (q[2] < 0.05) return;
      const t = now / 1000;
      const R = 18 + Math.sin(t * 2.4) * 1.5;
      const mk = this.S && this.S.marks.get(sel.key);
      const col = mk ? this.markColor(mk) : '#FFECBE';
      ctx.save();
      ctx.translate(q[0], q[1]);
      const halo = ctx.createRadialGradient(0, 0, R - 6, 0, 0, R + 14);
      halo.addColorStop(0, hexA(col, 0)); halo.addColorStop(0.45, hexA(col, 0.22)); halo.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, R + 14, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexA(col, 0.95); ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
      // a small orbiting spark marks it as "selected" without dashes that could read as a glyph
      ctx.fillStyle = '#FFF6E2';
      ctx.beginPath(); ctx.arc(Math.cos(t * 1.4) * R, Math.sin(t * 1.4) * R, 2.2, 0, TAU); ctx.fill();
      ctx.restore();
    }

    drawHint(ctx, now) {
      const h = this.hooks.hint && this.hooks.hint();
      if (!h || h.ra == null) return;
      const q = this.P.project(h.ra, h.dec);
      if (q[2] < 0.05) return;
      const t = (now / 1000) % 2;
      ctx.save();
      for (const k of [0, 1]) {
        const tt = (t + k) % 2 / 2;
        ctx.strokeStyle = hexA(this.col.seen, 0.95 * (1 - tt));
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(q[0], q[1], 10 + tt * 30, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- celebrations
    /* opts: { ra, dec, colors: [...], conId, big, title } */
    celebrate(opts) {
      if (opts.title) {
        const t1 = performance.now();
        // the rising title replaces the selection pill until it fades
        this.celebrateUntil = t1 + 2600; this.dirty = true;
        setTimeout(() => { this.dirty = true; }, 2650);
        this.effects.push({
          draw: (ctx, now) => {
            const t = (now - t1) / 1000;
            if (t > 2.6) return false;
            const q = this.P.project(opts.ra, opts.dec);
            const e = easeOutCubic(Math.min(1, t / 0.7));
            const a = t < 2 ? 1 : 1 - (t - 2) / 0.6;
            const y = q[1] - 40 - e * (opts.big ? 170 : opts.conId ? 160 : 110);
            ctx.save();
            ctx.globalAlpha = a * Math.min(1, t / 0.2);
            ctx.font = '600 15px "IBM Plex Sans KR", sans-serif'; ctx.textAlign = 'center';
            const tw = ctx.measureText(opts.title).width;
            const sc = 0.85 + 0.15 * easeOutCubic(Math.min(1, t / 0.35)) + (t < 0.35 ? 0.12 * Math.sin(t / 0.35 * Math.PI) : 0);
            ctx.translate(q[0], y); ctx.scale(sc, sc);
            ctx.shadowColor = hexA(opts.colors?.[0] || this.col.seen, 0.8); ctx.shadowBlur = 22;
            ctx.fillStyle = 'rgba(12,18,34,.92)';
            ctx.beginPath(); ctx.roundRect(-tw / 2 - 16, -22, tw + 32, 34, 17); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = hexA(opts.colors?.[0] || this.col.seen, 0.9); ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = '#FFF6E2'; ctx.fillText(opts.title, 0, 0);
            ctx.restore();
          },
        });
      }
      const P = this.P, t0 = performance.now();
      const colors = opts.colors && opts.colors.length ? opts.colors : [this.col.seen];
      const pos = () => P.project(opts.ra, opts.dec);
      const small = opts.scale === 'small';
      this.burst = { ra: opts.ra, dec: opts.dec, r: small ? 60 : opts.big || opts.conId ? 130 : 100 };
      this.celebrateUntil = Math.max(this.celebrateUntil || 0, t0 + 2600); this.dirty = true;
      setTimeout(() => { this.dirty = true; }, 2650);
      const n = reduceMotion ? 0 : opts.big ? 110 : small ? 26 : opts.conId ? 90 : 64;
      const parts = [];
      for (let i = 0; i < n; i++) {
        const an = small ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6 : Math.random() * TAU;
        const sp = small ? 120 + Math.random() * 160 : 160 + Math.random() * (opts.big ? 480 : opts.conId ? 420 : 340);
        parts.push({ an, sp, life: 0.9 + Math.random() * 1.1, size: 1 + Math.random() * 2.4, col: colors[i % colors.length], spark: Math.random() < 0.22, spin: (Math.random() - 0.5) * 8 });
      }
      // shockwave rings + particles + bloom
      this.effects.push({
        draw: (ctx, now) => {
          const t = (now - t0) / 1000;
          if (t > 2.4) return false;
          const q = pos();
          if (!small && t < 1.4) {
            // a brief dimming of the whole sky puts the moment in focus
            ctx.fillStyle = `rgba(3,5,12,${0.36 * Math.sin(Math.PI * t / 1.4)})`;
            ctx.fillRect(0, 0, this.w, this.h);
          }
          if (small && t < 1.6) {
            const k = easeOutCubic(Math.min(1, t / 1.2)), a = t < 1.1 ? 1 : 1 - (t - 1.1) / 0.5;
            const y = q[1] - 14 - k * 56;
            ctx.save(); ctx.globalAlpha = a;
            ctx.shadowColor = colors[0]; ctx.shadowBlur = 16;
            ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.arc(q[0], y, 12, 0, TAU); ctx.fill();
            ctx.shadowBlur = 0; ctx.fillStyle = '#0B0F1C';
            ctx.fillRect(q[0] - 6, y - 3, 12, 8); ctx.fillRect(q[0] - 2.5, y - 5.5, 5, 3);
            ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.arc(q[0], y + 1, 2.4, 0, TAU); ctx.fill();
            ctx.restore();
          }
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          if (t < 0.5) {
            const b = 1 - t / 0.5, R = 30 + 90 * easeOutCubic(t / 0.5);
            const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], R);
            g.addColorStop(0, `rgba(255,248,225,${0.85 * b})`); g.addColorStop(0.35, hexA(colors[0], 0.45 * b)); g.addColorStop(1, hexA(colors[0], 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], R, 0, TAU); ctx.fill();
          }
          for (let k = 0; k < (small ? 1 : 2); k++) {
            const tk = t - k * 0.22;
            if (tk < 0 || tk > 1.1) continue;
            const e = easeOutCubic(tk / 1.1);
            ctx.strokeStyle = hexA(colors[k % colors.length], 0.9 * (1 - e));
            ctx.lineWidth = 3.2 * (1 - e) + 0.4;
            ctx.beginPath(); ctx.arc(q[0], q[1], 10 + e * (opts.big ? 170 : small ? 55 : opts.conId ? 140 : 110), 0, TAU); ctx.stroke();
          }
          for (const p of parts) {
            if (t > p.life) continue;
            const k = t / p.life;
            const dist = p.sp * (1 - Math.exp(-3.2 * t)) / 3.2;
            const x = q[0] + Math.cos(p.an) * dist, y = q[1] + Math.sin(p.an) * dist + 18 * t * t;
            const a = (1 - k) * (0.6 + 0.4 * Math.sin(t * 30 + p.an * 10));
            ctx.fillStyle = hexA(p.col, a);
            if (p.spark) {
              const s = p.size * 2.6;
              ctx.save(); ctx.translate(x, y); ctx.rotate(t * p.spin);
              ctx.beginPath();
              ctx.moveTo(0, -s); ctx.quadraticCurveTo(0, 0, s, 0); ctx.quadraticCurveTo(0, 0, 0, s); ctx.quadraticCurveTo(0, 0, -s, 0); ctx.quadraticCurveTo(0, 0, 0, -s);
              ctx.fill(); ctx.restore();
            } else {
              ctx.beginPath(); ctx.arc(x, y, p.size * (1 - k * 0.5), 0, TAU); ctx.fill();
            }
          }
          ctx.restore();
        },
      });
      if (opts.conId) this.constellationSweep(opts.conId, colors[0]);
      if (opts.big && !reduceMotion) this.meteorShower(colors);
    }

    constellationSweep(id, color) {
      const segs = (C.lines[id] || []).flatMap((line) => line.slice(1).map((p, i) => [line[i], p]));
      const t0 = performance.now(), dur = reduceMotion ? 1 : 1500;
      this.effects.push({
        draw: (ctx, now) => {
          const t = (now - t0) / dur;
          if (t > 2) return false;
          const P = this.P;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const f = FIGURES[id];
          if (f) {
            const fq = P.project(f.ra, f.dec);
            const glowA = t < 0.4 ? 0.3 * (t / 0.4) : 0.3 * Math.max(0, 1 - (t - 0.4) / 1.4);
            const R = Math.max(40, f.r * P.pxPerDeg() * 1.2) * (0.6 + 0.4 * easeOutCubic(Math.min(1, t)));
            const g = ctx.createRadialGradient(fq[0], fq[1], 0, fq[0], fq[1], R);
            g.addColorStop(0, hexA(color, glowA)); g.addColorStop(1, hexA(color, 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fq[0], fq[1], R, 0, TAU); ctx.fill();
          }
          const fade = t < 1 ? 1 : Math.max(0, 1 - (t - 1));
          ctx.strokeStyle = hexA(color, 0.95 * fade); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
          ctx.shadowColor = color; ctx.shadowBlur = 12;
          const per = 1 / Math.max(1, segs.length);
          segs.forEach(([p1, p2], i) => {
            const local = clamp((t - i * per * 0.7) / (per * 2.2), 0, 1);
            if (local <= 0) return;
            const a = P.project(p1[0], p1[1]), b = P.project(p2[0], p2[1]);
            if (a[2] < 0 || b[2] < 0) return;
            const e = easeOutCubic(local);
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e); ctx.stroke();
            if (local < 1) {
              ctx.fillStyle = 'rgba(255,250,235,.95)';
              ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, 2.6, 0, TAU); ctx.fill();
            }
          });
          ctx.restore();
        },
      });
    }

    meteorShower(colors) {
      const t0 = performance.now();
      const ms = Array.from({ length: 14 }, (_, i) => ({
        delay: i * 0.11 + Math.random() * 0.15, x: Math.random() * this.w * 1.2, y: -20 - Math.random() * this.h * 0.3,
        len: 80 + Math.random() * 120, sp: 700 + Math.random() * 500, col: colors[i % colors.length],
      }));
      this.effects.push({
        draw: (ctx, now) => {
          const t = (now - t0) / 1000;
          if (t > 3.2) return false;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
          for (const m of ms) {
            const tt = t - m.delay;
            if (tt < 0 || tt > 1.4) continue;
            const d = m.sp * tt, ang = 2.4;
            const x = m.x + Math.cos(ang) * d, y = m.y + Math.sin(ang) * d;
            const g = ctx.createLinearGradient(x, y, x - Math.cos(ang) * m.len, y - Math.sin(ang) * m.len);
            g.addColorStop(0, `rgba(255,252,240,${1 - tt / 1.4})`); g.addColorStop(0.3, hexA(m.col, 0.6 * (1 - tt / 1.4))); g.addColorStop(1, hexA(m.col, 0));
            ctx.strokeStyle = g; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * m.len, y - Math.sin(ang) * m.len); ctx.stroke();
          }
          ctx.restore();
        },
      });
    }
  }

  window.SkyView = SkyView;
})();
