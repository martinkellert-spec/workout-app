import * as db from './db.js';
import * as sync from './sync.js';
import {
  normalizePlan, normalizeHistory, historyFor, suggest, describePerf, records, newRecords, volume, nextDay,
  weekStart, weeklyStats, streak, fmtNum, fmtDuration, epley, topWeight, unitLabel, nextOpen, supersetNext,
  nextWeight, prevWeight, rirSummary, fmtRir, planDayFor, sameDay, testStatus, testHistory, testDelta,
  fmtTestValue, fmtTime, insights, weekProgress, estimateMinutes, blocks, parseWarmup,
  normalizeLibrary, applyEdits, alternativesFor, fromLibrary, expandCooldown, activityFor, blockStatus,
  buildFlow, stepPhase,
} from './logic.js';
import { lineChart, barChart } from './charts.js';

export const APP_VERSION = '4.0.1';

const $app = document.getElementById('app');
const $tabbar = document.getElementById('tabbar');
const S = { basePlan: null, edits: {}, lib: null, daySwap: null, planArchive: [], libMuscle: '', libQuery: '', calOffset: 0, selDate: null, review: null, testDraft: null, plan: null, sessions: [], draft: null, settings: { restDefault: 90 }, pickDay: null, histTab: 'sessions' };

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
  let base, eff;
  [base, eff, S.sessions, S.draft] = await Promise.all([db.getMeta('planBase'), db.getMeta('plan'), db.allSessions(), db.getMeta('draft')]);
  S.basePlan = base || eff || null;
  // Gespeicherten Plan mit aktueller Logik neu einlesen (ergänzt z. B. Wochentage bei alten Plänen)
  if (S.basePlan) { try { S.basePlan = normalizePlan(S.basePlan); } catch { /* alter Plan bleibt */ } }
  S.edits = (await db.getMeta('planEdits')) || {};
  S.daySwap = (await db.getMeta('daySwap')) || null;
  S.planArchive = (await db.getMeta('planArchive')) || [];
  await ensureLib();
  recomputePlan();
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
  const hidden = route === 'train' || route === 'done' || route === 'test' || route === 'cooldown';
  $tabbar.classList.toggle('hidden', hidden);
  $app.classList.toggle('no-tabs', hidden);
  const base = { '': '#/', history: '#/history', session: '#/history', exercise: '#/history', testinfo: '#/history', week: '#/week', settings: '#/settings', library: '#/settings' }[route] || '#/';
  $tabbar.innerHTML = TABS.map(([h, label, icon]) =>
    `<a href="${h}" class="${h === base ? 'active' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}</a>`).join('');
}

function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if ((route === 'train' || route === 'done' || route === 'cooldown') && !S.draft) return go('#/');
  renderTabbar(route);
  const views = { '': viewStart, train: viewTrain, done: viewDone, history: viewHistory, session: viewSession, exercise: viewExercise, week: viewWeek, settings: viewSettings, test: viewTest, testinfo: viewTestInfo, review: viewReview, library: viewLibrary, cooldown: viewCooldown };
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
    <div class="ts grow"><div class="k">${wp.done >= wp.planned && wp.planned ? 'Perfekte Woche ✓' : 'Perfekte Woche'}</div><div class="segs">${segs}</div><div class="sub">${wp.done} von ${wp.planned} Einheiten${(() => { const b = blockStatus(S.plan); return !b ? '' : b.before ? ` · Block startet ${b.daysToStart === 1 ? 'morgen' : `in ${b.daysToStart} Tagen`}` : b.over ? ' · Block abgeschlossen' : ` · Block Woche ${b.week}/${b.weeks}`; })()}</div></div>
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
    const act = !planned && activityFor(S.plan, t);
    const mk = isDone ? 'done' : planned ? (dayStart(t) < dayStart(Date.now()) ? (t < firstTs ? 'rest' : 'missed') : 'plan') : act ? 'act' : 'rest';
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
      ${day.subtitle ? `<div class="dsub">${esc(day.subtitle)}</div>` : ''}
      <div class="dmeta"><span>${ICON_CLOCK}≈ ${estimateMinutes(day, S.settings.restDefault) + (day.cooldown && cdById(day.cooldown) ? cdMinutes(cdById(day.cooldown)) : cdList().length ? Math.min(...cdList().map(cdMinutes)) : 0)} Min.</span><span>${ICON_LIST}${day.exercises.length} Übungen</span></div>
      ${day.equipment ? `<div class="dmeta"><span>${ICON_TOOL}${esc(day.equipment)}</span></div>` : ''}
      <div class="daybtns"><button class="btn pill primary" data-a="start" data-id="${esc(day.id)}">${past ? 'Nachholen' : 'Workout starten'}</button><button class="btn pill glass" data-a="customize" data-id="${esc(day.id)}" data-t="${sel}">Anpassen</button></div>
    </div>
    ${warmupSection(day.note)}
    <details class="sec" open><summary>Workout<span class="chev"></span></summary>
      <div class="tl">${bl.map((b) => `<div class="blk">
        ${b.items.length > 1 ? `<div class="blkh">${esc(day.groupNames?.[b.group] || (b.items.length > 2 ? 'Circuit' : 'Supersatz'))} · ${Math.max(...b.items.map((e) => e.sets))} Runden</div>` : ''}
        ${b.items.map((e) => exLine(e)).join('')}
        ${b.items.length === 1 && b.items[0].hint ? `<div class="hintl">${esc(b.items[0].hint)}</div>` : ''}
      </div>`).join('')}</div>
    </details>
    ${cooldownSection(day)}
