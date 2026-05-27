// =========================================================
// VIZ 1 — Drought year comparison (light theme)
// =========================================================
import { tooltip, fmt, MONTHS_SHORT, makeSvg, bus, REGIONS } from './shared.js';

const W = 820, H = 360;
const M = { top: 24, right: 24, bottom: 50, left: 60 };

export function render(container, data) {
  const allYears = data.years;
  let regionSel = 'Western US';
  let yearA = 2005;
  let yearB = 2008;

  const root = d3.select(container);
  root.html('');

  const controls = root.append('div').attr('class', 'viz__controls');
  controls.append('span').text('compare');

  const selA = controls.append('select').attr('class', 'ctl');
  selA.selectAll('option').data(allYears).join('option')
    .attr('value', d => d).text(d => d)
    .property('selected', d => d === yearA);

  controls.append('span').text('vs');

  const selB = controls.append('select').attr('class', 'ctl');
  selB.selectAll('option').data(allYears).join('option')
    .attr('value', d => d).text(d => d)
    .property('selected', d => d === yearB);

  controls.append('span').style('margin-left', '20px').text('region');
  const selR = controls.append('select').attr('class', 'ctl');
  selR.selectAll('option').data(REGIONS.filter(r => data.region[r])).join('option')
    .attr('value', d => d).text(d => d)
    .property('selected', d => d === regionSel);

  const callout = root.append('div')
    .style('margin', '0 0 12px 0')
    .style('font-family', 'var(--font-mono)')
    .style('font-size', '11px')
    .style('letter-spacing', '0.04em')
    .style('color', 'var(--ink-mute)');

  const svgWrap = root.append('div').attr('class', 'viz__svg-wrap');
  const { inner, innerW, innerH } = makeSvg(svgWrap.node(), { width: W, height: H, margin: M });

  const x0 = d3.scaleBand().domain(MONTHS_SHORT).range([0, innerW]).padding(0.18);
  const x1 = d3.scaleBand().padding(0.05);
  const y = d3.scaleLinear().range([innerH, 0]);

  const gx = inner.append('g').attr('transform', `translate(0,${innerH})`);
  const gy = inner.append('g');

  inner.append('text').attr('class', 'axis-label')
    .attr('x', -innerH / 2).attr('y', -42)
    .attr('transform', 'rotate(-90)').attr('text-anchor', 'middle')
    .text('Mean NDVI');

  function colorFor(year) {
    return year === Math.min(yearA, yearB) ? '#7a8c44' : '#a8501f';
  }

  function update() {
    const series = [yearA, yearB];
    x1.domain(series).range([0, x0.bandwidth()]);

    const rows = data.region[regionSel];
    const rowA = rows.find(r => r.year === +yearA);
    const rowB = rows.find(r => r.year === +yearB);
    if (!rowA || !rowB) return;

    const monthly = MONTHS_SHORT.map((m, i) => ({
      month: m, mi: i, [yearA]: rowA.monthly[i], [yearB]: rowB.monthly[i],
    }));

    y.domain([0, d3.max(monthly, d => Math.max(d[yearA], d[yearB])) * 1.12]).nice();

    gx.call(d3.axisBottom(x0));
    gy.call(d3.axisLeft(y).ticks(5).tickFormat(fmt.ndvi));

    const groups = inner.selectAll('.month-grp').data(monthly, d => d.mi);
    const enter = groups.enter().append('g').attr('class', 'month-grp');
    groups.exit().remove();

    const merged = groups.merge(enter)
      .attr('transform', d => `translate(${x0(d.month)},0)`);

    series.forEach((yr) => {
      const sel = merged.selectAll(`rect.y-${yr}`)
        .data(d => [{ year: yr, val: d[yr], month: d.month }]);
      sel.enter().append('rect').attr('class', `y-${yr}`)
        .merge(sel)
        .transition().duration(420).ease(d3.easeCubicOut)
        .attr('x', () => x1(yr))
        .attr('width', x1.bandwidth())
        .attr('y', d => y(d.val))
        .attr('height', d => innerH - y(d.val))
        .attr('fill', colorFor(yr))
        .attr('opacity', 0.92);
      sel.exit().remove();
    });

    // legend swatches
    inner.selectAll('g.legend-swatch').remove();
    const lg = inner.append('g').attr('class', 'legend-swatch')
      .attr('transform', `translate(${innerW - 180}, -14)`);
    series.forEach((yr, i) => {
      const g = lg.append('g').attr('transform', `translate(${i * 90}, 0)`);
      g.append('rect').attr('width', 12).attr('height', 12).attr('fill', colorFor(yr));
      g.append('text').attr('x', 16).attr('y', 10)
        .style('font-family', 'var(--font-mono)')
        .style('font-size', '11px')
        .style('fill', 'var(--ink)')
        .text(yr);
    });

    // hover strip
    merged.selectAll('rect.hover-strip').data([0]).enter().append('rect')
      .attr('class', 'hover-strip')
      .attr('y', 0).attr('height', innerH).attr('x', 0).attr('width', x0.bandwidth())
      .attr('fill', 'transparent');
    merged.select('rect.hover-strip')
      .on('mouseenter', (event) => {
        const d = d3.select(event.currentTarget.parentNode).datum();
        const delta = d[yearB] - d[yearA];
        tooltip.show(`
          <strong>${d.month} · ${regionSel}</strong>
          ${yearA}: <span class="tt-num">${fmt.ndvi(d[yearA])}</span><br>
          ${yearB}: <span class="tt-num">${fmt.ndvi(d[yearB])}</span><br>
          Δ ${fmt.delta(delta)} (${fmt.pct(delta / d[yearA])})
        `, event);
      })
      .on('mousemove', (e) => tooltip.move(e))
      .on('mouseleave', () => tooltip.hide());

    const meanA = d3.mean(rowA.monthly), meanB = d3.mean(rowB.monthly);
    const drop = (meanB - meanA) / meanA;
    callout.html(
      `${regionSel} · ${yearA} mean ${fmt.ndvi(meanA)} → ${yearB} mean ${fmt.ndvi(meanB)} ` +
      `<span style="color:${drop < 0 ? 'var(--rust-7)' : 'var(--green-7)'};font-weight:500">` +
      `(${fmt.delta(drop * 100)}%)</span>`
    );
  }

  selA.on('change', function () { yearA = +this.value; update(); });
  selB.on('change', function () { yearB = +this.value; update(); });
  selR.on('change', function () { regionSel = this.value; update(); });

  bus.on('region:select', (r) => {
    if (data.region[r]) {
      regionSel = r;
      selR.property('value', r);
      update();
    }
  });

  update();
}
