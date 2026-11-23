import * as db from './db.js';
import * as sync from './sync.js';
import {
  normalizePlan, normalizeHistory, historyFor, suggest, describePerf, records, newRecords, volume, nextDay,
  weekStart, weeklyStats, streak, fmtNum, fmtDuration, epley, topWeight, unitLabel, nextOpen, supersetNext,
  nextWeight, prevWeight, rirSummary, fmtRir, planDayFor, sameDay, testStatus, testHistory, testDelta,
  fmtTestValue, fmtTime, insights, weekProgress, estimateMinutes, blocks, parseWarmup,
} from './logic.js';
import { lineChart, barChart } from './charts.js';

export const APP_VERSION = '3.0.1';

const $app = document.getElementById('app');
const $tabbar = document.getElementById('tabbar');
const S = { calOffset: 0, selDate: null, review: null, testDraft: null, plan: null, sessions: [], draft: null, settings: { restDefault: 90 }, pickDay: null, histTab: 'sessions' };

const val = (id) => document.getElementById(id)?.value || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const dateLong = (ts) => new Date(ts).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const kg = (w, type) => (type === 'bodyweight' && !w ? 'Körpergew.' : `${fmtNum(w)} kg`);
const done = () => S.sessions.filter((s) => s.endedAt && s.kind !== 'test');
const RPE_TEXT = ['', 'sehr leicht', 'leicht', 'leicht', 'moderat', 'moderat', 'fordernd', 'hart', 'sehr hart', 'extrem hart', 'Maximum'];

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
  // Gespeicherten Plan mit aktueller Logik neu einlesen (ergänzt z. B. Wochentage bei alten Plänen)
  if (S.plan) { try { S.plan = normalizePlan(S.plan); } catch { /* alter Plan bleibt */ } }
  S.settings = { ...S.settings, ...((await db.getMeta('settings')) || {}) };
  S.sync = await sync.getConfig();
  S.review = (await db.getMeta('review')) || null;
  S.testDraft = (await db.getMeta('testDraft')) || null;
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
  const hidden = route === 'train' || route === 'done' || route === 'test';
  $tabbar.classList.toggle('hidden', hidden);
  $app.classList.toggle('no-tabs', hidden);
  const base = { '': '#/', history: '#/history', session: '#/history', exercise: '#/history', testinfo: '#/history', week: '#/week', settings: '#/settings' }[route] || '#/';
  $tabbar.innerHTML = TABS.map(([h, label, icon]) =>
    `<a href="${h}" class="${h === base ? 'active' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}</a>`).join('');
}

function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if ((route === 'train' || route === 'done') && !S.draft) return go('#/');
  renderTabbar(route);
  const views = { '': viewStart, train: viewTrain, done: viewDone, history: viewHistory, session: viewSession, exercise: viewExercise, week: viewWeek, settings: viewSettings, test: viewTest, testinfo: viewTestInfo, review: viewReview };
  $app.innerHTML = (views[route] || viewStart)(decodeURIComponent(arg || ''));
  if (route !== 'train') window.scrollTo(0, 0);
  tick();
}
window.addEventListener('hashchange', render);

// ---------- Start ----------
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const relDay = (ts) => {
  const diff = Math.round((dayStart(ts) - dayStart(Date.now())) / 864e5);
  const wd = new Date(ts).toLocaleDateString('de-DE', { weekday: 'long' });
  return diff === 0 ? `Heute · ${wd}` : diff === 1 ? `Morgen · ${wd}` : diff === -1 ? `Gestern · ${wd}`
    : new Date(ts).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
};
const ICON_CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.2 1.4"/></svg>';
const ICON_TOOL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h12M4 5.5v5M12 5.5v5M2.5 6.8v2.4M13.5 6.8v2.4"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01"/></svg>';
const ICON_FLAME = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.6 1.2c.3 2.1-.9 3.2-1.9 4.3C5.6 6.7 4.5 7.9 4.5 9.9 4.5 12.2 6.1 14 8.2 14c2.3 0 3.8-1.8 3.8-4.2 0-1.6-.7-2.7-1.4-3.6-.1 1-.6 1.7-1.3 2 .4-2.6-.2-5.2-.7-7z"/></svg>';

function topStats() {
  const wp = weekProgress(S.plan, S.sessions);
  const st = streak(S.sessions);
  const segs = Array.from({ length: Math.max(wp.planned, 1) }, (_, i) => `<i class="${i < wp.done ? 'on' : ''}"></i>`).join('');
  return `<div class="topstats">
    <div class="ts"><div class="k">Wochen in Folge</div><div class="v"><span class="flame ${st ? 'on' : ''}">${ICON_FLAME}</span><span class="num">${st}</span></div></div>
    <div class="ts grow"><div class="k">${wp.done >= wp.planned && wp.planned ? 'Perfekte Woche ✓' : 'Perfekte Woche'}</div><div class="segs">${segs}</div><div class="sub">${wp.done} von ${wp.planned} Einheiten</div></div>
  </div>`;
}

function weekStrip(sel) {
  const ws = weekStart(Date.now());
  return `<div class="wk">${DAY_SHORT.map((l, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const t = d.getTime();
    const isDone = S.sessions.some((x) => x.endedAt && sameDay(x.startedAt, t));
    const planned = !!planDayFor(S.plan, t);
    const isSel = sel && sameDay(t, sel), isToday = sameDay(t, Date.now());
    const firstTs = Math.min(...S.sessions.filter((x) => x.endedAt).map((x) => dayStart(x.startedAt)), Infinity);
    const mk = isDone ? 'done' : planned ? (dayStart(t) < dayStart(Date.now()) ? (t < firstTs ? 'rest' : 'missed') : 'plan') : 'rest';
    return `<button class="wkd ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''}" data-a="selDay" data-t="${t}">
      <span class="mk ${mk}">${isDone ? ICON_CHECK : ''}</span><span class="lb">${isSel ? `${d.getDate()}.${d.getMonth() + 1}.` : l}</span></button>`;
  }).join('')}</div>`;
}