`;
}

function dayCard(sel) {
  const thatDay = S.sessions.filter((x) => x.endedAt && sameDay(x.startedAt, sel));
  const label = relDay(sel);
  if (thatDay.length) {
    return thatDay.map((x) => `<a class="hero done-card" href="#/${x.kind === 'test' ? 'testinfo' : 'session'}/${x.id}">
      <div class="label">${esc(label)} · erledigt ✓</div>
      <div class="day">${esc(x.kind === 'test' ? 'Leistungstest' : x.kind === 'activity' ? x.dayName : (S.plan.days.find((d) => d.id === x.dayId)?.focus || x.dayName))}</div>
      ${x.kind === 'test' && planDayFor(S.plan, sel) ? `<div class="muted small" style="margin:-4px 0 10px">statt ${esc(planDayFor(S.plan, sel).focus || planDayFor(S.plan, sel).name)}</div>` : ''}
      <div class="donerow"><span>${fmtDuration(x.endedAt - x.startedAt)}</span>${x.kind === 'test' ? `<span>${((n) => `${n} ${n === 1 ? 'Test' : 'Tests'}`)((x.results || []).filter((r) => r.value != null).length)}</span>` : x.kind === 'activity' ? '' : `<span>${fmtNum(Math.round(volume(x)))} kg</span>`}${x.rpe ? `<span>RPE ${x.rpe}</span>` : ''}<span class="chev" style="margin-left:auto"></span></div></a>`).join('');
  }
  const day = effectiveDay(planDayFor(S.plan, sel), sel);
  const act = !day && activityFor(S.plan, sel);
  if (act) {
    return `<div class="hero"><div class="label">${esc(label)}${act.optional ? ' · optional' : ''}</div><div class="day">${esc(act.name)}</div>
      <p class="muted small">Aktiver Erholungstag. Zählt nicht in die perfekte Woche, landet aber im Verlauf.</p>
      <button class="btn pill glass" data-a="activityDone" data-t="${sel}" data-n="${esc(act.name)}">Als erledigt markieren</button>
      <button class="textlink" style="margin:10px 0 0" data-a="pickOther">Stattdessen trainieren</button></div>`;
  }
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
  const day = effectiveDay(S.plan.days.find((d) => d.id === dayId), S.selDate ?? Date.now());
  S.draft = {
    id: String(Date.now()), startedAt: Date.now(), planName: S.plan.name, dayId: day.id, dayName: day.name, dayNote: day.note || '', dayCooldown: day.cooldown || '', idx: 0,
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
  S.draft.flow = { steps: makeFlow(S.draft), i: 0, timer: null };
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
  return viewPlayer();
}

function viewTrainLegacy() {
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
  cooldownTick();
  flowTick();
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
    ${cooldownCard(d)}
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
    cooldown: d.flow && d.dayCooldown ? { id: d.dayCooldown, name: cdById(d.dayCooldown)?.name || '', completed: d.flow.steps.some((x) => x.type === 'cool') }
      : d.cooldown ? { id: d.cooldown.id, name: d.cooldown.name, completed: !!d.cooldown.completed } : null,
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
    <div style="flex:1;min-width:0"><b>${esc(s.dayName)}</b><div class="muted small">${dateLong(s.startedAt)} · ${fmtDuration(s.endedAt - s.startedAt)}${s.kind === 'activity' ? '' : ` · ${fmtNum(Math.round(volume(s)))} kg`}${s.rpe ? ` · RPE ${s.rpe}` : ''}</div></div><span class="chev"></span></a>`).join('')}</div>`;
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
    ${s.cooldown ? `<div class="card small">Cool-down: <b>${esc(s.cooldown.name)}</b> ${s.cooldown.completed ? '✓' : '(abgebrochen)'}</div>` : ''}
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

// ---------- Plan-Anpassungen, Bibliothek, Archiv ----------
async function ensureLib() {
  if (S.lib?.length) return S.lib;
  try { S.lib = normalizeLibrary(await (await fetch('plans/library.json')).json()); } catch { S.lib = S.lib || []; }
  return S.lib;
}
function recomputePlan() { S.plan = applyEdits(S.basePlan, S.edits, S.lib); }
async function persistPlan() {
  recomputePlan();
  await db.setMeta('planBase', S.basePlan);
  await db.setMeta('plan', S.plan); // wirksamer Plan (für Backup und Wochenreview)
  await db.setMeta('planEdits', S.edits || {});
}
const dayEdits = (dayId) => (S.edits[dayId] ||= { replace: {}, remove: [], add: [] });

/** Tag inkl. „nur heute“-Tausch für ein Datum */
function effectiveDay(day, ts) {
  const sw = S.daySwap;
  if (!day || !sw || sw.dayId !== day.id || !sameDay(sw.date, ts)) return day;
  return applyEdits({ days: [day] }, { [day.id]: { replace: sw.replace } }, S.lib).days[0];
}

function libRow(x, action, extra = '') {
  return `<button class="item" data-s="${action}" data-k="${esc(x.key)}" ${extra}><div style="flex:1;min-width:0"><b>${esc(x.name)}</b>
    <div class="muted small">${esc(x.muscles.join(' · '))} · ${esc(x.equipment)}</div></div><span class="chev"></span></button>`;
}

/** Bibliotheks-Auswahl mit Suche und Muskel-Filter. onPick(item) */
function libraryPicker(title, onPick, list = null, extraTop = '') {
  const all = list || S.lib;
  const muscles = [...new Set(S.lib.flatMap((x) => x.muscles))];
  let q = '', m = '';
  const bg = sheet(`<h3>${esc(title)}</h3>${extraTop}
    <div class="form" style="margin-bottom:10px"><input id="libq" placeholder="Übung suchen …" autocomplete="off"></div>
    ${list ? '' : `<div class="chips" style="margin:0 -18px 10px;padding:0 18px">${muscles.map((x) => `<button class="chip" data-s="mf" data-m="${esc(x)}">${esc(x)}</button>`).join('')}</div>`}
    <div class="list sheetlist" id="liblist"></div>`, {
    pick: (b) => { const it = S.lib.find((x) => x.key === b.dataset.k); if (it) onPick(it); },
    mf: (b) => { m = m === b.dataset.m ? '' : b.dataset.m; bg.querySelectorAll('[data-s="mf"]').forEach((c) => c.classList.toggle('on', c.dataset.m === m)); draw(); },
    remove: () => onPick(null),
  });
  const draw = () => {
    const ql = q.toLowerCase();
    const items = all.filter((x) => (!ql || x.name.toLowerCase().includes(ql) || x.muscles.join(' ').toLowerCase().includes(ql)) && (!m || x.muscles.includes(m)));
    bg.querySelector('#liblist').innerHTML = items.length ? items.map((x) => libRow(x, 'pick')).join('') : '<div class="item muted small">Nichts gefunden.</div>';
  };
  bg.querySelector('#libq').addEventListener('input', (e) => { q = e.target.value.trim(); draw(); });
  draw();
  return bg;
}

/** „Anpassen“ in der Tagesansicht */
async function customizeDay(dayId, ts) {
  await ensureLib();
  const day = effectiveDay(S.plan.days.find((d) => d.id === dayId), ts);
  const e = S.edits[dayId];
  const edited = e && (Object.keys(e.replace || {}).length || (e.remove || []).length || (e.add || []).length);
  sheet(`<h3>Training anpassen</h3>
    <div class="list sheetlist">${day.exercises.map((x) => `<button class="item" data-s="ex" data-k="${esc(x.key)}"><div style="flex:1;min-width:0"><b>${esc(x.name)}</b>
      <div class="muted small">${x.sets} × ${x.repsMin === x.repsMax ? x.repsMin : `${x.repsMin}–${x.repsMax}`}${x.unit === 'sec' ? ' s' : ''}${x.swappedFrom ? ' · getauscht' : ''}</div></div><span class="swapico">⇄</span></button>`).join('')}</div>
    <button class="btn" data-s="add">Übung hinzufügen</button>
    <button class="btn" data-s="other">Anderes Training wählen</button>
    ${edited ? '<button class="btn ghost danger" data-s="reset">Änderungen an diesem Tag zurücksetzen</button>' : ''}`, {
    ex: (b) => swapFlow(dayId, ts, day.exercises.find((x) => x.key === b.dataset.k)),
    add: () => libraryPicker('Übung hinzufügen', async (it) => {
      if (!it) return;
      const de = dayEdits(dayId); de.add = [...new Set([...(de.add || []), it.key])];
      await persistPlan(); closeSheet(); toast(`${it.name} hinzugefügt`); render(); backupSoon();
    }),
    other: () => actions.pickOther(),
    reset: () => confirmSheet('Änderungen zurücksetzen?', 'Der Tag sieht danach wieder aus wie im Plan.', 'Zurücksetzen', async () => {
      delete S.edits[dayId]; if (S.daySwap?.dayId === dayId) { S.daySwap = null; await db.delMeta('daySwap'); }
      await persistPlan(); toast('Zurückgesetzt'); render(); backupSoon();
    }),
  });
}

/** Übung tauschen: Alternativen → „nur heute“ oder „dauerhaft“ */
function swapFlow(dayId, ts, cfg) {
  const origKey = cfg.swappedFrom || cfg.key;
  const day = S.plan.days.find((d) => d.id === dayId);
  const alts = alternativesFor(cfg.key, S.lib, day.exercises.map((x) => x.key));
  const bg = libraryPicker(`${cfg.name} tauschen`, (it) => {
    if (!it) {
      return confirmSheet(`${cfg.name} entfernen?`, 'Die Übung fällt dauerhaft aus diesem Trainingstag.', 'Entfernen', async () => {
        const de = dayEdits(dayId);
        if ((de.add || []).includes(cfg.key)) de.add = de.add.filter((k) => k !== cfg.key);
        else { de.remove = [...new Set([...(de.remove || []), origKey])]; delete de.replace[origKey]; }
        await persistPlan(); toast('Entfernt'); render(); backupSoon();
      });
    }
    sheet(`<h3>${esc(cfg.name)} → ${esc(it.name)}</h3>
      <button class="btn primary" data-s="today">Nur heute</button>
      <button class="btn" data-s="perm">Dauerhaft im Plan</button>
      <button class="btn ghost" data-s="x">Abbrechen</button>`, {
      today: async () => {
        S.daySwap = { date: dayStart(ts), dayId, replace: { ...(S.daySwap?.dayId === dayId && sameDay(S.daySwap.date, ts) ? S.daySwap.replace : {}), [cfg.key]: it.key } };
        await db.setMeta('daySwap', S.daySwap); closeSheet(); toast(`Heute: ${it.name}`); render();
      },
      perm: async () => {
        const de = dayEdits(dayId);
        if ((de.add || []).includes(cfg.key)) de.add = de.add.map((k) => (k === cfg.key ? it.key : k));
        else de.replace[origKey] = it.key;
        await persistPlan(); closeSheet(); toast(`${it.name} ist jetzt im Plan`); render(); backupSoon();
      },
      x: closeSheet,
    });
  }, alts.length ? null : null, `<button class="btn ghost danger" data-s="remove" style="margin:-4px 0 8px">Übung entfernen</button>
    ${alts.length ? `<div class="muted small" style="margin:0 4px 8px">Passend: ${alts.slice(0, 4).map((a) => esc(a.name)).join(', ')} …</div>` : ''}`);
  // Passende Alternativen zuerst anzeigen
  const list = bg.querySelector('#liblist');
  const others = S.lib.filter((x) => !alts.includes(x) && x.key !== cfg.key);
  list.innerHTML = alts.map((x) => libRow(x, 'pick')).join('') + (others.length ? `<div class="item muted small" style="font-weight:600">Weitere Übungen</div>${others.map((x) => libRow(x, 'pick')).join('')}` : '');
}

/** Im laufenden Training die aktuelle Übung tauschen (nur diese Session) */
async function swapInTraining() {
  await ensureLib();
  const d = S.draft, ex = d.exercises[d.idx];
  const alts = alternativesFor(ex.key, S.lib, d.exercises.map((x) => x.key));
  libraryPicker(`${ex.name} tauschen`, (it) => {
    if (!it) return;
    const cfg = fromLibrary(it, ex.cfg);
    const hist = historyFor(S.sessions, cfg.key);
    const sg = suggest(cfg, hist);
    d.exercises[d.idx] = {
      key: cfg.key, name: cfg.name, type: cfg.type, unit: cfg.unit, group: cfg.group, cfg, note: '', suggestion: sg,
      last: hist[0] ? { date: hist[0].date, text: [describePerf(hist[0], cfg.type, cfg.unit), rirSummary(hist[0])].filter(Boolean).join(' · '), note: hist[0].note || '' } : null,
      sets: Array.from({ length: cfg.sets }, () => ({ weight: sg.weight, reps: sg.reps, done: false })),
    };
    if (d.flow) rebuildFlow(d);
    saveDraft(); closeSheet(); toast(`Getauscht: ${it.name}`); render();
  }, [...alts, ...S.lib.filter((x) => !alts.includes(x) && x.key !== ex.key)]);
}

// ---------- Bibliothek (Seite) ----------
function viewLibrary() {
  if (!S.lib?.length) { ensureLib().then(() => { if (location.hash.startsWith('#/library')) render(); }); return '<div class="empty">Bibliothek wird geladen …</div>'; }
  const muscles = [...new Set(S.lib.flatMap((x) => x.muscles))];
  const m = S.libMuscle || '';
  const q = (S.libQuery || '').toLowerCase();
  const items = S.lib.filter((x) => (!m || x.muscles.includes(m)) && (!q || x.name.toLowerCase().includes(q)))
    .sort((a, b) => (m ? a.muscles.indexOf(m) - b.muscles.indexOf(m) : 0));
  const inPlan = new Set(S.plan?.days.flatMap((d) => d.exercises.map((e) => e.key)) || []);
  return `<button class="btn ghost" style="justify-content:flex-start;width:auto" data-a="back">‹ Mehr</button>
    <h1>Übungen</h1><p class="muted small">${S.lib.length} Übungen für dein Home-Gym. Antippen für Details oder zum Hinzufügen.</p>
    <div class="form" style="margin:12px 0 10px"><input id="libsearch" placeholder="Übung suchen …" value="${esc(S.libQuery || '')}" autocomplete="off"></div>
    <div class="chips" style="margin-bottom:12px"><button class="chip ${!m ? 'on' : ''}" data-a="libMuscle" data-m="">Alle</button>${muscles.map((x) => `<button class="chip ${m === x ? 'on' : ''}" data-a="libMuscle" data-m="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="list">${items.map((x) => `<button class="item" data-a="libItem" data-k="${esc(x.key)}"><div style="flex:1;min-width:0"><b>${esc(x.name)}</b>${inPlan.has(x.key) ? ' <span class="badge up" style="padding:2px 8px;font-size:11px">im Plan</span>' : ''}
      <div class="muted small">${esc(x.muscles.join(' · '))} · ${esc(x.equipment)}</div></div><span class="chev"></span></button>`).join('') || '<div class="item muted small">Nichts gefunden.</div>'}</div>`;
}

function libItemSheet(key) {
  const x = S.lib.find((y) => y.key === key);
  if (!x) return;
  const h = historyFor(S.sessions, key);
  const days = S.plan?.days || [];
  sheet(`<h3>${esc(x.name)}</h3>
    <div class="card small"><div><b>Muskeln:</b> ${esc(x.muscles.join(', '))}</div><div><b>Equipment:</b> ${esc(x.equipment)}</div>
      <div><b>Bereich:</b> ${x.repsMin}–${x.repsMax} ${x.unit === 'sec' ? 'Sekunden' : 'Wdh.'}${x.weight ? ` · Start ${fmtNum(x.weight)} kg` : ''}</div>
      ${x.hint ? `<div class="muted" style="margin-top:6px">${esc(x.hint)}</div>` : ''}
      ${h[0] ? `<div style="margin-top:6px"><b>Zuletzt:</b> ${esc(describePerf(h[0], x.type, x.unit))} · ${dateLong(h[0].date)}</div>` : ''}</div>
    ${days.map((d) => `<button class="btn" data-s="add" data-d="${esc(d.id)}">Zu ${esc(d.name.split(' – ')[0])} hinzufügen</button>`).join('')}
    ${h.length ? `<button class="btn ghost" data-s="hist">Verlauf ansehen</button>` : ''}`, {
    add: async (b) => {
      const de = dayEdits(b.dataset.d); de.add = [...new Set([...(de.add || []), key])];
      await persistPlan(); closeSheet(); toast(`${x.name} hinzugefügt`); render(); backupSoon();
    },
    hist: () => { closeSheet(); go(`#/exercise/${encodeURIComponent(key)}`); },
  });
}

// ---------- Gespeicherte Pläne ----------
function archiveSection() {
  const arch = S.planArchive || [];
  return `<h2>Gespeicherte Pläne</h2>
    <div class="list">${S.basePlan ? `<div class="item"><div style="flex:1"><b>${esc(S.basePlan.name)}</b> <span class="badge up" style="padding:2px 8px;font-size:11px">aktiv</span>
      <div class="muted small">Version ${S.basePlan.version || 1}${Object.keys(S.edits || {}).length ? ' · mit deinen Anpassungen' : ''}</div></div></div>` : ''}
    ${arch.map((a, i) => `<button class="item" data-a="archiveItem" data-i="${i}"><div style="flex:1"><b>${esc(a.name)}</b>
      <div class="muted small">Version ${a.version || 1} · bis ${new Date(a.savedAt).toLocaleDateString('de-DE', { dateStyle: 'medium' })}</div></div><span class="chev"></span></button>`).join('')}
    ${!arch.length ? '<div class="item muted small">Frühere Planstände erscheinen hier automatisch.</div>' : ''}</div>`;
}

// ---------- Geführter Ablauf (Schritt für Schritt) ----------
const PREP_SEC = 5;

function makeFlow(d) {
  const day = S.plan?.days.find((x) => x.id === d.dayId);
  const cd = d.dayCooldown ? cdById(d.dayCooldown) : null;
  return buildFlow({
    warmup: d.dayNote || '',
    exercises: d.exercises.map((e) => ({ name: e.name, group: e.cfg.group || e.group || '', rest: e.cfg.rest, sets: e.sets.length, unit: e.unit })),
    groupNames: day?.groupNames || {},
    cooldown: cd,
    restDefault: S.settings.restDefault,
  });
}

/** Ablauf anlegen (auch für ein Training, das vor dem Update gestartet wurde) */
function ensureFlow(d) {
  if (d.flow?.steps?.length) return;
  const steps = makeFlow(d);
  const anyDone = d.exercises.some((e) => e.sets.some((x) => x.done));
  let i = 0;
  if (anyDone) {
    i = steps.findIndex((s) => s.type === 'set' && !d.exercises[s.ex].sets[s.set].done);
    if (i < 0) i = steps.findIndex((s) => s.type === 'cool' || s.type === 'feedback');
  }
  d.flow = { steps, i: Math.max(0, i), timer: null };
  saveDraft();
}

/** Nach einem Tausch die Schritte neu bauen, Position (Übung/Satz) beibehalten */
function rebuildFlow(d) {
  const cur = d.flow?.steps[d.flow.i];
  const steps = makeFlow(d);
  let i = cur ? steps.findIndex((s) => s.type === cur.type && s.ex === cur.ex && s.set === cur.set && s.name === cur.name) : 0;
  d.flow = { steps, i: Math.max(0, i), timer: null };
}

const stepAt = (d, i) => d.flow.steps[i];
const stepSec = (d, s) => (s.type === 'set' ? Number(d.exercises[s.ex].sets[s.set].reps) || 30 : s.sec || 0);
const isTimed = (d, s) => s && (s.type === 'rest' || (s.type === 'set' ? s.timed : !!s.sec) && s.type !== 'feedback');

function stepLabel(d, s) {
  if (!s) return '';
  if (s.type === 'warm' || s.type === 'cool') return `${s.name}${s.side ? ` ${s.side}` : ''}`;
  if (s.type === 'set') return d.exercises[s.ex].name;
  if (s.type === 'rest') return `Pause ${fmtTime(s.sec)}`;
  return 'Abschluss';
}

function nextInfo(d) {
  const n = stepAt(d, d.flow.i + 1);
  if (!n) return '';
  if (n.type === 'rest') return `Danach: Pause ${fmtTime(n.sec)}`;
  if (n.type === 'feedback') return 'Danach: Abschluss';
  const same = n.type === 'set' && stepAt(d, d.flow.i)?.type === 'set';
  return `${same ? 'Danach direkt' : 'Danach'}: ${stepLabel(d, n)}`;
}

function timerLeft(t) {
  if (!t) return null;
  if (t.mode === 'paused') return t.left;
  return Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
}

function flowGo(i, { auto = false } = {}) {
  const d = S.draft;
  d.flow.i = Math.max(0, Math.min(i, d.flow.steps.length - 1));
  const s = stepAt(d, d.flow.i);
  d.flow.timer = null;
  if (s.type === 'rest') d.flow.timer = { mode: 'run', endsAt: Date.now() + s.sec * 1000 };
  else if (auto && isTimed(d, s)) d.flow.timer = { mode: 'prep', endsAt: Date.now() + PREP_SEC * 1000 };
  if (s.type === 'set') d.idx = s.ex;
  saveDraft(); render(); window.scrollTo(0, 0);
}

function flowNext() {
  const d = S.draft, cur = stepAt(d, d.flow.i), nxt = stepAt(d, d.flow.i + 1);
  // Bei aufeinanderfolgenden Zeit-Schritten im Warm-up/Cool-down automatisch mit Vorbereitung weiter
  const auto = cur && nxt && (cur.type === 'warm' || cur.type === 'cool') && cur.type === nxt.type && isTimed(d, cur) && isTimed(d, nxt);
  flowGo(d.flow.i + 1, { auto });
}

function tone(freq = 880, dur = 0.12) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur + 0.02);
}

