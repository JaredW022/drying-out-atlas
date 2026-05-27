// =========================================================
// DRYING OUT — Shared utilities (LIGHT theme)
// Regions match main.js exactly for cross-viz linking.
// =========================================================

/* ---------- REGIONS (must match main.js REGIONS) ---------- */
export const REGIONS = [
  'Amazon',
  'Western US',
  'Midwest',
  'Central America',
  'Andes',
  'Canada/Arctic',
];

/* ---------- COLOR SCALES (light theme) ---------- */

// Divergent: drought (rust) ↔ neutral (warm tan) ↔ healthy (forest)
// Visible on cream background.
export const droughtScale = d3.scaleLinear()
  .domain([-0.15, -0.05, 0, 0.05, 0.15])
  .range(['#7a3a16', '#a8501f', '#d4b878', '#92b16d', '#2d4a1a'])
  .clamp(true);

// Sequential tree-cover %: low (rust) → high (forest)
export const coverScale = d3.scaleSequential()
  .domain([0, 80])
  .interpolator(d3.interpolateRgb('#a8501f', '#2d4a1a'));

// Loss % (0 = neutral, higher = more drought)
export const lossScale = d3.scaleSequential()
  .domain([0, 12])
  .interpolator(d3.interpolateRgb('#f4ede0', '#7a3a16'));

/* ---------- TOOLTIP ---------- */
let _tip = null;
function ensureTip() {
  if (_tip) return _tip;
  _tip = document.createElement('div');
  _tip.className = 'viz-tooltip';
  document.body.appendChild(_tip);
  return _tip;
}
export const tooltip = {
  show(html, event) {
    const el = ensureTip();
    el.innerHTML = html;
    el.style.opacity = '1';
    this.move(event);
  },
  move(event) {
    const el = ensureTip();
    const pad = 14;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = event.pageX + pad, y = event.pageY + pad;
    if (x + w > window.innerWidth - 8) x = event.pageX - w - pad;
    if (y + h > window.scrollY + window.innerHeight - 8) y = event.pageY - h - pad;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  },
  hide() { if (_tip) _tip.style.opacity = '0'; },
};

/* ---------- FORMATTERS ---------- */
export const fmt = {
  pct:   d3.format('.1%'),
  pct0:  d3.format('.0%'),
  num:   d3.format(',.1f'),
  delta: (v) => (v >= 0 ? '+' : '') + d3.format('.2f')(v),
  ndvi:  d3.format('.3f'),
};

export const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ---------- CROSS-VIZ EVENT BUS ---------- */
export const bus = (() => {
  const listeners = {};
  return {
    on(event, fn) { (listeners[event] ||= []).push(fn); },
    emit(event, payload) { (listeners[event] || []).forEach((fn) => fn(payload)); },
  };
})();

/* ---------- DATA LOADER (mock fallback) ---------- */
export async function loadJSON(path, mock) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error('not found');
    return await res.json();
  } catch (err) {
    console.warn(`[data] using mock for ${path}`);
    return mock;
  }
}

/* ---------- SVG SETUP ---------- */
export function makeSvg(container, { width, height, margin }) {
  const wrap = d3.select(container);
  wrap.selectAll('svg').remove();
  const svg = wrap.append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('width', '100%')
    .style('height', 'auto');
  const inner = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  return { svg, inner, innerW, innerH };
}
