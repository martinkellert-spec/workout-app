// Reine Logik ohne DOM/DB – testbar in tests/tests.html

export const slug = (name) =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const fmtNum = (n) =>
  (Math.round(n * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

export const epley = (w, r) => (r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30));

const doneSets = (perf) => (perf?.sets || []).filter((s) => s.done);

/** Plan-JSON prüfen und normalisieren. Wirft Error mit verständlicher Meldung. */
const WD = [['mo', 'montag'], ['di', 'dienstag'], ['mi', 'mittwoch'], ['do', 'donnerstag'], ['fr', 'freitag'], ['sa', 'samstag'], ['so', 'sonntag']];
/** Wochentag 1–7 (Mo–So) aus "weekday", der id oder dem ersten Wort des Namens ("Montag – …") ableiten */
export function inferWeekday(d) {
  if (Number(d.weekday) >= 1 && Number(d.weekday) <= 7) return Number(d.weekday);
  for (const src of [d.id, d.name]) {
    const word = String(src || '').trim().toLowerCase().split(/[^a-zäöüß]+/)[0];
    const i = WD.findIndex((w) => w.includes(word));
    if (word && i >= 0) return i + 1;
  }
  return null;
}

/** Eine Übung aus Plan/Bibliothek in das App-Format bringen */
export function normalizeExercise(e) {
  const repsMin = Number(e.repsMin ?? e.reps ?? 8);
  const repsMax = Number(e.repsMax ?? e.reps ?? repsMin);
  return {
    key: slug(e.name),
    name: String(e.name),
    type: e.type === 'bodyweight' ? 'bodyweight' : 'weight',
    sets: Number(e.sets ?? 3),
    repsMin: Math.min(repsMin, repsMax),
    repsMax: Math.max(repsMin, repsMax),
    weight: Number(e.weight ?? 0),
    increment: Number(e.increment ?? 2.5),
    rest: e.rest == null ? null : Number(e.rest), // null = Standard-Pause, 0 = direkt weiter
    unit: e.unit === 'sec' ? 'sec' : 'reps',
    weights: Array.isArray(e.weights) ? [...e.weights].map(Number).sort((a, b) => a - b) : null,
    group: e.group ? String(e.group) : '',
    hint: e.hint ? String(e.hint) : '',
  };
}

export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Datei enthält kein gültiges JSON-Objekt.');
  if (!Array.isArray(raw.days) || raw.days.length === 0) throw new Error('Plan braucht mindestens einen Eintrag in "days".');
  const t = raw.tests;
  return {
    name: String(raw.name || 'Mein Plan'),
    version: Number(raw.version) || 0,
    source: raw.source ? String(raw.source) : '',
    block: raw.block && raw.block.start ? { weeks: Number(raw.block.weeks) || 8, start: String(raw.block.start) } : null,
    params: raw.params && typeof raw.params === 'object' ? { ...raw.params } : null,
    rules: Array.isArray(raw.rules) ? raw.rules.map(String) : [],
    activities: Array.isArray(raw.activities) ? raw.activities.map((a) => ({ weekday: Number(a.weekday), name: String(a.name || 'Aktivität'), optional: !!a.optional })) : [],
    cooldowns: Array.isArray(raw.cooldowns) ? raw.cooldowns.map((c, i) => ({
      id: String(c.id || slug(c.name || `cooldown-${i}`)),
      name: String(c.name || `Cool-down ${i + 1}`),
      items: (c.items || []).map((x) => ({ name: String(x.name), sec: Number(x.sec) || 30, sides: !!x.sides, hint: x.hint ? String(x.hint) : '' })),
    })) : [],
    tests: t && Array.isArray(t.items) && t.items.length ? {
      everyWeeks: Number(t.everyWeeks) || 6,
      items: t.items.map((x, i) => ({
        id: String(x.id || slug(x.name || `test-${i}`)),
        name: String(x.name || `Test ${i + 1}`),
        type: x.type === 'time' ? 'time' : 'reps',
        lowerIsBetter: x.type === 'time' ? x.lowerIsBetter !== false : !!x.lowerIsBetter,
        hint: x.hint ? String(x.hint) : '',
        steps: Array.isArray(x.steps) ? x.steps.map(String) : [],
        seconds: Number(x.seconds) || 0,
      })),
    } : null,
    days: raw.days.map((d, i) => {
      if (!Array.isArray(d.exercises) || d.exercises.length === 0)
        throw new Error(`Tag ${i + 1} hat keine Übungen.`);
      return {
        id: String(d.id ?? String.fromCharCode(65 + i)),
        name: String(d.name || `Tag ${String.fromCharCode(65 + i)}`),
        note: d.note ? String(d.note) : '',
        focus: d.focus ? String(d.focus) : '',
        subtitle: d.subtitle ? String(d.subtitle) : '',
        cooldown: d.cooldown ? String(d.cooldown) : '',
        groupNames: d.groupNames && typeof d.groupNames === 'object' ? { ...d.groupNames } : {},
        equipment: d.equipment ? String(d.equipment) : '',
        weekday: inferWeekday(d),
        exercises: d.exercises.map((e, j) => {
          if (!e.name) throw new Error(`Übung ${j + 1} an Tag ${i + 1} hat keinen Namen.`);
          return normalizeExercise(e);
        }),
      };
    }),
  };
}

