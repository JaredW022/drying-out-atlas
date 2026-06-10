const stops = [
  {
    region: 'Canada/Arctic',
    coordinates: [-95, 70],
    answer: 'Warming shifts',
    choices: ['Warming shifts', 'Deforestation pressure', 'Irrigation demand'],
    mainImage: './quiz_assets/canada.webp',
    secondaryImage: './anazon_trendline.png',
    photoTitle: 'Canada/Arctic',
    photoCopy: 'Static demo image for now. A future version can swap in a Canada/Arctic-specific landscape photo.',
    note: 'Northern vegetation patterns are sensitive to warming, snow timing, and seasonal change. The tree-cover drop is smaller than the strongest drying stops, but the region still changes.',
    chartCaption: 'Most dramatic greening of any region — driven by Arctic warming and shrub encroachment.',
    sources: [{ name: 'NOAA Arctic Report Card 2024', url: 'https://arctic.noaa.gov/report-card/report-card-2024/tundra-greenness-2024/' }],
  },
  {
    region: 'Western US',
    coordinates: [-118, 38],
    answer: 'Drought stress',
    choices: ['Drought stress', 'Coastal erosion', 'Tropical canopy loss'],
    mainImage: './quiz_assets/westernUS.jpg',
    secondaryImage: './anazon_trendline.png',
    photoTitle: 'Western US',
    photoCopy: 'A Western mountain landscape stands in for the region while the small supporting image keeps the broader vegetation trend story nearby.',
    note: 'Hotter, drier years compound water stress across already dry landscapes. In this dataset, the Western US has the steepest tree-cover drop in the route.',
    chartCaption: 'Drought erases gains — the greening trend is real but statistically unconfirmed.',
    sources: [
      { name: 'NASA SVS', url: 'https://svs.gsfc.nasa.gov/2938/' },
      { name: 'USGS Drought Stress', url: 'https://www.usgs.gov/core-science-systems/eros/droughtstress' },
    ],
  },
  {
    region: 'Central America',
    coordinates: [-85, 12],
    answer: 'Heat and rainfall variability',
    choices: ['Heat and rainfall variability', 'Permafrost thaw', 'Glacier retreat'],
    mainImage: './quiz_assets/central_america.webp',
    secondaryImage: './anazon_trendline.png',
    photoTitle: 'Central America',
    photoCopy: 'This demo uses a tropical forest image as a placeholder until a Central America-specific still is added.',
    note: 'The region stays relatively green, but changing rainfall and heat stress can weaken the vegetation signal over time.',
    chartCaption: 'Vegetation pulses with the wet season — a climate-driven heartbeat visible from space.',
    sources: [{ name: 'Remote Sensing, MDPI (2022)', url: 'https://www.mdpi.com/2072-4292/14/11/2521' }],
  },
  {
    region: 'Amazon',
    coordinates: [-60, -3],
    answer: 'Forest loss and drought',
    choices: ['Forest loss and drought', 'Urban snowmelt', 'High-elevation frost'],
    mainImage: './quiz_assets/amazon.jpg',
    secondaryImage: './anazon_trendline.png',
    photoTitle: 'Amazon',
    photoCopy: 'The image can look lush, but the trend reveal shows why the long-term signal matters.',
    note: 'The Amazon may still look lush from above, but forest loss and drought pressure stack into a clear long-term decline.',
    chartCaption: "Earth's most important carbon sink, barely growing.",
    sources: [
      { name: 'Nature Climate Change (2022)', url: 'https://www.nature.com/articles/s41558-022-01287-8' },
      { name: 'NASA Earth Observatory', url: 'https://science.nasa.gov/earth/earth-observatory/world-of-change/amazon-deforestation/' },
    ],
  },
  {
    region: 'Andes',
    coordinates: [-70, -30],
    answer: 'Elevation zone shifts',
    choices: ['Elevation zone shifts', 'Prairie irrigation', 'Sea ice brightening'],
    mainImage: './quiz_assets/andes.jpg',
    secondaryImage: './anazon_trendline.png',
    photoTitle: 'Andes',
    photoCopy: 'The Andes stop connects elevation, snowpack, temperature, and changing vegetation patterns.',
    note: 'Mountain vegetation responds to elevation, snowpack, and temperature shifts. The route ends with a smaller but still visible downward signal.',
    chartCaption: 'Steady upward march — forest gain dominates above 1,500m elevation.',
    sources: [
      { name: 'Global Change Biology / PMC (2019)', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6849738/' },
      { name: 'Earth System Dynamics (2022)', url: 'https://esd.copernicus.org/articles/13/595/2022/' },
    ],
  },
  {
    region: 'Midwest',
    coordinates: [-92, 42],
    answer: 'Corn Belt seasonality',
    choices: ['Corn Belt seasonality', 'Tundra shrub growth', 'Amazon drought'],
    mainImage: './quiz_assets/midwest.jpg',
    secondaryImage: './anazon_trendline.png',
    photoTitle: 'Midwest',
    photoCopy: 'The Midwest stop turns the quiz toward seasonality: sparse winter months versus high summer crop canopy.',
    note: 'The Midwest signal is defined by contrast. Crops push summer NDVI high while winter and early spring stay low, producing one of the strongest seasonal swings in the route.',
    chartCaption: "Crops push the summer ceiling higher — the corn belt's NDVI swing is among the largest on Earth.",
    sources: [
      { name: 'ScienceDirect (2020)', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0168192320302458' },
      { name: 'Remote Sensing, MDPI (2017)', url: 'https://www.mdpi.com/2072-4292/9/7/722' },
    ],
  },
];

const state = {
  index: 0,
  score: 0,
  data: null,
  annualRows: [],
  monthlyData: null,
  countries: null,
  projection: null,
  projectedStops: [],
  answered: false,
  hasRenderedStop: false,
};

const els = {
  visualPanel: document.querySelector('#visual-panel'),
  mapView: document.querySelector('#map-view'),
  routeMap: document.querySelector('#route-map'),
  revealView: document.querySelector('#reveal-view'),
  car: document.querySelector('#car-indicator'),
  regionLabel: document.querySelector('#region-label'),
  stopCount: document.querySelector('#stop-count'),
  modeLabel: document.querySelector('#mode-label'),
  score: document.querySelector('#score'),
  kicker: document.querySelector('#prompt-kicker'),
  title: document.querySelector('#prompt-title'),
  copy: document.querySelector('#prompt-copy'),
  choices: document.querySelector('#choice-grid'),
  result: document.querySelector('#result-card'),
  resultLabel: document.querySelector('#result-label'),
  resultTitle: document.querySelector('#result-title'),
  resultCopy: document.querySelector('#result-copy'),
  next: document.querySelector('#next-btn'),
  chart: document.querySelector('#trend-chart'),
  chartCaption: document.querySelector('#chart-caption'),
  chartSource: document.querySelector('#chart-source'),
  photoMain: document.querySelector('#photo-main'),
};

async function loadData() {
  const [treeResponse, annualResponse, monthlyResponse] = await Promise.all([
    fetch('./data/region-year-treecover.json'),
    fetch('./data/processed/region_trends.csv'),
    fetch('./data/monthly-by-year.json'),
  ]);
  state.data = await treeResponse.json();
  state.annualRows = window.d3.csvParse(await annualResponse.text(), d => ({
    region: d.region,
    year: Number(d.year),
    vegetation_proxy: Number(d.vegetation_proxy ?? d.value),
    value: Number(d.vegetation_proxy ?? d.value),
  }));
  state.monthlyData = await monthlyResponse.json();
}

async function loadMap() {
  const response = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  const topology = await response.json();
  state.countries = window.topojson
    .feature(topology, topology.objects.countries)
    .features
    .map(country => ({
      ...country,
      properties: {
        ...country.properties,
        warmValue: Math.random(),
      },
    }));
  renderRouteMap();
}

function renderStop() {
  const stop = stops[state.index];

  if (!stop) {
    renderFinal();
    return;
  }

  state.answered = false;
  els.visualPanel.classList.remove('is-reveal');
  els.mapView.hidden = false;
  els.revealView.hidden = true;
  els.result.hidden = true;
  els.modeLabel.textContent = 'Map route';
  els.stopCount.textContent = `Stop ${state.index + 1} / ${stops.length}`;
  els.regionLabel.textContent = stop.region;
  els.kicker.textContent = 'Question';
  els.title.textContent = `${stop.region}: what is driving change here?`;
  els.copy.textContent = 'Pick the most likely pressure before the real-world reveal.';
  moveCarToStop(state.index, state.hasRenderedStop);
  state.hasRenderedStop = true;
  renderChoices(stop);
  clearChart();
}

function renderChoices(stop) {
  els.choices.replaceChildren();
  stop.choices.forEach(choice => {
    const button = document.createElement('button');
    button.className = 'choice-btn';
    button.type = 'button';
    button.textContent = choice;
    button.dataset.choice = choice;
    els.choices.append(button);
  });
}

function handleChoice(event) {
  const button = event.target.closest('.choice-btn');
  if (!button || state.answered) return;

  const stop = stops[state.index];
  const correct = button.dataset.choice === stop.answer;
  state.answered = true;

  if (correct) state.score += 1;
  els.score.textContent = state.score;

  [...els.choices.querySelectorAll('.choice-btn')].forEach(choice => {
    choice.disabled = true;
    if (choice.dataset.choice === stop.answer) choice.classList.add('is-correct');
    if (choice === button && !correct) choice.classList.add('is-wrong');
  });

  revealStop(stop, correct);
}

function revealStop(stop, correct) {
  const series = getSeries(stop.region);
  const first = series[0];
  const last = series[series.length - 1];
  const delta = last.value - first.value;

  els.mapView.hidden = true;
  els.revealView.hidden = false;
  els.visualPanel.classList.add('is-reveal');
  els.modeLabel.textContent = 'Real-world reveal';
  els.kicker.textContent = correct ? 'Correct' : 'Answer revealed';
  els.copy.textContent = `${stop.answer}: tree cover changed from ${first.value.toFixed(1)}% in ${first.year} to ${last.value.toFixed(1)}% in ${last.year}.`;
  els.result.hidden = false;
  els.resultLabel.textContent = 'Data note';
  els.resultTitle.textContent = `${delta.toFixed(1)} percentage points across the record`;
  els.resultCopy.textContent = stop.note;
  els.next.textContent = state.index === stops.length - 1 ? 'Finish trip' : 'Back to map';
  els.photoMain.classList.add('is-loading');
  els.photoMain.onload = () => {
    requestAnimationFrame(() => els.photoMain.classList.remove('is-loading'));
  };
  els.photoMain.src = stop.mainImage;
  els.photoMain.alt = stop.photoTitle;

  drawRegionChart(stop);
}

function renderFinal() {
  els.mapView.hidden = false;
  els.revealView.hidden = true;
  els.visualPanel.classList.remove('is-reveal');
  els.modeLabel.textContent = 'Trip complete';
  els.stopCount.textContent = 'Final score';
  els.regionLabel.textContent = 'Americas route complete';
  moveCarToStop(stops.length - 1, true);
  els.kicker.textContent = 'Route log';
  els.title.textContent = `${state.score} / ${stops.length} causes identified`;
  els.copy.textContent = finalMessage();
  els.choices.replaceChildren();
  els.result.hidden = false;
  els.resultLabel.textContent = 'Takeaway';
  els.resultTitle.textContent = 'The Americas are changing through layered regional pressures.';
  els.resultCopy.textContent = 'Drought, heat, forest loss, warming, and elevation shifts stack differently by region, while the route map keeps the whole continent in view.';
  els.next.textContent = 'Restart trip';
  drawRegionChart(stops.find(stop => stop.region === 'Amazon'));
}

function finalMessage() {
  if (state.score === stops.length) return 'Excellent route read. You matched every stop to its pressure.';
  if (state.score >= 3) return 'Strong diagnosis. Most of the regional signals landed.';
  return 'The route did its job: the causes are regional, layered, and not always obvious from the map alone.';
}

function renderRouteMap() {
  if (!state.countries || !window.d3 || !window.topojson) return;

  const d3 = window.d3;
  const bounds = els.mapView.getBoundingClientRect();
  const width = Math.max(720, bounds.width);
  const height = Math.max(560, bounds.height);
  const americas = state.countries.filter(isAmericasCountry);
  const americasCollection = {
    type: 'FeatureCollection',
    features: americas,
  };

  state.projection = d3.geoNaturalEarth1()
    .fitSize([width, height], americasCollection)
    .clipExtent([[0, 0], [width, height]]);

  const path = d3.geoPath(state.projection);
  const color = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1]);
  const svg = d3.select(els.routeMap)
    .attr('viewBox', `0 0 ${width} ${height}`);

  svg.selectAll('*').remove();

  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', '#c9dce7');

  svg.append('g')
    .attr('aria-label', 'Country choropleth')
    .selectAll('path')
    .data(americas)
    .join('path')
    .attr('class', 'country')
    .attr('fill', d => color(d.properties.warmValue))
    .attr('d', path);

  state.projectedStops = stops.map(stop => {
    const [x, y] = state.projection(stop.coordinates);
    return { ...stop, x, y };
  });

  const routeLine = d3.line()
    .x(d => d.x)
    .y(d => d.y)
    .curve(d3.curveCatmullRom.alpha(0.65));

  svg.append('path')
    .datum(state.projectedStops)
    .attr('id', 'route-path')
    .attr('class', 'route-line')
    .attr('fill', 'none')
    .attr('stroke', '#3d1f0a')
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '8 5')
    .attr('d', routeLine);

  const markerGroup = svg.append('g')
    .attr('aria-label', 'Route stops');

  markerGroup.selectAll('circle')
    .data(state.projectedStops)
    .join('circle')
    .attr('class', 'route-stop')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('fill', 'white')
    .attr('stroke', '#3d1f0a')
    .attr('stroke-width', 2)
    .attr('r', 6);

  markerGroup.selectAll('text')
    .data(state.projectedStops)
    .join('text')
    .attr('class', 'route-label')
    .attr('x', d => d.x + 10)
    .attr('y', d => d.y - 10)
    .text(d => d.region.toUpperCase());

  moveCarToStop(Math.min(state.index, stops.length - 1), false);
}

