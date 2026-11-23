// Reine Logik ohne DOM/DB – testbar in tests/tests.html

export const slug = (name) =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const fmtNum = (n) =>
  (Math.round(n * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

export const epley = (w, r) => (r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30));

const doneSets = (perf) => (perf?.sets || []).filter((s) => s.done);

/** Plan-JSON prüfen und normalisieren. Wirft Error mit verständlicher Meldung. */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Datei enthält kein gültiges JSON-Objekt.');
  if (!Array.isArray(raw.days) || raw.days.length === 0) throw new Error('Plan braucht mindestens einen Eintrag in "days".');
  return {
    name: String(raw.name || 'Mein Plan'),
    days: raw.days.map((d, i) => {
      if (!Array.isArray(d.exercises) || d.exercises.length === 0)
        throw new Error(`Tag ${i + 1} hat keine Übungen.`);
      return {
        id: String(d.id ?? String.fromCharCode(65 + i)),
        name: String(d.name || `Tag ${String.fromCharCode(65 + i)}`),
        note: d.note ? String(d.note) : '',
        exercises: d.exercises.map((e, j) => {
          if (!e.name) throw new Error(`Übung ${j + 1} an Tag ${i + 1} hat keinen Namen.`);
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
  const unit = (w) => (type === 'bodyweight' && !w ? 'KG' : `${fmtNum(w)} kg`);
  if (same) return `${sets.length}×${sets[0].reps}${r} @ ${unit(sets[0].weight)}`;
  if (sets.every((s) => s.weight === sets[0].weight))
    return `${sets.map((s) => s.reps).join('/')}${r} @ ${unit(sets[0].weight)}`;
  return sets.map((s) => `${fmtNum(s.weight)}×${s.reps}${r}`).join(', ');
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
  const done = sessions.filter((s) => s.endedAt && s.planName === plan.name).sort((a, b) => b.startedAt - a.startedAt);
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
      feeling: h.feeling ?? null, note: h.note || '', imported: true,
      exercises: (h.exercises || []).map((e) => {
        const key = slug(e.name), cfg = cfgByKey.get(key);
        return {
          key, name: e.name, type: cfg?.type || 'weight', unit: cfg?.unit || 'reps', note: e.note || '',
          sets: (e.sets || []).map((x) => ({ weight: Number(x.weight ?? e.weight ?? 0), reps: Number(x.reps ?? x), done: true })),
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