/** Alle bisherigen Ausführungen einer Übung, neueste zuerst. */
export function historyFor(sessions, key) {
  return sessions
    .filter((s) => s.endedAt)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => {
      const ex = s.exercises.find((e) => e.key === key);
      return ex && doneSets(ex).length ? { date: s.startedAt, sets: doneSets(ex), note: ex.note } : null;
    })
    .filter(Boolean);
}

export const unitLabel = (unit, long = false) => (unit === 'sec' ? (long ? 'Sekunden' : 's') : (long ? 'Wiederholungen' : 'Wdh.'));

/** Nächstschwereres Gewicht: aus der Equipment-Liste (falls vorhanden), sonst + increment. null = kein schwereres vorhanden */
export function nextWeight(cfg, w) {
  if (cfg.weights?.length) return cfg.weights.find((x) => x > w + 1e-9) ?? null;
  return w + cfg.increment;
}
export function prevWeight(cfg, w) {
  if (cfg.weights?.length) return [...cfg.weights].reverse().find((x) => x < w - 1e-9) ?? null;
  return Math.max(0, w - cfg.increment);
}

export function topWeight(perf) {
  return Math.max(0, ...doneSets(perf).map((s) => s.weight));
}

/**
 * Vorschlag für heute (Double Progression).
 * returns { weight, reps, status: 'new'|'up'|'same'|'down', text }
 */
export function suggest(cfg, history) {
  if (!history.length) {
    return { weight: cfg.weight, reps: cfg.repsMin, status: 'new', text: 'Erstes Mal – Startwerte aus dem Plan' };
  }
  const last = history[0];
  const w = topWeight(last);
  const atW = doneSets(last).filter((s) => s.weight === w);
  const minReps = Math.min(...atW.map((s) => s.reps));

  const u = unitLabel(cfg.unit);
  const allTop = atW.length >= cfg.sets && atW.every((s) => s.reps >= cfg.repsMax);

  if (cfg.type === 'bodyweight') {
    if (allTop) return { weight: w, reps: cfg.repsMax, status: 'max', text: `Obere Grenze erreicht – schwerere Variante oder langsameres Tempo` };
    const reps = Math.min(cfg.repsMax, Math.max(cfg.repsMin, minReps + 1));
    return { weight: w, reps, status: 'up', text: `Ziel: ${reps} ${u} pro Satz` };
  }

  if (allTop) {
    const nw = nextWeight(cfg, w);
    if (nw == null) return { weight: w, reps: cfg.repsMax, status: 'max', text: `Schwerstes verfügbares Gewicht – Tempo verlangsamen oder Pause kürzen` };
    return { weight: nw, reps: cfg.repsMin, status: 'up', text: `Alles geschafft → ${fmtNum(nw)} kg` };
  }

  // Zweimal in Folge unter dem Wdh.-Bereich bei gleichem Gewicht → Hinweis
  if (history.length >= 2) {
    const prev = history[1];
    const pw = topWeight(prev);
    const prevMin = Math.min(...doneSets(prev).filter((s) => s.weight === pw).map((s) => s.reps));
    const nw = prevWeight(cfg, w);
    if (pw === w && minReps < cfg.repsMin && prevMin < cfg.repsMin && nw != null) {
      return { weight: w, reps: cfg.repsMin, status: 'down', text: `2× unter ${cfg.repsMin} ${u} – Gewicht auf ${fmtNum(nw)} kg reduzieren?`, lighter: nw };
    }
  }

  const reps = Math.min(cfg.repsMax, Math.max(cfg.repsMin, minReps + 1));
  return { weight: w, reps, status: 'same', text: `Gleiches Gewicht, Ziel ${reps} ${u}` };
}