function isAmericasCountry(feature) {
  const [lon, lat] = window.d3.geoCentroid(feature);
  return lon >= -170 && lon <= -30 && lat >= -60 && lat <= 85;
}

function moveCarToStop(stopIndex, animate) {
  const point = state.projectedStops[stopIndex];
  if (!point || !els.car) return;

  const left = `${point.x}px`;
  const top = `${point.y}px`;
  const car = window.d3.select('#car-indicator');

  if (animate) {
    car.transition()
      .duration(1200)
      .ease(window.d3.easeCubicInOut)
      .style('left', left)
      .style('top', top);
    return;
  }

  car.interrupt()
    .style('left', left)
    .style('top', top);
}

function resetTrip() {
  state.index = 0;
  state.score = 0;
  state.answered = false;
  state.hasRenderedStop = false;
  els.score.textContent = '0';
  renderStop();
}

function getSeries(region) {
  const values = state.data.values[region];
  return Object.keys(values)
    .map(year => ({ year: Number(year), value: Number(values[year]) }))
    .sort((a, b) => a.year - b.year);
}

function clearChart() {
  els.chart.replaceChildren();
  els.chartCaption.textContent = '';
  els.chartSource.replaceChildren();
}

function drawRegionChart(stop) {
  clearChart();
  if (!stop) return;

  drawTrendLineChart(stop);
  els.chartCaption.textContent = stop.chartCaption;
  renderSourceLine(stop.sources);
}