/** Satz als erledigt markieren und RIR abfragen */
function finishSet(d, s) {
  const st = d.exercises[s.ex].sets[s.set];
  st.done = true;
  saveDraft();
  const bg = sheet(`<h3>Wie viele wären noch gegangen?</h3><p class="muted small" style="text-align:center;margin-top:-8px">RIR · ${esc(d.exercises[s.ex].name)}</p>
    <div class="rirseg big">${[0, 1, 2, 3, 4].map((v) => `<button data-s="r" data-v="${v}" class="${st.rir === v ? 'on' : ''}">${v === 4 ? '4+' : v}</button>`).join('')}</div>
    <button class="btn ghost" data-s="skip">Überspringen</button>`, {
    r: (b) => { st.rir = +b.dataset.v; saveDraft(); closeSheet(); flowNext(); },
    skip: () => { closeSheet(); flowNext(); },
  });
  bg.addEventListener('click', (e) => { if (e.target === bg) flowNext(); });
}

// Aus tick() aufgerufen: Vorbereitung, Countdown, Pausen
let lastPrepSec = null;
function flowTick() {
  const d = S.draft;
  if (!d?.flow || !location.hash.startsWith('#/train')) return;
  const t = d.flow.timer, s = stepAt(d, d.flow.i);
  if (!t || t.mode === 'paused') return;
  const left = timerLeft(t);
  const el = document.getElementById('fltime');
  if (el) el.textContent = t.mode === 'prep' ? String(left) : fmtTime(left);
  const ring = document.getElementById('flring');
  if (ring && t.mode === 'run') { const total = s.type === 'rest' ? s.sec : stepSec(d, s); ring.innerHTML = bigRing(total ? 1 - left / total : 0); }
  if (t.mode === 'prep') {
    if (left !== lastPrepSec && left > 0) { lastPrepSec = left; tone(660, 0.08); }
    if (left <= 0) { lastPrepSec = null; tone(1320, 0.25); d.flow.timer = { mode: 'run', endsAt: Date.now() + stepSec(d, s) * 1000 }; saveDraft(); render(); }
    return;
  }
  if (left > 0) return;
  // Zeit abgelaufen
  d.flow.timer = null; saveDraft(); beep();
  if (s.type === 'set') { render(); finishSet(d, s); }
  else flowNext();
}