function exLine(cfg) {
  const s = suggest(cfg, historyFor(S.sessions, cfg.key));
  const up = s.status === 'up' && cfg.type !== 'bodyweight';
  return `<div class="exl"><span class="nm">${esc(cfg.name)}</span><span class="vv ${up ? 'up' : ''}">${cfg.sets} × ${s.reps}${cfg.unit === 'sec' ? ' s' : ''}${cfg.type === 'bodyweight' && !s.weight ? '' : ` · ${fmtNum(s.weight)} kg`}${up ? ' ↑' : ''}</span></div>`;
}

function warmupSection(note, open = false) {
  const w = parseWarmup(note);
  if (!w) return '';
  return `<details class="sec" ${open ? 'open' : ''}><summary>Warm-up${w.duration ? `<span class="sumx">${esc(w.duration)}</span>` : ''}<span class="chev"></span></summary>
    <div class="tl"><div class="blk">${w.items.map((x) => `<div class="exl"><span class="nm">${esc(x)}</span></div>`).join('')}</div></div></details>`;
}

function dayDetail(day, sel) {
  const past = dayStart(sel) < dayStart(Date.now());
  const title = day.focus || day.name.split(' – ')[1] || day.name;
  const bl = blocks(day);
  return `<div class="dayhead">
      <div class="eyebrow">${esc(relDay(sel))}${past ? ' · verpasst' : ''}</div>
      <div class="dtitle">${esc(title)}</div>
      <div class="dmeta"><span>${ICON_CLOCK}≈ ${estimateMinutes(day, S.settings.restDefault)} Min.</span><span>${ICON_LIST}${day.exercises.length} Übungen</span></div>
      ${day.equipment ? `<div class="dmeta"><span>${ICON_TOOL}${esc(day.equipment)}</span></div>` : ''}
    </div>
    ${warmupSection(day.note)}
    <details class="sec" open><summary>Workout<span class="chev"></span></summary>
      <div class="tl">${bl.map((b) => `<div class="blk">
        ${b.items.length > 1 ? `<div class="blkh">${b.items.length > 2 ? 'Circuit' : 'Supersatz'} · ${Math.max(...b.items.map((e) => e.sets))} Runden</div>` : ''}
        ${b.items.map((e) => exLine(e)).join('')}
        ${b.items.length === 1 && b.items[0].hint ? `<div class="hintl">${esc(b.items[0].hint)}</div>` : ''}
      </div>`).join('')}</div>
    </details>
    <div class="cta2"><button class="btn pill glass" data-a="pickOther">Anpassen</button><button class="btn pill primary" data-a="start" data-id="${esc(day.id)}">${past ? 'Nachholen' : 'Starten'}</button></div>`;
}

function dayCard(sel) {
  const thatDay = S.sessions.filter((x) => x.endedAt && sameDay(x.startedAt, sel));
  const label = relDay(sel);
  if (thatDay.length) {
    return thatDay.map((x) => `<a class="hero done-card" href="#/${x.kind === 'test' ? 'testinfo' : 'session'}/${x.id}">
      <div class="label">${esc(label)} · erledigt ✓</div>
      <div class="day">${esc(x.kind === 'test' ? 'Leistungstest' : (S.plan.days.find((d) => d.id === x.dayId)?.focus || x.dayName))}</div>
      ${x.kind === 'test' && planDayFor(S.plan, sel) ? `<div class="muted small" style="margin:-4px 0 10px">statt ${esc(planDayFor(S.plan, sel).focus || planDayFor(S.plan, sel).name)}</div>` : ''}
      <div class="donerow"><span>${fmtDuration(x.endedAt - x.startedAt)}</span>${x.kind === 'test' ? `<span>${((n) => `${n} ${n === 1 ? 'Test' : 'Tests'}`)((x.results || []).filter((r) => r.value != null).length)}</span>` : `<span>${fmtNum(Math.round(volume(x)))} kg</span>`}${x.rpe ? `<span>RPE ${x.rpe}</span>` : ''}<span class="chev" style="margin-left:auto"></span></div></a>`).join('');
  }
  const day = planDayFor(S.plan, sel);
  if (!day) {
    return `<div class="hero rest-card"><div class="label" style="color:var(--muted)">${esc(label)}</div><div class="day">Kein Training</div>
      <button class="textlink" style="margin:4px 0 0" data-a="pickOther">Trotzdem trainieren</button></div>`;
  }
  return dayDetail(day, sel);
}

function insightsBlock() {
  const items = insights(S.plan, S.sessions);
  const ts = testStatus(S.plan, S.sessions);
  const rv = S.review;
  if (!items.length && !rv && !(ts && !ts.due)) return '';
  return `<h2>Hinweise</h2>
    ${rv ? `<a class="card tap" href="#/review"><div class="row"><div class="grow"><div class="eyebrow">Wochenreview von Claude</div>
      <div class="small" style="margin-top:4px">${esc(rv.summary || '')}</div></div><span class="chev"></span></div></a>` : ''}
    ${items.length ? `<div class="list insights">${items.map((i) => `<div class="item"><span class="dot ${i.level}"></span><div class="small" style="flex:1">${esc(i.text)}</div></div>`).join('')}</div>` : ''}
    ${ts && !ts.due ? `<div class="muted small" style="margin:4px 4px 0">Nächster Leistungstest in ${ts.weeksLeft} ${ts.weeksLeft === 1 ? 'Woche' : 'Wochen'}</div>` : ''}`;
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
  const sel = S.selDate ?? dayStart(Date.now());
  let main;
  if (S.draft) {
    const d = S.draft, n = d.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
    main = `<div class="hero"><div class="label">Training läuft</div><div class="day">${esc(d.dayName)}</div>
      <p class="muted small">Seit ${fmtDuration(Date.now() - d.startedAt)} · ${n} Sätze erledigt</p>
      <button class="btn primary big" data-a="resume">Weiter trainieren</button></div>`;
  } else if (S.testDraft) {
    main = `<div class="hero"><div class="label">Läuft</div><div class="day">Leistungstest</div>
      <button class="btn primary big" data-a="openTest">Weiter testen</button></div>`;
  } else main = dayCard(sel);
  const ts = testStatus(S.plan, S.sessions);
  const testCard = ts?.due && !S.draft && !S.testDraft ? `<div class="hero"><div class="label">${ts.baseline ? 'Startpunkt festhalten' : `Alle ${S.plan.tests.everyWeeks} Wochen`}</div>
      <div class="day">Leistungstest fällig</div>
      <p class="muted small">${S.plan.tests.items.map((t) => esc(t.name)).join(' · ')}.
        ${(() => { const td = planDayFor(S.plan, Date.now()); const doneToday = S.sessions.some((x) => x.endedAt && sameDay(x.startedAt, Date.now()));
    return td && !doneToday ? `Ersetzt das heutige Training (${esc(td.focus || td.name)}) und zählt für die perfekte Woche.` : 'Am besten ausgeruht und statt einer normalen Einheit – zählt für die perfekte Woche.'; })()}</p>
      <button class="btn pill glass" data-a="openTest">Test starten</button></div>` : '';
  return `${topStats()}${weekStrip(sel)}<div class="daywrap">${main}</div>${testCard}${insightsBlock()}`;
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
        last: hist[0] ? { date: hist[0].date, text: [describePerf(hist[0], cfg.type, cfg.unit), rirSummary(hist[0])].filter(Boolean).join(' · '), note: hist[0].note || '' } : null,
        sets: Array.from({ length: cfg.sets }, () => ({ weight: sg.weight, reps: sg.reps, done: false })),
      };
    }),
  };
  saveDraft();
  keepAwake(true);
  go('#/train');
}