/** Kurztext "3×10 @ 60 kg" bzw. "60×10, 60×9" */
export function describePerf(perf, type = 'weight', repUnit = 'reps') {
  const sets = doneSets(perf);
  if (!sets.length) return '–';
  const same = sets.every((s) => s.weight === sets[0].weight && s.reps === sets[0].reps);
  const r = repUnit === 'sec' ? ' s' : '';
  const unit = (w) => (type === 'bodyweight' && !w ? 'Körpergew.' : `${fmtNum(w)} kg`);
  if (same) return `${sets.length} × ${sets[0].reps}${r} · ${unit(sets[0].weight)}`;
  if (sets.every((s) => s.weight === sets[0].weight))
    return `${sets.map((s) => s.reps).join(' / ')}${r} · ${unit(sets[0].weight)}`;
  return sets.map((s) => `${fmtNum(s.weight)} × ${s.reps}${r}`).join(', ');
}

/** RIR-Anzeige: 4 = "4+", Bereiche aus dem Import ("1–2") bleiben Text */
export const fmtRir = (r) => (r == null || r === '' ? '' : typeof r === 'number' ? (r >= 4 ? '4+' : String(r)) : String(r));

/** Zusammenfassung der RIR-Werte einer Ausführung, z. B. "RIR 1–2" oder "RIR 2". Leer, wenn keine erfasst. */
export function rirSummary(perf) {
  const vals = doneSets(perf).map((s) => s.rir).filter((r) => r != null && r !== '');
  if (!vals.length) return '';
  if (vals.some((v) => typeof v !== 'number')) {
    const uniq = [...new Set(vals.map(String))];
    return `RIR ${uniq.join(' / ')}`;
  }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return lo === hi ? `RIR ${fmtRir(lo)}` : `RIR ${fmtRir(lo)}–${fmtRir(hi)}`;
}

/** Bestwerte einer Übung über eine Liste von Ausführungen */
export function records(history) {
  let maxWeight = 0, best1RM = 0, maxReps = 0;
  for (const p of history) for (const s of p.sets) {
    maxWeight = Math.max(maxWeight, s.weight);
    best1RM = Math.max(best1RM, epley(s.weight, s.reps));
    maxReps = Math.max(maxReps, s.reps);
  }
  return { maxWeight, best1RM, maxReps };
}

/** Neue Rekorde einer gerade beendeten Session gegenüber der Vorgeschichte */
export function newRecords(session, previousSessions) {
  const out = [];
  for (const ex of session.exercises) {
    const cur = doneSets(ex);
    if (!cur.length) continue;
    const prev = historyFor(previousSessions, ex.key);
    if (!prev.length) continue; // erstes Mal zählt nicht als PR
    const before = records(prev);
    const now = records([{ sets: cur }]);
    if (now.maxWeight > before.maxWeight) out.push({ name: ex.name, text: `Höchstes Gewicht: ${fmtNum(now.maxWeight)} kg` });
    else if (now.best1RM > before.best1RM + 0.01) out.push({ name: ex.name, text: `Bestes geschätztes 1RM: ${fmtNum(Math.round(now.best1RM * 10) / 10)} kg` });
    else if (ex.type === 'bodyweight' && now.maxReps > before.maxReps) out.push({ name: ex.name, text: `Meiste Wdh.: ${now.maxReps}` });
  }
  return out;
}

