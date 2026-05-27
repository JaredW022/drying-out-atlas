// =========================================================
// VIZ 6 — Change in tree cover by latitude (light theme)
// =========================================================
import { tooltip, fmt, makeSvg } from './shared.js';

const W = 820, H = 380;
const M = { top: 28, right: 24, bottom: 60, left: 60 };

const LAT_LABELS = [
  { lat: -50, text: 'Patagonia',                  anchor: 'start' },
  { lat: -25, text: 'South American Savannas',    anchor: 'middle' },
  { lat:  -3, text: 'Central America & NW Amazon',anchor: 'middle' },
  { lat:  35, text: 'Western US / Midwest',       anchor: 'middle' },
  { lat:  60, text: 'Canada / Arctic',            anchor: 'end' },
];

export function render(container, data) {
  const root = d3.select(container);
  root.html('');

  const ctl = root.append('div').attr('class', 'viz__controls');
  ctl.append('span').html(`<span style="color:var(--rust-7);font-weight:700">▬</span> net loss  &nbsp; <span style="color:var(--green-7);font-weight:700">▬</span> net gain`);
  const resetBtn = ctl.append('button').attr('class', 'ctl').text('Reset selection').style('margin-left', 'auto');

  const wrap = root.append('div').attr('class', 'viz__svg-wrap');
  const { inner, innerW, innerH } = makeSvg(wrap.node(), { width: W, height: H, margin: M });

  const x = d3.scaleLinear().domain(d3.extent(data.latPoints, d => d.lat)).range([0, innerW]);
  const y = d3.scaleLinear()
    .domain([d3.min(data.latPoints, d => d.change), Math.max(0.5, d3.max(data.latPoints, d => d.change))])
    .nice().range([innerH, 0]);

  inner.append('line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', 'var(--ink-mute)').attr('stroke-dasharray', '3 3').attr('opacity', 0.6);

  inner.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d => `${d}°`));
  inner.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d => d + '%'));
  inner.append('text').attr('class', 'axis-label')
    .attr('x', innerW / 2).attr('y', innerH + 42).attr('text-anchor', 'middle')
    .text('latitude  (°N → south)');
  inner.append('text').attr('class', 'axis-label')
    .attr('x', -innerH / 2).attr('y', -42)
    .attr('transform', 'rotate(-90)').attr('text-anchor', 'middle')
    .text('Δ tree cover %  (2001 → 2022)');

  inner.append('g').selectAll('circle').data(data.latPoints).join('circle')
    .attr('cx', d => x(d.lat)).attr('cy', d => y(d.change))
    .attr('r', 2.2)
    .attr('fill', d => d.change < 0 ? '#c46838' : '#5a8a3a')
    .attr('opacity', 0.55);

  const line = d3.line().curve(d3.curveBasis)
    .x(d => x(d.lat)).y(d => y(d.change));
  inner.append('path').datum(data.smoothed)
    .attr('fill', 'none').attr('stroke', 'var(--rust-7)').attr('stroke-width', 2.5)
    .attr('d', line);

  inner.append('g').selectAll('g.lat-lbl').data(LAT_LABELS).join('g')
    .attr('class', 'lat-lbl')
    .attr('transform', (d) => {
      const pt = data.smoothed.reduce((a, b) => Math.abs(b.lat - d.lat) < Math.abs(a.lat - d.lat) ? b : a);
      return `translate(${x(d.lat)},${y(pt.change) - 18})`;
    })
    .each(function (d) {
      const g = d3.select(this);
      const text = g.append('text')
        .attr('text-anchor', d.anchor)
        .attr('font-family', 'var(--font-display)')
        .attr('font-style', 'italic')
        .attr('font-size', 11)
        .attr('fill', 'var(--ink-dim)')
        .text(d.text);
      const bbox = text.node().getBBox();
      g.insert('rect', 'text')
        .attr('x', bbox.x - 4).attr('y', bbox.y - 2)
        .attr('width', bbox.width + 8).attr('height', bbox.height + 4)
        .attr('fill', 'var(--bg-card)').attr('stroke', 'var(--rule)');
      g.select('text').raise();
    });

  const guide = inner.append('line').attr('y1', 0).attr('y2', innerH)
    .attr('stroke', 'var(--signal)').attr('stroke-dasharray', '2 3').attr('opacity', 0);

  inner.append('rect')
    .attr('width', innerW).attr('height', innerH).attr('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const lat = x.invert(mx);
      const pt = data.smoothed.reduce((a, b) => Math.abs(b.lat - lat) < Math.abs(a.lat - lat) ? b : a);
      guide.attr('opacity', 0.7).attr('x1', x(pt.lat)).attr('x2', x(pt.lat));
      tooltip.show(`
        <strong>${fmt.num(pt.lat)}° lat</strong>
        Δ tree cover: <span class="tt-num" style="color:${pt.change < 0 ? 'var(--rust-7)' : 'var(--green-7)'}">${fmt.delta(pt.change)}%</span>
      `, event);
    })
    .on('mouseleave', () => { guide.attr('opacity', 0); tooltip.hide(); });

  const brush = d3.brushX()
    .extent([[0, 0], [innerW, innerH]])
    .on('brush end', (event) => {
      if (!event.selection) {
        inner.selectAll('.lat-lbl').attr('opacity', 1);
        return;
      }
      const [x0, x1Sel] = event.selection.map(x.invert);
      inner.selectAll('.lat-lbl').attr('opacity', d => (d.lat >= x0 && d.lat <= x1Sel) ? 1 : 0.25);
    });
  const brushG = inner.append('g').attr('class', 'brush').call(brush);
  brushG.selectAll('.selection')
    .attr('fill', 'var(--signal)').attr('fill-opacity', 0.1)
    .attr('stroke', 'var(--rust-7)');

  resetBtn.on('click', () => {
    brushG.call(brush.move, null);
    inner.selectAll('.lat-lbl').attr('opacity', 1);
  });
}