// ---------- Training ----------
const ICON_X = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';
function ringSvg(pct) {
  const r = 24, c = 2 * Math.PI * r;
  return `<svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--ring-bg)" stroke-width="4.5"/>
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--green)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}" transform="rotate(-90 28 28)" style="transition:stroke-dashoffset .4s"/></svg>`;
}
function badgeFor(sg, ex) {
  if (sg.status === 'up' && ex.type !== 'bodyweight') return `<span class="badge up">↑ ${fmtNum(sg.weight)} kg</span>`;
  if (sg.status === 'up') return `<span class="badge up">↑ ${sg.reps} ${ex.unit === 'sec' ? 's' : 'Wdh.'}</span>`;
  if (sg.status === 'down') return '<span class="badge down">Prüfen</span>';
  if (sg.status === 'max') return '<span class="badge">Max.</span>';
  if (sg.status === 'new') return '<span class="badge new">Neu</span>';
  return `<span class="badge">Ziel ${sg.reps}</span>`;
}

function viewTrain() {
  const d = S.draft, ex = d.exercises[d.idx], n = d.exercises.length;
  const doneCount = d.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
  const total = d.exercises.reduce((a, e) => a + e.sets.length, 0);
  const pct = total ? doneCount / total : 0;
  const nextIdx = ex.sets.findIndex((s) => !s.done);
  const allDone = nextIdx === -1;
  const isLast = d.idx === n - 1;
  const following = nextOpen(d.exercises, d.idx);
  const sg = ex.suggestion;
  const unitLbl = ex.type === 'bodyweight' ? 'kg+' : 'kg';
  const repLbl = ex.unit === 'sec' ? 's' : '';
  const mates = ex.group ? d.exercises.filter((e) => e.group === ex.group) : [];
  // Nur noch die aktuelle Übung/Gruppe offen → "Training beenden" anbieten (z. B. nach 2 von 3 Core-Runden)
  const onlyGroupLeft = d.exercises.every((e, i) => i === d.idx || (ex.group && e.group === ex.group) || !e.sets.some((x) => !x.done));
  const cta = allDone
    ? (following === -1 ? '<button class="btn primary big" data-a="finish">Training abschließen</button>'
      : `<button class="btn primary big" data-a="goOpen">Weiter: ${esc(d.exercises[following].name)}</button>`)
    : `<button class="btn primary big" data-a="setDone">Satz ${nextIdx + 1} fertig</button>`;
  return `
    <div class="tbar">
      <button class="iconbtn" data-a="trainMenu" aria-label="Menü">${ICON_X}</button>
      <button class="crumb" data-a="overview">${esc(d.dayName)} ⌄</button>
      <span class="time" id="elapsed"></span>
    </div>
    ${mates.length > 1 ? `<div class="ssbar">${mates.length > 2 ? 'Circuit' : 'Supersatz'} · ${mates.map((m) => m === ex ? `<b>${esc(m.name)}</b>` : esc(m.name)).join(' → ')}</div>` : ''}
    <div class="xhead">
      <div><div class="eyebrow">Übung ${d.idx + 1} von ${n}</div><div class="xtitle">${esc(ex.name)}</div></div>
      <div class="ring">${ringSvg(pct)}<span>${Math.round(pct * 100)}%</span></div>
    </div>
    ${d.idx === 0 && d.dayNote && !doneCount ? `<div style="margin-bottom:12px">${warmupSection(d.dayNote, true)}</div>` : ''}
    <div class="memory">
      <div class="top">
        <div><div class="k">${ex.last ? `Letztes Mal · ${dateLong(ex.last.date)}` : 'Noch keine Werte'}</div><div class="v">${ex.last ? esc(ex.last.text) : 'Startwerte aus dem Plan'}</div></div>
        ${badgeFor(sg, ex)}
      </div>
      <div class="sugg">${esc(sg.text)}${ex.cfg.hint ? ` · ${esc(ex.cfg.hint)}` : ''}
        ${sg.status === 'down' ? `<div><button class="linkbtn" data-a="lighter">Auf ${fmtNum(sg.lighter)} kg reduzieren</button></div>` : ''}
        ${ex.last?.note && !(ex.cfg.hint || '').toLowerCase().includes(ex.last.note.toLowerCase()) ? `<div class="note">„${esc(ex.last.note)}“</div>` : ''}</div>
    </div>
    <div class="colhead"><span>Satz</span><span>${ex.type === 'bodyweight' ? 'Zusatz' : 'Gewicht'}</span><span>${ex.unit === 'sec' ? 'Zeit' : 'Wdh.'}</span><span>RIR</span><span></span></div>
    <div class="sets">
      ${ex.sets.map((s, i) => `<div class="set ${s.done ? 'done' : ''} ${i === nextIdx ? 'next' : ''}">
        <span class="n">${i + 1}</span>
        <button class="val" data-a="edit" data-i="${i}" data-f="weight">${ex.type === 'bodyweight' && !s.weight ? '<small style="margin:0">Körpergew.</small>' : `${fmtNum(s.weight)}<small>${unitLbl}</small>`}</button>
        <button class="val" data-a="edit" data-i="${i}" data-f="reps">${s.reps}${repLbl ? `<small>${repLbl}</small>` : ''}</button>
        <button class="rirv ${s.rir == null ? 'none' : ''}" data-a="askRir" data-i="${i}" aria-label="RIR Satz ${i + 1}">${s.rir == null ? '–' : fmtRir(s.rir)}</button>
        <button class="chk" data-a="toggle" data-i="${i}" aria-label="Satz ${i + 1} erledigt">${s.done ? ICON_CHECK : ''}</button>
      </div>`).join('')}
      <button class="addset" data-a="addSet">Satz hinzufügen</button>
    </div>
    <div id="panel"></div>
    <div class="subnav">
      <button data-a="prev" ${d.idx === 0 ? 'disabled' : ''}>Zurück</button>
      <button data-a="note" class="${ex.note ? 'has' : ''}">${ex.note ? 'Notiz ✓' : 'Notiz'}</button>
      ${!isLast && !allDone && !onlyGroupLeft ? '<button data-a="next">Überspringen</button>' : ''}
    </div>
    ${onlyGroupLeft && following !== -1 ? '<button class="textlink" data-a="finish">Training jetzt beenden</button>' : ''}
    <div class="cta">${cta}</div>`;
}