export function volume(session) {
  let v = 0;
  for (const ex of session.exercises) for (const s of doneSets(ex)) v += s.weight * s.reps;
  return v;
}

/** Nächster Trainingstag in der Rotation */
export function nextDay(plan, sessions) {
  const done = sessions.filter((s) => s.endedAt && s.kind !== 'test' && s.planName === plan.name).sort((a, b) => b.startedAt - a.startedAt);
  if (!done.length) return plan.days[0];
  const idx = plan.days.findIndex((d) => d.id === done[0].dayId);
  return plan.days[(idx + 1) % plan.days.length] || plan.days[0];
}

/** Montag 00:00 der Woche von ts */
export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Statistik der letzten n Wochen, älteste zuerst */
export function weeklyStats(sessions, n = 8, now = Date.now()) {
  const ws = weekStart(now);
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ws); d.setDate(d.getDate() - i * 7);
    weeks.push({ start: d.getTime(), count: 0, volume: 0 });
  }
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const w = weeks.find((x) => x.start === weekStart(s.startedAt));
    if (w) { w.count++; w.volume += volume(s); }
  }
  return weeks;
}

/** Wochen in Folge mit mindestens einem Training (aktuelle Woche zählt, wenn schon trainiert) */
export function streak(sessions, now = Date.now()) {
  const set = new Set(sessions.filter((s) => s.endedAt).map((s) => weekStart(s.startedAt)));
  let d = new Date(weekStart(now));
  if (!set.has(d.getTime())) d.setDate(d.getDate() - 7);
  let n = 0;
  while (set.has(d.getTime())) { n++; d.setDate(d.getDate() - 7); }
  return n;
}

export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Trainings aus einer Import-Datei (Feld "history") in App-Sessions umwandeln */
export function normalizeHistory(raw, plan) {
  if (!Array.isArray(raw)) return [];
  const cfgByKey = new Map(plan.days.flatMap((d) => d.exercises).map((e) => [e.key, e]));
  return raw.map((h, i) => {
    const start = new Date(h.date).getTime();
    if (!Number.isFinite(start)) throw new Error(`Training ${i + 1} im Log hat kein gültiges Datum.`);
    const day = plan.days.find((d) => d.id === h.dayId);
    return {
      id: h.id || `import-${start}-${i}`,
      startedAt: start,
      endedAt: start + (Number(h.durationMin) || 45) * 60000,
      planName: plan.name, dayId: h.dayId || '', dayName: day?.name || h.dayName || 'Training',
      feeling: h.feeling ?? null, rpe: h.rpe ?? null, note: h.note || '', imported: true,
      exercises: (h.exercises || []).map((e) => {
        const key = slug(e.name), cfg = cfgByKey.get(key);
        return {
          key, name: e.name, type: cfg?.type || 'weight', unit: cfg?.unit || 'reps', note: e.note || '',
          sets: (e.sets || []).map((x) => ({ weight: Number(x.weight ?? e.weight ?? 0), reps: Number(x.reps ?? x), rir: x.rir ?? e.rir ?? null, done: true })),
        };
      }),
    };
  });
}

/** Nächste Übung mit offenen Sätzen ab idx (vorwärts, dann von vorn). -1 = alles erledigt */
export function nextOpen(exercises, idx) {
  const open = (i) => exercises[i].sets.some((s) => !s.done);
  for (let i = idx + 1; i < exercises.length; i++) if (open(i)) return i;
  for (let i = 0; i <= idx; i++) if (open(i)) return i;
  return -1;
}

/**
 * Supersatz/Circuit: Nach einem erledigten Satz in exercises[idx] – wohin springen?
 * Gibt den Index der nächsten Übung derselben Gruppe zurück, die in dieser Runde noch dran ist, sonst idx.
 */
