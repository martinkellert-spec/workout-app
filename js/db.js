// Minimaler IndexedDB-Wrapper. Stores: sessions (abgeschlossene Trainings), meta (Plan, Einstellungen, Entwurf)
const DB_NAME = 'workout-app';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getMeta = (key) => tx('meta', 'readonly', (s) => s.get(key));
export const setMeta = (key, val) => tx('meta', 'readwrite', (s) => s.put(val, key));
export const delMeta = (key) => tx('meta', 'readwrite', (s) => s.delete(key));

export const allSessions = async () => (await tx('sessions', 'readonly', (s) => s.getAll())) || [];
export const putSession = (session) => tx('sessions', 'readwrite', (s) => s.put(session));
export const deleteSession = (id) => tx('sessions', 'readwrite', (s) => s.delete(id));

// Diese Einträge bleiben nur auf dem Gerät: nie in ein Backup, nie überschrieben beim Wiederherstellen (enthält den GitHub-Token)
const LOCAL_ONLY = ['sync', 'review'];

export async function exportAll() {
  const metaKeys = await tx('meta', 'readonly', (s) => s.getAllKeys());
  const meta = {};
  for (const k of metaKeys) if (!LOCAL_ONLY.includes(k)) meta[k] = await getMeta(k);
  return { app: 'workout-app', version: 1, exportedAt: new Date().toISOString(), meta, sessions: await allSessions() };
}

export async function importAll(data) {
  if (data?.app !== 'workout-app' || !Array.isArray(data.sessions)) throw new Error('Das ist keine Backup-Datei dieser App.');
  const keep = {};
  for (const k of LOCAL_ONLY) keep[k] = await getMeta(k);
  await tx('sessions', 'readwrite', (s) => s.clear());
  await tx('meta', 'readwrite', (s) => s.clear());
  for (const ses of data.sessions) await putSession(ses);
  for (const [k, v] of Object.entries(data.meta || {})) if (!LOCAL_ONLY.includes(k)) await setMeta(k, v);
  for (const [k, v] of Object.entries(keep)) if (v !== undefined) await setMeta(k, v);
}

export async function wipeAll() {
  await tx('sessions', 'readwrite', (s) => s.clear());
  await tx('meta', 'readwrite', (s) => s.clear());
}