function bigRing(pct) {
  const r = 104, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 240 240" width="100%" height="100%"><circle cx="120" cy="120" r="${r}" fill="none" stroke="var(--ring-bg)" stroke-width="10"/>
    <circle cx="120" cy="120" r="${r}" fill="none" stroke="var(--green)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, pct)))).toFixed(1)}" transform="rotate(-90 120 120)"/></svg>`;
}

function phaseBar(d) {
  const st = d.flow.steps, i = d.flow.i;
  const ph = ['warmup', 'workout', 'cooldown'].map((p) => {
    const idx = st.map((s, k) => (stepPhase(s) === p ? k : -1)).filter((k) => k >= 0);
    const doneN = idx.filter((k) => k < i).length;
    return { n: idx.length, pct: idx.length ? doneN / idx.length : 0 };
  }).filter((p) => p.n);
  return `<div class="phbar" style="grid-template-columns:${ph.map((p) => `${Math.max(p.n, 3)}fr`).join(' ')}">${ph.map((p) => `<i><b style="width:${(p.pct * 100).toFixed(1)}%"></b></i>`).join('')}</div>`;
}

function timerBlock(d, s, total) {
  const t = d.flow.timer;
  if (t?.mode === 'prep') {
    return `<div class="flring prep"><div class="flc"><div class="num flbig" id="fltime">${timerLeft(t)}</div><div class="flsub">Bereit machen</div></div></div>`;
  }
  const left = t ? timerLeft(t) : total;
  return `<div class="flring"><div id="flring" class="flsvg">${bigRing(t ? 1 - left / total : 0)}</div><div class="flc"><div class="num flbig" id="fltime">${fmtTime(left)}</div>
    ${t?.mode === 'paused' ? '<div class="flsub">Pausiert</div>' : ''}</div></div>`;
}

function viewPlayer() {
  const d = S.draft;
  ensureFlow(d);
  const steps = d.flow.steps, i = d.flow.i, s = steps[i];
  const t = d.flow.timer;
  const head = `<div class="tbar"><button class="iconbtn" data-a="trainMenu" aria-label="Menü">${ICON_X}</button>
      <button class="crumb" data-a="flowOverview">${esc(d.dayName.split(' – ')[0])} · ${i + 1}/${steps.length} ⌄</button><span class="time" id="elapsed"></span></div>
    ${phaseBar(d)}`;
  const back = i > 0 ? '<button class="btn pill glass" data-a="flowBack">Zurück</button>' : '<span></span>';
  let body = '', cta = '';

  if (s.type === 'warm' || s.type === 'cool') {
    const ph = steps.filter((x) => x.type === s.type), k = ph.indexOf(s) + 1;
    body = `<div class="eyebrow">${s.type === 'warm' ? 'Warm-up' : `Cool-down · ${esc(cdById(d.dayCooldown)?.name || '')}`} · ${k} von ${ph.length}</div>
      <div class="fltitle">${esc(s.name)}${s.side ? `<span class="flside"> ${s.side}</span>` : ''}</div>
      ${s.sec ? timerBlock(d, s, s.sec) : s.reps ? `<div class="num flhuge">${s.reps}</div><div class="flunit">Wiederholungen${s.perSide ? ' je Seite' : ''}</div>` : '<div class="flunit" style="margin-top:28px">Locker durchführen</div>'}
      ${s.hint ? `<p class="muted small fltext">${esc(s.hint)}</p>` : ''}`;
    const main = s.sec && !t ? '<button class="btn pill primary" data-a="flowStart">Start</button>'
      : s.sec && t?.mode === 'paused' ? '<button class="btn pill primary" data-a="flowResume">Weiter</button>'
        : s.sec ? '<button class="btn pill primary" data-a="flowPause">Pause</button>'
          : '<button class="btn pill primary" data-a="flowNext">Weiter</button>';
    cta = `${back}${main}`;
    if (s.sec && t) cta = `<button class="btn pill glass" data-a="flowNext">Überspringen</button>${main}`;
  } else if (s.type === 'set') {
    const ex = d.exercises[s.ex], st = ex.sets[s.set], cfg = ex.cfg, sg = ex.suggestion;
    d.idx = s.ex;
    const isW = ex.type !== 'bodyweight' || st.weight > 0;
    const up = sg.status === 'up' && ex.type !== 'bodyweight';
    body = `<div class="eyebrow">${s.block ? `${esc(s.block)} · Runde ${s.round} von ${s.rounds}` : `Satz ${s.round} von ${s.rounds}`}${st.done ? ' · erledigt ✓' : ''}</div>
      <div class="fltitle">${esc(ex.name)}</div>
      <div class="flchips"><span class="badge ${up ? 'up' : sg.status === 'down' ? 'down' : ''}">${up ? '↑ ' : ''}Ziel ${sg.reps}${ex.unit === 'sec' ? ' s' : ' Wdh.'}${ex.type === 'bodyweight' && !sg.weight ? '' : ` · ${fmtNum(sg.weight)} kg`}</span>${st.rir != null && st.done ? `<span class="badge">RIR ${fmtRir(st.rir)}</span>` : ''}</div>
      ${s.timed ? `${timerBlock(d, s, stepSec(d, s))}${!t ? stepperRow('reps', st.reps, 'Sekunden') : ''}${isW && !t ? stepperRow('weight', st.weight, cfg.weights?.length ? 'kg · deine Gewichte' : 'kg') : ''}`
    : `${isW ? stepperRow('weight', st.weight, ex.type === 'bodyweight' ? 'Zusatzgewicht kg' : 'kg pro Hantel') : ''}${stepperRow('reps', st.reps, 'Wiederholungen')}`}
      <div class="card small flmem">${ex.last ? `Letztes Mal: <b>${esc(ex.last.text)}</b>` : 'Erstes Mal – Startwerte aus dem Plan'}${cfg.hint ? `<div class="muted" style="margin-top:4px">${esc(cfg.hint)}</div>` : ''}</div>`;
    const main = s.timed
      ? (!t ? '<button class="btn pill primary" data-a="flowStart">Start</button>'
        : t.mode === 'paused' ? '<button class="btn pill primary" data-a="flowResume">Weiter</button>' : '<button class="btn pill primary" data-a="flowPause">Pause</button>')
      : `<button class="btn pill primary" data-a="flowSetDone">${st.done ? 'Satz aktualisieren' : 'Satz fertig'}</button>`;
    cta = s.timed && t ? `<button class="btn pill glass" data-a="flowTimedDone">Fertig</button>${main}` : `${back}${main}`;
  } else if (s.type === 'rest') {
    const n = steps.slice(i + 1).find((x) => x.type !== 'rest');
    let nx = '';
    if (n?.type === 'set') { const e = d.exercises[n.ex], st = e.sets[n.set]; nx = `<b>${esc(e.name)}</b>${n.block ? ` · Runde ${n.round} von ${n.rounds}` : ` · Satz ${n.round} von ${n.rounds}`}<br>${e.type === 'bodyweight' && !st.weight ? '' : `${fmtNum(st.weight)} kg × `}${st.reps}${e.unit === 'sec' ? ' s' : ''}`; }
    else if (n) nx = `<b>${esc(stepLabel(d, n))}</b>`;
    body = `<div class="eyebrow">Pause</div><div class="fltitle">Durchatmen</div>
      ${timerBlock(d, s, s.sec)}
      ${nx ? `<div class="card flnext"><div class="muted small">Als Nächstes</div><div>${nx}</div></div>` : ''}`;
    cta = '<button class="btn pill glass" data-a="flowAdd30">+30 s</button><button class="btn pill primary" data-a="flowNext">Überspringen</button>';
  } else {
    return `${head}${feedbackBody(d)}`;
  }
  const nextLine = s.type !== 'rest' ? `<div class="flnextline">${esc(nextInfo(d))}</div>` : '';
  const one = cta.startsWith('<span></span>');
  return `${head}<div class="flbody">${body}</div><div class="cta flcta">${nextLine}<div class="cta2 ${one ? 'one' : ''}" style="position:static;margin:0 auto;max-width:520px">${one ? cta.slice(13) : cta}</div></div>`;
}

function stepperRow(field, value, label) {
  return `<div class="flstep"><button data-a="flowStep" data-f="${field}" data-v="-1" aria-label="weniger">−</button>
    <button class="flval" data-a="flowEdit" data-f="${field}"><span class="num">${fmtNum(value)}</span><small>${esc(label)}</small></button>
    <button data-a="flowStep" data-f="${field}" data-v="1" aria-label="mehr">+</button></div>`;
}

function feedbackBody(d) {
  const vol = volume(d);
  const sets = d.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  const prs = newRecords(d, done());
  return `<div class="eyebrow" style="margin-top:14px">Geschafft</div><h1 style="margin-top:4px">Wie war das Workout?</h1>
    <div class="stats" style="margin-top:14px">
      <div class="stat"><b>${fmtDuration(Date.now() - d.startedAt)}</b><span>Dauer</span></div>
      <div class="stat"><b>${sets}</b><span>Sätze</span></div>
      <div class="stat"><b>${fmtNum(Math.round(vol))}</b><span>kg bewegt</span></div>
    </div>
    ${prs.length ? `<h2>Neue Rekorde 🎉</h2>${prs.map((p) => `<div class="pr">${esc(p.name)}: ${esc(p.text)}</div>`).join('')}` : ''}
    <h2>Anstrengung (RPE)</h2>${rpePicker(d.rpe)}
    <h2>Notiz</h2>
    <textarea id="sessnote" placeholder="Technik, Pump, Beschwerden, Energie …">${esc(d.note || '')}</textarea>
    <button class="btn primary big" data-a="flowSave">Speichern</button>
    <button class="btn ghost" data-a="flowBack">Zurück</button>`;
}

function flowStepValue(field, dir) {
  const d = S.draft, s = stepAt(d, d.flow.i), ex = d.exercises[s.ex], st = ex.sets[s.set];
  let v = st[field];
  if (field === 'weight') v = ex.cfg.weights?.length ? (dir > 0 ? nextWeight(ex.cfg, v) : prevWeight(ex.cfg, v)) ?? v : Math.max(0, Math.round((v + dir * (ex.cfg.increment || 2.5)) * 100) / 100);
  else v = Math.max(1, v + dir * (ex.unit === 'sec' ? 5 : 1));
  // gilt auch für die folgenden, noch offenen Sätze dieser Übung
  ex.sets.forEach((x, j) => { if (j === s.set || (j > s.set && !x.done)) x[field] = v; });
  saveDraft(); render();
}

// ---------- Cool-down ----------
const cdList = () => S.plan?.cooldowns || [];
const cdById = (id) => cdList().find((c) => c.id === id);
const cdMinutes = (c) => Math.max(1, Math.round(expandCooldown(c).total / 60));

/** Abschnitt in der Tagesansicht: festes Cool-down des Tages (sonst alle zur Auswahl) */
function cooldownSection(day) {
  if (!cdList().length) return '';
  const fixed = day?.cooldown && cdById(day.cooldown);
  const list = fixed ? [fixed] : cdList();
  return `<details class="sec"><summary>Cool-down<span class="sumx">${fixed ? `${cdMinutes(fixed)} Min.` : 'Auswahl nach dem Training'}</span><span class="chev"></span></summary>
    <div class="tl">${list.map((c) => `<div class="blk"><div class="blkh">${esc(c.name)} · ${cdMinutes(c)} Min.</div>
      ${c.items.map((x) => `<div class="exl"><span class="nm">${esc(x.name)}</span><span class="vv">${x.sec} s${x.sides ? ' je Seite' : ''}</span></div>`).join('')}</div>`).join('')}</div></details>`;
}

/** Karte auf dem Abschluss-Screen */
function cooldownCard(d) {
  if (!cdList().length) return '';
  const cd = d.cooldown;
  if (cd?.completed) return `<div class="card row"><div class="grow"><div class="eyebrow">Cool-down erledigt ✓</div><div class="small" style="margin-top:2px">${esc(cd.name)}</div></div></div>`;
  return `<h2>Cool-down</h2>
    ${cd && !cd.completed && cd.idx > 0 ? `<div class="muted small" style="margin:-4px 4px 8px">${esc(cd.name)} abgebrochen – noch einmal starten?</div>` : ''}
    <div class="list">${[...cdList()].sort((a, b) => (b.id === d.dayCooldown) - (a.id === d.dayCooldown)).map((c) => `<button class="item" data-a="cdPick" data-id="${esc(c.id)}"><div style="flex:1;min-width:0"><b>${esc(c.name)}</b>
      <div class="muted small">${c.id === d.dayCooldown ? '<span class="ok">Heute vorgesehen</span> · ' : ''}${cdMinutes(c)} Min. · ${c.items.map((x) => esc(x.name)).join(', ')}</div></div><span class="playico">▶</span></button>`).join('')}</div>`;
}

function cdLeftSec(cd, steps) {
  if (!cd || cd.idx >= steps.length) return 0;
  if (cd.paused) return cd.left ?? steps[cd.idx].sec;
  return Math.max(0, Math.ceil((cd.endsAt - Date.now()) / 1000));
}

function viewCooldown() {
  const d = S.draft, cd = d?.cooldown, c = cd && cdById(cd.id);
  if (!c) return '<div class="empty">Kein Cool-down aktiv.</div>';
  const { steps, total } = expandCooldown(c);
  const st = steps[Math.min(cd.idx, steps.length - 1)];
  const doneSec = steps.slice(0, cd.idx).reduce((a, x) => a + x.sec, 0) + (st.sec - cdLeftSec(cd, steps));
  const next = steps.slice(cd.idx + 1, cd.idx + 4);
  return `<div class="tbar"><button class="iconbtn" data-a="cdEnd" aria-label="Beenden">${ICON_X}</button><span class="crumb">${esc(c.name)}</span><span class="time">${cd.idx + 1}/${steps.length}</span></div>
    <div class="cdwrap">
      <div class="ring big" id="cdring">${ringSvg(total ? doneSec / total : 0)}</div>
      <div class="eyebrow" style="margin-top:22px">Dehnung ${cd.idx + 1} von ${steps.length}</div>
      <div class="xtitle" style="text-align:center">${esc(st.name)}</div>
      <div class="num cdtime" id="cdtime">${fmtTime(cdLeftSec(cd, steps))}</div>
      ${st.hint ? `<p class="muted small" style="text-align:center;max-width:320px;margin:0 auto">${esc(st.hint)}</p>` : ''}
    </div>
    ${next.length ? `<h2>Danach</h2><div class="list">${next.map((x) => `<div class="item"><span style="flex:1">${esc(x.name)}</span><span class="muted small num">${x.sec} s</span></div>`).join('')}</div>` : ''}
    <div class="cta"><div class="cta2" style="position:static;margin:0 auto;max-width:520px">
      <button class="btn pill glass" data-a="cdSkip">Überspringen</button>
      <button class="btn pill primary" data-a="cdToggle">${cd.paused ? 'Weiter' : 'Pause'}</button></div></div>`;
}

function cdAdvance(withBeep) {
  const d = S.draft, cd = d.cooldown, c = cdById(cd.id);
  const { steps } = expandCooldown(c);
  if (withBeep) beep();
  cd.idx++;
  if (cd.idx >= steps.length) {
    cd.completed = true; cd.endsAt = null; cd.paused = false;
    saveDraft(); toast('Cool-down geschafft'); go('#/done'); return;
  }
  cd.paused = false; cd.left = null; cd.endsAt = Date.now() + steps[cd.idx].sec * 1000;
  saveDraft(); render();
}

// Wird aus tick() aufgerufen
function cooldownTick() {
  if (!location.hash.startsWith('#/cooldown')) return;
  const cd = S.draft?.cooldown, c = cd && cdById(cd.id);
  if (!c || cd.completed || cd.paused) return;
  const { steps, total } = expandCooldown(c);
  const left = cdLeftSec(cd, steps);
  const el = document.getElementById('cdtime');
  if (el) el.textContent = fmtTime(left);
  const ring = document.getElementById('cdring');
  if (ring && total) {
    const doneSec = steps.slice(0, cd.idx).reduce((a, x) => a + x.sec, 0) + (steps[cd.idx].sec - left);
    ring.innerHTML = ringSvg(doneSec / total);
  }
  if (left <= 0) cdAdvance(true);
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
    ${p ? `<div class="card"><b>${esc(p.name)}</b><div class="muted small">${p.days.length} Trainingstage${Object.keys(S.edits || {}).length ? ' · mit deinen Anpassungen' : ''}</div>
      ${p.params ? `<div class="params small">${[['Frequenz', p.params.frequency], ['Hauptziel', p.params.goal], ['Weitere Ziele', p.params.goals2], ['Dauer', p.params.duration], ['RIR', p.params.rir], ['Session-RPE', p.params.rpe], ['Progression', p.params.progression], ['Block', p.block ? `${p.block.weeks} Wochen ab ${new Date(p.block.start).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}` : '']].filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>${p.params.notes ? `<p class="muted small" style="margin:10px 0 0">${esc(p.params.notes)}</p>` : ''}` : ''}
      ${p.rules?.length ? `<div class="rules small"><b>Unsere Trainingsregeln</b><ul>${p.rules.map((r) => { const i = r.indexOf(':'); return `<li>${i > 0 ? `<b>${esc(r.slice(0, i))}:</b>${esc(r.slice(i + 1))}` : esc(r)}</li>`; }).join('')}</ul></div>` : ''}
      ${p.activities?.length ? `<div class="muted small" style="margin-top:8px">Dazu: ${p.activities.map((a) => `${DAY_SHORT[a.weekday - 1]} ${esc(a.name)}${a.optional ? ' (optional)' : ''}`).join(' · ')}</div>` : ''}</div>
      <div class="list">${p.days.map((d) => `<div class="item" style="display:block"><b>${esc(d.name)}</b><div class="muted small">${d.exercises.map((e) => `${esc(e.name)} ${e.sets}×${e.repsMin === e.repsMax ? e.repsMin : `${e.repsMin}–${e.repsMax}`}${e.unit === 'sec' ? ' s' : ''}`).join(' · ')}</div></div>`).join('')}</div>` : '<div class="card muted">Noch kein Plan geladen.</div>'}
    <button class="btn" data-a="openLibrary">Übungsbibliothek</button>
    <button class="btn" data-a="loadMine">Meinen Plan neu laden</button>
    <button class="btn" data-a="importPlan">Plan-Datei importieren (JSON)</button>
    <button class="btn" data-a="loadExample">Beispielplan laden</button>
    ${archiveSection()}
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
  const b = S.basePlan;
  if (!b || !(b.source === 'mine' || (!b.source && b.name === 'Finaler 3er-Plan'))) return;
  try {
    const raw = await (await fetch(MY_PLAN, { cache: 'no-store' })).json();
    if ((Number(raw.version) || 0) > (b.version || 0)) await setPlan({ ...raw, source: 'mine' }, { quiet: true });
  } catch { /* offline – später erneut */ }
}

async function setPlan(raw, opts = {}) {
  try {
    const plan = normalizePlan(raw);
    const hist = normalizeHistory(raw.history, plan);
    // Bisherigen Plan ins Archiv legen (wenn sich Name oder Version ändern)
    if (S.basePlan && (S.basePlan.name !== plan.name || (S.basePlan.version || 0) !== (plan.version || 0))) {
      S.planArchive = [{ savedAt: Date.now(), name: S.basePlan.name, version: S.basePlan.version || 0, plan: S.basePlan, edits: S.edits }, ...(S.planArchive || [])].slice(0, 20);
      await db.setMeta('planArchive', S.planArchive);
    }
    // Eigene Anpassungen behalten, soweit die Übungen im neuen Plan noch existieren
    const keysByDay = Object.fromEntries(plan.days.map((d) => [d.id, new Set(d.exercises.map((e) => e.key))]));
    const kept = {};
    for (const [dayId, e] of Object.entries(raw.edits || S.edits || {})) {
      if (!keysByDay[dayId]) continue;
      kept[dayId] = { replace: Object.fromEntries(Object.entries(e.replace || {}).filter(([k]) => keysByDay[dayId].has(k))), remove: (e.remove || []).filter((k) => keysByDay[dayId].has(k)), add: e.add || [] };
    }
    S.basePlan = plan; S.edits = kept;
    await persistPlan();
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
  flowNext: () => { unlockAudio(); flowNext(); },
  flowBack: () => { const d = S.draft; if (d.flow.i > 0) { let j = d.flow.i - 1; while (j > 0 && stepAt(d, j).type === 'rest') j--; flowGo(j); } },
  flowStart: () => { unlockAudio(); S.draft.flow.timer = { mode: 'prep', endsAt: Date.now() + PREP_SEC * 1000 }; saveDraft(); render(); },
  flowPause: () => { const t = S.draft.flow.timer; if (!t) return; S.draft.flow.timer = { mode: 'paused', left: timerLeft(t), was: t.mode }; saveDraft(); render(); },
  flowResume: () => { const t = S.draft.flow.timer; S.draft.flow.timer = { mode: t.was || 'run', endsAt: Date.now() + t.left * 1000 }; saveDraft(); render(); },
  flowAdd30: () => { const t = S.draft.flow.timer; if (t?.endsAt) { t.endsAt += 30000; saveDraft(); flowTick(); } },
  flowSetDone: () => { unlockAudio(); const d = S.draft; finishSet(d, stepAt(d, d.flow.i)); },
  flowTimedDone: () => { const d = S.draft, s = stepAt(d, d.flow.i), t = d.flow.timer;
    if (t?.mode === 'run' || (t?.mode === 'paused' && t.was === 'run')) { const done = stepSec(d, s) - timerLeft(t); if (done > 0) d.exercises[s.ex].sets[s.set].reps = done; }
    d.flow.timer = null; saveDraft(); render(); finishSet(d, s); },
  flowStep: (a) => flowStepValue(a.dataset.f, +a.dataset.v),
  flowEdit: (a) => { const d = S.draft, s = stepAt(d, d.flow.i); d.idx = s.ex; editValue(s.set, a.dataset.f); },
  flowSave: () => saveSession(),
  flowOverview: () => {
    const d = S.draft;
    let html = '', ph = '';
    d.flow.steps.forEach((x, k) => {
      if (x.type === 'rest') return;
      const p = stepPhase(x);
      if (p !== ph) { ph = p; html += `<div class="item muted small" style="font-weight:600">${{ warmup: 'Warm-up', workout: 'Workout', cooldown: 'Cool-down', end: 'Abschluss' }[p]}</div>`; }
      const isDone = x.type === 'set' ? d.exercises[x.ex].sets[x.set].done : k < d.flow.i;
      const det = x.type === 'set' ? `${x.block ? `${x.block} · ` : ''}${x.block ? 'Runde' : 'Satz'} ${x.round}/${x.rounds}` : x.sec ? fmtTime(x.sec) : x.reps ? `${x.reps} Wdh.` : '';
      html += `<button class="item" data-s="go" data-i="${k}" style="${k === d.flow.i ? 'background:var(--green-soft)' : ''}"><span style="width:18px;color:var(--green)">${isDone ? '✓' : ''}</span><span style="flex:1">${esc(stepLabel(d, x))}</span><span class="muted small">${esc(det)}</span></button>`;
    });
    sheet(`<h3>Ablauf</h3><div class="list sheetlist">${html}</div>`, { go: (b) => { closeSheet(); flowGo(+b.dataset.i); } });
    setTimeout(() => document.querySelector('.sheetlist [style*="green-soft"]')?.scrollIntoView({ block: 'center' }), 50);
  },
  activityDone: (a) => {
    const t = +a.dataset.t, name = a.dataset.n;
    sheet(`<h3>${esc(name)} erledigt</h3><p class="muted small" style="text-align:center">Wie lange?</p>
      <div class="rpegrid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">${[20, 30, 45, 60].map((m) => `<button data-s="save" data-m="${m}">${m} Min.</button>`).join('')}</div>`, {
      save: async (b) => {
        const start = sameDay(t, Date.now()) ? Date.now() - +b.dataset.m * 60000 : new Date(new Date(t).setHours(18, 0, 0, 0)).getTime();
        const x = { id: `act-${Date.now()}`, kind: 'activity', startedAt: start, endedAt: start + +b.dataset.m * 60000, planName: S.plan.name, dayId: 'activity', dayName: name, note: '', exercises: [] };
        await db.putSession(x); S.sessions.push(x); closeSheet(); toast(`${name} eingetragen`); render(); backupSoon();
      },
    });
  },
  cdPick: (a) => {
    const c = cdById(a.dataset.id); if (!c) return;
    unlockAudio(); keepAwake(true);
    S.draft.note = document.getElementById('sessnote')?.value ?? S.draft.note;
    S.draft.cooldown = { id: c.id, name: c.name, idx: 0, paused: false, left: null, completed: false, endsAt: Date.now() + expandCooldown(c).steps[0].sec * 1000 };
    saveDraft(); go('#/cooldown');
  },
  cdToggle: () => {
    const cd = S.draft.cooldown, steps = expandCooldown(cdById(cd.id)).steps;
    if (cd.paused) { cd.endsAt = Date.now() + (cd.left ?? steps[cd.idx].sec) * 1000; cd.paused = false; cd.left = null; }
    else { cd.left = cdLeftSec(cd, steps); cd.paused = true; cd.endsAt = null; }
    saveDraft(); render();
  },
  cdSkip: () => cdAdvance(false),
  cdEnd: () => confirmSheet('Cool-down beenden?', 'Du kommst zurück zum Abschluss und kannst speichern.', 'Beenden', () => {
    const cd = S.draft.cooldown; cd.paused = true; cd.endsAt = null; saveDraft(); go('#/done');
  }, false),
  customize: (a) => customizeDay(a.dataset.id, +a.dataset.t),
  openLibrary: async () => { await ensureLib(); go('#/library'); },
  libMuscle: (a) => { S.libMuscle = a.dataset.m; render(); },
  libItem: (a) => libItemSheet(a.dataset.k),
  archiveItem: (a) => {
    const it = S.planArchive[+a.dataset.i];
    sheet(`<h3>${esc(it.name)} · Version ${it.version || 1}</h3>
      <div class="list sheetlist">${it.plan.days.map((d) => `<div class="item" style="display:block"><b>${esc(d.name)}</b><div class="muted small">${d.exercises.map((e) => esc(e.name)).join(' · ')}</div></div>`).join('')}</div>
      <button class="btn primary" data-s="act">Diesen Plan aktivieren</button><button class="btn ghost" data-s="x">Abbrechen</button>`, {
      act: async () => { closeSheet(); await setPlan({ ...it.plan, source: 'archive', edits: it.edits || {} }); },
      x: closeSheet,
    });
  },
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
    <button class="btn" data-s="swap">Diese Übung tauschen</button>
    <button class="btn" data-s="pause">Pausieren (später weitermachen)</button>
    <button class="btn" data-s="finish">Jetzt beenden & speichern</button>
    <button class="btn danger" data-s="discard">Training verwerfen</button>
    <button class="btn ghost" data-s="close">Abbrechen</button>`, {
    swap: () => { closeSheet(); swapInTraining(); },
    pause: () => { closeSheet(); keepAwake(false); go('#/'); },
    finish: () => { closeSheet(); if (S.draft.flow) flowGo(S.draft.flow.steps.length - 1); else go('#/done'); },
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

$app.addEventListener('input', (e) => {
  if (e.target.id !== 'libsearch') return;
  S.libQuery = e.target.value; const pos = e.target.selectionStart; render();
  const el = document.getElementById('libsearch'); el.focus(); el.setSelectionRange(pos, pos);
});
$app.addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]');
  if (a && actions[a.dataset.a] && !a.disabled) { e.preventDefault(); actions[a.dataset.a](a); }
});

// Tab-Leiste beim Herunterscrollen ausblenden, beim Hochscrollen wieder zeigen (wie iOS)
let lastY = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
  if (y < 60 || atEnd) { $tabbar.classList.remove('away'); lastY = y; return; }
  if (Math.abs(y - lastY) < 6) return;
  $tabbar.classList.toggle('away', y > lastY);
  lastY = y;
}, { passive: true });
window.addEventListener('hashchange', () => { $tabbar.classList.remove('away'); lastY = 0; });

// Wischen zwischen Übungen
let touch;
$app.addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
$app.addEventListener('touchend', (e) => {
  if (!touch || !location.hash.startsWith('#/train')) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 50) {
    if (S.draft?.flow) { if (dx > 0 && S.draft.flow.i > 0 && !S.draft.flow.timer) actions.flowBack(); }
    else actions[dx < 0 ? 'next' : 'prev']();
  }
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
