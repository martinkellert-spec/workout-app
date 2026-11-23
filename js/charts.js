// Kleine SVG-Diagramme ohne Bibliothek. Farben kommen aus CSS (.chart …)
import { fmtNum } from './logic.js';

const W = 340, H = 180, P = { l: 38, r: 10, t: 12, b: 24 };

function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const shortDate = (ts) => new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });

/** points: [{x: timestamp, y, y2?}] – Linie y (Akzent), optional y2 gestrichelt */
export function lineChart(points) {
  if (points.length < 2) return '<p class="muted small">Ab zwei Trainings erscheint hier ein Verlauf.</p>';
  const ys = points.flatMap((p) => [p.y, p.y2].filter((v) => v != null));
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sx = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const sy = (v) => H - P.b - ((v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const path = (k) => points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p[k]).toFixed(1)}`).join('');
  const grid = ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${P.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join('');
  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xl = labelIdx.map((i) => `<text x="${sx(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${shortDate(points[i].x)}</text>`).join('');
  const has2 = points.some((p) => p.y2 != null);
  const dots = points.length <= 20 ? points.map((p, i) => `<circle class="dot" cx="${sx(i)}" cy="${sy(p.y)}" r="3.5"/>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${has2 ? `<path class="line2" d="${path('y2')}"/>` : ''}<path class="line" d="${path('y')}"/>${dots}${xl}</svg>`;
}

/** bars: [{label, value, dim?}] */
export function barChart(bars, fmt = fmtNum) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const bw = (W - 8) / bars.length;
  const h = 150;
  return `<svg class="chart" viewBox="0 0 ${W} ${h + 34}" role="img">${bars.map((b, i) => {
    const bh = Math.max(b.value ? 4 : 0, (b.value / max) * h);
    const x = 4 + i * bw + bw * 0.18, w = bw * 0.64;
    return `<rect class="bar ${b.dim ? 'dim' : ''}" x="${x}" y="${h - bh + 14}" width="${w}" height="${bh}" rx="5"/>`
      + (b.value ? `<text x="${x + w / 2}" y="${h - bh + 9}" text-anchor="middle">${fmt(b.value)}</text>` : '')
      + `<text x="${x + w / 2}" y="${h + 30}" text-anchor="middle">${b.label}</text>`;
  }).join('')}</svg>`;
}