export function supersetNext(exercises, idx) {
  const g = exercises[idx].group;
  if (!g) return idx;
  const members = exercises.map((e, i) => (e.group === g ? i : -1)).filter((i) => i >= 0);
  const doneN = (i) => exercises[i].sets.filter((s) => s.done).length;
  const pos = members.indexOf(idx);
  const order = [...members.slice(pos + 1), ...members.slice(0, pos)];
  // erst wer in dieser Runde zurückliegt, dann (neue Runde) wer noch offene Sätze hat
  const behind = order.find((i) => doneN(i) < doneN(idx) && doneN(i) < exercises[i].sets.length);
  if (behind != null) return behind;
  if (exercises[idx].sets.some((s) => !s.done)) return order.length && exercises[members[0]].sets.some((s) => !s.done) && members[0] !== idx ? members[0] : idx;
  return order.find((i) => exercises[i].sets.some((s) => !s.done)) ?? idx;
}

// ---------- Tagesplanung ----------
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
/** Plan-Tag für ein Datum (über den Wochentag), sonst null */
export function planDayFor(plan, ts) {
  const wd = ((new Date(ts).getDay() + 6) % 7) + 1;
  return plan?.days.find((d) => (d.weekday ?? inferWeekday(d)) === wd) || null;
}

// ---------- Leistungstests ----------
const WEEK = 7 * 864e5;
/** Status der Tests: fällig? Basistest, wenn noch keiner gemacht wurde. */
export function testStatus(plan, sessions, now = Date.now()) {
  if (!plan?.tests) return null;
  const tests = sessions.filter((s) => s.kind === 'test' && s.endedAt).sort((a, b) => b.startedAt - a.startedAt);
  const last = tests[0] || null;
  if (!last) return { due: true, baseline: true, dueAt: now, last: null, weeksLeft: 0 };
  const dueAt = last.startedAt + plan.tests.everyWeeks * WEEK;
  return { due: now >= dueAt, baseline: false, dueAt, last, weeksLeft: Math.max(0, Math.ceil((dueAt - now) / WEEK)) };
}

/** Alle Ergebnisse eines Tests, neueste zuerst */
export function testHistory(sessions, testId) {
  return sessions.filter((s) => s.kind === 'test' && s.endedAt)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => { const r = (s.results || []).find((x) => x.id === testId); return r && r.value != null ? { date: s.startedAt, value: r.value } : null; })
    .filter(Boolean);
}

export const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
export const fmtTestValue = (t, v) => (v == null ? '–' : t.type === 'time' ? fmtTime(v) : `${v} Wdh.`);

/** Veränderung gegenüber dem vorigen Test: { text, better } oder null */
export function testDelta(t, hist) {
  if (hist.length < 2) return null;
  const d = hist[0].value - hist[1].value;
  if (d === 0) return { text: '±0', better: null };
  const better = t.lowerIsBetter ? d < 0 : d > 0;
  const abs = Math.abs(d);
  return { text: `${d > 0 ? '+' : '−'}${t.type === 'time' ? fmtTime(abs) : abs}`, better };
}

// ---------- Auswertung (Hinweise) ----------
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const numRirs = (perf) => doneSets(perf).map((x) => x.rir).filter((r) => typeof r === 'number');

