/* 하늘 수첩 — storage.
   Everything the UI reads or writes goes through SkyStore, so the backend can be swapped without touching app.js.

   - LocalBackend (default): IndexedDB in this browser. Works offline, opened straight from the file.
   - CloudBackend: the shape of the shared two-person backend. It is NOT connected yet; every call throws
     NotConnectedError. To connect it later, implement the methods below against the chosen service
     (e.g. Supabase: tables `observers`, `observations`, `comets`, storage bucket `photos`) and set
     SKYLOG_CONFIG.backend = 'cloud'.

   Data shapes
     observer     { id: 'a'|'b', name, color }
     observation  { id, observer, target: { kind, key }, seen, photo, identified,
                    when (ISO), place, gear, note, ra, dec, photos: [photoId], createdAt, updatedAt }
                    kind: 'messier' | 'dso' | 'star' | 'con' | 'planet' | 'moon' | 'comet'
                    ra/dec are stored for moving targets (planets, Moon, comets) at the observation time.
     comet        { id, name, q, e, i, peri, node, tp, note }   (elements optional)
     photo        { id, observationId, blob (≤1600px JPEG), thumb (≤360px JPEG), name, createdAt } */
(function () {
  'use strict';

  window.SKYLOG_CONFIG = Object.assign({
    backend: 'local',          // 'local' | 'cloud'
    cloud: { url: '', anonKey: '', workspace: '' },
  }, window.SKYLOG_CONFIG || {});

  const DEFAULT_OBSERVERS = [
    { id: 'a', name: '나', color: '#FF9A7E' },
    { id: 'b', name: '짝꿍', color: '#8EBBFF' },
  ];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------------- IndexedDB
  class LocalBackend {
    constructor() { this.name = 'local'; this.db = null; }
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('skylog', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('observers', { keyPath: 'id' });
          const o = db.createObjectStore('observations', { keyPath: 'id' });
          o.createIndex('observer', 'observer');
          db.createObjectStore('comets', { keyPath: 'id' });
          const p = db.createObjectStore('photos', { keyPath: 'id' });
          p.createIndex('observationId', 'observationId');
        };
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => reject(req.error);
      });
    }
    async tx(store, mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let out;
        Promise.resolve(fn(s)).then((v) => { out = v; });
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
    req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
    all(store) { return this.tx(store, 'readonly', (s) => this.req(s.getAll())); }
    put(store, v) { return this.tx(store, 'readwrite', (s) => { s.put(v); return v; }); }
    del(store, id) { return this.tx(store, 'readwrite', (s) => { s.delete(id); }); }
    get(store, id) { return this.tx(store, 'readonly', (s) => this.req(s.get(id))); }

    async listObservers() {
      const list = await this.all('observers');
      if (list.length) return DEFAULT_OBSERVERS.map((d) => list.find((o) => o.id === d.id) || d);
      for (const o of DEFAULT_OBSERVERS) await this.put('observers', o);
      return DEFAULT_OBSERVERS.slice();
    }
    saveObserver(o) { return this.put('observers', o); }
    listObservations() { return this.all('observations'); }
    saveObservation(o) { return this.put('observations', o); }
    async deleteObservation(id) {
      const photos = await this.tx('photos', 'readonly', (s) => this.req(s.index('observationId').getAllKeys(id)));
      for (const pid of photos) await this.del('photos', pid);
      return this.del('observations', id);
    }
    listComets() { return this.all('comets'); }
    saveComet(c) { return this.put('comets', c); }
    deleteComet(id) { return this.del('comets', id); }
    savePhoto(p) { return this.put('photos', p); }
    getPhoto(id) { return this.get('photos', id); }
    deletePhoto(id) { return this.del('photos', id); }
    listPhotoMeta() {
      return this.tx('photos', 'readonly', (s) => this.req(s.getAll())).then((all) =>
        all.map(({ id, observationId, thumb, name, createdAt }) => ({ id, observationId, thumb, name, createdAt })));
    }
  }

  // ---------------- shared cloud (scaffold only)
  class NotConnectedError extends Error {
    constructor() { super('클라우드 저장소는 아직 연결되지 않았어요.'); this.name = 'NotConnectedError'; }
  }
  class CloudBackend {
    constructor(cfg) { this.name = 'cloud'; this.cfg = cfg; }
    // Expected later: sign-in for exactly two people; each row carries `observer` so both logs live side by side.
    async listObservers() { throw new NotConnectedError(); }
    async saveObserver() { throw new NotConnectedError(); }
    async listObservations() { throw new NotConnectedError(); }
    async saveObservation() { throw new NotConnectedError(); }
    async deleteObservation() { throw new NotConnectedError(); }
    async listComets() { throw new NotConnectedError(); }
    async saveComet() { throw new NotConnectedError(); }
    async deleteComet() { throw new NotConnectedError(); }
    async savePhoto() { throw new NotConnectedError(); }   // upload blob + thumb to the photos bucket
    async getPhoto() { throw new NotConnectedError(); }
    async deletePhoto() { throw new NotConnectedError(); }
    async listPhotoMeta() { throw new NotConnectedError(); }
  }

  const backend = window.SKYLOG_CONFIG.backend === 'cloud'
    ? new CloudBackend(window.SKYLOG_CONFIG.cloud)
    : new LocalBackend();

  // ---------------- image helpers
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
      img.src = url;
    });
  }
  function resize(img, max, quality, asDataURL) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (asDataURL) return Promise.resolve(c.toDataURL('image/jpeg', quality));
    return new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  }
  async function makePhoto(file, observationId) {
    const img = await loadImage(file);
    return {
      id: uid(), observationId, name: file.name || 'photo.jpg', createdAt: new Date().toISOString(),
      blob: await resize(img, 1600, 0.86, false), thumb: await resize(img, 360, 0.8, true),
    };
  }

  // ---------------- backup
  const blobToDataURL = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  const dataURLToBlob = (u) => fetch(u).then((r) => r.blob());

  async function exportAll() {
    const photos = [];
    for (const m of await backend.listPhotoMeta()) {
      const p = await backend.getPhoto(m.id);
      photos.push({ ...p, blob: p.blob ? await blobToDataURL(p.blob) : null });
    }
    return {
      app: 'skylog', version: 1, exportedAt: new Date().toISOString(),
      observers: await backend.listObservers(), observations: await backend.listObservations(),
      comets: await backend.listComets(), photos,
    };
  }
  async function importAll(data) {
    if (!data || data.app !== 'skylog') throw new Error('하늘 수첩 백업 파일이 아니에요.');
    for (const o of data.observers || []) await backend.saveObserver(o);
    for (const o of data.observations || []) await backend.saveObservation(o);
    for (const c of data.comets || []) await backend.saveComet(c);
    for (const p of data.photos || []) await backend.savePhoto({ ...p, blob: p.blob ? await dataURLToBlob(p.blob) : null });
    return (data.observations || []).length;
  }

  window.SkyStore = { backend, uid, makePhoto, exportAll, importAll, NotConnectedError };
})();
