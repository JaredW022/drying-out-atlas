import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import scrollama from "https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm";

window.addEventListener("DOMContentLoaded", () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let storyMode = false;
  let sliderLocked = false;
  let activeZoomTransition = null;
  let hoveredRegionName = null;
  let compareMode = false;

  let lastMouseX = null;
  let lastMouseY = null;

  let selectionMode = false;
  let isDrawing = false;
  let selStartPx = null;
  let selCurPx = null;
  let selDataRect = null;

  let currentTransform = d3.zoomIdentity;
  let currentGrid = null;

  const gridCache = {};
  let cacheReady = false;

  // Track which Scrollama step is active so we can restore state on re-entry
  let activeScrollStep = null;

  // ── Months ─────────────────────────────────────────────────────────────────
  const months = [];
  for (let y = 2000; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2000 && (m === 1 || m === 2)) continue;
      if (y === 2025 && m === 4) continue;
      months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }

  // ── DOM ────────────────────────────────────────────────────────────────────
  const slider = d3.select("#slider");
  slider.attr("max", months.length - 1);

  const app = d3.select("#app");
  const title = d3.select("#title");
  const hover = d3.select("#hover");
  const toggleCompare = d3.select("#toggle-compare");

  const canvas = d3.select("#heatmap").node();
  const ctx = canvas.getContext("2d");

  const compareLeftCanvas = d3.select("#compare-left").node();
  const compareRightCanvas = d3.select("#compare-right").node();
  const compareLeftCtx = compareLeftCanvas.getContext("2d");
  const compareRightCtx = compareRightCanvas.getContext("2d");

  const compareRightSelect = d3.select("#compare-right-select");
  const compareLeftHover = d3.select("#compare-left-hover");
  const compareRightHover = d3.select("#compare-right-hover");
  const mainRegionList = d3.select("#main-region-list");
  const compareLeftRegions = d3.select("#compare-left-regions");
  const compareRightRegions = d3.select("#compare-right-regions");

  const CANVAS_WIDTH = canvas.width;
  const CANVAS_HEIGHT = canvas.height;
  const LON_MIN = -170, LON_MAX = -30;
  const LAT_MIN = -60, LAT_MAX = 75;

  // ── Regions ────────────────────────────────────────────────────────────────
  const REGIONS = {
    "Amazon":         { lon_min: -75, lon_max: -45, lat_min: -20, lat_max: 5   },
    "Western US":     { lon_min: -125, lon_max: -105, lat_min: 30, lat_max: 50  },
    "Midwest":        { lon_min: -105, lon_max: -80, lat_min: 36, lat_max: 50  },
    "Central America":{ lon_min: -95,  lon_max: -75, lat_min: 7,  lat_max: 22  },
    "Andes":          { lon_min: -80,  lon_max: -65, lat_min: -45, lat_max: 10 },
    "Canada/Arctic":  { lon_min: -140, lon_max: -60, lat_min: 55, lat_max: 75  },
  };

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  function lonToX(lon) { return (lon - LON_MIN) / (LON_MAX - LON_MIN) * CANVAS_WIDTH; }
  function latToY(lat) { return (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * CANVAS_HEIGHT; }

  function cssToCanvas(cssX, cssY) {
    const rect = canvas.getBoundingClientRect();
    return [cssX * CANVAS_WIDTH / rect.width, cssY * CANVAS_HEIGHT / rect.height];
  }

  function canvasToData(cssX, cssY) {
    const [px, py] = cssToCanvas(cssX, cssY);
    return currentTransform.invert([px, py]);
  }

  // ── Offscreen canvas ───────────────────────────────────────────────────────
  const offscreen = document.createElement("canvas");
  offscreen.width = CANVAS_WIDTH;
  offscreen.height = CANVAS_HEIGHT;
  const offCtx = offscreen.getContext("2d");

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const zoom = d3.zoom()
    .scaleExtent([1, 20])
    .filter(event => {
      if (selectionMode) return false;
      return (!event.ctrlKey || event.type === "wheel") && !event.button;
    })
    .on("zoom", event => {
      currentTransform = event.transform;
      redraw();
    });

  d3.select(canvas).call(zoom);

  // ── NDVI drawing ───────────────────────────────────────────────────────────
  function drawNDVI(grid) {
    const rows = grid.length, cols = grid[0].length;
    const color = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
    const img = offCtx.createImageData(cols, rows);

    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        const rgb = v === null ? d3.rgb("#e0e0e0") : d3.rgb(color(v));
        img.data[i++] = rgb.r;
        img.data[i++] = rgb.g;
        img.data[i++] = rgb.b;
        img.data[i++] = 255;
      }
    }

    offCtx.putImageData(img, 0, 0);
    offCtx.drawImage(offscreen, 0, 0, cols, rows, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function drawGridToCanvas(grid, targetCanvas, targetCtx) {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

    if (!grid) {
      targetCtx.fillStyle = "#ddd";
      targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetCtx.fillStyle = "#555";
      targetCtx.font = "18px Arial";
      targetCtx.fillText("No data available", 24, 36);
      return;
    }

    const rows = grid.length, cols = grid[0].length;
    const color = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
    const imageData = targetCtx.createImageData(cols, rows);

    let i = 0, hasData = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const value = grid[r][c];
        const rgb = value === null ? d3.rgb("#e0e0e0") : d3.rgb(color(value));
        if (value !== null) hasData = true;
        imageData.data[i++] = rgb.r;
        imageData.data[i++] = rgb.g;
        imageData.data[i++] = rgb.b;
        imageData.data[i++] = 255;
      }
    }

    if (!hasData) {
      targetCtx.fillStyle = "#ddd";
      targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetCtx.fillStyle = "#555";
      targetCtx.font = "18px Arial";
      targetCtx.fillText("No data available", 24, 36);
      return;
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cols; tempCanvas.height = rows;
    tempCanvas.getContext("2d").putImageData(imageData, 0, 0);
    targetCtx.drawImage(tempCanvas, 0, 0, cols, rows, 0, 0, targetCanvas.width, targetCanvas.height);
    drawRegionsOnCompareCanvas(targetCtx, targetCanvas);
  }

  function drawRegionsOnCompareCanvas(targetCtx, targetCanvas) {
    const scaleX = targetCanvas.width / CANVAS_WIDTH;
    const scaleY = targetCanvas.height / CANVAS_HEIGHT;

    targetCtx.save();
    targetCtx.lineWidth = 1.5;
    targetCtx.strokeStyle = "rgba(255,255,255,0.9)";
    targetCtx.fillStyle = "rgba(255,255,255,0.95)";
    targetCtx.font = "12px Arial";

    for (const [name, r] of Object.entries(REGIONS)) {
      const x1 = lonToX(r.lon_min) * scaleX, x2 = lonToX(r.lon_max) * scaleX;
      const y1 = latToY(r.lat_max) * scaleY, y2 = latToY(r.lat_min) * scaleY;
      targetCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      targetCtx.fillText(name, x1 + 4, y1 + 14);
    }
    targetCtx.restore();
  }

  function compareCanvasToGrid(event, targetCanvas, grid) {
    if (!grid) return null;
    const rect = targetCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * targetCanvas.width / rect.width;
    const y = (event.clientY - rect.top) * targetCanvas.height / rect.height;
    const rows = grid.length, cols = grid[0].length;
    const col = Math.floor(x * cols / targetCanvas.width);
    const row = Math.floor(y * rows / targetCanvas.height);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return { row, col, value: grid[row][col], dataX: x / targetCanvas.width * CANVAS_WIDTH, dataY: y / targetCanvas.height * CANVAS_HEIGHT };
  }

  function meanForRegion(grid, regionBox) {
    if (!grid) return null;
    const rows = grid.length, cols = grid[0].length;
    const x1 = Math.max(0, Math.floor((regionBox.lon_min - LON_MIN) / (LON_MAX - LON_MIN) * cols));
    const x2 = Math.min(cols, Math.ceil((regionBox.lon_max - LON_MIN) / (LON_MAX - LON_MIN) * cols));
    const y1 = Math.max(0, Math.floor((LAT_MAX - regionBox.lat_max) / (LAT_MAX - LAT_MIN) * rows));
    const y2 = Math.min(rows, Math.ceil((LAT_MAX - regionBox.lat_min) / (LAT_MAX - LAT_MIN) * rows));
    let sum = 0, count = 0;
    for (let row = y1; row < y2; row++)
      for (let col = x1; col < x2; col++) {
        const value = grid[row][col];
        if (value !== null) { sum += value; count++; }
      }
    return count ? sum / count : null;
  }

  function updateRegionList(grid, listSelection) {
    const rows = Object.entries(REGIONS).map(([name, box]) => ({ name, value: meanForRegion(grid, box) }));
    listSelection.selectAll("li").data(rows).join("li")
      .html(d => `<span class="region-name">${d.name}</span><span class="region-value">${d.value === null ? "—" : d.value.toFixed(3)}</span>`);
  }

  function updateCompareHover(event, side) {
    const isLeft = side === "left";
    const month = isLeft ? months[slider.node().value] : compareRightSelect.property("value");
    const grid = gridCache[month];
    const targetCanvas = isLeft ? compareLeftCanvas : compareRightCanvas;
    const targetHover = isLeft ? compareLeftHover : compareRightHover;
    const point = compareCanvasToGrid(event, targetCanvas, grid);

    if (!point) { targetHover.text("Hover vegetation proxy: —"); return; }

    const region = regionAt(point.dataX, point.dataY);
    const valueText = point.value === null ? "—" : point.value.toFixed(3);
    targetHover.text(region ? `${region.name} — vegetation proxy: ${valueText}` : `Vegetation proxy: ${valueText}`);
  }

  function populateCompareSelects() {
    compareRightSelect.selectAll("option").data(months).join("option")
      .attr("value", d => d).text(d => d);
    compareRightSelect.property("value", months.includes("2024-07") ? "2024-07" : months[months.length - 1]);
  }

  function updateCompareView() {
    if (!cacheReady) return;
    const leftMonth = months[slider.node().value];
    const rightMonth = compareRightSelect.property("value");
    d3.select("#compare-left-title").text(leftMonth);
    d3.select("#compare-right-title").text(rightMonth);
    drawGridToCanvas(gridCache[leftMonth], compareLeftCanvas, compareLeftCtx);
    drawGridToCanvas(gridCache[rightMonth], compareRightCanvas, compareRightCtx);
    updateRegionList(gridCache[leftMonth], compareLeftRegions);
    updateRegionList(gridCache[rightMonth], compareRightRegions);
    compareLeftHover.text("Hover vegetation proxy: —");
    compareRightHover.text("Hover vegetation proxy: —");
  }

  function setCompareMode(enabled) {
    compareMode = enabled;
    app.classed("compare-mode", compareMode);
    toggleCompare.text(compareMode ? "Back to single map" : "Compare Two Different Times");

    if (compareMode) {
      if (selectionMode) {
        selectionMode = false;
        d3.select("#toggle-select").text("⬚ Highlight region").classed("active", false);
        canvas.style.cursor = "default";
        selStartPx = selCurPx = selDataRect = null;
        document.getElementById("ndvi-avg").style.display = "none";
      }
      storyMode = false;
      sliderLocked = false;
      updateCompareView();
    } else {
      redraw();
      updateHoverFromMouse();
    }
  }

  // ── Selection drawing ──────────────────────────────────────────────────────
  function drawSelection() {
    if (!selStartPx || !selCurPx) return;
    const [sx1, sy1] = currentTransform.apply([selStartPx.x, selStartPx.y]);
    const [sx2, sy2] = currentTransform.apply([selCurPx.x, selCurPx.y]);
    const x = Math.min(sx1, sx2), y = Math.min(sy1, sy2);
    const w = Math.abs(sx2 - sx1), h = Math.abs(sy2 - sy1);

    ctx.save();
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = "rgba(255, 220, 50, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "rgba(255, 220, 50, 0.08)";
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.save();
    ctx.setTransform(currentTransform.k, 0, 0, currentTransform.k, currentTransform.x, currentTransform.y);
    ctx.drawImage(offscreen, 0, 0);
    drawRegions();
    ctx.restore();
    drawSelection();
  }

  // ── Regions drawing & hit testing ─────────────────────────────────────────
  function drawRegions() {
    ctx.font = `${12 / currentTransform.k}px Arial`;

    for (const [name, r] of Object.entries(REGIONS)) {
      const x1 = lonToX(r.lon_min), x2 = lonToX(r.lon_max);
      const y1 = latToY(r.lat_max), y2 = latToY(r.lat_min);
      const isHovered = name === hoveredRegionName;

      ctx.lineWidth = (isHovered ? 4 : 2) / currentTransform.k;
      ctx.strokeStyle = isHovered ? "rgba(255, 220, 40, 0.98)" : "rgba(255,255,255,0.8)";
      ctx.fillStyle = isHovered ? "rgba(255, 220, 40, 0.16)" : "rgba(255,255,255,0.9)";

      if (isHovered) ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const labelX = x1 + 4 / currentTransform.k;
      const labelY = y1 + 14 / currentTransform.k;

      if (isHovered) {
        const padding = 4 / currentTransform.k;
        const labelWidth = ctx.measureText(name).width;
        const labelHeight = 16 / currentTransform.k;
        ctx.fillStyle = "rgba(255, 245, 160, 0.95)";
        ctx.fillRect(labelX - padding, labelY - labelHeight + 2 / currentTransform.k, labelWidth + padding * 2, labelHeight + padding);
        ctx.fillStyle = "rgba(35, 35, 20, 1)";
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
      }
      ctx.fillText(name, labelX, labelY);
    }
  }

  function regionAt(dataX, dataY) {
    for (const [name, r] of Object.entries(REGIONS)) {
      const x1 = lonToX(r.lon_min), x2 = lonToX(r.lon_max);
      const y1 = latToY(r.lat_max), y2 = latToY(r.lat_min);
      if (dataX >= x1 && dataX <= x2 && dataY >= y1 && dataY <= y2)
        return { name, x1, x2, y1, y2 };
    }
    return null;
  }

  // ── Zoom to a named region (used by both click and Scrollama) ──────────────
  /**
   * Animate the canvas zoom to a named region.
   * @param {string} regionName   — key in REGIONS
   * @param {number} [padding=0.8] — fraction of viewport to fill (0–1)
   * @returns Promise that resolves when the zoom transition ends
   */
  function zoomToRegion(regionName, padding = 0.8) {
    return new Promise(resolve => {
      const r = REGIONS[regionName];
      if (!r) { resolve(); return; }

      const x1 = lonToX(r.lon_min), x2 = lonToX(r.lon_max);
      const y1 = latToY(r.lat_max), y2 = latToY(r.lat_min);
      const regionW = x2 - x1, regionH = y2 - y1;
      const scale = padding * Math.min(CANVAS_WIDTH / regionW, CANVAS_HEIGHT / regionH);
      const centerX = (x1 + x2) / 2, centerY = (y1 + y2) / 2;
      const tx = CANVAS_WIDTH / 2 - scale * centerX;
      const ty = CANVAS_HEIGHT / 2 - scale * centerY;

      if (activeZoomTransition) activeZoomTransition.end();

      activeZoomTransition = d3.select(canvas)
        .transition().duration(700)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
        .on("end", () => { activeZoomTransition = null; resolve(); });
    });
  }

  /** Animate zoom back to the full extent */
  function zoomToFull() {
    return new Promise(resolve => {
      if (activeZoomTransition) activeZoomTransition.end();
      activeZoomTransition = d3.select(canvas)
        .transition().duration(600)
        .call(zoom.transform, d3.zoomIdentity)
        .on("end", () => { activeZoomTransition = null; resolve(); });
    });
  }

  // ── Selection mouse events ─────────────────────────────────────────────────
  canvas.addEventListener("mousedown", e => {
    if (!selectionMode) return;
    e.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    const [dx, dy] = canvasToData(e.clientX - rect.left, e.clientY - rect.top);
    selStartPx = { x: dx, y: dy };
    selCurPx = { x: dx, y: dy };
    isDrawing = true;
    selDataRect = null;
    document.getElementById("ndvi-avg").style.display = "none";
  });

  canvas.addEventListener("mousemove", e => {
    if (selectionMode && isDrawing) {
      const rect = canvas.getBoundingClientRect();
      const [dx, dy] = canvasToData(e.clientX - rect.left, e.clientY - rect.top);
      selCurPx = { x: dx, y: dy };
      redraw();
    } else {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      if (!isDrawing) updateHoverFromMouse();
    }
  });

  canvas.addEventListener("mouseup", () => {
    if (!selectionMode || !isDrawing) return;
    isDrawing = false;
    if (!selStartPx || !selCurPx) return;
    const minSize = 4 / currentTransform.k;
    if (Math.abs(selCurPx.x - selStartPx.x) < minSize || Math.abs(selCurPx.y - selStartPx.y) < minSize) {
      selStartPx = selCurPx = null;
      redraw();
      return;
    }
    selDataRect = { x1: Math.min(selStartPx.x, selCurPx.x), y1: Math.min(selStartPx.y, selCurPx.y), x2: Math.max(selStartPx.x, selCurPx.x), y2: Math.max(selStartPx.y, selCurPx.y) };
    computeAndShowAverage();
    redraw();
  });

  // ── Average NDVI computation ───────────────────────────────────────────────
  function computeAndShowAverage() {
    if (!currentGrid || !selDataRect) return;
    const grid = currentGrid, rows = grid.length, cols = grid[0].length;
    const c1 = Math.max(0, Math.floor(selDataRect.x1 * cols / CANVAS_WIDTH));
    const c2 = Math.min(cols, Math.ceil(selDataRect.x2 * cols / CANVAS_WIDTH));
    const r1 = Math.max(0, Math.floor(selDataRect.y1 * rows / CANVAS_HEIGHT));
    const r2 = Math.min(rows, Math.ceil(selDataRect.y2 * rows / CANVAS_HEIGHT));
    let sum = 0, count = 0;
    for (let r = r1; r < r2; r++)
      for (let c = c1; c < c2; c++) {
        const v = grid[r][c];
        if (v !== null) { sum += v; count++; }
      }
    const avgEl = document.getElementById("ndvi-avg");
    const valEl = document.getElementById("ndvi-avg-value");
    valEl.textContent = count === 0 ? "No data in selection" : `Avg vegetation proxy: ${(sum / count).toFixed(4)}  (${count.toLocaleString()} cells)`;
    avgEl.style.display = "block";
  }

  document.getElementById("toggle-select").addEventListener("click", () => {
    selectionMode = !selectionMode;
    const btn = document.getElementById("toggle-select");
    btn.textContent = selectionMode ? "✕ Cancel selection" : "⬚ Highlight region";
    btn.classList.toggle("active", selectionMode);
    canvas.style.cursor = selectionMode ? "crosshair" : "default";
    if (!selectionMode) {
      selStartPx = selCurPx = selDataRect = null;
      document.getElementById("ndvi-avg").style.display = "none";
      redraw();
    }
  });

  // ── Click-to-zoom (manual, in Ch4 interactive section) ────────────────────
  canvas.addEventListener("click", e => {
    if (selectionMode) return;

    if (storyMode) { storyMode = false; sliderLocked = false; }

    const rect = canvas.getBoundingClientRect();
    const [dataX, dataY] = canvasToData(e.clientX - rect.left, e.clientY - rect.top);
    const hit = regionAt(dataX, dataY);

    if (!hit) {
      storyMode = false; sliderLocked = false;
      zoomToFull();
      return;
    }

    zoomToRegion(hit.name).then(() => playTimeline(hit.name));
  });

  // ── Hover logic ────────────────────────────────────────────────────────────
  function updateHoverFromMouse() {
    if (!currentGrid || lastMouseX === null) return;
    const rect = canvas.getBoundingClientRect();
    const [dataX, dataY] = canvasToData(lastMouseX - rect.left, lastMouseY - rect.top);
    const rows = currentGrid.length, cols = currentGrid[0].length;
    const col = Math.floor(dataX * cols / CANVAS_WIDTH);
    const row = Math.floor(dataY * rows / CANVAS_HEIGHT);

    if (col < 0 || col >= cols || row < 0 || row >= rows) { hover.text("Vegetation proxy: —"); return; }

    const value = currentGrid[row][col];
    const proxyText = value === null ? "Vegetation proxy: —" : `Vegetation proxy: ${value.toFixed(3)}`;
    const region = regionAt(dataX, dataY);
    const nextName = region ? region.name : null;

    if (nextName !== hoveredRegionName) { hoveredRegionName = nextName; redraw(); }
    hover.text(region ? `${region.name} — ${proxyText}` : proxyText);
  }

  canvas.addEventListener("mouseleave", () => {
    lastMouseX = lastMouseY = null;
    hover.text("Vegetation proxy: —");
    if (hoveredRegionName !== null) { hoveredRegionName = null; redraw(); }
  });

  // ── Preload & update ───────────────────────────────────────────────────────
  async function preloadAll() {
    title.text("Loading data…");
    await Promise.all(months.map(async ym => {
      try { gridCache[ym] = await d3.json(`ndvi_json/${ym}.json`); }
      catch { gridCache[ym] = null; }
    }));
    cacheReady = true;
    title.text(`NDVI — ${months[0]}`);
    populateCompareSelects();
    update();
    updateCompareView();
  }

  function update() {
    if (!cacheReady) return;
    const ym = months[slider.node().value];
    const grid = gridCache[ym];
    title.text(`NDVI — ${ym}`);
    if (!grid || grid.every(row => row.every(v => v === null))) return;
    currentGrid = grid;
    drawNDVI(grid);
    redraw();
    updateRegionList(grid, mainRegionList);
    updateCompareView();
    updateHoverFromMouse();
    if (selDataRect) computeAndShowAverage();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Story mode ─────────────────────────────────────────────────────────────
  const REGION_INFO = {
    "Midwest": "The Midwest experiences the most fluctuation on average in a year!",
    "Andes": "The Andes has the smallest fluctuation in vegetation score on average.",
  };

  async function playTimeline(regionName) {
    storyMode = true;
    sliderLocked = true;

    if (REGION_INFO[regionName]) showPopup(REGION_INFO[regionName], regionName, true);

    for (let i = 0; i < months.length; i++) {
      if (!storyMode) break;
      slider.node().value = i;
      update();
      const event = isInteresting(regionName, months[i]);
      if (event) { showPopup(event.msg, regionName, false); await sleep(3000); }
      else        { await sleep(100); }
    }

    storyMode = false;
    sliderLocked = false;
  }

  function isInteresting(regionName, ym) {
    const [year, month] = ym.split("-").map(Number);
    const interesting = {
      "Midwest":          [{ y: 2014, m: 3,  msg: "Lowest vegetation score recorded for the Midwest, 2000–2025" }, { y: 2025, m: 8,  msg: "The Midwest's greatest outlier month: vegetation proxy 0.376 above the regional mean" }],
      "Amazon":           [{ y: 2024, m: 9,  msg: "Lowest vegetation score recorded in the Amazon region" }],
      "Western US":       [{ y: 2008, m: 1,  msg: "Lowest vegetation score recorded in the Western US" }],
      "Central America":  [{ y: 2024, m: 10, msg: "Highest vegetation score recorded for any region!" }, { y: 2009, m: 4,  msg: "Lowest vegetation score recorded for Central America" }],
      "Andes":            [{ y: 2003, m: 2,  msg: "Lowest vegetation score recorded in the Andes" }],
      "Canada/Arctic":    [{ y: 2012, m: 12, msg: "Lowest score recorded for any region across the full 25-year dataset!" }, { y: 2021, m: 11, msg: "Greatest month-over-month increase in vegetation score across the dataset" }, { y: 2011, m: 4,  msg: "Greatest month-over-month decrease in vegetation score across the dataset" }],
    };
    const rules = interesting[regionName] || [];
    return rules.find(r => r.y === year && r.m === month) || null;
  }

  // ── Popup ───────────────────────────────────────────────────────────────────
  function getRegionScreenRect(region) {
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = document.getElementById("viz-container").getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / canvasRect.width, scaleY = CANVAS_HEIGHT / canvasRect.height;
    const [sx1, sy1] = currentTransform.apply([region.x1, region.y1]);
    const [sx2, sy2] = currentTransform.apply([region.x2, region.y2]);
    return {
      left:   sx1 / scaleX + (canvasRect.left - containerRect.left),
      top:    sy1 / scaleY + (canvasRect.top  - containerRect.top),
      width:  (sx2 - sx1) / scaleX,
      height: (sy2 - sy1) / scaleY,
    };
  }

  function showPopup(text, regionName, isIntro = false) {
    const region = REGIONS[regionName];
    const x1 = lonToX(region.lon_min), x2 = lonToX(region.lon_max);
    const y1 = latToY(region.lat_max), y2 = latToY(region.lat_min);
    const rect = getRegionScreenRect({ x1, x2, y1, y2 });
    const box = d3.select("#popup");
    const accentColor = isIntro ? "#1a6fa8" : "#92820a";
    const icon = isIntro ? "ℹ" : "📍";
    const label = isIntro ? "Region overview" : regionName;
    const displayMs = isIntro ? 4000 : 2200;

    box.html(`
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:${accentColor};text-transform:uppercase;letter-spacing:0.06em;">${icon} ${label}</p>
      <p style="margin:0;">${text}</p>
    `)
    .style("left", rect.left + 10 + "px")
    .style("top",  rect.top  + 10 + "px")
    .style("max-width", Math.min(rect.width - 24, 300) + "px")
    .style("transform", "none")
    .style("opacity", 1);

    setTimeout(() => box.transition().duration(800).style("opacity", 0), displayMs);
  }

  // ── Slider & compare controls ──────────────────────────────────────────────
  slider.on("input", () => { if (!sliderLocked) update(); });
  toggleCompare.on("click", () => setCompareMode(!compareMode));
  compareRightSelect.on("change", updateCompareView);

  compareLeftCanvas.addEventListener("mousemove",  e => updateCompareHover(e, "left"));
  compareRightCanvas.addEventListener("mousemove", e => updateCompareHover(e, "right"));
  compareLeftCanvas.addEventListener("mouseleave",  () => compareLeftHover.text("Hover vegetation proxy: —"));
  compareRightCanvas.addEventListener("mouseleave", () => compareRightHover.text("Hover vegetation proxy: —"));

  // ══════════════════════════════════════════════════════════════════════════
  //  SCROLLAMA — wires each .step to the NDVI map in Ch4's viz
  //
  //  The Ch4 canvas lives inside #ch4 (full-width section, not a
  //  scrollytelling layout). The scrollytelling sections (1-3) use static
  //  images in their own .scroll-graphic panels. Scrollama drives:
  //    • graphic panel transitions (static image swaps in sections 1–3)
  //    • a special "scroll into Ch4" handler that zooms the canvas
  //      to the region highlighted by the last narrative step
  // ══════════════════════════════════════════════════════════════════════════

  // ── Graphic panel transitions for sections 1–3 ──────────────────────────
  function switchGraphicPanel(panelId) {
    if (!panelId) return;
    // Find the parent .scroll-graphic__inner
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const inner = panel.closest(".scroll-graphic__inner");
    if (!inner) return;
    inner.querySelectorAll(".graphic-panel").forEach(p => p.classList.remove("visible"));
    panel.classList.add("visible");
  }

  // ── Per-step scroll actions ────────────────────────────────────────────────
  // Each entry maps data-step → { graphicPanel?, regionFocus?, label? }
  const STEP_ACTIONS = {
    // Section 1 — all show the same NDVI map panel (no region zoom)
    "1-1": { graphicPanel: "panel-ndvi-map",         label: "MODIS NDVI · Americas · Jul 2024 · NASA GIBS" },
    "1-2": { graphicPanel: "panel-ndvi-map",         label: "MODIS NDVI · Americas · Jul 2024 · NASA GIBS" },
    "1-3": { graphicPanel: "panel-ndvi-map",         label: "MODIS NDVI · Americas · Jul 2024 · NASA GIBS" },

    // Section 2 — regional trend chart
    "2-1": { graphicPanel: "panel-regional-trends",  label: "Regional NDVI trend slope · all regions positive" },
    "2-2": { graphicPanel: "panel-regional-trends",  label: "Regional NDVI trend slope · 4 significant, 2 uncertain" },
    "2-3": { graphicPanel: "panel-regional-trends",  label: "Regional NDVI trend slope · drivers of greening" },

    // Section 3 — Amazon
    "3-1": { graphicPanel: "panel-amazon-photo",     label: "Amazon basin · dense canopy snapshot" },
    "3-2": { graphicPanel: "panel-amazon-photo",     label: "Amazon basin · density vs. momentum" },
    "3-3": { graphicPanel: "panel-amazon-comp",      label: "Amazon vs Canada/Arctic · diverging trends 2000–2025" },
  };

  function handleStepEnter({ element }) {
    const stepId = element.dataset.step;
    activeScrollStep = stepId;

    const action = STEP_ACTIONS[stepId];
    if (!action) return;

    // Switch static graphic panel
    if (action.graphicPanel) switchGraphicPanel(action.graphicPanel);

    // Update graphic label
    const sectionNum = stepId.split("-")[0];
    const labelEl = document.getElementById(`graphic-label-${sectionNum}`);
    if (labelEl && action.label) labelEl.textContent = action.label;

    // Mark active step for styling
    document.querySelectorAll(".step.is-active").forEach(el => el.classList.remove("is-active"));
    element.classList.add("is-active");
  }

  // ── Ch4 entry: zoom canvas to Amazon on first reach ───────────────────────
  // When the reader scrolls into Ch4 after reading Ch3's Amazon focus,
  // briefly zoom the interactive canvas to the Amazon to provide continuity.
  let ch4EntryZoomDone = false;

  function initScrollamaSteps() {
    const scroller = scrollama();

    scroller
      .setup({
        step: ".step",
        offset: 0.55,   // trigger when step's midpoint crosses 55% down the viewport
        debug: false,
      })
      .onStepEnter(handleStepEnter)
      .onStepExit(({ element }) => {
        // When scrolling back past the first step of any section, 
        // deactivate and let the previous step re-activate via its own enter
      });

    // Resize handler
    window.addEventListener("resize", scroller.resize);
  }

  // ── Ch4 intersection — zoom-to-Amazon on entry ────────────────────────────
  function initCh4Entry() {
    const ch4El = document.getElementById("ch4");
    if (!ch4El) return;

    new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting || ch4EntryZoomDone || !cacheReady) return;
        ch4EntryZoomDone = true;

        // Short delay so the section is visible before animating
        setTimeout(async () => {
          await zoomToRegion("Amazon", 0.75);
          // Stay zoomed for 2s, then zoom back out so user has full map
          await sleep(2000);
          await zoomToFull();
        }, 300);
      });
    }, { threshold: 0.25 }).observe(ch4El);
  }

  // ── Kick everything off ────────────────────────────────────────────────────
  preloadAll().catch(console.error);
  initScrollamaSteps();
  initCh4Entry();

  // Activate the first step on load (in case page starts at top)
  const firstStep = document.querySelector(".step");
  if (firstStep) firstStep.classList.add("is-active");
});