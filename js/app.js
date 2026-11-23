import * as db from './db.js';
import * as sync from './sync.js';
import {
  normalizePlan, normalizeHistory, historyFor, suggest, describePerf, records, newRecords, volume, nextDay,
  weekStart, weeklyStats, streak, fmtNum, fmtDuration, epley, topWeight, unitLabel, nextOpen, supersetNext,
  nextWeight, prevWeight,
} from './logic.js';
import { lineChart, barChart } from './charts.js';

export const APP_VERSION = '1.3.0';

const $app = document.getElementById('app');
const $tabbar = document.getElementById('tabbar');
const S = { plan: null, sessions: [], draft: null, settings: { restDefault: 90 }, pickDay: null, histTab: 'sessions' };

const val = (id) => document.getElementById(id)?.value || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const dateLong = (ts) => new Date(ts).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const kg = (w, type) => (type === 'bodyweight' && !w ? 'KG' : `${fmtNum(w)} kg`);
const done = () => S.sessions.filter((s) => s.endedAt);

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- Sheets (Bottom-Dialoge) ----------
function sheet(html, handlers = {}) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.addEventListener('click', (e) => {
    if (e.target === bg) return closeSheet();
    const a = e.target.closest('[data-s]');
    if (a && handlers[a.dataset.s]) handlers[a.dataset.s](a, bg);
  });
  document.body.appendChild(bg);
  return bg;
}
const closeSheet = () => document.querySelector('.sheet-bg')?.remove();
function confirmSheet(title, text, okLabel, onOk, danger = true) {
  sheet(`<h3>${esc(title)}</h3><p class="muted" style="text-align:center">${esc(text)}</p>
    <button class="btn ${danger ? 'danger' : 'primary'}" data-s="ok">${esc(okLabel)}</button>
    <button class="btn" data-s="cancel">Abbrechen</button>`,
  { ok: () => { closeSheet(); onOk(); }, cancel: closeSheet });
}

// ---------- Ton, Vibration, Display an ----------
let audio;
function unlockAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ohne Ton */ } }
  audio?.resume?.();
}
function beep() {
  navigator.vibrate?.([300, 120, 300]);
  if (!audio) return;
  [0, 0.22, 0.44].forEach((t, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2);
  });
}
let wakeLock;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.draft) keepAwake(true); });

// ---------- Daten laden ----------
async function load() {
  [S.plan, S.sessions, S.draft] = await Promise.all([db.getMeta('plan'), db.allSessions(), db.getMeta('draft')]);
  S.settings = { ...S.settings, ...((await db.getMeta('settings')) || {}) };
  S.sync = await sync.getConfig();
}
const saveDraft = () => db.setMeta('draft', S.draft);