function renderSourceLine(sources = []) {
  els.chartSource.append('Source: ');
  sources.forEach((source, index) => {
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${source.name} — ${source.url.replace(/^https?:\/\//, '')}`;
    if (index) els.chartSource.append(' + ');
    els.chartSource.append(link);
  });
}

function drawTrendLineChart(stop) {
  const d3 = window.d3;
  const svg = setupChart(300, 160);
  const data = getAnnualRows(stop.region).filter(d => d.year >= 2001 && d.year <= 2023);
  const margin = { top: 24, right: 16, bottom: 28, left: 36 };
  const chartBottom = 160 - margin.bottom;
  const chartRight = 300 - margin.right;
  const values = data.map(d => d.vegetation_proxy);
  const emphasisValues = emphasisDomainValues(stop, data);
  const x = d3.scaleLinear().domain([2001, 2023]).range([margin.left, chartRight]);
  const y = d3.scaleLinear()
    .domain([d3.min([...values, ...emphasisValues]) - 0.002, d3.max([...values, ...emphasisValues]) + 0.002])
    .range([chartBottom, margin.top]);
  const regression = linearRegression(data);
  const trendValue = year => regression.slope * year + regression.intercept;
  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.vegetation_proxy));

  svg.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', 300)
    .attr('height', 160)
    .attr('fill', 'white');

  addRegionEmphasis(svg, stop, data, x, y, trendValue);

  y.ticks(3).forEach(tick => {
    svg.append('line')
      .attr('x1', margin.left)
      .attr('x2', chartRight)
      .attr('y1', y(tick))
      .attr('y2', y(tick))
      .attr('stroke', '#eee')
      .attr('stroke-dasharray', '3 3');
    chartLabel(svg, tick.toFixed(2), margin.left - 5, y(tick) + 3, 'trend-label', 'end', 9, '#666');
  });

  [2001, 2010, 2020, 2023].forEach(tick => {
    svg.append('line')
      .attr('x1', x(tick))
      .attr('x2', x(tick))
      .attr('y1', chartBottom)
      .attr('y2', chartBottom + 3)
      .attr('stroke', '#999');
    chartLabel(svg, tick, x(tick), 150, 'trend-label', 'middle', 9, '#666');
  });

  svg.append('path')
    .datum(data)
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', '#4a90d9')
    .attr('stroke-width', 1.5);

  svg.append('line')
    .attr('x1', x(2001))
    .attr('x2', x(2023))
    .attr('y1', y(trendValue(2001)))
    .attr('y2', y(trendValue(2023)))
    .attr('stroke', '#d94a4a')
    .attr('stroke-width', 1.2)
    .attr('stroke-dasharray', '4 3');

  chartLabel(svg, `Vegetation Trend · ${stop.region}`, 150, 13, 'trend-label', 'middle', 9, '#333');
  chartLabel(svg, `Trend line (slope=${regression.slope.toFixed(6)})`, 282, 27, 'trend-label', 'end', 8, '#d94a4a');
}

