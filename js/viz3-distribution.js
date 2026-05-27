// =========================================================
// VIZ 3 — Pixel distribution shift (light theme)
// =========================================================
import { tooltip, fmt, makeSvg } from './shared.js';

const W = 820, H = 380;
const M = { top: 50, right: 24, bottom: 50, left: 50 };

const YEAR_COLORS = {
  2001: '#4a7a2a',   // forest green (healthy baseline)
  2012: '#b8923c',   // ochre (mid-drought era)
  2022: '#a8501f',   // rust (recent)
};

export function render(container, data) {
  const root = d3.select(container);
  root.html('');

  let active = new Set(data.years);

  const ctl = root.append('div').attr('class', 'viz__controls');
  ctl.append('span').text('layer');
  data.years.forEach((yr) => {
    ctl.append('button')
      .attr('class', 'ctl ctl--active')
      .style('color', YEAR_COLORS[yr])
      .style('border-color', YEAR_COLORS[yr])
      .style('background', YEAR_COLORS[yr] + '18')
      .text(yr)
      .on('click', function () {
        if (active.has(yr)) active.delete(yr); else active.add(yr);
        const on = active.has(yr);
        d3.select(this).classed('ctl--active', on)
          .style('background', on ? YEAR_COLORS[yr] + '18' : 'var(--bg-page)')
          .style('color', on ? YEAR_COLORS[yr] : 'var(--ink-mute)');
        update();
      });
  });

  const wrap = root.append('div').attr('class', 'viz__svg-wrap');
  const { inner, innerW, innerH } = makeSvg(wrap.node(), { width: W, height: H, margin: M });

  const x = d3.scaleLinear().domain([0, d3.max(data.bins)]).range([0, innerW]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(data.years, yr => d3.max(data.densities[yr]))]).nice()
    .range([innerH, 0]);

  inner.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d => d + '%'));
  inner.append('g').call(d3.axisLeft(y).ticks(5));

  inner.append('text').attr('class', 'axis-label')
    .attr('x', innerW / 2).attr('y', innerH + 40).attr('text-anchor', 'middle')
    .text('% tree cover per pixel');
  inner.append('text').attr('class', 'axis-label')
    .attr('x', -innerH / 2).attr('y', -35)
    .attr('transform', 'rotate(-90)').attr('text-anchor', 'middle')
    .text('density of pixels');

  const area = d3.area()
    .curve(d3.curveMonotoneX)
    .x((_, i) => x(data.bins[i]))
    .y0(innerH)
    .y1(d => y(d));

  const layersG = inner.append('g');
  const meansG = inner.append('g');
  const guide = inner.append('line')
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', 'var(--signal)').attr('stroke-dasharray', '2 3').attr('opacity', 0);

  function update() {
    const visible = data.years.filter(y => active.has(y));

    const layers = layersG.selectAll('path.density').data(visible, d => d);
    layers.enter().append('path').attr('class', 'density').attr('opacity', 0)
      .merge(layers)
      .attr('fill', d => YEAR_COLORS[d])
      .attr('d', d => area(data.densities[d]))
      .transition().duration(450).attr('opacity', 0.38);
    layers.exit().transition().duration(250).attr('opacity', 0).remove();

    // sort visible years by mean so we can stagger labels left-to-right
    const visibleSorted = [...visible].sort((a, b) => data.means[a] - data.means[b]);
    const meanLines = meansG.selectAll('g.mean').data(visibleSorted, d => d);
    const enterM = meanLines.enter().append('g').attr('class', 'mean');
    enterM.append('line').attr('y1', 0).attr('y2', innerH).attr('stroke-dasharray', '4 3').attr('stroke-width', 1.5);
    enterM.append('text').attr('text-anchor', 'middle');
    const mergedM = meanLines.merge(enterM);
    mergedM.select('line')
      .attr('x1', d => x(data.means[d]))
      .attr('x2', d => x(data.means[d]))
      .attr('stroke', d => YEAR_COLORS[d]);
    // stagger labels vertically by index so close means don't overlap
    mergedM.select('text')
      .attr('x', d => x(data.means[d]))
      .attr('y', (d, i) => -8 - (visibleSorted.length - 1 - i) * 13)
      .attr('fill', d => YEAR_COLORS[d])
      .style('font-family', 'var(--font-mono)')
      .style('font-size', '10px')
      .text(d => `${d}  μ=${fmt.num(data.means[d])}%`);
    meanLines.exit().remove();
  }

  inner.append('rect')
    .attr('width', innerW).attr('height', innerH).attr('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const i = d3.bisectCenter(data.bins, x.invert(mx));
      guide.attr('x1', x(data.bins[i])).attr('x2', x(data.bins[i])).attr('opacity', 0.7);
      const rows = [...active].map((yr) => {
        const d = data.densities[yr][i];
        return `<div style="color:${YEAR_COLORS[yr]}">${yr}: <span class="tt-num">${d3.format('.4f')(d)}</span></div>`;
      }).join('');
      tooltip.show(`<strong>${fmt.num(data.bins[i])}% tree cover</strong>${rows}`, event);
    })
    .on('mouseleave', () => { guide.attr('opacity', 0); tooltip.hide(); });

  update();
}
