// =========================================================
// VIZ 4 — Region × year tree-cover heatmap (light theme)
// =========================================================
import { tooltip, fmt, makeSvg, coverScale, bus, REGIONS } from './shared.js';

const W = 920, H = 360;
const M = { top: 18, right: 50, bottom: 50, left: 130 };

export function render(container, data) {
  const root = d3.select(container);
  root.html('');

  let sortMode = 'order';
  let selected = null;

  const ctl = root.append('div').attr('class', 'viz__controls');
  ctl.append('span').text('sort');
  const btnOrder = ctl.append('button').attr('class', 'ctl ctl--active').text('Geographic (N→S)');
  const btnLoss = ctl.append('button').attr('class', 'ctl').text('Total loss');

  const wrap = root.append('div').attr('class', 'viz__svg-wrap');
  const { inner, innerW, innerH } = makeSvg(wrap.node(), { width: W, height: H, margin: M });

  const x = d3.scaleBand().domain(data.years).range([0, innerW]).padding(0.06);
  const y = d3.scaleBand().range([0, innerH]).padding(0.08);

  function totalLoss(region) {
    const v = data.values[region];
    return v[data.years[0]] - v[data.years[data.years.length - 1]];
  }

  function update() {
    let regions;
    if (sortMode === 'order') {
      regions = REGIONS.filter(r => data.values[r]);
    } else {
      regions = [...data.regions].sort((a, b) => totalLoss(b) - totalLoss(a));
    }
    y.domain(regions);

    inner.selectAll('g.x-ax').remove();
    inner.append('g').attr('class', 'x-ax').attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickValues(data.years.filter((_, i) => i % 2 === 0)).tickSize(4));

    inner.selectAll('g.y-ax').remove();
    inner.append('g').attr('class', 'y-ax')
      .call(d3.axisLeft(y).tickSize(0))
      .selectAll('text')
      .style('font-family', 'var(--font-body)')
      .style('font-size', '12px')
      .style('cursor', 'pointer')
      .style('fill', d => d === selected ? 'var(--rust-7)' : 'var(--ink-dim)')
      .style('font-weight', d => d === selected ? '600' : '400')
      .on('click', (e, d) => selectRegion(d));

    const cellData = [];
    regions.forEach((r) => data.years.forEach((yr) => {
      cellData.push({ region: r, year: yr, val: data.values[r][yr] });
    }));

    const cells = inner.selectAll('rect.cell').data(cellData, d => `${d.region}-${d.year}`);
    cells.enter().append('rect').attr('class', 'cell')
      .attr('stroke', 'var(--bg-card)').attr('stroke-width', 1)
      .merge(cells)
      .transition().duration(400)
      .attr('x', d => x(d.year))
      .attr('y', d => y(d.region))
      .attr('width', x.bandwidth()).attr('height', y.bandwidth())
      .attr('fill', d => coverScale(d.val))
      .attr('opacity', d => (selected && d.region !== selected) ? 0.25 : 1);

    inner.selectAll('rect.cell')
      .on('mouseenter', (event, d) => {
        const baseline = data.values[d.region][data.years[0]];
        tooltip.show(`
          <strong>${d.region}</strong>
          ${d.year}: <span class="tt-num">${fmt.num(d.val)}%</span> tree cover<br>
          Δ from 2001: <span style="color:${d.val < baseline ? 'var(--rust-7)' : 'var(--green-7)'}">${fmt.delta(d.val - baseline)}%</span>
        `, event);
      })
      .on('mousemove', (e) => tooltip.move(e))
      .on('mouseleave', () => tooltip.hide())
      .on('click', (e, d) => selectRegion(d.region));

    const txts = inner.selectAll('text.cell-txt').data(cellData, d => `${d.region}-${d.year}`);
    txts.enter().append('text').attr('class', 'cell-txt')
      .attr('text-anchor', 'middle').attr('font-size', 9).attr('pointer-events', 'none')
      .merge(txts)
      .transition().duration(400)
      .attr('x', d => x(d.year) + x.bandwidth() / 2)
      .attr('y', d => y(d.region) + y.bandwidth() / 2 + 3)
      .attr('fill', d => d.val > 45 ? '#faf7f0' : '#1f1a14')
      .attr('opacity', d => (selected && d.region !== selected) ? 0.3 : 0.85)
      .text(d => Math.round(d.val));
  }

  function selectRegion(r) {
    selected = (selected === r) ? null : r;
    bus.emit('region:select', r);
    update();
  }

  btnOrder.on('click', () => {
    sortMode = 'order';
    btnOrder.classed('ctl--active', true);
    btnLoss.classed('ctl--active', false);
    update();
  });
  btnLoss.on('click', () => {
    sortMode = 'loss';
    btnLoss.classed('ctl--active', true);
    btnOrder.classed('ctl--active', false);
    update();
  });

  update();
}