function addRegionEmphasis(svg, stop, data, x, y, trendValue) {
  const d3 = window.d3;
  if (stop.region === 'Canada/Arctic') {
    const endX = x(2023);
    const endY = y(trendValue(2023));
    chartLabel(svg, '▲', endX, endY - 8, 'trend-label', 'middle', 12, '#3d6b35');
    chartLabel(svg, 'STEEPEST TREND', Math.min(254, endX - 10), endY + 5, 'trend-label', 'end', 7, '#3d6b35');
  }

  if (stop.region === 'Western US') {
    const first = data[0];
    const last = data[data.length - 1];
    svg.append('path')
      .attr('d', `M${x(first.year)},${y(first.vegetation_proxy) - 7} L${x(last.year)},${y(last.vegetation_proxy) - 7} L${x(last.year) - 7},${y(last.vegetation_proxy) - 12} M${x(last.year)},${y(last.vegetation_proxy) - 7} L${x(last.year) - 7},${y(last.vegetation_proxy) - 2}`)
      .attr('fill', 'none')
      .attr('stroke', '#c84b1e')
      .attr('stroke-width', 1);
    chartLabel(svg, 'DECLINE', x(last.year) - 2, y(last.vegetation_proxy) - 13, 'trend-label', 'end', 7, '#c84b1e');
  }

  if (stop.region === 'Central America') {
    const drops = data.slice(1).map((d, i) => ({ ...d, drop: d.vegetation_proxy - data[i].vegetation_proxy }));
    const stress = drops.sort((a, b) => a.drop - b.drop)[0];
    svg.append('circle').attr('cx', x(stress.year)).attr('cy', y(stress.vegetation_proxy)).attr('r', 3).attr('fill', '#c84b1e');
    chartLabel(svg, 'STRESS PEAK', x(stress.year), y(stress.vegetation_proxy) - 7, 'trend-label', 'middle', 7, '#c84b1e');
  }

  if (stop.region === 'Amazon') {
    const others = state.annualRows.filter(d => d.region !== 'Amazon');
    const mean = d3.mean(others, d => d.vegetation_proxy);
    svg.append('line')
      .attr('x1', x(2001))
      .attr('x2', x(2023))
      .attr('y1', y(mean))
      .attr('y2', y(mean))
      .attr('stroke', '#3d6b35')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 2');
    chartLabel(svg, 'Other regions avg →', 202, y(mean) - 3, 'trend-label', 'start', 7, '#3d6b35');
  }

  if (stop.region === 'Andes') {
    const last = data[data.length - 1];
    svg.append('circle').attr('cx', x(last.year)).attr('cy', y(last.vegetation_proxy)).attr('r', 3).attr('fill', '#3d6b35');
    chartLabel(svg, 'NET GAIN', x(last.year) - 4, y(last.vegetation_proxy) - 7, 'trend-label', 'end', 7, '#3d6b35');
  }

  if (stop.region === 'Midwest') {
    const peak = d3.max(data, d => d.vegetation_proxy);
    const low = data.reduce((best, d) => d.vegetation_proxy < best.vegetation_proxy ? d : best, data[0]);
    svg.append('line')
      .attr('x1', x(2001))
      .attr('x2', x(2023))
      .attr('y1', y(peak))
      .attr('y2', y(peak))
      .attr('stroke', '#3d6b35')
      .attr('stroke-width', 0.8)
      .attr('stroke-dasharray', '3 2');
    chartLabel(svg, 'PEAK SEASON', 39, Math.max(31, y(peak) - 3), 'trend-label', 'start', 7, '#3d6b35');
    chartLabel(svg, 'WINTER LOW', x(low.year), y(low.vegetation_proxy) - 7, 'trend-label', 'middle', 7, '#8B6914');
  }
}