/** Regelbasierte Hinweise aus den Trainings. level: warn | good | info */
export function insights(plan, sessions, now = Date.now()) {
  const out = [];
  const tr = sessions.filter((s) => s.endedAt && s.kind !== 'test').sort((a, b) => b.startedAt - a.startedAt);

  // 1) Belastung: RPE
  const rpes = tr.map((s) => s.rpe).filter((r) => typeof r === 'number');
  if (rpes.slice(0, 3).filter((r) => r >= 9).length >= 2) {
    out.push({ level: 'warn', text: 'Die letzten Einheiten waren sehr hart (RPE 9+). Eine leichtere Woche würde der Erholung guttun.' });
  } else if (rpes.length >= 6 && avg(rpes.slice(0, 3)) - avg(rpes.slice(3, 6)) >= 1.5) {
    out.push({ level: 'warn', text: `Die Sessions fühlen sich härter an (RPE Ø ${fmtNum(Math.round(avg(rpes.slice(0, 3)) * 10) / 10)} statt ${fmtNum(Math.round(avg(rpes.slice(3, 6)) * 10) / 10)}). Schlaf und Erholung im Blick behalten.` });
  }

  // 2) Pro Übung: am Limit, zu leicht, stagniert
  const keys = [...new Set(tr.flatMap((s) => s.exercises.map((e) => e.key)))];
  const limit = [], easy = [], stuck = [];
  for (const key of keys) {
    const h = historyFor(tr, key);
    if (!h.length) continue;
    const name = tr.find((s) => s.exercises.some((e) => e.key === key)).exercises.find((e) => e.key === key).name;
    const r0 = numRirs(h[0]);
    if (r0.length >= 2 && r0.every((r) => r === 0)) limit.push(name);
    else if (h.length >= 2 && [h[0], h[1]].every((p) => { const r = numRirs(p); return r.length && avg(r) >= 3; })) easy.push(name);
    if (h.length >= 4) {
      const score = (p) => Math.max(...doneSets(p).map((x) => (x.weight > 0 ? epley(x.weight, x.reps) : x.reps)));
      const recent = Math.max(...h.slice(0, 3).map(score));
      const before = Math.max(...h.slice(3).map(score));
      if (recent <= before) stuck.push(name);
    }
  }
  const list = (n) => (n.length <= 3 ? n.join(', ') : `${n.slice(0, 3).join(', ')} und ${n.length - 3} weitere`);
  if (limit.length === 1) out.push({ level: 'warn', text: `${limit[0]}: alle Sätze am Limit (RIR 0). Gewicht halten, bis wieder Luft da ist.` });
  else if (limit.length > 1) out.push({ level: 'warn', text: `${limit.length} Übungen zuletzt komplett am Limit (RIR 0): ${list(limit)}. Gewichte halten, bis wieder Luft da ist.` });
  if (easy.length === 1) out.push({ level: 'good', text: `${easy[0]} ging zweimal locker (RIR 3+). Mehr Gewicht oder Wiederholungen ist drin.` });
  else if (easy.length > 1) out.push({ level: 'good', text: `Zweimal locker (RIR 3+): ${list(easy)}. Hier ist mehr drin.` });
  if (stuck.length === 1) out.push({ level: 'info', text: `${stuck[0]} stagniert seit 3 Einheiten. Tempo, Pausen oder Variante ändern?` });
  else if (stuck.length > 1) out.push({ level: 'info', text: `Stagniert seit 3 Einheiten: ${list(stuck)}. Tempo, Pausen oder Variante ändern?` });

  // 3) Regelmäßigkeit diese Woche
  if (plan) {
    const ws = weekStart(now);
    const planned = plan.days.filter((d) => d.weekday).map((d) => ws + (d.weekday - 1) * 864e5).filter((t) => t <= now && !sameDay(t, now));
    const all = sessions.filter((s) => s.endedAt);
    const missed = planned.filter((t) => !all.some((s) => sameDay(s.startedAt, t)));
    if (missed.length) out.push({ level: 'info', text: `Diese Woche ${missed.length === 1 ? 'fehlt 1 geplante Einheit' : `fehlen ${missed.length} geplante Einheiten`}. Nachholen oder bewusst auslassen?` });
  }
  const order = { warn: 0, good: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 4);
}

/** Geschätzte Dauer eines Trainingstags in Minuten (Warm-up + Sätze + Pausen) */
export function estimateMinutes(day, restDefault = 90) {
  let sec = day.note ? 5 * 60 : 0;
  for (const e of day.exercises) {
    const work = e.unit === 'sec' ? e.repsMax : e.repsMax * 3.5 + 10;
    const rest = e.rest ?? restDefault;
    sec += e.sets * (work + rest);
  }
  return Math.round(sec / 60 / 5) * 5;
}

/** Fortschritt der aktuellen Woche: geplante Einheiten vs. erledigte Trainingstage */
export function weekProgress(plan, sessions, now = Date.now()) {
  const ws = weekStart(now), we = ws + 7 * 864e5;
  const planned = plan ? plan.days.filter((d) => (d.weekday ?? inferWeekday(d))).length : 0;
  const days = new Set(sessions.filter((s) => s.endedAt && s.kind !== 'activity' && s.startedAt >= ws && s.startedAt < we).map((s) => new Date(s.startedAt).toDateString()));
  return { planned, done: Math.min(days.size, Math.max(planned, days.size)) };
}