// Timer & Trainingsdauer – alle 250 ms aktualisieren (berechnet aus Zeitstempeln, läuft also auch nach Standby korrekt)
function tick() {
  const d = S.draft;
  const el = document.getElementById('elapsed');
  if (el && d) {
    const m = Math.floor((Date.now() - d.startedAt) / 60000);
    el.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }
  const w = document.getElementById('watch');
  if (w && S.testDraft?.watch?.running) w.textContent = fmtTime(watchSeconds(S.testDraft));
  const cdEl = document.getElementById('cd');
  if (cdEl && S.testDraft?.cd?.running) {
    const left = cdLeft(S.testDraft, S.plan.tests.items[S.testDraft.idx]);
    cdEl.textContent = fmtTime(left);
    if (left <= 0) { S.testDraft.cd = { done: true }; saveTestDraft(); beep(); render(); }
  }
  const p = document.getElementById('panel');
  if (!p || !d) return;
  const ask = d.rirAsk && d.exercises[d.rirAsk.ex]?.sets[d.rirAsk.set] ? d.rirAsk : null;
  if (!ask && !d.rest) { p.innerHTML = ''; p.dataset.key = ''; return; }
  const left = d.rest ? Math.round((d.rest.endsAt - Date.now()) / 1000) : 0;
  if (d.rest && left <= 0 && !d.rest.alerted) { d.rest.alerted = true; saveDraft(); beep(); }
  const over = d.rest && left <= 0;
  const key = `${ask ? `${ask.ex}-${ask.set}-${d.exercises[ask.ex].sets[ask.set].rir}` : ''}|${d.rest ? 'r' : ''}|${over}`;
  if (p.dataset.key !== key) {
    p.dataset.key = key;
    let html = '';
    if (ask) {
      const e = d.exercises[ask.ex], cur = e.sets[ask.set].rir;
      html += `<div class="q">Wie viele wären noch gegangen? <span>${ask.ex !== d.idx ? `${esc(e.name)} · ` : ''}Satz ${ask.set + 1}</span></div>
        <div class="rirseg">${[0, 1, 2, 3, 4].map((v) => `<button data-a="rir" data-v="${v}" class="${cur === v ? 'on' : ''}">${v === 4 ? '4+' : v}</button>`).join('')}</div>`;
    }
    if (d.rest) {
      html += `<div class="rest ${over ? 'over' : ''}"><div><div class="k">${over ? 'Pause vorbei' : 'Pause'}</div><div class="t"></div></div>
        <div class="mini"><button data-a="restAdd">+30 s</button><button data-a="restStop">${over ? 'OK' : 'Überspringen'}</button></div></div>`;
    }
    p.innerHTML = `<div class="panel">${html}</div>`;
  }
  const t = p.querySelector('.t');
  if (t) { const a = Math.abs(left); t.textContent = `${left < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; }
}
setInterval(tick, 250);

function startRest(sec) {
  S.draft.rest = sec > 0 ? { endsAt: Date.now() + sec * 1000, alerted: false } : null;
}

// Nach einem erledigten Satz: Pause starten (0 = direkt weiter) und bei Supersatz/Circuit zur nächsten Übung springen
function afterSet(ex, setIdx) {
  const d = S.draft;
  d.rirAsk = { ex: d.idx, set: setIdx };
  const anyOpen = nextOpen(d.exercises, d.idx) !== -1 || ex.sets.some((s) => !s.done);
  startRest(anyOpen ? (ex.cfg.rest ?? S.settings.restDefault) : 0);
  const j = supersetNext(d.exercises, d.idx);
  if (j !== d.idx) { d.idx = j; toast(`→ ${d.exercises[j].name}`); }
  saveDraft(); render();
  requestAnimationFrame(() => document.getElementById('panel')?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
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
  return `<h1>Geschafft!</h1><p class="muted">${esc(d.dayName)} · ${dateLong(d.startedAt)}</p>
    <div class="stats" style="margin-top:16px">
      <div class="stat"><b>${fmtDuration(Date.now() - d.startedAt)}</b><span>Dauer</span></div>
      <div class="stat"><b>${sets}</b><span>Sätze</span></div>
      <div class="stat"><b>${fmtNum(Math.round(vol))}</b><span>kg bewegt</span></div>
    </div>
    ${prs.length ? `<h2>Neue Rekorde 🎉</h2>${prs.map((p) => `<div class="pr">${esc(p.name)}: ${esc(p.text)}</div>`).join('')}` : ''}
    <h2>Wie hart war die Session?</h2>
    ${rpePicker(d.rpe)}
    <h2>Notiz</h2>
    <textarea id="sessnote" placeholder="Wie lief's? Was ist aufgefallen – Technik, Schmerzen, Energie …">${esc(d.note || '')}</textarea>
    <button class="btn good big" data-a="save">Speichern</button>
    <button class="btn ghost" data-a="backToTrain">Zurück zum Training</button>`;
}

function rpePicker(v) {
  return `<div class="card rpe"><div class="rpegrid">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button data-a="rpe" data-v="${n}" class="${v === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="rpetext" id="rpetext">${v ? `RPE ${v} · ${RPE_TEXT[v]}` : '1 = sehr leicht · 10 = absolutes Maximum'}</div></div>`;
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
    feeling: d.feeling || null, rpe: d.rpe || null, note: d.note,
    exercises: d.exercises.map((e) => ({ key: e.key, name: e.name, type: e.type, unit: e.unit || 'reps', note: e.note, sets: e.sets.map(({ weight, reps, rir, done: dn }) => ({ weight, reps, rir: rir ?? null, done: dn })) })),
  };
  await db.putSession(session);
  await db.delMeta('draft');
  S.sessions.push(session); S.draft = null; S.pickDay = null; S.selDate = null;
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
  const seg = `<div class="seg">${[['sessions', 'Trainings'], ['exercises', 'Übungen'], ['tests', 'Tests']].map(([k, l]) => `<button data-a="histTab" data-v="${k}" class="${S.histTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (S.histTab === 'tests') return `<h1>Verlauf</h1>${seg}${testsOverview()}`;
  if (!list.length) return `<h1>Verlauf</h1>${seg}<div class="empty">Noch keine Trainings gespeichert.<br>Nach deinem ersten Training siehst du hier alles.</div>`;
  if (S.histTab === 'exercises') {
    return `<h1>Verlauf</h1>${seg}<div class="list">${exerciseIndex().map((e) => {
      const h = historyFor(S.sessions, e.key);
      return `<a class="item" href="#/exercise/${encodeURIComponent(e.key)}" style="color:inherit;text-decoration:none"><div style="flex:1;min-width:0"><b>${esc(e.name)}</b><div class="muted small">Zuletzt ${esc(describePerf(h[0], e.type, e.unit))}</div></div><span class="chev"></span></a>`;
    }).join('')}</div>`;
  }
  return `<h1>Verlauf</h1>${seg}<div class="list">${list.map((s) => `<a class="item" href="#/session/${s.id}">
    <div style="flex:1;min-width:0"><b>${esc(s.dayName)}</b><div class="muted small">${dateLong(s.startedAt)} · ${fmtDuration(s.endedAt - s.startedAt)} · ${fmtNum(Math.round(volume(s)))} kg${s.rpe ? ` · RPE ${s.rpe}` : ''}</div></div><span class="chev"></span></a>`).join('')}</div>`;
}