// ---------- Routing ----------
const TABS = [
  ['#/', 'Start', '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>'],
  ['#/history', 'Verlauf', '<path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-6"/>'],
  ['#/week', 'Woche', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['#/settings', 'Mehr', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'],
];
function renderTabbar(route) {
  const hidden = route === 'train' || route === 'done';
  $tabbar.classList.toggle('hidden', hidden);
  $app.classList.toggle('no-tabs', hidden);
  const base = { '': '#/', history: '#/history', session: '#/history', exercise: '#/history', week: '#/week', settings: '#/settings' }[route] || '#/';
  $tabbar.innerHTML = TABS.map(([h, label, icon]) =>
    `<a href="${h}" class="${h === base ? 'active' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}</a>`).join('');
}

function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if ((route === 'train' || route === 'done') && !S.draft) return go('#/');
  renderTabbar(route);
  const views = { '': viewStart, train: viewTrain, done: viewDone, history: viewHistory, session: viewSession, exercise: viewExercise, week: viewWeek, settings: viewSettings };
  $app.innerHTML = (views[route] || viewStart)(decodeURIComponent(arg || ''));
  if (route !== 'train') window.scrollTo(0, 0);
  tick();
}
window.addEventListener('hashchange', render);

// ---------- Start ----------
function weekStrip() {
  const ws = weekStart(Date.now());
  const days = new Set(done().map((s) => new Date(s.startedAt).toDateString()));
  const today = new Date().toDateString();
  return `<div class="weekstrip">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((l, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const ds = d.toDateString();
    return `<div>${l}<b class="${days.has(ds) ? 'done' : ''} ${ds === today ? 'today' : ''}">${d.getDate()}</b></div>`;
  }).join('')}</div>`;
}

function planPreview(day) {
  return day.exercises.map((cfg) => {
    const s = suggest(cfg, historyFor(S.sessions, cfg.key));
    return `<li><span>${cfg.group ? `<span class="grp">${esc(cfg.group)}</span>` : ''}${esc(cfg.name)}</span><span>${cfg.sets}×${s.reps}${cfg.unit === 'sec' ? ' s' : ''} · ${kg(s.weight, cfg.type)}${s.status === 'up' && cfg.type !== 'bodyweight' ? ' ▲' : ''}</span></li>`;
  }).join('');
}

function viewStart() {
  if (!S.plan) {
    return `<h1>Workout</h1>
      <div class="hero"><div class="label">Willkommen</div><div class="day">Noch kein Trainingsplan</div>
      <p class="muted">Lade deinen 3er-Plan mit einem Tipp. Deine bisherigen Trainings werden mit übernommen.</p>
      <button class="btn primary big" data-a="loadMine">Meinen Plan laden</button>
      <button class="btn" data-a="loadExample">Beispielplan ausprobieren</button>
      <button class="btn ghost" data-a="importPlan">Plan-Datei importieren</button>
      <button class="btn ghost" data-a="gotoSync">Sicherung von GitHub holen</button></div>`;
  }
  if (S.draft) {
    const d = S.draft, n = d.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
    return `<h1>Workout</h1>
      <div class="hero"><div class="label">Training läuft</div><div class="day">${esc(d.dayName)}</div>
      <p class="muted">Seit ${fmtDuration(Date.now() - d.startedAt)} · ${n} Sätze erledigt</p>
      <button class="btn primary big" data-a="resume">Weiter trainieren</button></div>
      <h2>Diese Woche</h2><div class="card">${weekStrip()}</div>`;
  }
  const next = nextDay(S.plan, S.sessions);
  const day = S.plan.days.find((d) => d.id === S.pickDay) || next;
  const last = done().sort((a, b) => b.startedAt - a.startedAt)[0];
  return `<h1>Workout</h1>
    ${S.plan.days.length > 1 ? `<div class="chips" style="margin-top:12px">${S.plan.days.map((d) =>
      `<button class="chip ${d.id === day.id ? 'on' : ''}" data-a="pickDay" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join('')}</div>` : ''}
    <div class="hero"><div class="label">${day.id === next.id ? 'Heute dran' : 'Ausgewählt'}</div>
      <div class="day">${esc(day.name)}</div>
      ${day.note ? `<p class="muted small">${esc(day.note)}</p>` : ''}
      <ul>${planPreview(day)}</ul>
      <button class="btn primary big" data-a="start" data-id="${esc(day.id)}">Training starten</button></div>
    <h2>Diese Woche</h2><div class="card">${weekStrip()}</div>
    ${last ? `<h2>Zuletzt</h2><a class="card tap row" href="#/session/${last.id}"><div class="grow"><b>${esc(last.dayName)}</b><div class="muted small">${dateLong(last.startedAt)} · ${fmtDuration(last.endedAt - last.startedAt)}</div></div><span class="chev"></span></a>` : ''}`;
}

function startTraining(dayId) {
  const day = S.plan.days.find((d) => d.id === dayId);
  S.draft = {
    id: String(Date.now()), startedAt: Date.now(), planName: S.plan.name, dayId: day.id, dayName: day.name, dayNote: day.note || '', idx: 0,
    rest: null,
    exercises: day.exercises.map((cfg) => {
      const hist = historyFor(S.sessions, cfg.key);
      const sg = suggest(cfg, hist);
      return {
        key: cfg.key, name: cfg.name, type: cfg.type, unit: cfg.unit, group: cfg.group, cfg, note: '', suggestion: sg,
        last: hist[0] ? { date: hist[0].date, text: describePerf(hist[0], cfg.type, cfg.unit), note: hist[0].note || '' } : null,
        sets: Array.from({ length: cfg.sets }, () => ({ weight: sg.weight, reps: sg.reps, done: false })),
      };
    }),
  };
  saveDraft();
  keepAwake(true);
  go('#/train');
}

// ---------- Training ----------
function viewTrain() {
  const d = S.draft, ex = d.exercises[d.idx], n = d.exercises.length;
  const doneCount = d.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
  const total = d.exercises.reduce((a, e) => a + e.sets.length, 0);
  const nextIdx = ex.sets.findIndex((s) => !s.done);
  const allDone = nextIdx === -1;
  const isLast = d.idx === n - 1;
  const following = nextOpen(d.exercises, d.idx);
  const sg = ex.suggestion;
  const unitLbl = ex.type === 'bodyweight' ? 'Zusatz' : 'kg';
  const repLbl = ex.unit === 'sec' ? 's' : 'Wdh';
  const mates = ex.group ? d.exercises.filter((e) => e.group === ex.group) : [];
  // Nur noch die aktuelle Übung/Gruppe offen → "Training beenden" anbieten (z. B. nach 2 von 3 Core-Runden)
  const onlyGroupLeft = d.exercises.every((e, i) => i === d.idx || (ex.group && e.group === ex.group) || !e.sets.some((x) => !x.done));
  return `
    <div class="trainhead">
      <button data-a="trainMenu" aria-label="Menü">✕</button>
      <button data-a="overview">${esc(d.dayName.split(' – ')[0])} · ${d.idx + 1}/${n} ▾</button>
      <span id="elapsed" style="min-width:44px;text-align:right"></span>
    </div>
    <div class="progress"><i style="width:${(doneCount / total) * 100}%"></i></div>
    ${mates.length > 1 ? `<div class="ssbar">${mates.length > 2 ? 'Circuit' : 'Supersatz'} ${esc(ex.group)}: ${mates.map((m) => m === ex ? `<b>${esc(m.name)}</b>` : esc(m.name)).join(' ⇄ ')}</div>` : ''}
    <div class="exname">${esc(ex.name)}</div>
    ${d.idx === 0 && d.dayNote && !d.exercises.some((e) => e.sets.some((x) => x.done)) ? `<div class="card small"><b>Warm-up:</b> ${esc(d.dayNote)}</div>` : ''}
    <div class="memory">
      <div class="last">${ex.last ? `Letztes Mal (${dateLong(ex.last.date)}): <b>${esc(ex.last.text)}</b>` : 'Noch keine Werte gespeichert'}</div>
      <div class="sugg ${sg.status}">${sg.status === 'up' ? '▲ ' : sg.status === 'down' ? '⚠ ' : sg.status === 'max' ? '★ ' : ''}${esc(sg.text)}</div>
      ${sg.status === 'down' ? `<button class="btn ghost" data-a="lighter" style="justify-content:flex-start">Auf ${fmtNum(sg.lighter)} kg reduzieren</button>` : ''}
      ${ex.cfg.hint ? `<div class="note">${esc(ex.cfg.hint)}</div>` : ''}
      ${ex.last?.note ? `<div class="note">Notiz letztes Mal: „${esc(ex.last.note)}“</div>` : ''}
    </div>
    <div class="sets">
      ${ex.sets.map((s, i) => `<div class="set ${s.done ? 'done' : ''} ${i === nextIdx ? 'next' : ''}">
        <div class="n">${i + 1}</div>
        <button class="val" data-a="edit" data-i="${i}" data-f="weight">${ex.type === 'bodyweight' && !s.weight ? '<small>KG</small>' : `${fmtNum(s.weight)}<small>${unitLbl}</small>`}</button>
        <button class="val" data-a="edit" data-i="${i}" data-f="reps">${s.reps}<small>${repLbl}</small></button>
        <button class="chk" data-a="toggle" data-i="${i}" aria-label="Satz ${i + 1} erledigt">${s.done ? '✓' : ''}</button>
      </div>`).join('')}
      <button class="addset" data-a="addSet">+ Satz hinzufügen</button>
    </div>
    ${allDone
    ? (following === -1 ? '<button class="btn good big" data-a="finish">Training abschließen ✓</button>'
      : `<button class="btn primary big" data-a="goOpen">Weiter: ${esc(d.exercises[following].name)} →</button>`)
    : '<button class="btn primary big" data-a="setDone">SATZ FERTIG</button>'}
    <div id="timer"></div>
    <div class="navrow">
      <button class="btn" data-a="prev" ${d.idx === 0 ? 'disabled' : ''}>← Vorherige</button>
      <button class="btn" data-a="note">${ex.note ? '✎ Notiz ✓' : '✎ Notiz'}</button>
    </div>
    ${!isLast && !allDone && !onlyGroupLeft ? '<button class="btn ghost" data-a="next">Übung überspringen →</button>' : ''}
    ${onlyGroupLeft && following !== -1 ? '<button class="btn ghost" data-a="finish">Training jetzt beenden</button>' : ''}`;
}

// Timer & Trainingsdauer – alle 250 ms aktualisieren (berechnet aus Zeitstempeln, läuft also auch nach Standby korrekt)
function tick() {
  const d = S.draft;
  const el = document.getElementById('elapsed');
  if (el && d) {
    const m = Math.floor((Date.now() - d.startedAt) / 60000);
    el.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }
  const t = document.getElementById('timer');
  if (!t) return;
  if (!d?.rest) { t.innerHTML = ''; return; }
  const left = Math.round((d.rest.endsAt - Date.now()) / 1000);
  if (left <= 0 && !d.rest.alerted) { d.rest.alerted = true; saveDraft(); beep(); }
  const abs = Math.abs(left);
  const txt = `${left < 0 ? '+' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  const cls = left <= 0 ? 'timer over' : 'timer';
  if (t.dataset.state !== cls) {
    t.dataset.state = cls;
    t.innerHTML = `<div class="${cls}"><div><div class="small">${left <= 0 ? 'Pause vorbei – los!' : 'Pause'}</div><div class="t"></div></div>
      <div class="row" style="gap:6px"><button data-a="restAdd">+30 s</button><button data-a="restStop">Stopp</button></div></div>`;
  }
  t.querySelector('.t').textContent = txt;
}
setInterval(tick, 250);

function startRest(sec) {
  S.draft.rest = sec > 0 ? { endsAt: Date.now() + sec * 1000, alerted: false } : null;
}

// Nach einem erledigten Satz: Pause starten (0 = direkt weiter) und bei Supersatz/Circuit zur nächsten Übung springen
function afterSet(ex) {
  const d = S.draft;
  const anyOpen = nextOpen(d.exercises, d.idx) !== -1 || ex.sets.some((s) => !s.done);
  startRest(anyOpen ? (ex.cfg.rest ?? S.settings.restDefault) : 0);
  const j = supersetNext(d.exercises, d.idx);
  if (j !== d.idx) { d.idx = j; toast(`→ ${d.exercises[j].name}`); window.scrollTo(0, 0); }
  saveDraft(); render();
}

function editValue(i, field) {
  const ex = S.draft.exercises[S.draft.idx], s = ex.sets[i];
  const step = field === 'weight' ? (ex.cfg.increment || 2.5) : 1;
  let v = s[field];
  const label = field === 'weight' ? (ex.type === 'bodyweight' ? 'Zusatzgewicht kg' : 'Gewicht kg') : unitLabel(ex.unit, true);
  const useList = field === 'weight' && ex.cfg.weights?.length;
  const bg = sheet(`<h3>Satz ${i + 1}</h3>
    <div class="stepper"><button data-s="minus">−</button>
      <div class="v"><input id="sv" inputmode="decimal" value="${fmtNum(v)}" style="width:100%;text-align:center;border:0;background:none;font-size:34px;font-weight:800"><small>${label}</small></div>
      <button data-s="plus">+</button></div>
    <p class="muted small" style="text-align:center">${useList ? `Deine Gewichte: ${ex.cfg.weights.map(fmtNum).join(' · ')} kg<br>` : ''}Gilt auch für die folgenden, noch offenen Sätze.</p>
    <button class="btn primary" data-s="ok">Übernehmen</button>`, {
    minus: () => { v = useList ? (prevWeight(ex.cfg, read()) ?? read()) : Math.max(0, Math.round((read() - step) * 100) / 100); upd(); },
    plus: () => { v = useList ? (nextWeight(ex.cfg, read()) ?? read()) : Math.round((read() + step) * 100) / 100; upd(); },
    ok: () => {
      v = read();
      ex.sets.forEach((x, j) => { if (j === i || (j > i && !x.done)) x[field] = field === 'reps' ? Math.round(v) : v; });
      saveDraft(); closeSheet(); render();
    },
  });
  const inp = bg.querySelector('#sv');
  const read = () => { const n = parseFloat(String(inp.value).replace(',', '.')); return Number.isFinite(n) ? n : v; };
  const upd = () => { inp.value = fmtNum(v); };
}

function overviewSheet() {
  const d = S.draft;
  sheet(`<h3>Übungen</h3><div class="list">${d.exercises.map((e, i) => {
    const c = e.sets.filter((s) => s.done).length;
    return `<button class="item" data-s="jump" data-i="${i}"><span class="grow" style="flex:1;${i === d.idx ? 'font-weight:700' : ''}">${esc(e.name)}</span><span class="muted">${c}/${e.sets.length}${c === e.sets.length ? ' ✓' : ''}</span></button>`;
  }).join('')}</div>`, { jump: (a) => { d.idx = +a.dataset.i; saveDraft(); closeSheet(); render(); } });
}

function noteSheet(title, value, onSave) {
  const bg = sheet(`<h3>${esc(title)}</h3><textarea id="nt" placeholder="z. B. Schulter zwickt, Griff enger nehmen …">${esc(value)}</textarea>
    <button class="btn primary" data-s="ok">Speichern</button>`, { ok: () => { onSave(bg.querySelector('#nt').value.trim()); closeSheet(); } });
  setTimeout(() => bg.querySelector('#nt').focus(), 250);
}

// ---------- Abschluss ----------
function viewDone() {
  const d = S.draft;
  const vol = volume(d);
  const sets = d.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
  const prs = newRecords(d, done());
  const faces = ['😫', '😕', '😐', '🙂', '💪'];
  return `<h1>Geschafft!</h1><p class="muted">${esc(d.dayName)} · ${dateLong(d.startedAt)}</p>
    <div class="stats" style="margin-top:16px">
      <div class="stat"><b>${fmtDuration(Date.now() - d.startedAt)}</b><span>Dauer</span></div>
      <div class="stat"><b>${sets}</b><span>Sätze</span></div>
      <div class="stat"><b>${fmtNum(Math.round(vol))}</b><span>kg bewegt</span></div>
    </div>
    ${prs.length ? `<h2>Neue Rekorde 🎉</h2>${prs.map((p) => `<div class="pr">${esc(p.name)}: ${esc(p.text)}</div>`).join('')}` : ''}
    <h2>Wie war's?</h2>
    <div class="feel">${faces.map((f, i) => `<button data-a="feel" data-v="${i + 1}" class="${d.feeling === i + 1 ? 'on' : ''}">${f}</button>`).join('')}</div>
    <textarea id="sessnote" placeholder="Notiz zum Training (optional)">${esc(d.note || '')}</textarea>
    <button class="btn good big" data-a="save">Speichern</button>
    <button class="btn ghost" data-a="backToTrain">Zurück zum Training</button>`;
}

// Nach jeder Datenänderung im Hintergrund zu GitHub sichern (falls eingerichtet); Einstellungen danach aktualisieren
async function backupSoon() {
  if (!S.sync) return;
  await sync.schedule();
  S.sync = await sync.getConfig();
  if (location.hash.startsWith('#/settings')) render();
}

async function saveSession() {
  const d = S.draft;
  d.note = document.getElementById('sessnote')?.value.trim() || '';
  const session = {
    id: d.id, startedAt: d.startedAt, endedAt: Date.now(), planName: d.planName, dayId: d.dayId, dayName: d.dayName,
    feeling: d.feeling || null, note: d.note,
    exercises: d.exercises.map((e) => ({ key: e.key, name: e.name, type: e.type, unit: e.unit || 'reps', note: e.note, sets: e.sets.map(({ weight, reps, done: dn }) => ({ weight, reps, done: dn })) })),
  };
  await db.putSession(session);
  await db.delMeta('draft');
  S.sessions.push(session); S.draft = null; S.pickDay = null;
  keepAwake(false);
  toast('Training gespeichert 💪');
  go('#/');
  backupSoon();
}

// ---------- Verlauf ----------
function exerciseIndex() {
  const map = new Map();
  for (const s of done().sort((a, b) => b.startedAt - a.startedAt))
    for (const e of s.exercises) if (!map.has(e.key) && e.sets.some((x) => x.done)) map.set(e.key, { key: e.key, name: e.name, type: e.type, unit: e.unit || 'reps' });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function viewHistory() {
  const list = done().sort((a, b) => b.startedAt - a.startedAt);
  const seg = `<div class="seg"><button data-a="histTab" data-v="sessions" class="${S.histTab === 'sessions' ? 'on' : ''}">Trainings</button><button data-a="histTab" data-v="exercises" class="${S.histTab === 'exercises' ? 'on' : ''}">Übungen</button></div>`;
  if (!list.length) return `<h1>Verlauf</h1>${seg}<div class="empty">Noch keine Trainings gespeichert.<br>Nach deinem ersten Training siehst du hier alles.</div>`;
  if (S.histTab === 'exercises') {
    return `<h1>Verlauf</h1>${seg}<div class="list">${exerciseIndex().map((e) => {
      const h = historyFor(S.sessions, e.key);
      return `<a class="item" href="#/exercise/${encodeURIComponent(e.key)}" style="color:inherit;text-decoration:none"><div style="flex:1;min-width:0"><b>${esc(e.name)}</b><div class="muted small">Zuletzt ${esc(describePerf(h[0], e.type, e.unit))}</div></div><span class="chev"></span></a>`;
    }).join('')}</div>`;
  }
  const faces = ['', '😫', '😕', '😐', '🙂', '💪'];
  return `<h1>Verlauf</h1>${seg}<div class="list">${list.map((s) => `<a class="item" href="#/session/${s.id}" style="color:inherit;text-decoration:none">
    <div style="flex:1;min-width:0"><b>${esc(s.dayName)}</b> ${faces[s.feeling || 0]}<div class="muted small">${dateLong(s.startedAt)} · ${fmtDuration(s.endedAt - s.startedAt)} · ${fmtNum(Math.round(volume(s)))} kg</div></div><span class="chev"></span></a>`).join('')}</div>`;
}

function viewSession(id) {
  const s = S.sessions.find((x) => x.id === id);
  if (!s) return '<div class="empty">Training nicht gefunden.</div>';
  const faces = ['', '😫', '😕', '😐', '🙂', '💪'];
  return `<button class="btn ghost" style="justify-content:flex-start;width:auto" data-a="back">‹ Verlauf</button>
    <h1>${esc(s.dayName)}</h1><p class="muted">${new Date(s.startedAt).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })}</p>
    <div class="stats"><div class="stat"><b>${fmtDuration(s.endedAt - s.startedAt)}</b><span>Dauer</span></div>
      <div class="stat"><b>${fmtNum(Math.round(volume(s)))}</b><span>kg bewegt</span></div>
      <div class="stat"><b>${faces[s.feeling || 0] || '–'}</b><span>Gefühl</span></div></div>
    ${s.note ? `<div class="card">${esc(s.note)}</div>` : ''}
    <div class="list">${s.exercises.map((e) => `<a class="item" href="#/exercise/${encodeURIComponent(e.key)}" style="color:inherit;text-decoration:none"><div style="flex:1;min-width:0"><b>${esc(e.name)}</b>
      <div class="muted small">${esc(describePerf(e, e.type, e.unit))}</div>${e.note ? `<div class="small" style="font-style:italic;margin-top:2px">„${esc(e.note)}“</div>` : ''}</div><span class="chev"></span></a>`).join('')}</div>
    <button class="btn danger" data-a="delSession" data-id="${s.id}">Training löschen</button>`;
}

function viewExercise(key) {
  const h = historyFor(S.sessions, key);
  if (!h.length) return '<div class="empty">Keine Daten für diese Übung.</div>';
  const info = exerciseIndex().find((e) => e.key === key) || { name: key, type: 'weight', unit: 'reps' };
  const r = records(h);
  const asc = [...h].reverse();
  const bw = info.type === 'bodyweight' && r.maxWeight === 0;
  const pts = asc.map((p) => bw
    ? { x: p.date, y: Math.max(...p.sets.map((s) => s.reps)) }
    : { x: p.date, y: topWeight(p), y2: Math.round(Math.max(...p.sets.map((s) => epley(s.weight, s.reps))) * 10) / 10 });
  return `<button class="btn ghost" style="justify-content:flex-start;width:auto" data-a="back">‹ Zurück</button>
    <h1>${esc(info.name)}</h1>
    <div class="stats" style="margin-top:12px">
      ${bw ? `<div class="stat"><b>${r.maxReps}</b><span>Max. ${info.unit === 'sec' ? 'Sekunden' : 'Wdh.'}</span></div>`
    : `<div class="stat"><b>${fmtNum(r.maxWeight)}</b><span>Max. kg</span></div><div class="stat"><b>${fmtNum(Math.round(r.best1RM * 10) / 10)}</b><span>Best 1RM (geschätzt)</span></div>`}
      <div class="stat"><b>${h.length}</b><span>Trainings</span></div>
    </div>
    <div class="card">${lineChart(pts)}
      <div class="legend">${bw ? `<span><i></i>Max. ${info.unit === 'sec' ? 'Sekunden' : 'Wdh.'}</span>` : '<span><i></i>Top-Gewicht</span><span><i class="l2"></i>geschätztes 1RM</span>'}</div></div>
    <h2>Alle Einträge</h2>
    <div class="list">${h.map((p) => `<div class="item"><div style="flex:1"><b>${esc(describePerf(p, info.type, info.unit))}</b><div class="muted small">${dateLong(p.date)}</div>${p.note ? `<div class="small" style="font-style:italic">„${esc(p.note)}“</div>` : ''}</div></div>`).join('')}</div>`;
}

// ---------- Woche ----------
function viewWeek() {
  const st = weeklyStats(S.sessions, 8);
  const cur = st[st.length - 1];
  const lbl = (w) => { const d = new Date(w.start); return `${d.getDate()}.${d.getMonth() + 1}.`; };
  return `<h1>Woche</h1>
    <div class="card" style="margin-top:16px">${weekStrip()}</div>
    <div class="stats">
      <div class="stat"><b>${cur.count}</b><span>Trainings diese Woche</span></div>
      <div class="stat"><b>${streak(S.sessions)}</b><span>Wochen in Folge 🔥</span></div>
      <div class="stat"><b>${done().length}</b><span>Trainings gesamt</span></div>
    </div>
    <h2>Trainings pro Woche</h2>
    <div class="card">${barChart(st.map((w, i) => ({ label: lbl(w), value: w.count, dim: i !== st.length - 1 })), (v) => v)}</div>
    <h2>Bewegtes Gewicht pro Woche (Tonnen)</h2>
    <div class="card">${barChart(st.map((w) => ({ label: lbl(w), value: Math.round(w.volume / 100) / 10 })))}</div>`;
}

// ---------- Einstellungen ----------
function viewSettings() {
  const p = S.plan;
  return `<h1>Mehr</h1>
    <h2>Trainingsplan</h2>
    ${p ? `<div class="card"><b>${esc(p.name)}</b><div class="muted small">${p.days.length} Trainingstage</div></div>
      <div class="list">${p.days.map((d) => `<div class="item" style="display:block"><b>${esc(d.name)}</b><div class="muted small">${d.exercises.map((e) => `${esc(e.name)} ${e.sets}×${e.repsMin === e.repsMax ? e.repsMin : `${e.repsMin}–${e.repsMax}`}${e.unit === 'sec' ? ' s' : ''}`).join(' · ')}</div></div>`).join('')}</div>` : '<div class="card muted">Noch kein Plan geladen.</div>'}
    <button class="btn" data-a="loadMine">Meinen Plan neu laden</button>
    <button class="btn" data-a="importPlan">Plan-Datei importieren (JSON)</button>
    <button class="btn" data-a="loadExample">Beispielplan laden</button>
    <h2>Pausentimer</h2>
    <div class="card row"><div class="grow">Standard-Pause (wenn der Plan keine vorgibt):</div>
      <div class="row" style="gap:6px"><button class="btn" style="width:44px;min-height:44px" data-a="restDef" data-v="-15">−</button><b style="min-width:52px;text-align:center">${S.settings.restDefault} s</b><button class="btn" style="width:44px;min-height:44px" data-a="restDef" data-v="15">+</button></div></div>
    <h2 id="sync">GitHub-Sicherung</h2>
    ${syncSection()}
    <h2>Backup als Datei</h2>
    <div class="card small muted">Zusätzlich kannst du eine Backup-Datei z. B. in iCloud Drive ablegen.${S.persisted ? '<br>✓ Speicher auf diesem Gerät ist dauerhaft geschützt.' : ''}</div>
    <button class="btn" data-a="export">Backup exportieren</button>
    <button class="btn" data-a="importBackup">Backup-Datei wiederherstellen</button>
    <h2>Info</h2>
    <div class="card small muted">Version ${APP_VERSION} · ${done().length} Trainings gespeichert</div>
    <button class="btn danger" data-a="wipe">Alle Daten löschen</button>`;
}

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  if (m < 1440) return `vor ${Math.round(m / 60)} Std.`;
  return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
};

function syncSection() {
  const c = S.sync;
  if (!c) {
    const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
    return `<div class="card small">Sichert jedes Training automatisch in dein <b>privates</b> GitHub-Repo. So gehen keine Daten verloren – auch nicht bei Handywechsel.</div>
      <div class="card form">
        <label>GitHub-Benutzername<input id="syOwner" value="${esc(owner)}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label>Privates Repo<input id="syRepo" value="workout-data" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label>Token<input id="syToken" type="password" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      </div>
      <button class="btn primary" data-a="syncConnect">Verbinden</button>`;
  }
  const status = c.lastError
    ? `<span class="warn">⚠ ${esc(c.lastError)}</span>`
    : c.pending ? '⏳ Sicherung ausstehend – wird nachgeholt, sobald Internet da ist'
      : c.lastSyncAt ? `<span class="ok">✓ Gesichert ${ago(c.lastSyncAt)}</span>` : '';
  return `<div class="card small"><b>${esc(c.owner)}/${esc(c.repo)}</b><div style="margin-top:4px">${status}</div></div>
    <button class="btn primary" data-a="syncNow">Jetzt sichern</button>
    <button class="btn" data-a="syncRestore">Von GitHub wiederherstellen</button>
    <button class="btn ghost danger" data-a="syncOff">Verbindung trennen</button>`;
}

async function readFile(input) {
  return new Promise((resolve) => {
    input.onchange = async () => {
      const f = input.files[0]; input.value = '';
      if (f) resolve(await f.text());
    };
    input.click();
  });
}

async function setPlan(raw) {
  try {
    const plan = normalizePlan(raw);
    const hist = normalizeHistory(raw.history, plan);
    S.plan = plan;
    await db.setMeta('plan', S.plan);
    let added = 0;
    for (const h of hist) {
      if (S.sessions.some((x) => x.id === h.id)) continue;
      await db.putSession(h); S.sessions.push(h); added++;
    }
    S.pickDay = null;
    toast(added ? `Plan geladen + ${added} Trainings übernommen` : `Plan „${S.plan.name}“ geladen`);
    go('#/');
    backupSoon();
  } catch (e) { sheet(`<h3>Plan nicht lesbar</h3><p class="muted" style="text-align:center">${esc(e.message)}</p><button class="btn" data-s="x">OK</button>`, { x: closeSheet }); }
}

async function exportBackup() {
  const data = await db.exportAll();
  const name = `workout-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Aktionen ----------
const actions = {
  loadExample: async () => setPlan(await (await fetch('plans/beispiel.json')).json()),
  loadMine: async () => setPlan(await (await fetch('plans/mein-plan.json')).json()),
  importPlan: async () => {
    const txt = await readFile(document.getElementById('filePlan'));
    try { await setPlan(JSON.parse(txt)); } catch { setPlan(null); }
  },
  pickDay: (a) => { S.pickDay = a.dataset.id; render(); },
  start: (a) => { unlockAudio(); startTraining(a.dataset.id); },
  resume: () => { unlockAudio(); keepAwake(true); go('#/train'); },
  setDone: () => {
    unlockAudio();
    const ex = S.draft.exercises[S.draft.idx];
    const i = ex.sets.findIndex((s) => !s.done);
    if (i < 0) return;
    ex.sets[i].done = true;
    afterSet(ex);
  },
  toggle: (a) => {
    const ex = S.draft.exercises[S.draft.idx], s = ex.sets[+a.dataset.i];
    s.done = !s.done;
    if (s.done) return afterSet(ex);
    saveDraft(); render();
  },
  edit: (a) => editValue(+a.dataset.i, a.dataset.f),
  addSet: () => {
    const ex = S.draft.exercises[S.draft.idx], l = ex.sets[ex.sets.length - 1];
    ex.sets.push({ weight: l?.weight ?? 0, reps: l?.reps ?? 8, done: false });
    saveDraft(); render();
  },
  lighter: () => {
    const ex = S.draft.exercises[S.draft.idx];
    ex.sets.forEach((s) => { if (!s.done) s.weight = ex.suggestion.lighter; });
    ex.suggestion = { ...ex.suggestion, status: 'same', text: `Reduziert auf ${fmtNum(ex.suggestion.lighter)} kg` };
    saveDraft(); render();
  },
  next: () => { if (S.draft.idx < S.draft.exercises.length - 1) { S.draft.idx++; saveDraft(); render(); window.scrollTo(0, 0); } },
  goOpen: () => { const j = nextOpen(S.draft.exercises, S.draft.idx); if (j >= 0) { S.draft.idx = j; saveDraft(); render(); window.scrollTo(0, 0); } },
  prev: () => { if (S.draft.idx > 0) { S.draft.idx--; saveDraft(); render(); window.scrollTo(0, 0); } },
  restAdd: () => { S.draft.rest.endsAt = Math.max(Date.now(), S.draft.rest.endsAt) + 30000; S.draft.rest.alerted = false; saveDraft(); tick(); },
  restStop: () => { S.draft.rest = null; saveDraft(); tick(); },
  note: () => { const ex = S.draft.exercises[S.draft.idx]; noteSheet(`Notiz: ${ex.name}`, ex.note, (v) => { ex.note = v; saveDraft(); render(); }); },
  overview: overviewSheet,
  trainMenu: () => sheet(`<h3>Training</h3>
    <button class="btn" data-s="pause">Pausieren (später weitermachen)</button>
    <button class="btn" data-s="finish">Jetzt beenden & speichern</button>
    <button class="btn danger" data-s="discard">Training verwerfen</button>
    <button class="btn ghost" data-s="close">Abbrechen</button>`, {
    pause: () => { closeSheet(); keepAwake(false); go('#/'); },
    finish: () => { closeSheet(); go('#/done'); },
    discard: () => confirmSheet('Training verwerfen?', 'Alle Einträge dieses Trainings gehen verloren.', 'Verwerfen', async () => {
      await db.delMeta('draft'); S.draft = null; keepAwake(false); go('#/');
    }),
    close: closeSheet,
  }),
  finish: () => go('#/done'),
  feel: (a) => {
    S.draft.feeling = +a.dataset.v; S.draft.note = document.getElementById('sessnote').value; saveDraft();
    document.querySelectorAll('.feel button').forEach((b) => b.classList.toggle('on', b === a));
  },
  save: saveSession,
  backToTrain: () => { S.draft.note = document.getElementById('sessnote').value; saveDraft(); go('#/train'); },
  histTab: (a) => { S.histTab = a.dataset.v; render(); },
  back: () => history.back(),
  delSession: (a) => confirmSheet('Training löschen?', 'Das kann nicht rückgängig gemacht werden.', 'Löschen', async () => {
    await db.deleteSession(a.dataset.id);
    S.sessions = S.sessions.filter((s) => s.id !== a.dataset.id);
    toast('Gelöscht'); go('#/history');
    backupSoon();
  }),
  restDef: async (a) => {
    S.settings.restDefault = Math.max(15, Math.min(600, S.settings.restDefault + +a.dataset.v));
    await db.setMeta('settings', S.settings); render();
  },
  export: exportBackup,
  gotoSync: () => { go('#/settings'); setTimeout(() => document.getElementById('sync')?.scrollIntoView({ behavior: 'smooth' }), 100); },
  syncConnect: async (a) => {
    a.disabled = true; a.textContent = 'Verbinde …';
    try {
      const r = await sync.connect({ owner: val('syOwner'), repo: val('syRepo'), token: val('syToken') });
      S.sync = await sync.getConfig();
      if (!r.private) toast('Achtung: Das Repo ist öffentlich! Bitte auf privat stellen.');
      if (r.hasBackup && !S.sessions.length) {
        // Neues Gerät: vorhandene Sicherung anbieten statt sie zu überschreiben
        render();
        return confirmSheet('Sicherung gefunden', 'Im Repo liegt schon eine Sicherung. Jetzt auf dieses Gerät holen?', 'Wiederherstellen', () => actions.syncRestore(null, true), false);
      }
      if (r.hasBackup && S.sessions.length) {
        render();
        return sheet(`<h3>Im Repo liegt schon eine Sicherung</h3><p class="muted" style="text-align:center">Welche Daten sollen gelten?</p>
          <button class="btn primary" data-s="mine">Daten von diesem iPhone hochladen</button>
          <button class="btn" data-s="theirs">Sicherung aus GitHub übernehmen</button>`, {
          mine: async () => { closeSheet(); await actions.syncNow(); },
          theirs: () => { closeSheet(); actions.syncRestore(null, true); },
        });
      }
      await actions.syncNow();
    } catch (e) {
      a.disabled = false; a.textContent = 'Verbinden';
      sheet(`<h3>Verbindung fehlgeschlagen</h3><p class="muted" style="text-align:center">${esc(e.message)}</p><button class="btn" data-s="x">OK</button>`, { x: closeSheet });
    }
  },
  syncNow: async () => {
    try { await sync.push(); toast('Bei GitHub gesichert ✓'); }
    catch (e) { toast(e.message); }
    S.sync = await sync.getConfig(); if (location.hash.startsWith('#/settings')) render();
  },
  syncRestore: async (_a, confirmed = false) => {
    const doIt = async () => {
      try { const n = await sync.restore(); await load(); toast(`${n} Trainings von GitHub geholt`); go('#/'); }
      catch (e) { toast(e.message); S.sync = await sync.getConfig(); render(); }
    };
    if (confirmed) return doIt();
    confirmSheet('Von GitHub wiederherstellen?', 'Die Daten auf diesem iPhone werden durch die Sicherung aus GitHub ersetzt.', 'Wiederherstellen', doIt);
  },
  syncOff: () => confirmSheet('Verbindung trennen?', 'Der Token wird von diesem iPhone entfernt. Die Sicherung bei GitHub bleibt erhalten.', 'Trennen', async () => {
    await sync.disconnect(); S.sync = null; render();
  }),
  importBackup: async () => {
    const txt = await readFile(document.getElementById('fileBackup'));
    confirmSheet('Backup wiederherstellen?', 'Alle aktuellen Daten auf diesem Gerät werden durch das Backup ersetzt.', 'Wiederherstellen', async () => {
      try { await db.importAll(JSON.parse(txt)); await load(); toast('Backup wiederhergestellt'); go('#/'); }
      catch (e) { toast(e.message || 'Datei ungültig'); }
    });
  },
  wipe: () => confirmSheet('Alle Daten löschen?', 'Plan und alle Trainings werden von diesem Gerät gelöscht. Vorher ein Backup exportieren!', 'Endgültig löschen', async () => {
    await db.wipeAll(); await load(); toast('Alle Daten gelöscht'); go('#/');
  }),
};

$app.addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]');
  if (a && actions[a.dataset.a] && !a.disabled) { e.preventDefault(); actions[a.dataset.a](a); }
});

// Wischen zwischen Übungen
let touch;
$app.addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
$app.addEventListener('touchend', (e) => {
  if (!touch || !location.hash.startsWith('#/train')) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 50) actions[dx < 0 ? 'next' : 'prev']();
  touch = null;
}, { passive: true });

// ---------- Service Worker & Update-Hinweis ----------
let updateRequested = false;
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const show = (w) => {
      if (document.querySelector('.banner')) return;
      const b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = '<span>Neue Version verfügbar</span><button>Neu laden</button>';
      b.querySelector('button').onclick = () => { updateRequested = true; w.postMessage('skipWaiting'); };
      document.body.appendChild(b);
    };
    if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) show(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  });
  // Nur neu laden, wenn der Nutzer das Update angefordert hat (nicht beim allerersten Installieren)
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested) { updateRequested = false; location.reload(); } });
}

(async function init() {
  await load();
  if (navigator.storage?.persist) {
    const ok = await navigator.storage.persisted?.() || await navigator.storage.persist().catch(() => false);
    S.persisted = ok;
  }
  render();
  registerSW();
  sync.autoRetry();
  if (S.draft && location.hash.startsWith('#/train')) keepAwake(true);
})();