/** Übungen eines Tags zu Blöcken zusammenfassen (Supersatz/Circuit = gleiche Gruppe hintereinander) */
export function blocks(day) {
  const out = [];
  for (const e of day.exercises) {
    const last = out[out.length - 1];
    if (e.group && last && last.group === e.group) last.items.push(e);
    else out.push({ group: e.group || '', items: [e] });
  }
  return out;
}

/** Warm-up-Text ("4–5 Min.: A, B / C") in Dauer + einzelne Übungen zerlegen */
export function parseWarmup(note) {
  const text = String(note || '').trim();
  if (!text) return null;
  const i = text.indexOf(':');
  const head = i > 0 ? text.slice(0, i).trim() : '';
  const body = i > 0 ? text.slice(i + 1) : text;
  const items = body.split(/\s*(?:,|\s\/\s|;)\s*/).map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1));
  return { duration: head, items };
}

// ---------- Bibliothek & Plan-Anpassungen ----------
/** Bibliothek normalisieren: jede Übung bekommt key, muscles, patterns, equipment */
export function normalizeLibrary(raw) {
  return (raw?.exercises || []).map((x) => ({ ...normalizeExercise(x), muscles: x.muscles || [], patterns: x.patterns || [], equipment: x.equipment || '' }));
}

/** Übung aus der Bibliothek an die Stelle einer Plan-Übung setzen (Sätze, Gruppe und Pause bleiben) */
export function fromLibrary(item, base = {}) {
  return { ...item, sets: base.sets ?? 3, group: base.group || '', rest: base.rest ?? null, swappedFrom: base.key || '' };
}

/**
 * Anpassungen auf einen Plan anwenden.
 * edits: { [dayId]: { replace: { [origKey]: libKey }, remove: [origKey], add: [libKey] } }
 */
export function applyEdits(plan, edits, lib) {
  if (!plan) return plan;
  const byKey = new Map((lib || []).map((x) => [x.key, x]));
  return {
    ...plan,
    days: plan.days.map((d) => {
      const e = edits?.[d.id];
      if (!e) return d;
      let ex = d.exercises
        .filter((x) => !(e.remove || []).includes(x.key))
        .map((x) => { const r = e.replace?.[x.key]; return r && byKey.has(r) ? fromLibrary(byKey.get(r), x) : x; });
      for (const k of e.add || []) if (byKey.has(k)) ex = ex.concat(fromLibrary(byKey.get(k), { sets: 3 }));
      return { ...d, exercises: ex, edited: true };
    }),
  };
}

/** Passende Alternativen: gleiches Bewegungsmuster zuerst, dann gleiche Muskelgruppe */
export function alternativesFor(exKey, lib, exclude = []) {
  const me = lib.find((x) => x.key === exKey);
  if (!me) return lib.filter((x) => !exclude.includes(x.key)).slice(0, 12);
  const score = (x) => (x.patterns.some((p) => me.patterns.includes(p)) ? 2 : 0) + (x.muscles.some((m) => me.muscles.includes(m)) ? 1 : 0);
  return lib.filter((x) => x.key !== exKey && !exclude.includes(x.key) && score(x) > 0)
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'de'));
}

/** Cool-down in einzelne Schritte auflösen ("je Seite" → links + rechts) */
export function expandCooldown(cd) {
  const steps = [];
  for (const x of cd?.items || []) {
    if (x.sides) { steps.push({ name: `${x.name} links`, sec: x.sec, hint: x.hint }); steps.push({ name: `${x.name} rechts`, sec: x.sec, hint: x.hint }); }
    else steps.push({ name: x.name, sec: x.sec, hint: x.hint });
  }
  return { steps, total: steps.reduce((a, x) => a + x.sec, 0) };
}

/** Aktivität (z. B. Yoga) für ein Datum laut Plan, sonst null */
export function activityFor(plan, ts) {
  const wd = ((new Date(ts).getDay() + 6) % 7) + 1;
  return plan?.activities?.find((a) => a.weekday === wd) || null;
}