function viewSession(id) {
  const s = S.sessions.find((x) => x.id === id);
  if (!s) return '<div class="empty">Training nicht gefunden.</div>';
  const faces = ['', '😫', '😕', '😐', '🙂', '💪'];
  return `<button class="btn ghost" style="justify-content:flex-start;width:auto" data-a="back">‹ Verlauf</button>
    <h1>${esc(s.dayName)}</h1><p class="muted">${new Date(s.startedAt).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })}</p>
    <div class="stats"><div class="stat"><b>${fmtDuration(s.endedAt - s.startedAt)}</b><span>Dauer</span></div>
      <div class="stat"><b>${fmtNum(Math.round(volume(s)))}</b><span>kg bewegt</span></div>
      <div class="stat"><b>${s.rpe ? s.rpe : (faces[s.feeling || 0] || '–')}</b><span>${s.rpe ? `RPE · ${RPE_TEXT[s.rpe]}` : 'Gefühl'}</span></div></div>
    ${s.note ? `<div class="card">${esc(s.note)}</div>` : ''}
    <div class="list">${s.exercises.map((e) => `<a class="item" href="#/exercise/${encodeURIComponent(e.key)}" style="color:inherit;text-decoration:none"><div style="flex:1;min-width:0"><b>${esc(e.name)}</b>
      <div class="muted small">${esc([describePerf(e, e.type, e.unit), rirSummary(e)].filter(Boolean).join(' · '))}</div>${e.note ? `<div class="small" style="font-style:italic;margin-top:2px">„${esc(e.note)}“</div>` : ''}</div><span class="chev"></span></a>`).join('')}</div>
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
    <div class="list">${h.map((p) => `<div class="item"><div style="flex:1"><b>${esc(describePerf(p, info.type, info.unit))}</b>${rirSummary(p) ? ` <span class="muted small">· ${esc(rirSummary(p))}</span>` : ''}<div class="muted small">${dateLong(p.date)}</div>${p.note ? `<div class="small" style="font-style:italic">„${esc(p.note)}“</div>` : ''}</div></div>`).join('')}</div>`;
}

// ---------- Leistungstests ----------
function testsOverview() {
  const T = S.plan?.tests;
  if (!T) return '<div class="empty">Im aktuellen Plan sind keine Tests definiert.</div>';
  const ts = testStatus(S.plan, S.sessions);
  return `<div class="card small muted">${ts.due ? 'Ein Test ist fällig.' : `Nächster Test in ${ts.weeksLeft} ${ts.weeksLeft === 1 ? 'Woche' : 'Wochen'}.`} Getestet wird alle ${T.everyWeeks} Wochen.</div>
    ${T.items.map((t) => {
    const h = testHistory(S.sessions, t.id), dl = testDelta(t, h);
    const pts = [...h].reverse().map((x) => ({ x: x.date, y: t.type === 'time' ? Math.round(x.value / 6) / 10 : x.value }));
    return `<h2>${esc(t.name)}</h2><div class="card">
      <div class="row"><div class="grow"><div class="num" style="font-size:28px">${fmtTestValue(t, h[0]?.value)}</div>
        <div class="muted small">${h[0] ? `${dateLong(h[0].date)}${t.lowerIsBetter ? ' · weniger ist besser' : ''}` : 'Noch kein Ergebnis'}</div></div>
        ${dl ? `<span class="badge ${dl.better === true ? 'up' : dl.better === false ? 'down' : ''}">${esc(dl.text)}</span>` : ''}</div>
      ${pts.length >= 2 ? `<div style="margin-top:12px">${lineChart(pts)}</div><div class="legend"><span><i></i>${t.type === 'time' ? 'Minuten' : 'Wiederholungen'}</span></div>` : ''}</div>`;
  }).join('')}
    ${!S.draft && !S.testDraft ? '<button class="btn" data-a="openTest">Test jetzt machen</button>' : ''}`;
}

function newTestDraft() {
  return { id: `test-${Date.now()}`, startedAt: Date.now(), idx: 0, results: S.plan.tests.items.map((t) => ({ id: t.id, name: t.name, type: t.type, value: null })), watch: null };
}
const saveTestDraft = () => db.setMeta('testDraft', S.testDraft);

