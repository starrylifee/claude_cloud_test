/* 하늘 수첩 — app: object index, observation records, panels, dialogs, search, celebrations. */
(function () {
  'use strict';
  const A = window.Astro, C = window.SKY_CATALOG, Store = window.SkyStore, DB = Store.backend;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fromLocalInput = (s) => (s ? new Date(s) : new Date());
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const fmtDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
  const fmtChip = (d) => `<span class="chip-date">${d.getMonth() + 1}.${pad(d.getDate())}<span class="chip-day"> (${DAYS[d.getDay()]})</span></span> <span class="chip-time">${pad(d.getHours())}:${pad(d.getMinutes())}</span>`;

  const TYPE_KO = {
    gg: '은하단', g: '은하', s: '나선은하', s0: '렌즈형 은하', sd: '왜소 타원은하', i: '불규칙 은하', e: '타원은하',
    oc: '산개성단', gc: '구상성단', dn: '암흑성운', bn: '발광성운', sfr: '별 탄생 영역', rn: '반사성운', en: '방출성운',
    pn: '행성상성운', snr: '초신성 잔해', pos: '별 무리',
  };
  const KIND_KO = { messier: '메시에', dso: '심우주 천체', star: '별', con: '별자리', planet: '행성', moon: '달', comet: '혜성' };
  const BODY_COLORS = { sun: '#FFD36B', moon: '#EDEBE0', mer: '#C9B9A6', ven: '#FFF1CC', mar: '#FF8D62', jup: '#F2D7A8', sat: '#E8D18E', ura: '#A8E3E8', nep: '#86A9FF' };
  const PLANET_SYMS = { mer: '☿', ven: '♀', mar: '♂', jup: '♃', sat: '♄', ura: '⛢', nep: '♆', moon: '☾' };
  const orb = (key) => (BODY_COLORS[key] ? `<i class="orb ${key === 'moon' ? 'moon' : ''}" style="--c:${BODY_COLORS[key]}"></i>` : '✦');
  const ICONS = {
    seen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 7l1.6-2.5h3.8L15.5 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    known: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.3 6.4 6.6.3-5.2 4.1 1.8 6.5L12 16.3l-5.5 3.8 1.8-6.5-5.2-4.1 6.6-.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  };
  const STATUS = [['seen', '봤어요', 's-seen'], ['photo', '찍었어요', 's-photo'], ['identified', '알아봤어요', 's-known']];

  // ------------------------------------------------------------------ prefs (per-browser conveniences)
  const PREF_KEY = 'skylog.prefs.v1';
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };

  // ------------------------------------------------------------------ object index
  const items = new Map();   // key -> item
  const alias = new Map();   // "NGC 224" -> "M31"
  const messier = [], dsos = [], named = [];
  for (const m of C.messier) {
    const it = { kind: 'messier', key: m.id, id: m.id, ko: m.ko, en: m.en, t: m.t, mag: m.mag, dim: m.dim, ra: m.ra, dec: m.dec, con: m.con, ngc: m.ngc, num: +m.id.slice(1) };
    it.name = m.ko || m.en || TYPE_KO[m.t] || m.id;
    items.set(it.key, it); messier.push(it);
    if (m.ngc) for (const part of m.ngc.split(/,\s*/)) alias.set(part.replace(/\s+/g, ' ').trim(), it.key);
  }
  for (const d of C.dsos) {
    const [id, t, mag, dim, ra, dec, con, ko, en, m] = d;
    if (m && items.has(m)) { alias.set(id, m); continue; }
    const it = { kind: 'dso', key: id, id, t, mag, dim, ra, dec, con, ko, en, m };
    it.name = ko || en || TYPE_KO[t] || id;
    items.set(id, it); dsos.push(it);
  }
  for (const s of C.named) {
    const it = { kind: 'star', key: s.id, id: s.bayer ? `${s.bayer} ${s.con}` : s.id, ko: s.ko, en: s.en, mag: s.mag, ra: s.ra, dec: s.dec, con: s.con };
    it.name = s.ko || s.en;
    items.set(it.key, it); named.push(it);
  }
  for (const id in C.cons) {
    const c = C.cons[id];
    items.set(id, { kind: 'con', key: id, id, name: c.ko, ko: c.ko, en: c.en, la: c.la, ra: c.c[0], dec: c.c[1], rank: c.rank });
  }
  for (const k of A.PLANET_KEYS) {
    const p = C.planets[k];
    items.set(k, { kind: 'planet', key: k, id: p.en, name: p.ko, ko: p.ko, en: p.en, moving: true });
  }
  items.set('moon', { kind: 'moon', key: 'moon', id: 'Moon', name: '달', ko: '달', en: 'Moon', moving: true });

  // ------------------------------------------------------------------ state
  const state = {
    observers: [], who: prefs.who || 'a', obs: [], comets: [], photoMeta: [],
    selectedKey: null, chartDate: new Date(), site: prefs.site || { lat: 37.57, lon: 126.98 },
    layers: Object.assign({ mw: true, lines: true, bounds: true, conNames: true, grid: false, ecliptic: true, horizon: true, messier: true, ngc: true, solar: true, photos: true, mineOnly: false }, prefs.layers || {}),
    marks: new Map(), conMarks: new Map(), thumbs: new Map(), bodies: [], trails: [],
    tab: 'target', logFilter: 'all',
  };
  const jd = () => A.julianDay(state.chartDate);

  function positionOf(item, date) {
    const j = A.julianDay(date || state.chartDate);
    if (item.kind === 'planet') return A.planetPosition(item.key, j);
    if (item.kind === 'moon') return A.moonPosition(j);
    if (item.kind === 'comet') return item.el ? A.cometPosition(item.el, j) : null;
    return { ra: item.ra, dec: item.dec };
  }
  function lookup(key) {
    const it = items.get(alias.get(key) || key);
    if (!it) return null;
    if (it.moving || it.kind === 'comet') {
      const p = positionOf(it);
      if (p) return Object.assign(it, { ra: p.ra, dec: p.dec, dist: p.dist, illum: p.illum, waxing: p.waxing, helioDist: p.helioDist });
      const last = state.obs.filter((o) => o.target.key === it.key && o.ra != null).sort((a, b) => b.when.localeCompare(a.when))[0];
      if (last) return Object.assign(it, { ra: last.ra, dec: last.dec });
      return Object.assign(it, { ra: null, dec: null });
    }
    return it;
  }
  const selected = () => (state.selectedKey ? lookup(state.selectedKey) : null);
  const observer = (id) => state.observers.find((o) => o.id === id) || { id, name: id, color: '#fff' };
  const visibleObs = () => (state.who === 'both' ? state.obs : state.obs.filter((o) => o.observer === state.who));
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // One rule for "how was it met" everywhere (chart, chips, grid, bubbles): photographed > seen > identified.
  const primaryStatus = (m) => (m.photo ? 'photo' : m.seen ? 'seen' : 'known');
  const gotChip = (key, text) => {
    const m = state.marks.get(key);
    return `<button class="chip chip-got ${m ? 's-' + primaryStatus(m) : ''}" data-jump="${esc(key)}">${esc(text)}</button>`;
  };
  function primaryColor(m) {
    if (state.who === 'both') return m.who.a && m.who.b ? '#F3EEFF' : m.who.a ? cssVar('--obs-a') : cssVar('--obs-b');
    return cssVar('--' + primaryStatus(m));
  }

  function computeMarks() {
    const marks = new Map(), con = new Map();
    for (const o of visibleObs()) {
      const k = o.target.key;
      const m = marks.get(k) || { seen: false, photo: false, identified: false, who: {}, n: 0, last: '' };
      m.seen = m.seen || o.seen; m.photo = m.photo || o.photo; m.identified = m.identified || o.identified;
      m.who[o.observer] = true; m.n++; if (o.when > m.last) m.last = o.when;
      marks.set(k, m);
    }
    for (const [k, m] of marks) {
      const it = items.get(k);
      if (!it) continue;
      let cid = it.kind === 'con' ? it.key : it.con;
      if (!cid && it.moving) {
        const o = state.obs.find((x) => x.target.key === k && x.ra != null);
        if (o) cid = A.constellationAt(o.ra, o.dec);
      }
      if (!cid) continue;
      const level = it.kind === 'con' ? 2 : 1;
      const cur = con.get(cid);
      // a constellation takes the colour of its own record; one with only objects inside stays plain gold
      if (!cur || cur.level < level) con.set(cid, { level, color: level === 2 || state.who === 'both' ? primaryColor(m) : cssVar('--seen') });
    }
    state.marks = marks; state.conMarks = con;
  }

  function computeBodies() {
    const j = jd(), sun = A.planetPosition('sun', j);
    const bodies = [{ kind: 'sun', key: 'sun', name: '태양', ra: sun.ra, dec: sun.dec, color: BODY_COLORS.sun }];
    const m = A.moonPosition(j);
    bodies.push(Object.assign(items.get('moon'), { ra: m.ra, dec: m.dec, illum: m.illum, waxing: m.waxing, color: BODY_COLORS.moon }));
    for (const k of A.PLANET_KEYS) {
      const p = A.planetPosition(k, j);
      bodies.push(Object.assign(items.get(k), { ra: p.ra, dec: p.dec, dist: p.dist, color: BODY_COLORS[k], r: k === 'jup' || k === 'ven' ? 5.2 : k === 'sat' ? 4.4 : k === 'ura' || k === 'nep' ? 3.2 : 4 }));
    }
    for (const c of state.comets) {
      const it = items.get('comet:' + c.id);
      if (!it.el) continue;
      const p = A.cometPosition(it.el, j);
      bodies.push(Object.assign(it, { ra: p.ra, dec: p.dec, helioDist: p.helioDist, color: '#C4F6EA', sunRa: sun.ra, sunDec: sun.dec, r: 3.6 }));
    }
    state.bodies = bodies;
    // dated positions of moving targets
    const trails = new Map();
    for (const o of visibleObs()) {
      const it = items.get(o.target.key);
      if (!it || !(it.moving || it.kind === 'comet') || o.ra == null) continue;
      const t = trails.get(it.key) || { item: it, color: BODY_COLORS[it.key] || '#C4F6EA', points: [] };
      const d = new Date(o.when);
      const col = state.who === 'both' ? observer(o.observer).color : o.photo ? cssVar('--photo') : o.seen ? cssVar('--seen') : cssVar('--known');
      t.points.push({ ra: o.ra, dec: o.dec, when: o.when, label: `${d.getFullYear() % 100}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`, color: col });
      trails.set(it.key, t);
    }
    for (const t of trails.values()) t.points.sort((a, b) => a.when.localeCompare(b.when));
    state.trails = [...trails.values()];
  }

  async function loadThumbs() {
    state.thumbs = new Map();
    const byObs = new Map(state.photoMeta.map((p) => [p.observationId, p]));
    for (const o of visibleObs()) {
      const p = byObs.get(o.id);
      if (!p || state.thumbs.has(o.target.key)) continue;
      const img = new Image();
      img.onload = () => { view.dirty = true; };
      img.src = p.thumb;
      state.thumbs.set(o.target.key, img);
    }
  }

  // ------------------------------------------------------------------ sky view
  const skyEl = $('#sky');
  const view = new window.SkyView(skyEl, $('#skyCanvas'), $('#fxCanvas'), {
    state: () => ({
      layers: state.layers, marks: state.marks, conMarks: state.conMarks, messier, dsos, named, bodies: state.bodies,
      trails: state.trails, thumbs: state.thumbs, lookup, jd: jd(), site: state.site, mode: state.who,
    }),
    selected,
    hint: () => (state.marks.size || state.selectedKey ? null : state.hintKey ? lookup(state.hintKey) : null),
    onSelect: (item) => select(item.key, { fly: false }),
    onHover: (hit, p) => hover(hit, p),
    onPick: (sky) => finishPick(sky),
    onViewChange: (P) => {
      $('#fovLabel').innerHTML = `시야 ${P.fov < 10 ? P.fov.toFixed(1) : Math.round(P.fov)}°<span class="fov-pos">  ·  ${A.fmtRA(P.ra0)}  ${A.fmtDec(P.dec0)}</span>`;
      clearTimeout(view._saveT);
      view._saveT = setTimeout(() => { prefs.view = { ra: P.ra0, dec: P.dec0, fov: P.fov }; savePrefs(); }, 400);
    },
  });
  document.fonts && document.fonts.ready.then(() => { view.dirty = true; });

  function hover(hit, p) {
    const tag = $('#hoverTag');
    if (!hit) { tag.hidden = true; return; }
    const it = hit.item;
    tag.innerHTML = `<b>${esc(it.name)}</b><span>${esc(it.kind === 'con' ? it.la : it.kind === 'star' ? it.id : it.id || '')}</span>`;
    tag.style.left = p[0] + 'px'; tag.style.top = p[1] + 'px';
    tag.hidden = false;
  }

  function refreshAll() {
    computeMarks(); computeBodies();
    view.dirty = true;
    renderPanel();
  }

  // ------------------------------------------------------------------ selection
  function select(key, { fly = true, tab = true } = {}) {
    const it = lookup(key);
    if (!it) return;
    state.selectedKey = it.key;
    if (fly && it.ra != null) {
      const fov = it.kind === 'con' ? 50 : it.kind === 'moon' ? 8 : Math.min(view.P.fov, 34);
      view.flyTo(it.ra, it.dec, fov);
    }
    if (tab) setTab('target');
    else renderPanel();
    if (window.matchMedia('(max-width: 820px)').matches) { $('#panel').classList.remove('min'); $('#panel').classList.add('open'); }
  }

  // ------------------------------------------------------------------ panel
  function setTab(t) {
    state.tab = t;
    for (const b of $$('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const p of $$('.tab-body')) p.hidden = p.id !== 'tab-' + t;
    renderPanel();
  }
  function renderPanel() {
    ({ target: renderTarget, collect: renderCollect, log: renderLog, gallery: renderGallery })[state.tab]();
    $('#brandSub').innerHTML = subtitle();
    $('#sheetStat').innerHTML = subtitle();
  }
  function subtitle() {
    const n = state.marks.size;
    const who = state.who === 'both' ? '우리' : observer(state.who).name;
    const mGot = messier.filter((x) => state.marks.has(x.key)).length;
    const cGot = [...state.conMarks.values()].filter((v) => v.level === 2).length;
    return n ? `<span>${esc(who)}의 하늘</span><span>메시에</span><b class="num">${mGot}<small>/110</small></b><span>별자리</span><b class="num">${cGot}<small>/88</small></b>` : `<span>${esc(who)}의 밤하늘을 모아 보세요</span>`;
  }

  // read-only: how this object has been met so far, with the first date for each way
  function stampRow(m, list) {
    if (!m) return '<p class="status-none">아직 만나지 않았어요</p>';
    return `<div class="badge-row">${STATUS.filter(([k]) => m[k]).map(([k, label, cls]) => {
      const first = list.filter((o) => o[k]).map((o) => o.when).sort()[0];
      return `<span class="badge-s ${cls}">${ICONS[k === 'identified' ? 'known' : k]}<b>${label}</b>${first ? `<small>첫 기록 ${fmtDate(first).slice(2)}</small>` : ''}</span>`;
    }).join('')}</div>`;
  }
  function obsFor(key) { return visibleObs().filter((o) => o.target.key === key).sort((a, b) => b.when.localeCompare(a.when)); }

  function altText(it) {
    if (it.ra == null) return '—';
    const h = A.toHorizontal(it.ra, it.dec, jd(), state.site.lat, state.site.lon);
    const dirs = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    return h.alt < 0 ? `지평선 아래 (${Math.round(h.alt)}°)` : `${Math.round(h.alt)}° · ${dirs[Math.round(h.az / 45) % 8]}`;
  }

  function renderTarget() {
    const el = $('#tab-target');
    const it = selected();
    if (!it) { el.innerHTML = welcomeHTML(); bindJump(el); return; }
    const m = state.marks.get(it.key);
    const list = obsFor(it.key);
    const conName = it.con && C.cons[it.con] ? C.cons[it.con].ko : it.ra != null ? (C.cons[A.constellationAt(it.ra, it.dec)] || {}).ko : '';
    const facts = [];
    if (it.ra != null) facts.push(['적경', A.fmtRA(it.ra)], ['적위', A.fmtDec(it.dec)]);
    if (it.mag != null) facts.push(['밝기', `${it.mag}등급`]);
    if (it.dim) facts.push(['크기', `${it.dim}′`]);
    if (it.kind !== 'con' && conName) facts.push(['별자리', conName]);
    if (it.dist != null) facts.push(['거리', `${it.dist.toFixed(2)} AU`]);
    if (it.kind === 'moon' && it.illum != null) facts.push(['밝은 면', `${Math.round(it.illum * 100)}%`]);
    facts.push(['지금 고도', altText(it)]);

    const eyebrow = it.kind === 'messier' ? `메시에 ${it.num}${it.ngc ? ' · ' + it.ngc : ''}` : it.kind === 'dso' ? it.id + (it.m ? ' · ' + it.m : '')
      : it.kind === 'con' ? `별자리 · ${it.id}` : it.kind === 'star' ? `별 · ${it.id}` : KIND_KO[it.kind];
    const sub = it.kind === 'con' ? it.la : it.en && it.en !== it.name ? it.en : '';
    const type = it.t ? TYPE_KO[it.t] || it.t : it.kind === 'planet' ? '행성 · 날짜마다 자리가 바뀌어요' : it.kind === 'moon' ? '지구의 위성' : it.kind === 'comet' ? (it.el ? '혜성 · 궤도로 위치 계산' : '혜성 · 위치 직접 기록') : '';
    const photos = state.photoMeta.filter((p) => list.some((o) => o.id === p.observationId));

    let extra = '';
    if (it.kind === 'con') {
      const inside = messier.filter((x) => x.con === it.key);
      const got = [...state.marks.keys()].map((k) => items.get(k)).filter((x) => x && x.con === it.key && x.kind !== 'con');
      extra += `<div class="section-h"><h3>이 별자리의 메시에</h3><span class="meta">${inside.filter((x) => state.marks.has(x.key)).length}/${inside.length}</span></div>`;
      extra += inside.length ? `<div class="filter-row">${inside.map((x) => state.marks.has(x.key) ? gotChip(x.key, x.id) : `<button class="chip" data-jump="${x.key}">${x.id}</button>`).join('')}</div>` : '<p class="help">메시에 천체가 없는 별자리예요.</p>';
      if (got.length) extra += `<div class="section-h"><h3>여기서 모은 것</h3><span class="meta">${got.length}</span></div><div class="filter-row">${got.map((x) => gotChip(x.key, x.kind === 'messier' ? x.id : x.name)).join('')}</div>`;
    }

    el.innerHTML = `
      <div class="target-head">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h2 class="h-title">${esc(it.name)}</h2>
        ${sub ? `<p class="h-sub">${esc(sub)}</p>` : ''}
        ${type ? `<span class="type-pill">${esc(type)}</span>` : ''}
        ${horizonNote(it)}
      </div>
      <button class="btn btn-primary cta" id="recordBtn">${ICONS.plus}${list.length ? '또 기록하기' : '기록 남기기'}</button>
      ${stampRow(m, list)}
      <dl class="facts">${facts.map(([k, v], i) => `<div${i === facts.length - 1 && facts.length % 2 ? ' class="wide"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${photos.length ? `<div class="section-h"><h3>사진</h3><span class="meta">${photos.length}</span></div><div class="photo-strip">${photos.map((p) => `<button data-photo="${p.id}"><img src="${p.thumb}" alt="${esc(it.name)} 사진"></button>`).join('')}</div>` : ''}
      ${extra}
      <div class="section-h"><h3>기록</h3><span class="meta">${list.length}</span></div>
      ${list.length ? `<div class="entries">${list.map(entryHTML).join('')}</div>` : `<p class="empty">아직 기록이 없어요. 처음 만난 순간을 남겨 보세요.</p>`}
      ${it.kind === 'comet' ? `<button class="btn btn-ghost cta" id="editComet">혜성 정보 고치기</button>` : ''}
    `;
    $('#recordBtn', el).onclick = () => openRecord(it.key);
    const ec = $('#editComet', el); if (ec) ec.onclick = () => openComet(it.cometId);
    bindEntries(el); bindJump(el); bindPhotos(el);
  }

  function horizonNote(it) {
    if (it.ra == null || it.kind === 'con') return '';
    const j0 = jd(), alt = (j) => A.toHorizontal(it.ra, it.dec, j, state.site.lat, state.site.lon).alt;
    if (alt(j0) > 0) return '';
    let rise = null;
    for (let k = 1; k <= 144; k++) if (alt(j0 + k / 144) > 0) { rise = new Date(state.chartDate.getTime() + k * 600e3); break; }
    return `<p class="horizon-note">지금은 지평선 아래예요${rise ? ` · ${rise.getDate() !== state.chartDate.getDate() ? '내일 ' : ''}${pad(rise.getHours())}:${pad(rise.getMinutes())}쯤 떠요` : ' · 이 관측지에서는 오늘 뜨지 않아요'}</p>`;
  }

  function welcomeHTML() {
    const j = jd();
    const up = (it) => { const h = A.toHorizontal(it.ra, it.dec, j, state.site.lat, state.site.lon); return h.alt; };
    const sunAlt = up(state.bodies[0]);
    const planets = state.bodies.filter((b) => b.kind === 'planet' || b.kind === 'moon').map((b) => [b, up(b)]).filter(([, a]) => a > 5).sort((a, b) => b[1] - a[1]);
    const best = messier.map((x) => [x, up(x)]).filter(([, a]) => a > 25).sort((a, b) => (a[0].mag ?? 9) - (b[0].mag ?? 9)).slice(0, 8);
    const night = sunAlt < -12 ? '지금은 어두운 밤이에요.' : sunAlt < 0 ? '해가 졌어요. 곧 별이 하나둘 보여요.' : '지금은 해가 떠 있어요. 성도 시각을 오늘 밤으로 바꿔 보세요.';
    const row = ([x, a]) => `<button class="prow" data-jump="${x.key}"><span class="sym">${orb(x.key)}</span><span><span class="pname">${esc(x.kind === 'messier' ? `${x.id} ${x.name}` : x.name)}</span><br><span class="pmeta">고도 ${Math.round(a)}°${x.mag != null ? ` · ${x.mag}등급` : ''}</span></span>${state.marks.has(x.key) ? '<i class="got-dot" title="모음"></i>' : '<span></span>'}</button>`;
    const mGot = messier.filter((x) => state.marks.has(x.key)).length;
    const first = best.find(([x]) => !state.marks.has(x.key)) || (state.marks.has('M45') ? null : [items.get('M45'), up(items.get('M45'))]);
    state.hintKey = first ? first[0].key : null;
    return `
      <p class="eyebrow">오늘의 하늘</p>
      <h2 class="h-title">${state.marks.size ? '오늘은 무엇을 만났나요?' : '첫 별을 모아 볼까요?'}</h2>
      ${state.marks.size ? '' : '<p class="h-sub">성도에서 천체나 별자리를 누르거나 위에서 찾아보세요. 기록할수록 내 하늘이 밝아져요.</p>'}
      <div class="progress-card">
        <div class="progress-top"><span>메시에</span><b class="num">${mGot}<small>/110</small></b></div>
        <div class="meter"><i style="width:${(mGot / 110) * 100}%"></i></div>
        ${state.marks.size ? '' : `<div class="ghost-grid" aria-hidden="true">${'<i></i>'.repeat(110)}</div><p class="ghost-cap">메시에 110칸과 별자리 88개를 내 기록으로 채워 가요</p>`}
        ${first ? `<button class="btn btn-primary cta" data-jump="${first[0].key}">${ICONS.plus}오늘 밤 추천: ${esc(first[0].id)} ${esc(first[0].name)}</button>` : ''}
      </div>
      ${state.marks.size ? '' : '<p class="steps-line"><b>찾기</b> → <b>기록</b> → <b>빛나기</b> · 기록한 천체는 성도에서 빛나고, 별자리는 선이 켜져요.</p>'}
      <p class="help" style="margin-top:10px">${night} 관측지 ${state.site.lat.toFixed(2)}°, ${state.site.lon.toFixed(2)}° 기준이에요.</p>
      ${planets.length ? `<div class="section-h"><h3>지금 떠 있는 행성과 달</h3></div><div class="plist two">${planets.map(([x, a]) => `<button class="prow" data-jump="${x.key}"><span class="sym">${orb(x.key)}</span><span><span class="pname">${esc(x.name)}</span><br><span class="pmeta">고도 ${Math.round(a)}°</span></span></button>`).join('')}</div>` : ''}
      <div class="section-h"><h3>지금 잘 보이는 메시에</h3><span class="meta">고도 25° 이상</span></div>
      ${best.length ? `<div class="plist">${best.map(row).join('')}</div>` : '<p class="empty">지금은 높이 뜬 메시에 천체가 없어요.</p>'}
    `;
  }

  function entryHTML(o) {
    const it = items.get(o.target.key) || { name: o.target.key };
    const d = new Date(o.when);
    const photo = state.photoMeta.find((p) => p.observationId === o.id);
    const ob = observer(o.observer);
    return `<article class="entry" data-entry="${o.id}" tabindex="0">
      <div class="entry-pills">${STATUS.filter(([k]) => o[k]).map(([k, label, cls]) => `<span class="pill ${cls}" title="${label}">${ICONS[k === 'identified' ? 'known' : k]}</span>`).join('')}</div>
      <div>
        <div class="entry-title">${esc(it.name)}${it.kind === 'messier' || it.kind === 'dso' ? `<span class="mono">${esc(it.id)}</span>` : ''}</div>
        <div class="entry-meta">${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${o.place ? ' · ' + esc(o.place) : ''}${o.gear ? ' · ' + esc(o.gear) : ''}</div>
        ${o.note ? `<div class="entry-note">${esc(o.note)}</div>` : ''}
        ${state.who === 'both' ? `<div class="entry-who" style="--c:${ob.color}"><i></i>${esc(ob.name)}</div>` : ''}
      </div>
      ${photo ? `<img class="entry-thumb" src="${photo.thumb}" alt="">` : '<span></span>'}
    </article>`;
  }
  function bindEntries(el) {
    for (const e of $$('[data-entry]', el)) {
      const open = () => { const o = state.obs.find((x) => x.id === e.dataset.entry); if (o) openRecord(o.target.key, o); };
      e.onclick = open;
      e.onkeydown = (ev) => { if (ev.key === 'Enter') open(); };
    }
  }
  function bindJump(el) { for (const b of $$('[data-jump]', el)) b.onclick = () => select(b.dataset.jump); }
  function bindPhotos(el) { for (const b of $$('[data-photo]', el)) b.onclick = () => openViewer(b.dataset.photo); }

  function cellClass(m) {
    if (!m) return '';
    return `got c-${primaryStatus(m)}`;
  }
  function cellDots(m) {
    if (!m) return '';
    return `<span class="cdots">${STATUS.filter(([k]) => m[k]).map(([k]) => `<i class="d-${k === 'identified' ? 'known' : k}"></i>`).join('')}</span>`;
  }
  function renderCollect() {
    const el = $('#tab-collect');
    const keys = [...state.marks.entries()];
    const count = (k) => keys.filter(([, m]) => m[k]).length;
    const mGot = messier.filter((x) => state.marks.has(x.key)).length;
    const conGot = Object.keys(C.cons).filter((id) => state.conMarks.get(id)?.level === 2).length;
    const dsoGot = keys.filter(([k]) => items.get(k)?.kind === 'dso');
    const starGot = keys.filter(([k]) => items.get(k)?.kind === 'star');
    const solar = [...A.PLANET_KEYS, 'moon'].map((k) => items.get(k));
    el.innerHTML = `
      <p class="eyebrow">${state.who === 'both' ? '우리 둘의 수집' : esc(observer(state.who).name) + '의 수집'}</p>
      <h2 class="h-title">모은 하늘</h2>
      ${state.who === 'both' ? `<p class="who-key"><span><i style="background:${observer('a').color}"></i>${esc(observer('a').name)}</span><span><i style="background:${observer('b').color}"></i>${esc(observer('b').name)}</span><span><i style="background:conic-gradient(${observer('a').color} 0 50%, ${observer('b').color} 0)"></i>둘 다</span></p>` : ''}
      <p class="help" style="margin:10px 0 6px">메시에·NGC·별자리·별·행성을 모두 합친 천체 수예요.</p>
      <div class="summary">
        <div class="sum-card s-seen"><b>${count('seen')}</b><span>봤어요</span></div>
        <div class="sum-card s-photo"><b>${count('photo')}</b><span>찍었어요</span></div>
        <div class="sum-card s-known"><b>${count('identified')}</b><span>알아봤어요</span></div>
      </div>

      <div class="section-h"><h3>메시에 목록</h3><span class="meta">${mGot}/110</span></div>
      <div class="meter"><i style="width:${(mGot / 110) * 100}%"></i></div>
      <div class="mgrid" style="margin-top:10px" aria-label="메시에 1–110">${messier.map((x) => `<button class="mcell ${cellClass(state.marks.get(x.key))}" data-jump="${x.key}" data-cell="${x.key}" title="${esc(x.id + ' ' + x.name)}">${x.num}${cellDots(state.marks.get(x.key))}</button>`).join('')}</div>

      <p class="grid-key"><span><i class="k k-seen"></i>봤어요</span><span><i class="k k-photo"></i>찍었어요</span><span><i class="k k-known"></i>알아봤어요</span></p>
      <p class="help" style="margin-top:4px">칸 색은 대표 방식(찍음 › 봄 › 알아봄), 칸 아래 점은 만난 방식 전부예요.</p>

      <div class="section-h"><h3>별자리 88</h3><span class="meta">${conGot}/88 알아봄</span></div>
      <p class="grid-key" style="margin:0 0 8px"><span><i class="k k-con"></i>별자리를 알아봄</span><span><i class="k k-part"></i>안의 천체만 모음</span></p>
      <div class="cgrid">${Object.keys(C.cons).sort((a, b) => C.cons[a].ko.localeCompare(C.cons[b].ko, 'ko')).map((id) => {
        const lv = state.conMarks.get(id);
        return `<button class="ccell ${lv ? (lv.level === 2 ? 'got' : 'part') : ''}" data-jump="${id}" data-cell="${id}" title="${esc(C.cons[id].ko)} · ${id}">${esc(C.cons[id].ko.replace(/자리$/, ''))}</button>`;
      }).join('')}</div>


      <div class="section-h"><h3>행성과 달</h3><span class="meta">날짜별 기록</span></div>
      <div class="plist">${solar.map((p) => {
        const list = obsFor(p.key);
        return `<button class="prow ${list.length ? 'got' : ''}" data-jump="${p.key}"><span class="sym">${orb(p.key)}</span><span><span class="pname">${p.name}</span><br><span class="pmeta">${list.length ? `${list.length}번 · 마지막 ${list[0].when.slice(0, 10)}` : '아직'}</span></span><span class="dates">${list.slice(0, 24).map(() => '<i></i>').join('')}</span></button>`;
      }).join('')}</div>

      <div class="section-h"><h3>혜성</h3><span class="meta">${state.comets.length}</span></div>
      <div class="plist">${state.comets.map((c) => {
        const list = obsFor('comet:' + c.id);
        return `<button class="prow ${list.length ? 'got' : ''}" data-jump="comet:${c.id}"><span class="sym">☄</span><span><span class="pname">${esc(c.name)}</span><br><span class="pmeta">${c.q ? '궤도 있음' : '위치 직접 기록'} · ${list.length}번</span></span><span class="dates">${list.slice(0, 24).map(() => '<i></i>').join('')}</span></button>`;
      }).join('')}</div>
      <button class="btn btn-ghost cta" id="addComet">${ICONS.plus}혜성 추가</button>

      <div class="section-h"><h3>NGC · IC</h3><span class="meta">${dsoGot.length}</span></div>
      ${dsoGot.length ? `<div class="filter-row">${dsoGot.map(([k]) => gotChip(k, k)).join('')}</div>` : '<p class="help">성도를 확대하면 NGC·IC 천체가 나타나요.</p>'}

      <div class="section-h"><h3>이름 있는 별</h3><span class="meta">${starGot.length}</span></div>
      ${starGot.length ? `<div class="filter-row">${starGot.map(([k]) => gotChip(k, items.get(k).name)).join('')}</div>` : '<p class="help">베가, 시리우스처럼 이름 있는 별도 모을 수 있어요.</p>'}
    `;
    $('#addComet', el).onclick = () => openComet();
    bindJump(el);
    if (state.justCell) {
      const c = el.querySelector(`[data-cell="${CSS.escape(state.justCell)}"]`);
      if (c) { c.classList.add('just'); c.scrollIntoView({ block: 'nearest' }); }
      state.justCell = null;
    }
  }

  function nightOf(iso) {
    const d = new Date(new Date(iso).getTime() - 12 * 3600e3);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function renderLog() {
    const el = $('#tab-log');
    const f = state.logFilter;
    const list = visibleObs().filter((o) => f === 'all' || o[f]).sort((a, b) => b.when.localeCompare(a.when));
    const groups = new Map();
    for (const o of list) { const k = nightOf(o.when); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    el.innerHTML = `
      <p class="eyebrow">관측 일지</p>
      <h2 class="h-title">밤마다 쌓인 기록</h2>
      <div class="filter-row" style="margin-top:12px">${[['all', '전체'], ...STATUS.map(([k, l]) => [k, l])].map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      ${list.length ? [...groups].map(([day, os]) => {
        const d = new Date(day + 'T12:00');
        return `<h3 class="night-h">${d.getMonth() + 1}월 ${d.getDate()}일 밤 <small>${d.getFullYear()} · ${days[d.getDay()]} · ${os.length}개</small></h3><div class="entries">${os.map(entryHTML).join('')}</div>`;
      }).join('') : '<p class="empty">아직 기록이 없어요.</p>'}
    `;
    for (const b of $$('[data-filter]', el)) b.onclick = () => { state.logFilter = b.dataset.filter; renderLog(); };
    bindEntries(el);
  }

  function renderGallery() {
    const el = $('#tab-gallery');
    const vis = new Map(visibleObs().map((o) => [o.id, o]));
    const ps = state.photoMeta.filter((p) => vis.has(p.observationId)).sort((a, b) => vis.get(b.observationId).when.localeCompare(vis.get(a.observationId).when));
    el.innerHTML = `
      <p class="eyebrow">사진</p>
      <h2 class="h-title">내가 찍은 하늘</h2>
      <p class="h-sub" style="margin-bottom:14px">${ps.length ? `${ps.length}장 · 누르면 크게 보여요` : ''}</p>
      ${ps.length && ps.length <= 8 ? `<div class="gallery">${ps.map((p) => {
        const o = vis.get(p.observationId), it = items.get(o.target.key) || { name: o.target.key };
        return `<button class="gcard" data-photo="${p.id}"><img src="${p.thumb}" alt="${esc(it.name)}" loading="lazy"><figcaption><b>${esc((it.kind === 'messier' || it.kind === 'dso') && it.id !== it.name ? `${it.id} ${it.name}` : it.name)}</b><span>${fmtDate(o.when)}</span></figcaption></button>`;
      }).join('')}<button class="gcard gadd" id="galleryAdd"><span>${ICONS.plus}<b>사진 더하기</b><small>천체를 고르고 ‘찍었어요’로 기록</small></span></button></div>` : ps.length ? [...ps.reduce((m, p) => {
        const d = new Date(vis.get(p.observationId).when), k = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
        if (!m.has(k)) m.set(k, []); m.get(k).push(p); return m;
      }, new Map())].map(([month, list]) => `<h3 class="night-h">${month} <small>${list.length}장</small></h3><div class="gallery">${list.map((p) => {
        const o = vis.get(p.observationId), it = items.get(o.target.key) || { name: o.target.key };
        return `<button class="gcard" data-photo="${p.id}"><img src="${p.thumb}" alt="${esc(it.name)}" loading="lazy"><figcaption><b>${esc((it.kind === 'messier' || it.kind === 'dso') && it.id !== it.name ? `${it.id} ${it.name}` : it.name)}</b><span>${fmtDate(o.when)}</span></figcaption></button>`;
      }).join('')}</div>`).join('') : '<p class="empty">기록할 때 ‘찍었어요’를 고르면 사진을 올릴 수 있어요. 올린 사진은 성도 위 천체 옆에도 떠요.</p>'}
    `;
    const withPhoto = new Set(ps.map((p) => vis.get(p.observationId).target.key));
    const noPhoto = [...state.marks.entries()].filter(([k, m]) => !m.photo && !withPhoto.has(k) && items.get(k) && items.get(k).kind !== 'con').map(([k]) => k).slice(0, 24);
    if (noPhoto.length) el.insertAdjacentHTML('beforeend', `<div class="section-h"><h3>아직 안 찍은 내 천체</h3><span class="meta">${noPhoto.length}</span></div><div class="filter-row">${noPhoto.map((k) => gotChip(k, items.get(k).kind === 'messier' ? items.get(k).id : items.get(k).name)).join('')}</div>`);
    bindJump(el);
    bindPhotos(el);
    const ga = $('#galleryAdd', el);
    if (ga) ga.onclick = () => { setTab('target'); si.focus(); };
  }

  async function openViewer(photoId) {
    const p = await DB.getPhoto(photoId);
    if (!p) return;
    const o = state.obs.find((x) => x.id === p.observationId);
    const it = o && items.get(o.target.key);
    const url = p.blob ? URL.createObjectURL(p.blob) : p.thumb;
    const img = $('#viewerImg');
    img.src = url; img.alt = it ? it.name : '';
    $('#viewerCap').textContent = it ? `${it.kind === 'messier' ? it.id + ' ' : ''}${it.name} · ${o.when.slice(0, 10)}${o.gear ? ' · ' + o.gear : ''}` : '';
    const dlg = $('#viewerDlg');
    dlg.showModal();
    dlg.addEventListener('close', () => { if (p.blob) URL.revokeObjectURL(url); }, { once: true });
  }

  // ------------------------------------------------------------------ record dialog
  const recDlg = $('#recordDlg'), recForm = $('#recordForm');
  let rec = null; // { key, existing, newFiles: [File], removed: Set }

  function openRecord(key, existing, preset) {
    const it = lookup(key);
    if (!it) return;
    rec = { key: it.key, existing, newFiles: [], removed: new Set() };
    $('#recordEyebrow').textContent = existing ? '기록 고치기' : `${KIND_KO[it.kind]} 기록`;
    $('#recordTitle').textContent = it.kind === 'messier' ? `${it.id} ${it.name}` : it.kind === 'dso' && it.name !== it.id ? `${it.id} ${it.name}` : it.name;
    const f = recForm.elements;
    const last = state.obs.filter((o) => o.observer === writer()).sort((a, b) => b.when.localeCompare(a.when))[0];
    f.seen.checked = existing ? existing.seen : preset ? preset === 'seen' : true;
    f.photo.checked = existing ? existing.photo : preset === 'photo';
    f.identified.checked = existing ? existing.identified : preset === 'identified';
    // new records default to the chart's time, so "last night" can be logged by turning the chart back first
    f.when.value = toLocalInput(existing ? new Date(existing.when) : state.chartDate);
    f.place.value = existing ? existing.place || '' : last?.place || '';
    f.gear.value = existing ? existing.gear || '' : last?.gear || '';
    f.note.value = existing ? existing.note || '' : '';
    const manual = it.kind === 'comet' && !it.el;
    $('#coordFields').hidden = !manual;
    f.ra.value = manual && existing?.ra != null ? A.fmtRA(existing.ra) : '';
    f.dec.value = manual && existing?.dec != null ? A.fmtDec(existing.dec) : '';
    $('#recordDelete').hidden = !existing;
    // in 둘 다 mode the dialog asks whose record this is
    const wb = $('#whoPick');
    wb.hidden = false;
    pickedWriter = existing ? existing.observer : state.who === 'both' ? 'a' : state.who;
    wb.innerHTML = `<span>누구의 기록?</span>${['a', 'b'].map((id) => `<button type="button" class="who-btn" data-pick="${id}" aria-pressed="${pickedWriter === id}" style="--c:${observer(id).color}"><span class="dot" style="background:${observer(id).color}"></span>${esc(observer(id).name)}</button>`).join('')}`;
    for (const b of $$('[data-pick]', wb)) b.onclick = () => { pickedWriter = b.dataset.pick; for (const x of $$('[data-pick]', wb)) x.setAttribute('aria-pressed', String(x === b)); };
    $('#gearList').innerHTML = [...new Set(state.obs.map((o) => o.gear).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join('');
    renderPhotoThumbs();
    syncPhotoBox();
    recDlg.showModal();
    document.activeElement && document.activeElement.blur();
  }
  let pickedWriter = 'a';
  const writer = () => pickedWriter;

  function syncPhotoBox() { $('#photoDrop').hidden = !recForm.elements.photo.checked; }
  function renderPhotoThumbs() {
    const box = $('#photoThumbs');
    const old = rec.existing ? state.photoMeta.filter((p) => p.observationId === rec.existing.id && !rec.removed.has(p.id)) : [];
    box.innerHTML = old.map((p) => `<div class="pthumb"><img src="${p.thumb}" alt=""><button type="button" data-rm-old="${p.id}" aria-label="사진 빼기">×</button></div>`).join('')
      + rec.newFiles.map((f, i) => `<div class="pthumb"><img src="${f._url}" alt=""><button type="button" data-rm-new="${i}" aria-label="사진 빼기">×</button></div>`).join('');
    const n = old.length + rec.newFiles.length;
    $('#photoPick span').innerHTML = n ? `사진 ${n}장 붙였어요 <small>더 올리거나 끌어다 놓아도 돼요</small>` : '사진 올리기 <small>끌어다 놓아도 돼요</small>';
    for (const b of $$('[data-rm-old]', box)) b.onclick = () => { rec.removed.add(b.dataset.rmOld); renderPhotoThumbs(); };
    for (const b of $$('[data-rm-new]', box)) b.onclick = () => { const [f] = rec.newFiles.splice(+b.dataset.rmNew, 1); URL.revokeObjectURL(f._url); renderPhotoThumbs(); };
  }
  function addFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      f._url = URL.createObjectURL(f);
      rec.newFiles.push(f);
    }
    recForm.elements.photo.checked = true; syncPhotoBox();
    renderPhotoThumbs();
  }
  recForm.elements.photo.addEventListener('change', syncPhotoBox);
  $('#photoPick').onclick = () => $('#photoInput').click();
  $('#photoInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  const drop = $('#photoDrop');
  recDlg.addEventListener('dragover', (e) => { e.preventDefault(); recForm.elements.photo.checked = true; syncPhotoBox(); drop.classList.add('over'); });
  recDlg.addEventListener('dragleave', (e) => { if (e.target === drop) drop.classList.remove('over'); });
  recDlg.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  recDlg.addEventListener('close', () => { if (rec) for (const f of rec.newFiles) URL.revokeObjectURL(f._url); });

  $('#pickOnChart').onclick = () => {
    recDlg.close();
    view.pickMode = true;
    skyEl.classList.add('picking');
    $('#pickBanner').hidden = false;
    rec._picking = true;
  };
  $('#pickCancel').onclick = () => finishPick(null);
  function finishPick(sky) {
    view.pickMode = false;
    skyEl.classList.remove('picking');
    $('#pickBanner').hidden = true;
    if (!rec || !rec._picking) return;
    rec._picking = false;
    if (sky) { recForm.elements.ra.value = A.fmtRA(sky.ra); recForm.elements.dec.value = A.fmtDec(sky.dec); }
    recDlg.showModal();
  }

  $('#recordDelete').onclick = async () => {
    if (!rec?.existing || !confirm('이 기록을 지울까요? 같이 올린 사진도 지워져요.')) return;
    await DB.deleteObservation(rec.existing.id);
    rec = null;
    recDlg.close();
    await reload();
    toast('기록을 지웠어요', '', '−');
  };

  recForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = recForm.elements;
    if (!f.seen.checked && !f.photo.checked && !f.identified.checked) { toast('어떻게 만났는지 하나는 골라 주세요', '봤어요 · 찍었어요 · 알아봤어요', '!'); return; }
    const it = lookup(rec.key);
    const when = fromLocalInput(f.when.value);
    let ra = null, dec = null;
    if (it.moving || it.kind === 'comet') {
      if (it.kind === 'comet' && !it.el) {
        ra = A.parseAngle(f.ra.value, true); dec = A.parseAngle(f.dec.value, false);
        if (!isFinite(ra) || !isFinite(dec)) { toast('혜성 위치를 넣어 주세요', '적경·적위를 쓰거나 성도에서 찍어요', '!'); return; }
      } else { const p = positionOf(it, when); ra = p.ra; dec = p.dec; }
    }
    $('#recordSave').disabled = true;
    try {
      const before = snapshot();
      const now = new Date().toISOString();
      const o = Object.assign(rec.existing ? { ...rec.existing } : { id: Store.uid(), observer: writer(), createdAt: now, photos: [] }, {
        target: { kind: it.kind, key: it.key }, seen: f.seen.checked, photo: f.photo.checked, identified: f.identified.checked,
        when: when.toISOString(), place: f.place.value.trim(), gear: f.gear.value.trim(), note: f.note.value.trim(), ra, dec, updatedAt: now,
      });
      for (const pid of rec.removed) await DB.deletePhoto(pid);
      o.photos = (o.photos || []).filter((p) => !rec.removed.has(p));
      for (const file of rec.newFiles) {
        const p = await Store.makePhoto(file, o.id);
        await DB.savePhoto(p);
        o.photos.push(p.id);
      }
      await DB.saveObservation(o);
      const nPhotos = rec.newFiles.length;
      recDlg.close();
      rec = null;
      await reload();
      celebrateRecord(o, it, before, nPhotos);
    } catch (err) {
      console.error(err);
      toast('저장하지 못했어요', err.message || String(err), '!');
    } finally {
      $('#recordSave').disabled = false;
    }
  });

  // what the visible collection looked like before a save, to know what is new
  function snapshot() {
    return {
      marks: new Map([...state.marks].map(([k, m]) => [k, { ...m }])),
      cons: new Map([...state.conMarks].map(([k, v]) => [k, v.level])),
      messier: messier.filter((x) => state.marks.has(x.key)).length,
    };
  }

  function celebrateRecord(o, it, before, nPhotos) {
    const shown = state.who === 'both' || state.who === o.observer;
    const prev = before.marks.get(it.key);
    const fresh = [];
    for (const [k, label] of STATUS) if (o[k] && !(prev && prev[k])) fresh.push(label);
    const colors = [];
    if (o.seen) colors.push(cssVar('--seen'));
    if (o.photo) colors.push(cssVar('--photo'));
    if (o.identified) colors.push(cssVar('--known'));
    const mNow = messier.filter((x) => state.marks.has(x.key)).length;
    const milestone = it.kind === 'messier' && mNow > before.messier && (mNow % 10 === 0 || mNow === 110 || mNow === 1);
    const cid = it.kind === 'con' ? it.key : it.con || (o.ra != null ? A.constellationAt(o.ra, o.dec) : '');
    const conNew = cid && (before.cons.get(cid) || 0) < (state.conMarks.get(cid)?.level || 0);
    state.selectedKey = it.key;
    renderPanel();
    if (!shown) { toast(`${observer(o.observer).name}의 하늘에 새겼어요`, it.name, '✦'); return; }
    // the burst centres where the selection reticle sits, so ring, reticle and name pill share one focus
    const pos = o.ra != null ? { ra: o.ra, dec: o.dec } : it.ra != null ? { ra: it.ra, dec: it.dec } : null;
    const go = pos ? view.flyTo(pos.ra, pos.dec, it.kind === 'con' ? 55 : Math.min(view.P.fov, 40), 900) : Promise.resolve();
    go.then(() => {
      // a first meeting gets the full show; adding a new way to a known object is a smaller flourish
      const upgrade = !!prev && fresh.length > 0;
      if (pos) view.celebrate({ ra: pos.ra, dec: pos.dec, colors: upgrade ? colors.filter((c, i) => fresh.includes(STATUS.filter(([k]) => o[k])[i]?.[1])) : colors, conId: it.kind === 'con' || conNew ? cid : null, big: milestone, scale: upgrade || !fresh.length ? 'small' : 'normal', title: fresh.length ? `✦ ${it.kind === 'messier' ? it.id : it.name}` : null });
      for (const stat of [$('#brandSub'), $('#sheetStat')]) { stat.classList.remove('bump'); void stat.offsetWidth; stat.classList.add('bump'); }
      // the name already rises on the chart; the toast speaks to progress and what to look for next
      const cNow = [...state.conMarks.values()].filter((v) => v.level === 2).length;
      // lead with what changed; progress and the next idea follow
      const short = it.kind === 'messier' || it.kind === 'dso' ? it.id : it.name;
      const had = prev ? STATUS.filter(([k]) => prev[k]).map(([, l]) => l) : [];
      const change = nPhotos && !(prev && prev.photo) ? '첫 사진' : fresh.length && had.length ? `${fresh.join('·')} 추가` : fresh.length ? `처음 ${fresh.join(' · ')}` : '또 만났어요';
      const title = `${short} · ${change}`;
      const bits = [];
      if (it.kind === 'messier') bits.push(`메시에 ${mNow}/110${mNow > before.messier ? ' (+1)' : ''}`);
      if (it.kind === 'con') bits.push(`별자리 ${cNow}/88${conNew ? ' (+1)' : ''}`);
      if (it.moving) bits.push(`${obsFor(it.key).length}번째 날짜`);
      if (nPhotos > 1) bits.push(`사진 ${nPhotos}장`);
      if (conNew && cid && it.kind !== 'con') bits.push(`${C.cons[cid].ko}에 첫 발자국`);
      const j = jd();
      const next = messier.filter((x) => !state.marks.has(x.key)).map((x) => [x, A.toHorizontal(x.ra, x.dec, j, state.site.lat, state.site.lon).alt])
        .filter(([, a]) => a > 25).sort((a, b) => (a[0].mag ?? 9) - (b[0].mag ?? 9))[0];
      if (next) bits.push(`다음: ${next[0].id} ${next[0].name}`);
      toast(title, bits.join(' · '), o.photo ? '📷' : o.identified ? '✦' : '★', false, o.photo ? 'photo' : o.seen ? 'seen' : 'known');
      if (milestone) setTimeout(() => toast(mNow === 110 ? '메시에 110개 완주!' : mNow === 1 ? '첫 메시에!' : `메시에 ${mNow}개 달성!`, '하늘이 조금 더 내 것이 됐어요', '✸', true), 700);
      if (it.kind === 'messier' || it.kind === 'con') state.justCell = it.key;
    });
  }

  // ------------------------------------------------------------------ comets
  const cometDlg = $('#cometDlg'), cometForm = $('#cometForm');
  let editingComet = null;
  function openComet(id) {
    editingComet = id ? state.comets.find((c) => c.id === id) : null;
    const f = cometForm.elements, c = editingComet || {};
    $('#cometTitle').textContent = editingComet ? c.name : '새 혜성';
    for (const k of ['name', 'q', 'e', 'i', 'peri', 'node']) f[k].value = c[k] ?? '';
    f.tp.value = c.tp ? new Date(c.tp).toISOString().slice(0, 19) : '';
    $('#cometDelete').hidden = !editingComet;
    cometDlg.showModal();
  }
  cometForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = cometForm.elements;
    const c = { id: editingComet?.id || Store.uid(), name: f.name.value.trim() };
    const nums = ['q', 'e', 'i', 'peri', 'node'].map((k) => f[k].value.trim());
    if (nums.some(Boolean) || f.tp.value) {
      if (nums.some((v) => v === '' || !isFinite(+v)) || !f.tp.value) { toast('궤도 요소를 모두 채워 주세요', '아니면 전부 비워 두세요', '!'); return; }
      ['q', 'e', 'i', 'peri', 'node'].forEach((k, i) => { c[k] = +nums[i]; });
      c.tp = new Date(f.tp.value + 'Z').toISOString();
    }
    await DB.saveComet(c);
    cometDlg.close();
    await reload();
    select('comet:' + c.id);
    toast(`${c.name} 추가`, c.tp ? '궤도로 위치를 계산해요' : '기록할 때 위치를 찍어 주세요', '☄');
  });
  $('#cometDelete').onclick = async () => {
    if (!editingComet) return;
    const used = state.obs.filter((o) => o.target.key === 'comet:' + editingComet.id);
    if (!confirm(used.length ? `이 혜성 기록 ${used.length}개도 함께 지울까요?` : '이 혜성을 지울까요?')) return;
    for (const o of used) await DB.deleteObservation(o.id);
    await DB.deleteComet(editingComet.id);
    cometDlg.close();
    state.selectedKey = null;
    await reload();
  };

  function indexComets() {
    for (const k of [...items.keys()]) if (k.startsWith('comet:')) items.delete(k);
    for (const c of state.comets) {
      const el = c.q != null && c.tp ? { q: c.q, e: c.e, i: c.i, peri: c.peri, node: c.node, tp: c.tp } : null;
      items.set('comet:' + c.id, { kind: 'comet', key: 'comet:' + c.id, cometId: c.id, id: c.name, name: c.name, el, moving: !!el });
    }
  }

  // ------------------------------------------------------------------ search
  const searchIndex = [];
  function buildSearch() {
    searchIndex.length = 0;
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s·\-–]/g, '');
    for (const it of items.values()) {
      const keys = [it.key, it.id, it.ko, it.en, it.la, it.name, it.ngc, it.m].filter(Boolean).map(norm);
      searchIndex.push({ it, keys });
    }
    for (const [a, k] of alias) searchIndex.push({ it: items.get(k), keys: [norm(a)], via: a });
    buildSearch.norm = norm;
  }
  let srSel = 0, srList = [];
  function runSearch(q) {
    const ul = $('#searchResults');
    const n = buildSearch.norm(q);
    if (!n) { ul.hidden = true; return; }
    const scored = [];
    for (const e of searchIndex) {
      let best = 0;
      for (const k of e.keys) {
        if (k === n) best = Math.max(best, 100);
        else if (k.startsWith(n)) best = Math.max(best, 60 - Math.min(20, k.length - n.length));
        else if (n.length > 1 && k.includes(n)) best = Math.max(best, 25);
      }
      if (best) {
        const bias = { planet: 9, moon: 9, con: 7, messier: 8, star: 5, comet: 9, dso: 0 }[e.it.kind] || 0;
        scored.push([best + bias - (e.it.mag ?? 8) * 0.3, e]);
      }
    }
    scored.sort((a, b) => b[0] - a[0]);
    const seen = new Set();
    srList = scored.map(([, e]) => e).filter((e) => !seen.has(e.it.key) && seen.add(e.it.key)).slice(0, 12);
    srSel = 0;
    ul.innerHTML = srList.length ? srList.map((e, i) => {
      const it = e.it, m = state.marks.has(it.key);
      return `<li role="option" data-i="${i}" aria-selected="${i === 0}"><span class="sr-id">${esc(it.kind === 'con' ? it.key : it.kind === 'planet' || it.kind === 'moon' ? PLANET_SYMS[it.key] : it.kind === 'comet' ? '☄' : e.via || it.id)}</span><span class="sr-name">${esc(it.name)}</span><span class="sr-kind">${m ? '✓ ' : ''}${KIND_KO[it.kind]}</span></li>`;
    }).join('') : '<li class="sr-empty">찾는 천체가 없어요</li>';
    ul.hidden = false;
    for (const li of $$('li[data-i]', ul)) li.onpointerdown = (ev) => { ev.preventDefault(); pickSearch(+li.dataset.i); };
  }
  function pickSearch(i) {
    const e = srList[i];
    if (!e) return;
    $('#searchResults').hidden = true;
    $('#searchInput').value = '';
    $('#searchInput').blur();
    select(e.it.key);
  }
  const si = $('#searchInput');
  si.addEventListener('input', () => runSearch(si.value));
  si.addEventListener('focus', () => si.value && runSearch(si.value));
  si.addEventListener('blur', () => setTimeout(() => { $('#searchResults').hidden = true; }, 120));
  si.addEventListener('keydown', (e) => {
    const lis = $$('#searchResults li[data-i]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      srSel = (srSel + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % Math.max(1, lis.length);
      lis.forEach((li, i) => li.setAttribute('aria-selected', String(i === srSel)));
    } else if (e.key === 'Enter') { e.preventDefault(); pickSearch(srSel); }
    else if (e.key === 'Escape') { $('#searchResults').hidden = true; si.blur(); }
  });

  // ------------------------------------------------------------------ toasts
  function toast(title, sub, icon, big, tone) {
    const el = document.createElement('div');
    el.className = 'toast' + (big ? ' big' : '') + (tone ? ' t-' + tone : '');
    el.style.setProperty('--life', big ? '4.2s' : '3.4s');
    const glyph = { photo: ICONS.photo, seen: ICONS.seen, known: ICONS.known }[tone];
    el.innerHTML = `<span class="t-ico">${glyph || esc(icon || '★')}</span><span><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), big ? 4800 : 4000);
  }

  // ------------------------------------------------------------------ header controls
  function syncWho() {
    for (const b of $$('.who-btn')) b.setAttribute('aria-pressed', String(b.dataset.who === state.who));
    $$('.who-btn .who-name')[0].textContent = observer('a').name;
    $$('.who-btn .who-name')[1].textContent = observer('b').name;
    $('.lg-name-a').textContent = observer('a').name;
    $('.lg-name-b').textContent = observer('b').name;
    $('.legend-who').hidden = state.who !== 'both';
    $('.legend-status').hidden = state.who === 'both';
    document.documentElement.style.setProperty('--obs-a', observer('a').color);
    document.documentElement.style.setProperty('--obs-b', observer('b').color);
  }
  for (const b of $$('.who-btn')) b.onclick = () => {
    state.who = b.dataset.who; prefs.who = state.who; savePrefs();
    syncWho(); loadThumbs(); refreshAll();
  };

  const timeInput = $('#chartTime');
  const timeChip = $('#timeChip');
  function setChartDate(d) {
    state.chartDate = d; timeInput.value = toLocalInput(d);
    timeChip.querySelector('span').innerHTML = fmtChip(d);
    computeBodies(); view.dirty = true; renderPanel();
  }
  timeChip.onclick = () => { try { timeInput.showPicker(); } catch (e) { timeInput.focus(); } };
  $('#hourBack').onclick = () => setChartDate(new Date(state.chartDate.getTime() - 3600e3));
  $('#hourFwd').onclick = () => setChartDate(new Date(state.chartDate.getTime() + 3600e3));
  timeInput.addEventListener('change', () => { if (timeInput.value) setChartDate(new Date(timeInput.value)); });
  $('#nowBtn').onclick = () => setChartDate(new Date());

  $('#zoomIn').onclick = () => view.zoomAt(0.7, view.w / 2, view.h / 2);
  $('#zoomOut').onclick = () => view.zoomAt(1 / 0.7, view.w / 2, view.h / 2);
  $('#zenithBtn').onclick = () => {
    if (Math.abs(state.chartDate - Date.now()) > 5 * 60e3) setChartDate(new Date());
    const z = A.fromHorizontal(0, 90, jd(), state.site.lat, state.site.lon);
    view.flyTo(z.ra, z.dec, 140, 1200);
  };
  const layersBtn = $('#layersBtn'), layersPanel = $('#layersPanel');
  layersBtn.onclick = () => { layersPanel.hidden = !layersPanel.hidden; layersBtn.setAttribute('aria-expanded', String(!layersPanel.hidden)); };
  for (const cb of $$('[data-layer]')) {
    cb.checked = !!state.layers[cb.dataset.layer];
    cb.onchange = () => { state.layers[cb.dataset.layer] = cb.checked; prefs.layers = state.layers; savePrefs(); view.dirty = true; };
  }
  document.addEventListener('pointerdown', (e) => {
    if (!layersPanel.hidden && !layersPanel.contains(e.target) && !layersBtn.contains(e.target)) { layersPanel.hidden = true; layersBtn.setAttribute('aria-expanded', 'false'); }
  });
  for (const b of $$('.tab')) b.onclick = () => setTab(b.dataset.tab);
  for (const d of $$('dialog')) {
    for (const x of $$('[data-close]', d)) x.onclick = () => d.close();
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }

  // red night-vision mode
  function applyTheme() {
    if (prefs.red) document.documentElement.dataset.theme = 'red'; else delete document.documentElement.dataset.theme;
    view.refreshColors();
  }
  const redBtn = document.createElement('button');
  redBtn.className = 'icon-btn'; redBtn.type = 'button'; redBtn.id = 'redBtn';
  redBtn.setAttribute('aria-label', '붉은 야간 모드'); redBtn.title = '붉은 야간 모드 (눈의 암적응 지키기)';
  redBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 12.6A6.5 6.5 0 017.4 4.5a6.5 6.5 0 108.1 8.1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  redBtn.onclick = () => { prefs.red = !prefs.red; savePrefs(); applyTheme(); redBtn.setAttribute('aria-pressed', String(!!prefs.red)); };
  $('.sky-hud-left').appendChild(redBtn);

  // settings
  const setDlg = $('#settingsDlg'), setForm = $('#settingsForm');
  $('#menuBtn').onclick = () => {
    const f = setForm.elements;
    f.nameA.value = observer('a').name; f.nameB.value = observer('b').name;
    f.lat.value = state.site.lat; f.lon.value = state.site.lon;
    $('#backendBadge').textContent = DB.name === 'local' ? '이 기기 (IndexedDB)' : '클라우드';
    setDlg.showModal();
  };
  $('#useGeo').onclick = () => {
    if (!navigator.geolocation) { toast('위치를 가져올 수 없어요', '', '!'); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      setForm.elements.lat.value = p.coords.latitude.toFixed(3); setForm.elements.lon.value = p.coords.longitude.toFixed(3);
    }, () => toast('위치 권한이 없어요', '위도·경도를 직접 넣어 주세요', '!'));
  };
  setForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = setForm.elements;
    for (const [id, v] of [['a', f.nameA.value], ['b', f.nameB.value]]) {
      const o = { ...observer(id), name: v.trim() || observer(id).name };
      await DB.saveObserver(o);
    }
    const lat = parseFloat(f.lat.value), lon = parseFloat(f.lon.value);
    if (isFinite(lat) && isFinite(lon)) { state.site = { lat: Math.max(-90, Math.min(90, lat)), lon: A.wrap180(lon) }; prefs.site = state.site; savePrefs(); }
    setDlg.close();
    await reload();
  });
  $('#exportBtn').onclick = async () => {
    const data = await Store.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `하늘수첩-백업-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#importBtn').onclick = () => $('#importInput').click();
  $('#importInput').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const n = await Store.importAll(JSON.parse(await file.text()));
      setDlg.close();
      await reload();
      toast('백업을 불러왔어요', `기록 ${n}개`, '✓');
    } catch (err) { toast('불러오지 못했어요', err.message, '!'); }
  };

  // mobile sheet
  const panel = $('#panel');
  let grip = null;
  $('#sheetGrip').addEventListener('pointerdown', (e) => { grip = { y: e.clientY }; e.target.setPointerCapture(e.pointerId); });
  $('#sheetGrip').addEventListener('pointerup', (e) => {
    if (!grip) return;
    const dy = e.clientY - grip.y; grip = null;
    if (Math.abs(dy) < 6) { panel.classList.toggle('min'); panel.classList.remove('max'); }
    else if (dy > 0) { if (panel.classList.contains('max')) panel.classList.remove('max'); else panel.classList.add('min'); }
    else { if (panel.classList.contains('min')) panel.classList.remove('min'); else panel.classList.add('max'); }
    setTimeout(() => view.resize(), 380);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
    if (e.key === '/') { e.preventDefault(); si.focus(); }
    else if (e.key === '+' || e.key === '=') view.zoomAt(0.75, view.w / 2, view.h / 2);
    else if (e.key === '-') view.zoomAt(1 / 0.75, view.w / 2, view.h / 2);
    else if (e.key === 'Escape') { state.selectedKey = null; renderPanel(); }
    else if (e.key.toLowerCase() === 'r' && selected()) openRecord(state.selectedKey);
  });

  // ------------------------------------------------------------------ load
  async function reload() {
    try {
      state.observers = await DB.listObservers();
      state.obs = await DB.listObservations();
      state.comets = await DB.listComets();
      state.photoMeta = await DB.listPhotoMeta();
    } catch (err) {
      console.error(err);
      toast('저장소를 열 수 없어요', err.message, '!');
    }
    indexComets();
    buildSearch();
    syncWho();
    await loadThumbs();
    refreshAll();
  }

  (async function init() {
    applyTheme();
    redBtn.setAttribute('aria-pressed', String(!!prefs.red));
    setChartDate(state.chartDate);
    const narrow = window.matchMedia('(max-width: 560px)');
    const ph = () => { si.placeholder = narrow.matches ? '천체 찾기' : 'M31, NGC 7000, 오리온, 목성, 베가…'; };
    ph(); narrow.addEventListener('change', ph);
    const firstRun = !prefs.view;
    if (prefs.view) view.setView(prefs.view.ra, prefs.view.dec, prefs.view.fov);
    else { const z = A.fromHorizontal(0, 90, jd(), state.site.lat, state.site.lon); view.setView(z.ra, z.dec, 120); }
    await reload();
    if (firstRun && !state.obs.length && state.hintKey) {
      const h = lookup(state.hintKey);
      view.setView(h.ra, h.dec + 18, 95);
    }
    // a hook for quick checks from the console
    window.skylog = { state, select, openRecord, view, reload, toast, setChartDate, lookup };
  })();
})();