/** Trainingsblock: aktuelle Woche (1-basiert) oder Tage bis zum Start */
export function blockStatus(plan, now = Date.now()) {
  if (!plan?.block) return null;
  const [y, m, d] = plan.block.start.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  if (now < start) return { before: true, daysToStart: Math.ceil((start - now) / 864e5), weeks: plan.block.weeks };
  const week = Math.floor((now - start) / (7 * 864e5)) + 1;
  return { before: false, week: Math.min(week, plan.block.weeks), weeks: plan.block.weeks, over: week > plan.block.weeks };
}

// ---------- Geführter Ablauf ----------
/** Einen Warm-up-Punkt lesen: "30 Jumping Jacks" → reps, "WGS – 20 Sek. je Seite" → sec + Seiten */
export function parseWarmupItem(text) {
  const t = String(text).trim();
  const sides = /je\s+seite/i.test(t);
  const secM = t.match(/(\d+)\s*(?:sek\.?|sekunden|s)\b/i);
  if (secM) {
    const name = t.replace(/\s*[–-]?\s*\d+\s*(?:sek\.?|sekunden|s)\b\.?/i, '').replace(/\s*je\s+seite/i, '').replace(/\s+/g, ' ').trim();
    return { name: name || t, sec: Number(secM[1]), sides };
  }
  const repM = t.match(/^(\d+)\s+(.+)$/);
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  if (repM) return { name: cap(repM[2].replace(/\s*je\s+seite/i, '').trim()), reps: Number(repM[1]), sides };
  return { name: t, sides: false };
}

/**
 * Ablauf eines Trainings als Liste von Schritten.
 * input: { warmup: Text, exercises: [{ group, rest, sets: Anzahl, unit, name }], groupNames, cooldown: {name, items}, restDefault }
 * Schritte: warm | set | rest | cool | feedback
 */
export function buildFlow({ warmup = '', exercises = [], groupNames = {}, cooldown = null, restDefault = 90 }) {
  const steps = [];
  const w = parseWarmup(warmup);
  for (const it of w?.items || []) {
    const x = parseWarmupItem(it);
    if (x.sec && x.sides) { steps.push({ type: 'warm', name: x.name, sec: x.sec, side: 'links' }); steps.push({ type: 'warm', name: x.name, sec: x.sec, side: 'rechts' }); }
    else steps.push({ type: 'warm', name: x.name, ...(x.sec ? { sec: x.sec } : {}), ...(x.reps ? { reps: x.reps } : {}), ...(x.sides ? { perSide: true } : {}) });
  }
  // Übungen zu Blöcken (gleiche Gruppe hintereinander)
  const bl = [];
  exercises.forEach((e, i) => {
    const last = bl[bl.length - 1];
    if (e.group && last && last.group === e.group) last.idx.push(i);
    else bl.push({ group: e.group || '', idx: [i] });
  });
  const work = [];
  for (const b of bl) {
    const rounds = Math.max(...b.idx.map((i) => exercises[i].sets));
    const label = b.idx.length > 1 ? (groupNames[b.group] || (b.idx.length > 2 ? 'Circuit' : 'Supersatz')) : '';
    for (let r = 0; r < rounds; r++) {
      for (const i of b.idx) {
        const e = exercises[i];
        if (r >= e.sets) continue;
        work.push({ type: 'set', ex: i, set: r, round: r + 1, rounds: b.idx.length > 1 ? rounds : e.sets, block: label, timed: e.unit === 'sec' });
        const rest = e.rest ?? restDefault;
        if (rest > 0) work.push({ type: 'rest', sec: rest });
      }
    }
  }
  while (work.length && work[work.length - 1].type === 'rest') work.pop();
  steps.push(...work);
  for (const s of expandCooldown(cooldown).steps) steps.push({ type: 'cool', name: s.name, sec: s.sec, hint: s.hint || '' });
  steps.push({ type: 'feedback' });
  return steps;
}

export const stepPhase = (s) => (s.type === 'warm' ? 'warmup' : s.type === 'cool' ? 'cooldown' : s.type === 'feedback' ? 'end' : 'workout');