function cdLeft(d, t) {
  if (d.cd?.running) return Math.max(0, Math.ceil((d.cd.endsAt - Date.now()) / 1000));
  return d.cd?.done ? 0 : t.seconds;
}
function watchSeconds(d) {
  const w = d.watch;
  if (!w) return d.results[d.idx]?.value || 0;
  return Math.round((w.acc + (w.running ? Date.now() - w.since : 0)) / 1000);
}
function readTestInput() {
  const d = S.testDraft, t = S.plan.tests.items[d.idx];
  if (t.type === 'time') { if (d.watch) d.results[d.idx].value = watchSeconds(d) || null; return; }
  const el = document.getElementById('tv');
  if (!el) return;
  const v = parseInt(el.value, 10);
  d.results[d.idx].value = Number.isFinite(v) ? v : null;
}

function viewTest() {
  const T = S.plan?.tests, d = S.testDraft;
  if (!T || !d) return '<div class="empty">Kein Test aktiv.</div>';
  const t = T.items[d.idx], r = d.results[d.idx];
  const prev = testHistory(S.sessions, t.id)[0];
  const last = d.idx === T.items.length - 1;
  const input = t.type === 'time'
    ? `<div class="card watch"><div class="num watchtime" id="watch">${fmtTime(watchSeconds(d))}</div>
        <div class="row" style="gap:8px;margin-top:14px">
          ${d.watch?.running ? '<button class="btn primary pill" data-a="watchStop">Stopp</button>'
    : `<button class="btn primary pill" data-a="watchStart">${d.watch ? 'Weiter' : 'Start'}</button>${d.watch ? '<button class="btn pill" style="background:var(--surface-2)" data-a="watchReset">Zurücksetzen</button>' : ''}`}
        </div>
        <button class="textlink" data-a="testEdit">Zeit von Hand eintragen</button></div>`
    : `${t.seconds ? `<div class="card watch" style="margin-bottom:12px"><div class="num watchtime" id="cd">${fmtTime(cdLeft(d, t))}</div>
        <div class="row" style="gap:8px;margin-top:14px">${d.cd?.running ? '<button class="btn pill glass" data-a="cdStop">Abbrechen</button>'
    : `<button class="btn primary pill" data-a="cdStart">${d.cd?.done ? 'Nochmal starten' : `${t.seconds} Sekunden starten`}</button>`}</div>
        <div class="muted small" style="margin-top:10px">${d.cd?.done ? 'Zeit vorbei – trag deine Wiederholungen ein.' : 'Nach dem Signal die geschafften Wiederholungen eintragen.'}</div></div>` : ''}<div class="stepper"><button data-a="testMinus">−</button><div class="v"><input id="tv" inputmode="numeric" value="${r.value ?? ''}" placeholder="0"><small>Wiederholungen</small></div><button data-a="testPlus">+</button></div>`;
  return `<div class="tbar"><button class="iconbtn" data-a="testMenu" aria-label="Menü">${ICON_X}</button><span class="crumb">Leistungstest</span><span class="time">${d.idx + 1}/${T.items.length}</span></div>
    <div class="xhead"><div><div class="eyebrow">Test ${d.idx + 1} von ${T.items.length}</div><div class="xtitle">${esc(t.name)}</div></div></div>
    <div class="memory"><div class="top"><div><div class="k">${prev ? `Letztes Ergebnis · ${dateLong(prev.date)}` : 'Erster Test'}</div><div class="v">${prev ? fmtTestValue(t, prev.value) : 'Das wird dein Startwert'}</div></div></div>
      ${t.hint ? `<div class="sugg">${esc(t.hint)}</div>` : ''}
      ${t.steps.length ? `<ol class="steps">${t.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}</div>
    <div style="margin-top:14px">${input}</div>
    <div class="subnav"><button data-a="testPrev" ${d.idx === 0 ? 'disabled' : ''}>Zurück</button><button data-a="testSkip">Auslassen</button></div>
    <div class="cta"><button class="btn primary big" data-a="testNext">${last ? 'Test abschließen' : 'Weiter'}</button></div>`;
}

function viewTestInfo(id) {
  const x = S.sessions.find((y) => y.id === id);
  if (!x) return '<div class="empty">Test nicht gefunden.</div>';
  const items = S.plan?.tests?.items || [];
  return `<button class="btn ghost" style="justify-content:flex-start;width:auto" data-a="back">‹ Zurück</button>
    <h1>Leistungstest</h1><p class="muted">${new Date(x.startedAt).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })}</p>
    <div class="list">${(x.results || []).map((r) => { const t = items.find((i) => i.id === r.id) || { type: r.type }; return `<div class="item"><div style="flex:1"><b>${esc(r.name)}</b></div><span class="num">${fmtTestValue(t, r.value)}</span></div>`; }).join('')}</div>
    ${x.rpe ? `<div class="card small">RPE ${x.rpe} · ${RPE_TEXT[x.rpe]}</div>` : ''}${x.note ? `<div class="card small">${esc(x.note)}</div>` : ''}
    <button class="btn danger" data-a="delSession" data-id="${x.id}">Test löschen</button>`;
}

// ---------- Claude-Wochenreview ----------
function mdToHtml(md) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', inList = false;
  for (const line of String(md).split('\n')) {
    const l = line.trimEnd();
    if (/^\s*[-*] /.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,3} /.test(l)) html += `<h3>${inline(l.replace(/^#+ /, ''))}</h3>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
function viewReview() {
  const rv = S.review;
  if (!rv) return '<div class="empty">Noch kein Review vorhanden.</div>';
  return `<button class="btn ghost" style="justify-content:flex-start;width:auto" data-a="back">‹ Zurück</button>
    <div class="eyebrow">Wochenreview von Claude</div><h1 style="font-size:28px">${esc(rv.title || 'Deine Woche')}</h1>
    <p class="muted small">${rv.date ? new Date(rv.date).toLocaleDateString('de-DE', { dateStyle: 'long' }) : ''}</p>
    <div class="card md">${mdToHtml(rv.text || '')}</div>`;
}

// ---------- Woche ----------
function monthCalendar(offset) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [];
  const firstTs = Math.min(...S.sessions.filter((x) => x.endedAt).map((x) => dayStart(x.startedAt)), Infinity);
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let dnum = 1; dnum <= days; dnum++) {
    const t = new Date(first.getFullYear(), first.getMonth(), dnum).getTime();
    const isDone = S.sessions.some((x) => x.endedAt && sameDay(x.startedAt, t));
    const planned = !!planDayFor(S.plan, t);
    const future = dayStart(t) > dayStart(Date.now());
    const today = sameDay(t, Date.now());
    const cls = isDone ? 'done' : planned ? (future || today ? 'plan' : t < firstTs ? 'rest' : 'missed') : 'rest';
    cells.push(cls === 'rest' && !today ? '<span class="cd rest"><i></i></span>'
      : `<button class="cd ${cls} ${today ? 'today' : ''}" data-a="calDay" data-t="${t}">${dnum}</button>`);
  }
  const title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `<div class="card cal">
    <div class="calh"><button class="iconbtn" data-a="calMonth" data-v="-1" aria-label="Vorheriger Monat">‹</button><b>${title}</b><button class="iconbtn" data-a="calMonth" data-v="1" aria-label="Nächster Monat" ${offset >= 1 ? 'disabled' : ''}>›</button></div>
    <div class="calgrid wd">${DAY_SHORT.map((l) => `<span>${l}</span>`).join('')}</div>
    <div class="calgrid">${cells.join('')}</div>
    <div class="legend cal-legend"><span><i class="lg done"></i>trainiert</span><span><i class="lg plan"></i>geplant</span><span><i class="lg missed"></i>verpasst</span></div>
  </div>`;
}

function viewWeek() {
  const st = weeklyStats(S.sessions, 8);
  const wp = weekProgress(S.plan, S.sessions);
  const lbl = (w) => { const d = new Date(w.start); return `${d.getDate()}.${d.getMonth() + 1}.`; };
  return `<h1>Woche</h1>
    ${monthCalendar(S.calOffset || 0)}
    <div class="stats">
      <div class="stat"><b>${wp.done}/${wp.planned}</b><span>Diese Woche</span></div>
      <div class="stat"><b>${streak(S.sessions)}</b><span>Wochen in Folge</span></div>
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

// Eigener Plan: wird automatisch aktualisiert, wenn plans/mein-plan.json eine höhere "version" hat
const MY_PLAN = 'plans/mein-plan.json';
async function autoUpdateMyPlan() {
  if (!S.plan || !(S.plan.source === 'mine' || S.plan.name === 'Finaler 3er-Plan')) return;
  try {
    const raw = await (await fetch(MY_PLAN, { cache: 'no-store' })).json();
    if ((Number(raw.version) || 0) > (S.plan.version || 0)) await setPlan({ ...raw, source: 'mine' }, { quiet: true });
  } catch { /* offline – später erneut */ }
}

async function setPlan(raw, opts = {}) {
  try {
    const plan = normalizePlan(raw);
    const hist = normalizeHistory(raw.history, plan);
    S.plan = plan;
    await db.setMeta('plan', S.plan);
    let added = 0;
    for (const h of hist) {
      const old = S.sessions.find((x) => x.id === h.id);
      if (old && !old.imported) continue; // selbst geloggte Trainings nie überschreiben
      await db.putSession(h);
      S.sessions = S.sessions.filter((x) => x.id !== h.id).concat(h);
      if (!old) added++;
    }
    S.pickDay = null;
    if (opts.quiet) { toast('Trainingsplan aktualisiert'); render(); backupSoon(); return; }
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
  loadMine: async () => setPlan({ ...(await (await fetch(MY_PLAN, { cache: 'no-store' })).json()), source: 'mine' }),
  importPlan: async () => {
    const txt = await readFile(document.getElementById('filePlan'));
    try { await setPlan(JSON.parse(txt)); } catch { setPlan(null); }
  },
  pickDay: (a) => { S.pickDay = a.dataset.id; render(); },
  selDay: (a) => { S.selDate = +a.dataset.t; render(); },
  calDay: (a) => { S.selDate = +a.dataset.t; S.calOffset = 0; go('#/'); },
  calMonth: (a) => { S.calOffset = Math.min(1, (S.calOffset || 0) + +a.dataset.v); render(); },
  cdStart: () => { const d = S.testDraft, t = S.plan.tests.items[d.idx]; unlockAudio(); d.cd = { running: true, endsAt: Date.now() + t.seconds * 1000 }; saveTestDraft(); render(); },
  cdStop: () => { S.testDraft.cd = null; saveTestDraft(); render(); },
  pickOther: () => sheet(`<h3>Welches Training?</h3><div class="list">${S.plan.days.map((d) => `<button class="item" data-s="go" data-id="${esc(d.id)}"><span style="flex:1">${esc(d.name)}</span><span class="chev"></span></button>`).join('')}</div>`,
    { go: (b) => { closeSheet(); unlockAudio(); startTraining(b.dataset.id); } }),
  rpe: (a) => {
    const v = +a.dataset.v;
    const isTest = location.hash.startsWith('#/test');
    const target = isTest ? S.testDraft : S.draft;
    if (!target) return;
    target.rpe = target.rpe === v ? null : v;
    if (!isTest) { S.draft.note = document.getElementById('sessnote')?.value ?? S.draft.note; saveDraft(); } else saveTestDraft();
    document.querySelectorAll('.rpegrid button').forEach((b) => b.classList.toggle('on', +b.dataset.v === target.rpe));
    const el = document.getElementById('rpetext');
    if (el) el.textContent = target.rpe ? `RPE ${target.rpe} · ${RPE_TEXT[target.rpe]}` : '1 = sehr leicht · 10 = absolutes Maximum';
  },
  openTest: () => {
    if (!S.plan?.tests) return;
    if (!S.testDraft) { S.testDraft = newTestDraft(); saveTestDraft(); }
    unlockAudio(); keepAwake(true); go('#/test');
  },
  testMinus: () => { const i = document.getElementById('tv'); i.value = Math.max(0, (parseInt(i.value, 10) || 0) - 1); readTestInput(); saveTestDraft(); },
  testPlus: () => { const i = document.getElementById('tv'); i.value = (parseInt(i.value, 10) || 0) + 1; readTestInput(); saveTestDraft(); },
  watchStart: () => { const d = S.testDraft; d.watch = { acc: d.watch?.acc || 0, since: Date.now(), running: true }; saveTestDraft(); render(); },
  watchStop: () => { const d = S.testDraft; d.watch.acc += Date.now() - d.watch.since; d.watch.running = false; readTestInput(); saveTestDraft(); render(); },
  watchReset: () => { const d = S.testDraft; d.watch = null; d.results[d.idx].value = null; saveTestDraft(); render(); },
  testEdit: () => {
    const d = S.testDraft, cur = watchSeconds(d);
    const bg = sheet(`<h3>Zeit eintragen</h3><div class="row" style="gap:10px;margin-bottom:14px"><div class="form grow"><label>Minuten<input id="tm" inputmode="numeric" value="${Math.floor(cur / 60)}"></label></div><div class="form grow"><label>Sekunden<input id="tsx" inputmode="numeric" value="${cur % 60}"></label></div></div>
      <button class="btn primary" data-s="ok">Übernehmen</button>`, { ok: () => {
      const v = (parseInt(bg.querySelector('#tm').value, 10) || 0) * 60 + (parseInt(bg.querySelector('#tsx').value, 10) || 0);
      d.watch = v ? { acc: v * 1000, since: 0, running: false } : null; d.results[d.idx].value = v || null; saveTestDraft(); closeSheet(); render();
    } });
  },
  testPrev: () => {
    const d = S.testDraft; readTestInput(); d.idx--; d.cd = null;
    d.watch = d.results[d.idx].value && d.results[d.idx].type === 'time' ? { acc: d.results[d.idx].value * 1000, since: 0, running: false } : null;
    saveTestDraft(); render();
  },
  testSkip: () => { const d = S.testDraft; if (d.watch?.running) return toast('Erst die Stoppuhr anhalten'); d.watch = null; d.results[d.idx].value = null; actions.testNext(null, true); },
  testNext: (_a, skip = false) => {
    const d = S.testDraft;
    if (d.watch?.running) return toast('Erst die Stoppuhr anhalten');
    if (!skip) readTestInput();
    if (d.cd?.running) return toast('Erst den Countdown abwarten oder abbrechen');
    if (d.idx < S.plan.tests.items.length - 1) {
      d.idx++; d.cd = null;
      d.watch = d.results[d.idx].value && d.results[d.idx].type === 'time' ? { acc: d.results[d.idx].value * 1000, since: 0, running: false } : null;
      saveTestDraft(); render(); window.scrollTo(0, 0); return;
    }
    saveTestDraft();
    const bg = sheet(`<h3>Test abschließen</h3>${rpePicker(d.rpe)}<textarea id="tnote" placeholder="Notiz (optional)">${esc(d.note || '')}</textarea>
      <button class="btn primary big" data-s="save">Speichern</button>`, {
      save: async () => {
        const x = { id: d.id, kind: 'test', startedAt: d.startedAt, endedAt: Date.now(), planName: S.plan.name, dayId: 'test', dayName: 'Leistungstest',
          rpe: d.rpe || null, note: bg.querySelector('#tnote').value.trim(), results: d.results.map(({ id, name, type, value }) => ({ id, name, type, value })), exercises: [] };
        await db.putSession(x); await db.delMeta('testDraft');
        S.sessions.push(x); S.testDraft = null; keepAwake(false); closeSheet();
        toast('Test gespeichert'); S.histTab = 'tests'; go('#/history'); backupSoon();
      },
    });
    // RPE-Buttons im Sheet
    bg.querySelectorAll('[data-a="rpe"]').forEach((b) => b.addEventListener('click', () => actions.rpe(b)));
  },
  testMenu: () => sheet(`<h3>Leistungstest</h3>
    <button class="btn" data-s="pause">Pausieren (später weitermachen)</button>
    <button class="btn danger" data-s="discard">Test verwerfen</button>
    <button class="btn ghost" data-s="close">Abbrechen</button>`, {
    pause: () => { readTestInput(); saveTestDraft(); closeSheet(); keepAwake(false); go('#/'); },
    discard: () => confirmSheet('Test verwerfen?', 'Die Eingaben dieses Tests gehen verloren.', 'Verwerfen', async () => { await db.delMeta('testDraft'); S.testDraft = null; keepAwake(false); go('#/'); }),
    close: closeSheet,
  }),

  start: (a) => { unlockAudio(); startTraining(a.dataset.id); },
  resume: () => { unlockAudio(); keepAwake(true); go('#/train'); },
  setDone: () => {
    unlockAudio();
    const ex = S.draft.exercises[S.draft.idx];
    const i = ex.sets.findIndex((s) => !s.done);
    if (i < 0) return;
    ex.sets[i].done = true;
    afterSet(ex, i);
  },
  toggle: (a) => {
    const ex = S.draft.exercises[S.draft.idx], s = ex.sets[+a.dataset.i];
    s.done = !s.done;
    if (s.done) return afterSet(ex, +a.dataset.i);
    if (S.draft.rirAsk?.ex === S.draft.idx && S.draft.rirAsk.set === +a.dataset.i) S.draft.rirAsk = null;
    saveDraft(); render();
  },
  edit: (a) => editValue(+a.dataset.i, a.dataset.f),
  askRir: (a) => { S.draft.rirAsk = { ex: S.draft.idx, set: +a.dataset.i }; saveDraft(); tick(); document.getElementById('panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  rir: (a) => {
    const d = S.draft, ask = d.rirAsk;
    if (!ask) return;
    const st = d.exercises[ask.ex].sets[ask.set];
    st.rir = st.rir === +a.dataset.v ? null : +a.dataset.v;
    if (st.rir != null) d.rirAsk = null;
    saveDraft(); render();
  },
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
// Claude-Wochenreview höchstens alle 3 Stunden aus GitHub nachladen
async function refreshReview() {
  if (!S.sync || (S.review?.fetchedAt && Date.now() - S.review.fetchedAt < 3 * 3600e3)) return;
  const r = await sync.fetchReview();
  if (!r) return;
  const changed = r.date !== S.review?.date || r.text !== S.review?.text;
  S.review = r; await db.setMeta('review', r);
  if (changed && (location.hash === '' || location.hash === '#/')) render();
}

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
  refreshReview();
  autoUpdateMyPlan();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshReview(); });
  if (S.draft && location.hash.startsWith('#/train')) keepAwake(true);
})();