function setupChart(width, height) {
  return window.d3.select(els.chart)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('width', '100%')
    .attr('height', 'auto')
    .attr('aria-label', 'Region-specific D3 quiz chart');
}

function getAnnualRows(region) {
  return state.annualRows
    .filter(d => d.region === region)
    .sort((a, b) => a.year - b.year);
}

function linearRegression(data) {
  const d3 = window.d3;
  const n = data.length;
  const sumX = d3.sum(data, d => d.year);
  const sumY = d3.sum(data, d => d.vegetation_proxy);
  const sumXY = d3.sum(data, d => d.year * d.vegetation_proxy);
  const sumX2 = d3.sum(data, d => d.year * d.year);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function emphasisDomainValues(stop, data) {
  if (stop.region === 'Amazon') {
    return [window.d3.mean(state.annualRows.filter(d => d.region !== 'Amazon'), d => d.vegetation_proxy)];
  }
  return [];
}

function chartLabel(svg, value, x, y, className = 'trend-label', anchor = 'start', fontSize = 9, fill = null) {
  const text = svg.append('text')
    .attr('class', className)
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('font-size', fontSize)
    .text(value);
  if (fill) text.style('fill', fill);
}

els.choices.addEventListener('click', handleChoice);
els.next.addEventListener('click', () => {
  if (state.index >= stops.length) {
    resetTrip();
    return;
  }

  state.index += 1;
  renderStop();
});

window.addEventListener('resize', () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(renderRouteMap, 120);
});

Promise.all([loadData(), loadMap()])
  .then(renderStop)
  .catch(() => {
    els.title.textContent = 'Game data did not load';
    els.copy.textContent = 'Open this page through a local server or GitHub Pages so the JSON and map files can be fetched.';
  });
