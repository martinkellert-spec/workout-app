// Sicherung der Trainingsdaten in ein privates GitHub-Repo (Datei backup.json).
// Der Token liegt nur auf diesem Gerät (meta "sync") und landet nie im Backup selbst.
import * as db from './db.js';

const API = 'https://api.github.com';
const FILE = 'backup.json';
let running = null;

export async function getConfig() {
  return (await db.getMeta('sync')) || null;
}
async function saveConfig(patch) {
  const cfg = { ...((await getConfig()) || {}), ...patch };
  await db.setMeta('sync', cfg);
  return cfg;
}

const headers = (token, raw = false) => ({
  Authorization: `Bearer ${token}`,
  Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});
const fileUrl = (c) => `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${FILE}`;

// UTF-8-sicheres Base64 (für Umlaute)
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function explain(res) {
  if (res.status === 401) return 'Token ungültig oder abgelaufen.';
  if (res.status === 403) return 'Token hat keine Schreibrechte für das Repo (Contents: Read and write).';
  if (res.status === 404) return 'Repo nicht gefunden – Name prüfen und ob der Token Zugriff darauf hat.';
  let msg = '';
  try { msg = (await res.json()).message; } catch { /* egal */ }
  return `GitHub-Fehler ${res.status}${msg ? `: ${msg}` : ''}`;
}

/** Verbindung prüfen. Gibt { ok, private, hasBackup } zurück oder wirft Error mit verständlicher Meldung. */
export async function connect({ owner, repo, token }) {
  owner = owner.trim(); repo = repo.trim(); token = token.trim();
  if (!owner || !repo || !token) throw new Error('Bitte Benutzername, Repo und Token ausfüllen.');
  let res;
  try { res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: headers(token) }); }
  catch { throw new Error('Keine Verbindung zu GitHub – bist du online?'); }
  if (!res.ok) throw new Error(await explain(res));
  const info = await res.json();
  if (info.permissions && !info.permissions.push) throw new Error('Token darf in dieses Repo nicht schreiben (Contents: Read and write).');
  const head = await fetch(fileUrl({ owner, repo }), { headers: headers(token) });
  await saveConfig({ owner, repo, token, pending: true, lastError: '' });
  return { private: !!info.private, hasBackup: head.ok };
}

export async function disconnect() {
  await db.delMeta('sync');
}

/** Merkt vor, dass gesichert werden muss, und versucht es sofort (still im Hintergrund). */
export async function schedule() {
  const c = await getConfig();
  if (!c) return;
  await saveConfig({ pending: true });
  return push().catch(() => {});
}

/** Sichert jetzt. Wirft bei Fehler; vermerkt Fehler/Erfolg in der Konfiguration. */
export function push() {
  if (running) return running;
  running = (async () => {
    const c = await getConfig();
    if (!c) throw new Error('GitHub-Sicherung ist nicht eingerichtet.');
    if (!navigator.onLine) throw new Error('Offline – wird automatisch nachgeholt.');
    try {
      const data = await db.exportAll();
      const body = JSON.stringify(data, null, 1);
      // aktuelle Version (sha) holen, sonst lehnt GitHub das Überschreiben ab
      const cur = await fetch(fileUrl(c), { headers: headers(c.token), cache: 'no-store' });
      let sha;
      if (cur.ok) sha = (await cur.json()).sha;
      else if (cur.status !== 404) throw new Error(await explain(cur));
      const res = await fetch(fileUrl(c), {
        method: 'PUT',
        headers: { ...headers(c.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Backup ${new Date().toLocaleString('de-DE')} · ${data.sessions.filter((s) => s.endedAt).length} Trainings`,
          content: toBase64(body),
          ...(sha ? { sha } : {}),
        }),
      });
      if (!res.ok) throw new Error(await explain(res));
      await saveConfig({ pending: false, lastSyncAt: Date.now(), lastError: '' });
    } catch (e) {
      const msg = e instanceof TypeError ? 'Keine Verbindung zu GitHub – wird automatisch nachgeholt.' : e.message;
      await saveConfig({ lastError: msg });
      throw new Error(msg);
    }
  })().finally(() => { running = null; });
  return running;
}

/** Lädt backup.json von GitHub und ersetzt die Daten auf diesem Gerät. */
export async function restore() {
  const c = await getConfig();
  if (!c) throw new Error('GitHub-Sicherung ist nicht eingerichtet.');
  let res;
  try { res = await fetch(fileUrl(c), { headers: headers(c.token, true), cache: 'no-store' }); }
  catch { throw new Error('Keine Verbindung zu GitHub.'); }
  if (res.status === 404) throw new Error('Im Repo gibt es noch keine Sicherung.');
  if (!res.ok) throw new Error(await explain(res));
  const data = await res.json();
  await db.importAll(data);
  await saveConfig({ pending: false, lastSyncAt: Date.now(), lastError: '' });
  return data.sessions.filter((s) => s.endedAt).length;
}

// Ausstehende Sicherung nachholen, sobald wieder Netz da ist / App wieder im Vordergrund
export function autoRetry() {
  const retry = async () => { const c = await getConfig(); if (c?.pending) push().catch(() => {}); };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
  retry();
}

/** Neuestes Claude-Wochenreview aus dem Repo laden (reviews/latest.json). null, wenn keins da ist. */
export async function fetchReview() {
  const c = await getConfig();
  if (!c || !navigator.onLine) return null;
  const url = `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/reviews/latest.json`;
  try {
    const res = await fetch(url, { headers: headers(c.token, true), cache: 'no-store' });
    if (!res.ok) return null;
    const r = await res.json();
    return r && r.text ? { title: r.title || '', date: r.date || '', summary: r.summary || '', text: r.text, fetchedAt: Date.now() } : null;
  } catch { return null; }
}
