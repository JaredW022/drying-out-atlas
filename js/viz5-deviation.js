// =========================================================
// VIZ 5 — NDVI deviation box plot (light theme)
// =========================================================
import { tooltip, fmt, makeSvg, droughtScale, bus } from './shared.js';

const W = 820, H = 380;
const M = { top: 24, right: 24, bottom: 60, left: 60 };

export function render(container, data) {
  const root = d3.select(container);
  root.html('');

  const allYears = [...new Set(data.points.map(p => p.year))].sort();
  let yrLo = allYears[0], yrHi = allYears[allYears.length - 1];
  let highlight = null;

  const ctl = root.append('div').attr('class', 'viz__controls');
  ctl.append('span').text('years');
  const loIn = ctl.append('input').attr('type', 'number').attr('class', 'ctl').attr('value', yrLo)
    .attr('min', allYears[0]).attr('max', allYears[allYears.length - 1])
    .style('width', '78px').style('text-transform', 'none');
  ctl.append('span').text('–');
  const hiIn = ctl.append('input').attr('type', 'number').attr('class', 'ctl').attr('value', yrHi)
    .attr('min', allYears[0]).attr('max', allYears[allYears.length - 1])
    .style('width', '78px').style('text-transform', 'none');

  const wrap = root.append('div').attr('class', 'viz__svg-wrap');
  const { inner, innerW, innerH } = makeSvg(wrap.node(), { width: W, height: H, margin: M });

  const x = d3.scaleBand().domain(data.regions).range([0, innerW]).padding(0.32);
  const y = d3.scaleLinear()
    .domain(d3.extent(data.points, p => p.deviation)).nice()
    .range([innerH, 0]);

  inner.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x))
    .selectAll('text')
    .style('font-family', 'var(--font-body)')
    .style('font-size', '11px')
    .style('fill', 'var(--ink-dim)')
    .attr('transform', 'translate(-6,6) rotate(-18)')
    .style('text-anchor', 'end');

  inner.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(fmt.ndvi));
  inner.append('text').attr('class', 'axis-label')
    .attr('x', -innerH / 2).attr('y', -42)
    .attr('transform', 'rotate(-90)').attr('text-anchor', 'middle')
    .text('NDVI deviation from baseline');

  inner.append('line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', 'var(--ink-mute)').attr('stroke-dasharray', '3 3').attr('opacity', 0.5);

  const boxesG = inner.append('g');
  const pointsG = inner.append('g');

  function quantiles(arr) {
    const s = arr.slice().sort(d3.ascending);
    return {
      q1: d3.quantile(s, 0.25),
      med: d3.quantile(s, 0.5),
      q3: d3.quantile(s, 0.75),
      min: d3.min(s),
      max: d3.max(s),
    };
  }

  function update() {
    const filt = data.points.filter(p => p.year >= yrLo && p.year <= yrHi);
    const byRegion = d3.group(filt, p => p.region);

    const boxes = boxesG.selectAll('g.box').data(data.regions, d => d);
    const enterB = boxes.enter().append('g').attr('class', 'box');
    enterB.append('line').attr('class', 'whisker');
    enterB.append('rect').attr('class', 'iqr');
    enterB.append('line').attr('class', 'median');
    const mergedB = boxes.merge(enterB)
      .attr('transform', d => `translate(${x(d) + x.bandwidth() / 2},0)`)
      .attr('opacity', d => (highlight && d !== highlight) ? 0.3 : 1);

    mergedB.each(function (region) {
      const pts = (byRegion.get(region) || []).map(p => p.deviation);
      if (!pts.length) return;
      const q = quantiles(pts);
      const node = d3.select(this);
      const bw = x.bandwidth();
      node.select('.whisker')
        .attr('x1', 0).attr('x2', 0)
        .attr('y1', y(q.min)).attr('y2', y(q.max))
        .attr('stroke', 'var(--ink-dim)').attr('stroke-width', 1);
      node.select('.iqr')
        .attr('x', -bw / 2).attr('width', bw)
        .attr('y', y(q.q3)).attr('height', Math.max(2, y(q.q1) - y(q.q3)))
        .attr('fill', droughtScale(q.med)).attr('opacity', 0.55)
        .attr('stroke', 'var(--ink-dim)').attr('stroke-width', 0.8);
      node.select('.median')
        .attr('x1', -bw / 2).attr('x2', bw / 2)
        .attr('y1', y(q.med)).attr('y2', y(q.med))
        .attr('stroke', 'var(--ink)').attr('stroke-width', 2);
    });

    const jitter = d3.randomNormal(0, x.bandwidth() / 8);
    const pts = pointsG.selectAll('circle').data(filt, d => `${d.region}-${d.year}`);
    pts.enter().append('circle')
      .attr('r', 3.2)
      .attr('stroke', 'var(--bg-card)').attr('stroke-width', 0.6)
      .each(function (d) { d._jx = jitter(); })
      .on('mouseenter', (event, d) => {
        tooltip.show(`<strong>${d.region} · ${d.year}</strong>deviation: <span class="tt-num">${fmt.delta(d.deviation)}</span>`, event);
      })
      .on('mousemove', (e) => tooltip.move(e))
      .on('mouseleave', () => tooltip.hide())
      .on('click', (e, d) => bus.emit('region:select', d.region))
      .merge(pts)
      .transition().duration(350)
      .attr('cx', d => x(d.region) + x.bandwidth() / 2 + d._jx)
      .attr('cy', d => y(d.deviation))
      .attr('fill', d => droughtScale(d.deviation))
      .attr('opacity', d => (highlight && d.region !== highlight) ? 0.2 : 0.78);
    pts.exit().remove();
  }

  loIn.on('change', function () { yrLo = +this.value; update(); });
  hiIn.on('change', function () { yrHi = +this.value; update(); });

  bus.on('region:select', (r) => {
    highlight = (highlight === r) ? null : r;
    update();
  });

  update();
}
