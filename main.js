import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import scrollama from "https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm";

window.addEventListener("DOMContentLoaded", () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let storyMode = false;
  let sliderLocked = false;
  let activeZoomTransition = null;
  let hoveredRegionName = null;
  let compareMode = false;
  let compareFocusedRegion = null;

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

  let activeScrollStep = null;

  // Canvas position changes while scrolling, so do not cache left/top.
  // A stale bounding rect makes hover/click region hit-testing drift away from the cursor.
  function getCanvasRect() {
    return canvas.getBoundingClientRect();
  }

  // PERF: RAF guard for mousemove-triggered redraws
  let rafPending = false;
  function scheduleRedraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; redraw(); });
  }

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
  const compareRegionExit = d3.select("#compare-region-exit");
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

  // PERF: pre-compute region entries array and pixel coords once
  const REGION_ENTRIES = Object.entries(REGIONS);
  const REGION_PIXEL_COORDS = REGION_ENTRIES.map(([name, r]) => ({
    name,
    x1: lonToX(r.lon_min), x2: lonToX(r.lon_max),
    y1: latToY(r.lat_max), y2: latToY(r.lat_min),
  }));

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  function lonToX(lon) { return (lon - LON_MIN) / (LON_MAX - LON_MIN) * CANVAS_WIDTH; }
  function latToY(lat) { return (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * CANVAS_HEIGHT; }

  function cssToCanvas(cssX, cssY) {
    const r = getCanvasRect();
    return [cssX * CANVAS_WIDTH / r.width, cssY * CANVAS_HEIGHT / r.height];
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

  // PERF: persistent temp canvas for compare drawing — avoids repeated DOM alloc
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d");

  // PERF: colour LUT — map 256 NDVI steps to [r,g,b] once; use typed array for speed
  const LUT_SIZE = 512;
  const colorLUT = new Uint8Array(LUT_SIZE * 3); // [r0,g0,b0, r1,g1,b1, ...]
  (function buildLUT() {
    const scale = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);
    for (let i = 0; i < LUT_SIZE; i++) {
      const rgb = d3.rgb(scale(i / (LUT_SIZE - 1)));
      colorLUT[i * 3]     = rgb.r;
      colorLUT[i * 3 + 1] = rgb.g;
      colorLUT[i * 3 + 2] = rgb.b;
    }
  })();

  // NULL pixel colour (grey for ocean/missing data)
  const NULL_R = 0xe0, NULL_G = 0xe0, NULL_B = 0xe0;

  // PERF: fast pixel writer using the LUT instead of per-pixel d3 object alloc
  function gridToImageData(grid, imageData) {
    const rows = grid.length, cols = grid[0].length;
    const data = imageData.data;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (v === null) {
          data[i++] = NULL_R; data[i++] = NULL_G; data[i++] = NULL_B; data[i++] = 255;
        } else {
          const idx = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(v * (LUT_SIZE - 1)))) * 3;
          data[i++] = colorLUT[idx]; data[i++] = colorLUT[idx + 1]; data[i++] = colorLUT[idx + 2]; data[i++] = 255;
        }
      }
    }
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const PAN_MARGIN = 0.20;
  const zoom = d3.zoom()
    .scaleExtent([1, 20])
    .translateExtent([
      [-CANVAS_WIDTH  * PAN_MARGIN, -CANVAS_HEIGHT * PAN_MARGIN],
      [ CANVAS_WIDTH  * (1 + PAN_MARGIN), CANVAS_HEIGHT * (1 + PAN_MARGIN)],
    ])
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
    const img = offCtx.createImageData(cols, rows);
    gridToImageData(grid, img);
    offCtx.putImageData(img, 0, 0);
    // Scale up to full canvas size
    offCtx.drawImage(offscreen, 0, 0, cols, rows, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function cropForRegion(regionName, padding = 0.12) {
    if (!regionName || !REGIONS[regionName]) {
      return { sx: 0, sy: 0, sw: CANVAS_WIDTH, sh: CANVAS_HEIGHT };
    }
    const r = REGIONS[regionName];
    const x1 = lonToX(r.lon_min), x2 = lonToX(r.lon_max);
    const y1 = latToY(r.lat_max), y2 = latToY(r.lat_min);
    const padX = (x2 - x1) * padding;
    const padY = (y2 - y1) * padding;
    const sx = Math.max(0, x1 - padX);
    const sy = Math.max(0, y1 - padY);
    const ex = Math.min(CANVAS_WIDTH, x2 + padX);
    const ey = Math.min(CANVAS_HEIGHT, y2 + padY);
    return { sx, sy, sw: ex - sx, sh: ey - sy };
  }

  function compareCanvasPointToData(event, targetCanvas) {
    const rect = targetCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * targetCanvas.width / rect.width;
    const y = (event.clientY - rect.top) * targetCanvas.height / rect.height;
    const crop = cropForRegion(compareFocusedRegion);
    return {
      dataX: crop.sx + x / targetCanvas.width * crop.sw,
      dataY: crop.sy + y / targetCanvas.height * crop.sh,
    };
  }

  function drawGridToCanvas(grid, targetCanvas, targetCtx, focusedRegionName = null) {
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
    const imageData = targetCtx.createImageData(cols, rows);
    let hasData = false;

    // PERF: use LUT instead of per-pixel d3 alloc
    const data = imageData.data;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const value = grid[r][c];
        if (value === null) {
          data[i++] = NULL_R; data[i++] = NULL_G; data[i++] = NULL_B; data[i++] = 255;
        } else {
          hasData = true;
          const idx = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(value * (LUT_SIZE - 1)))) * 3;
          data[i++] = colorLUT[idx]; data[i++] = colorLUT[idx + 1]; data[i++] = colorLUT[idx + 2]; data[i++] = 255;
        }
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

    // PERF: reuse persistent tempCanvas instead of allocating a new one each call
    tempCanvas.width = cols;
    tempCanvas.height = rows;
    tempCtx.putImageData(imageData, 0, 0);
    const crop = cropForRegion(focusedRegionName);
    const sx = crop.sx * cols / CANVAS_WIDTH;
    const sy = crop.sy * rows / CANVAS_HEIGHT;
    const sw = crop.sw * cols / CANVAS_WIDTH;
    const sh = crop.sh * rows / CANVAS_HEIGHT;
    targetCtx.drawImage(tempCanvas, sx, sy, sw, sh, 0, 0, targetCanvas.width, targetCanvas.height);
    drawRegionsOnCompareCanvas(targetCtx, targetCanvas, focusedRegionName);
  }

  function drawRegionsOnCompareCanvas(targetCtx, targetCanvas, focusedRegionName = null) {
    const crop = cropForRegion(focusedRegionName);
    const scaleX = targetCanvas.width / crop.sw;
    const scaleY = targetCanvas.height / crop.sh;

    targetCtx.save();
    targetCtx.lineWidth = focusedRegionName ? 2.5 : 1.5;
    targetCtx.font = "12px Arial";

    // PERF: use pre-computed pixel coords
    for (const { name, x1: rx1, x2: rx2, y1: ry1, y2: ry2 } of REGION_PIXEL_COORDS) {
      if (focusedRegionName && name !== focusedRegionName) continue;
      const x1 = (rx1 - crop.sx) * scaleX;
      const x2 = (rx2 - crop.sx) * scaleX;
      const y1 = (ry1 - crop.sy) * scaleY;
      const y2 = (ry2 - crop.sy) * scaleY;
      targetCtx.strokeStyle = name === focusedRegionName ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.9)";
      targetCtx.fillStyle = name === focusedRegionName ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.95)";
      if (name === focusedRegionName) targetCtx.fillRect(x1, y1, x2 - x1, y2 - y1);
      targetCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      targetCtx.fillStyle = "rgba(255,255,255,0.95)";
      targetCtx.fillText(name, x1 + 4, y1 + 14);
    }
    targetCtx.restore();
  }

  function compareCanvasToGrid(event, targetCanvas, grid) {
    if (!grid) return null;
    const rows = grid.length, cols = grid[0].length;
    const point = compareCanvasPointToData(event, targetCanvas);
    const col = Math.floor(point.dataX * cols / CANVAS_WIDTH);
    const row = Math.floor(point.dataY * rows / CANVAS_HEIGHT);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return { row, col, value: grid[row][col], dataX: point.dataX, dataY: point.dataY };
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

  // ── Mean for arbitrary data-space rect ────────────────────────────────────
  function meanForDataRect(grid, rect) {
    if (!grid || !rect) return null;
    const rows = grid.length, cols = grid[0].length;
    const c1 = Math.max(0, Math.floor(rect.x1 * cols / CANVAS_WIDTH));
    const c2 = Math.min(cols, Math.ceil(rect.x2 * cols / CANVAS_WIDTH));
    const r1 = Math.max(0, Math.floor(rect.y1 * rows / CANVAS_HEIGHT));
    const r2 = Math.min(rows, Math.ceil(rect.y2 * rows / CANVAS_HEIGHT));
    let sum = 0, count = 0;
    for (let r = r1; r < r2; r++)
      for (let c = c1; c < c2; c++) {
        const v = grid[r][c];
        if (v !== null) { sum += v; count++; }
      }
    return count ? sum / count : null;
  }

  function updateRegionList(grid, listSelection, interactive = false) {
    const rows = REGION_ENTRIES.map(([name, box]) => ({ name, value: meanForRegion(grid, box) }));
    listSelection.selectAll("li").data(rows).join("li")
      .style("cursor", interactive ? "pointer" : null)
      .style("text-decoration", d => interactive && d.name === compareFocusedRegion ? "underline" : null)
      .html(d => `<span class="region-name">${d.name}</span><span class="region-value">${d.value === null ? "—" : d.value.toFixed(3)}</span>`)
      .on("click", (event, d) => {
        if (interactive) focusCompareRegion(d.name);
      });
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
    // PERF: skip entirely when compare panel is hidden
    if (!compareMode || !cacheReady) return;
    const leftMonth = months[slider.node().value];
    const rightMonth = compareRightSelect.property("value");
    const suffix = compareFocusedRegion ? ` · ${compareFocusedRegion}` : "";
    d3.select("#compare-left-title").text(leftMonth + suffix);
    d3.select("#compare-right-title").text(rightMonth + suffix);
    drawGridToCanvas(gridCache[leftMonth], compareLeftCanvas, compareLeftCtx, compareFocusedRegion);
    drawGridToCanvas(gridCache[rightMonth], compareRightCanvas, compareRightCtx, compareFocusedRegion);
    updateRegionList(gridCache[leftMonth], compareLeftRegions, true);
    updateRegionList(gridCache[rightMonth], compareRightRegions, true);
    compareRegionExit.style("display", compareFocusedRegion ? "block" : "none");
    const hint = compareFocusedRegion ? `${compareFocusedRegion} focus · click × to exit` : "Click a region box to zoom both maps";
    compareLeftHover.text(hint);
    compareRightHover.text(hint);
  }

  function focusCompareRegion(regionName) {
    if (!regionName || !REGIONS[regionName]) return;
    compareFocusedRegion = regionName;
    updateCompareView();
  }

  function clearCompareRegionFocus() {
    compareFocusedRegion = null;
    updateCompareView();
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
        hideSummaryStatsBtn();
      }
      storyMode = false;
      sliderLocked = false;
      updateCompareView();
    } else {
      compareFocusedRegion = null;
      compareRegionExit.style("display", "none");
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

    // PERF: use pre-computed pixel coords
    for (const { name, x1, x2, y1, y2 } of REGION_PIXEL_COORDS) {
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
    // PERF: use pre-computed pixel coords
    for (const { name, x1, x2, y1, y2 } of REGION_PIXEL_COORDS) {
      if (dataX >= x1 && dataX <= x2 && dataY >= y1 && dataY <= y2)
        return { name, x1, x2, y1, y2 };
    }
    return null;
  }

  // ── Zoom to a named region ─────────────────────────────────────────────────
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
    const r = getCanvasRect();
    const [dx, dy] = canvasToData(e.clientX - r.left, e.clientY - r.top);
    selStartPx = { x: dx, y: dy };
    selCurPx = { x: dx, y: dy };
    isDrawing = true;
    selDataRect = null;
    document.getElementById("ndvi-avg").style.display = "none";
    hideSummaryStatsBtn();
  });

  canvas.addEventListener("mousemove", e => {
    if (selectionMode && isDrawing) {
      const r = getCanvasRect();
      const [dx, dy] = canvasToData(e.clientX - r.left, e.clientY - r.top);
      selCurPx = { x: dx, y: dy };
      scheduleRedraw(); // PERF: RAF-guarded instead of direct redraw
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
      hideSummaryStatsBtn();
      return;
    }
    selDataRect = {
      x1: Math.min(selStartPx.x, selCurPx.x),
      y1: Math.min(selStartPx.y, selCurPx.y),
      x2: Math.max(selStartPx.x, selCurPx.x),
      y2: Math.max(selStartPx.y, selCurPx.y)
    };
    computeAndShowAverage();
    showSummaryStatsBtn();
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

  // ── Summary stats button ───────────────────────────────────────────────────
  function showSummaryStatsBtn() {
    let btn = document.getElementById("btn-summary-stats");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btn-summary-stats";
      btn.textContent = "📈 Summary stats";
      Object.assign(btn.style, {
        fontFamily: "var(--mono)",
        fontSize: ".72rem",
        letterSpacing: ".06em",
        textTransform: "uppercase",
        background: "var(--accent)",
        color: "#fff",
        border: "none",
        padding: ".4rem .9rem",
        cursor: "pointer",
        borderRadius: "2px",
        transition: "opacity .2s",
      });
      btn.addEventListener("click", openSummaryStatsModal);
      const toggleSelectBtn = document.getElementById("toggle-select");
      toggleSelectBtn.parentNode.insertBefore(btn, toggleSelectBtn.nextSibling);
    }
    btn.style.display = "inline-block";
  }

  function hideSummaryStatsBtn() {
    const btn = document.getElementById("btn-summary-stats");
    if (btn) btn.style.display = "none";
  }

  // ── Summary stats modal ────────────────────────────────────────────────────
  function buildYearlyData(rect) {
    const yearMap = {};
    for (const ym of months) {
      const grid = gridCache[ym];
      if (!grid) continue;
      const val = meanForDataRect(grid, rect);
      if (val === null) continue;
      const year = parseInt(ym.split("-")[0]);
      if (!yearMap[year]) yearMap[year] = [];
      yearMap[year].push(val);
    }
    return Object.entries(yearMap).map(([year, vals]) => ({
      year: +year,
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => a.year - b.year);
  }

  function buildMonthlyData(rect) {
    return months.map(ym => {
      const grid = gridCache[ym];
      const val = grid ? meanForDataRect(grid, rect) : null;
      const [y, m] = ym.split("-").map(Number);
      return { date: new Date(y, m - 1, 1), value: val };
    }).filter(d => d.value !== null);
  }

  function openSummaryStatsModal() {
    if (!selDataRect || !cacheReady) return;

    const existing = document.getElementById("stats-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "stats-modal-overlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0",
      background: "rgba(26,26,24,0.72)",
      zIndex: "500", display: "flex",
      alignItems: "center", justifyContent: "center",
      padding: "1.5rem", backdropFilter: "blur(3px)",
    });

    const modal = document.createElement("div");
    Object.assign(modal.style, {
      background: "var(--paper)", border: "1px solid var(--rule)",
      borderRadius: "6px", width: "min(860px, 100%)",
      maxHeight: "90vh", display: "flex",
      flexDirection: "column", overflow: "hidden",
      boxShadow: "0 8px 40px rgba(0,0,0,0.28)",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: ".7rem 1.1rem", borderBottom: "1px solid var(--rule)",
      background: "var(--paper-2)", display: "flex",
      alignItems: "center", justifyContent: "space-between", flexShrink: "0",
    });
    header.innerHTML = `<div><span style="font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);">Selected Region · NDVI Time Series</span></div>`;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    Object.assign(closeBtn.style, {
      fontFamily: "var(--mono)", fontSize: "1.1rem", lineHeight: "1",
      background: "transparent", border: "1px solid var(--rule)",
      color: "var(--ink-light)", width: "28px", height: "28px",
      cursor: "pointer", borderRadius: "2px", display: "flex",
      alignItems: "center", justifyContent: "center",
    });
    closeBtn.addEventListener("click", () => overlay.remove());
    header.appendChild(closeBtn);

    const tabBar = document.createElement("div");
    Object.assign(tabBar.style, {
      padding: ".45rem 1.1rem 0", borderBottom: "1px solid var(--rule)",
      display: "flex", gap: "0", background: "var(--paper)", flexShrink: "0",
    });

    const tabBtnStyle = (active) => ({
      fontFamily: "var(--mono)", fontSize: ".7rem", letterSpacing: ".08em",
      textTransform: "uppercase", background: "transparent", border: "none",
      borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
      color: active ? "var(--accent)" : "var(--ink-faint)",
      padding: ".4rem .9rem", cursor: "pointer", marginBottom: "-1px",
      transition: "color .2s, border-color .2s",
    });

    const tabYearly = document.createElement("button");
    tabYearly.textContent = "Yearly averages";
    const tabMonthly = document.createElement("button");
    tabMonthly.textContent = "Monthly series";
    Object.assign(tabYearly.style, tabBtnStyle(true));
    Object.assign(tabMonthly.style, tabBtnStyle(false));
    tabBar.appendChild(tabYearly);
    tabBar.appendChild(tabMonthly);

    const chartContainer = document.createElement("div");
    Object.assign(chartContainer.style, {
      flex: "1", minHeight: "0", padding: "1.5rem 1.5rem 1rem", overflowY: "auto",
    });

    const statsRow = document.createElement("div");
    Object.assign(statsRow.style, {
      padding: ".5rem 1.5rem .7rem", borderTop: "1px solid var(--rule)",
      display: "flex", gap: "2rem", flexWrap: "wrap",
      background: "var(--paper-2)", flexShrink: "0",
    });

    modal.appendChild(header);
    modal.appendChild(tabBar);
    modal.appendChild(chartContainer);
    modal.appendChild(statsRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

    const yearlyData = buildYearlyData(selDataRect);
    const monthlyData = buildMonthlyData(selDataRect);

    function decimalYear(date) {
      const start = new Date(date.getFullYear(), 0, 1);
      const next = new Date(date.getFullYear() + 1, 0, 1);
      return date.getFullYear() + (date - start) / (next - start);
    }

    function normalCdf(x) {
      // Abramowitz-Stegun erf approximation, enough for the stats label here.
      const sign = x < 0 ? -1 : 1;
      const z = Math.abs(x) / Math.sqrt(2);
      const t = 1 / (1 + 0.3275911 * z);
      const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
      const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z));
      return 0.5 * (1 + erf);
    }

    function regressionStats(data) {
      const points = data.map((d, i) => {
        const y = d.value ?? d.mean;
        let x = i;
        if (d.year != null) x = +d.year;
        else if (d.date instanceof Date) x = decimalYear(d.date);
        return { x, y };
      }).filter(d => Number.isFinite(d.x) && Number.isFinite(d.y));

      if (points.length < 3) return null;

      const n = points.length;
      const xMean = d3.mean(points, d => d.x);
      const yMean = d3.mean(points, d => d.y);
      const sxx = d3.sum(points, d => (d.x - xMean) ** 2);
      if (sxx === 0) return null;

      const slope = d3.sum(points, d => (d.x - xMean) * (d.y - yMean)) / sxx;
      const intercept = yMean - slope * xMean;
      const sse = d3.sum(points, d => (d.y - (intercept + slope * d.x)) ** 2);
      const df = n - 2;
      const mse = sse / df;
      const seSlope = Math.sqrt(mse / sxx);
      const t = seSlope === 0 ? Infinity : slope / seSlope;

      // Two-sided p-value using a normal approximation; with monthly data n is large,
      // and with yearly data this is close enough for an exploratory UI label.
      const pApprox = 2 * (1 - normalCdf(Math.abs(t)));
      return { slope, t, pApprox, significant: pApprox < 0.05 };
    }

    function renderStats(data) {
      const vals = data.map(d => d.value ?? d.mean).filter(v => v != null);
      if (!vals.length) { statsRow.innerHTML = ""; return; }
      const mn = d3.min(vals), mx = d3.max(vals), avg = d3.mean(vals);
      const reg = regressionStats(data);
      const slope = reg ? reg.slope : null;
      const trendDir = !reg ? "—" : slope > 0.0001 ? "↑ Increasing" : slope < -0.0001 ? "↓ Decreasing" : "→ Stable";
      const sigText = !reg ? "—" : reg.significant ? "Yes, p < 0.05" : "No, p ≥ 0.05";
      statsRow.innerHTML = [
        ["Min", mn.toFixed(4)],
        ["Max", mx.toFixed(4)],
        ["Mean", avg.toFixed(4)],
        ["Range", (mx - mn).toFixed(4)],
        ["Slope", slope === null ? "—" : `${slope.toExponential(3)} NDVI/year`],
        ["Significant?", sigText],
        ["Trend", trendDir],
      ].map(([label, val]) => `
        <div>
          <div style="font-family:var(--mono);font-size:.62rem;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:.15rem;">${label}</div>
          <div style="font-family:var(--mono);font-size:.82rem;color:var(--ink);font-weight:500;">${val}</div>
        </div>
      `).join("");
    }

    function renderYearlyChart() {
      chartContainer.innerHTML = "";
      if (!yearlyData.length) {
        chartContainer.innerHTML = `<p style="font-family:var(--mono);font-size:.8rem;color:var(--ink-faint);text-align:center;padding:3rem;">No data available for selection.</p>`;
        return;
      }
      const W = chartContainer.clientWidth - 20 || 780;
      const H = 320;
      const margin = { top: 24, right: 28, bottom: 44, left: 52 };
      const iW = W - margin.left - margin.right;
      const iH = H - margin.top - margin.bottom;
      const svg = d3.select(chartContainer).append("svg")
        .attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const xScale = d3.scaleBand().domain(yearlyData.map(d => d.year)).range([0, iW]).padding(0.25);
      const yExtent = d3.extent(yearlyData, d => d.mean);
      const yPad = (yExtent[1] - yExtent[0]) * 0.12 || 0.02;
      const yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([iH, 0]).nice();
      g.append("g").call(d3.axisLeft(yScale).tickSize(-iW).tickFormat(""))
        .selectAll("line").style("stroke", "var(--rule)").style("stroke-dasharray", "3,3");
      g.select(".domain").remove();
      const trendLine = d3.line().x(d => xScale(d.year) + xScale.bandwidth() / 2).y(d => yScale(d.mean));
      const xs2 = yearlyData.map((_, i) => i), ys2 = yearlyData.map(d => d.mean);
      const xM = d3.mean(xs2), yM = d3.mean(ys2);
      const sl = d3.sum(xs2.map((x, i) => (x - xM) * (ys2[i] - yM))) / d3.sum(xs2.map(x => (x - xM) ** 2));
      const ic = yM - sl * xM;
      const trendData = yearlyData.map((d, i) => ({ year: d.year, mean: ic + sl * i }));
      g.append("path").datum(trendData).attr("fill", "none")
        .attr("stroke", "var(--accent-3)").attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "5,4").attr("opacity", 0.7).attr("d", trendLine);

      const tooltip = d3.select(chartContainer).append("div")
        .style("position", "absolute").style("background", "rgba(255,255,255,0.97)")
        .style("border", "1px solid var(--rule)").style("border-radius", "3px")
        .style("padding", ".4rem .65rem").style("font-family", "var(--mono)")
        .style("font-size", ".72rem").style("color", "var(--ink)")
        .style("pointer-events", "none").style("box-shadow", "0 2px 8px rgba(0,0,0,0.1)")
        .style("opacity", 0).style("z-index", "10");

      g.selectAll(".bar").data(yearlyData).join("rect").attr("class", "bar")
        .attr("x", d => xScale(d.year)).attr("width", xScale.bandwidth())
        .attr("y", d => yScale(d.mean)).attr("height", d => iH - yScale(d.mean))
        .attr("fill", "var(--accent)").attr("opacity", 0.75).attr("rx", 1)
        .on("mouseover", function(event, d) {
          d3.select(this).attr("opacity", 1);
          tooltip.style("opacity", 1).html(`<strong>${d.year}</strong><br/>Mean NDVI: ${d.mean.toFixed(4)}`);
        })
        .on("mousemove", function(event) {
          const r = chartContainer.getBoundingClientRect();
          tooltip.style("left", (event.clientX - r.left + 10) + "px").style("top", (event.clientY - r.top - 28) + "px");
        })
        .on("mouseleave", function() { d3.select(this).attr("opacity", 0.75); tooltip.style("opacity", 0); });

      g.append("g").attr("transform", `translate(0,${iH})`).call(
        d3.axisBottom(xScale).tickValues(yearlyData.filter((_, i) => i % 3 === 0).map(d => d.year))
      ).selectAll("text").style("font-family", "var(--mono)").style("font-size", "10px").style("fill", "var(--ink-faint)");
      g.append("g").call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".3f")))
        .selectAll("text").style("font-family", "var(--mono)").style("font-size", "10px").style("fill", "var(--ink-faint)");
      g.selectAll(".domain").style("stroke", "var(--rule)");
      g.append("text").attr("transform", `translate(${iW / 2},${iH + 36})`).attr("text-anchor", "middle")
        .style("font-family", "var(--mono)").style("font-size", "10px").style("fill", "var(--ink-faint)").text("Year");
      g.append("text").attr("transform", "rotate(-90)").attr("x", -iH / 2).attr("y", -40)
        .attr("text-anchor", "middle").style("font-family", "var(--mono)").style("font-size", "10px")
        .style("fill", "var(--ink-faint)").text("Mean NDVI (vegetation proxy)");
      const leg = g.append("g").attr("transform", `translate(${iW - 140}, 2)`);
      leg.append("line").attr("x1", 0).attr("x2", 18).attr("y1", 6).attr("y2", 6)
        .attr("stroke", "var(--accent-3)").attr("stroke-width", 1.5).attr("stroke-dasharray", "5,4").attr("opacity", 0.8);
      leg.append("text").attr("x", 22).attr("y", 10)
        .style("font-family", "var(--mono)").style("font-size", "9.5px").style("fill", "var(--ink-faint)").text("Linear trend");
      renderStats(yearlyData);
    }

    function renderMonthlyChart() {
      chartContainer.innerHTML = "";
      if (!monthlyData.length) {
        chartContainer.innerHTML = `<p style="font-family:var(--mono);font-size:.8rem;color:var(--ink-faint);text-align:center;padding:3rem;">No data available for selection.</p>`;
        return;
      }
      const W = chartContainer.clientWidth - 20 || 780;
      const H = 320;
      const margin = { top: 24, right: 28, bottom: 48, left: 52 };
      const iW = W - margin.left - margin.right;
      const iH = H - margin.top - margin.bottom;
      const svg = d3.select(chartContainer).append("svg")
        .attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const xScale = d3.scaleTime().domain(d3.extent(monthlyData, d => d.date)).range([0, iW]);
      const yExtent = d3.extent(monthlyData, d => d.value);
      const yPad = (yExtent[1] - yExtent[0]) * 0.10 || 0.02;
      const yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([iH, 0]).nice();
      g.append("g").call(d3.axisLeft(yScale).tickSize(-iW).tickFormat(""))
        .selectAll("line").style("stroke", "var(--rule)").style("stroke-dasharray", "3,3");
      const area = d3.area().x(d => xScale(d.date)).y0(iH).y1(d => yScale(d.value)).curve(d3.curveMonotoneX);
      g.append("path").datum(monthlyData).attr("fill", "var(--accent)").attr("opacity", 0.12).attr("d", area);
      const line = d3.line().x(d => xScale(d.date)).y(d => yScale(d.value)).curve(d3.curveMonotoneX);
      g.append("path").datum(monthlyData).attr("fill", "none").attr("stroke", "var(--accent)").attr("stroke-width", 1.5).attr("d", line);
      const bisect = d3.bisector(d => d.date).left;
      const focusDot = g.append("circle").attr("r", 4).attr("fill", "var(--accent)").style("opacity", 0);
      const tooltip = d3.select(chartContainer).append("div")
        .style("position", "absolute").style("background", "rgba(255,255,255,0.97)")
        .style("border", "1px solid var(--rule)").style("border-radius", "3px")
        .style("padding", ".4rem .65rem").style("font-family", "var(--mono)")
        .style("font-size", ".72rem").style("color", "var(--ink)")
        .style("pointer-events", "none").style("box-shadow", "0 2px 8px rgba(0,0,0,0.1)")
        .style("opacity", 0).style("z-index", "10");
      svg.append("rect").attr("transform", `translate(${margin.left},${margin.top})`)
        .attr("width", iW).attr("height", iH).attr("fill", "transparent")
        .on("mousemove", function(event) {
          const [mx] = d3.pointer(event);
          const x0 = xScale.invert(mx);
          const idx = bisect(monthlyData, x0, 1);
          const d0 = monthlyData[idx - 1], d1 = monthlyData[idx];
          const d = d1 && (x0 - d0.date > d1.date - x0) ? d1 : d0;
          if (!d) return;
          focusDot.style("opacity", 1).attr("cx", xScale(d.date)).attr("cy", yScale(d.value));
          const ym = `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, "0")}`;
          const cr = chartContainer.getBoundingClientRect();
          tooltip.style("opacity", 1).html(`<strong>${ym}</strong><br/>NDVI: ${d.value.toFixed(4)}`)
            .style("left", (event.clientX - cr.left + 12) + "px").style("top", (event.clientY - cr.top - 30) + "px");
        })
        .on("mouseleave", () => { focusDot.style("opacity", 0); tooltip.style("opacity", 0); });
      g.append("g").attr("transform", `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(d3.timeYear.every(2)))
        .selectAll("text").style("font-family", "var(--mono)").style("font-size", "10px").style("fill", "var(--ink-faint)");
      g.append("g").call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".3f")))
        .selectAll("text").style("font-family", "var(--mono)").style("font-size", "10px").style("fill", "var(--ink-faint)");
      g.selectAll(".domain").style("stroke", "var(--rule)");
      g.append("text").attr("transform", `translate(${iW / 2},${iH + 38})`).attr("text-anchor", "middle")
        .style("font-family", "var(--mono)").style("font-size", "10px").style("fill", "var(--ink-faint)").text("Month");
      g.append("text").attr("transform", "rotate(-90)").attr("x", -iH / 2).attr("y", -40)
        .attr("text-anchor", "middle").style("font-family", "var(--mono)").style("font-size", "10px")
        .style("fill", "var(--ink-faint)").text("Mean NDVI (vegetation proxy)");
      renderStats(monthlyData);
    }

    tabYearly.addEventListener("click", () => {
      Object.assign(tabYearly.style, tabBtnStyle(true));
      Object.assign(tabMonthly.style, tabBtnStyle(false));
      renderYearlyChart();
    });
    tabMonthly.addEventListener("click", () => {
      Object.assign(tabMonthly.style, tabBtnStyle(true));
      Object.assign(tabYearly.style, tabBtnStyle(false));
      renderMonthlyChart();
    });

    renderYearlyChart();
  }

  // ── Toggle-select button ───────────────────────────────────────────────────
  document.getElementById("toggle-select").addEventListener("click", () => {
    selectionMode = !selectionMode;
    const btn = document.getElementById("toggle-select");
    btn.textContent = selectionMode ? "✕ Cancel selection" : "⬚ Highlight region";
    btn.classList.toggle("active", selectionMode);
    canvas.style.cursor = selectionMode ? "crosshair" : "default";
    if (!selectionMode) {
      selStartPx = selCurPx = selDataRect = null;
      document.getElementById("ndvi-avg").style.display = "none";
      hideSummaryStatsBtn();
      redraw();
    }
  });

  // ── Click-to-zoom ──────────────────────────────────────────────────────────
  canvas.addEventListener("click", e => {
    if (selectionMode) return;
    if (storyMode) { storyMode = false; sliderLocked = false; }
    const r = getCanvasRect();
    const [dataX, dataY] = canvasToData(e.clientX - r.left, e.clientY - r.top);
    const hit = regionAt(dataX, dataY);
    if (!hit) { storyMode = false; sliderLocked = false; zoomToFull(); return; }
    zoomToRegion(hit.name).then(() => playTimeline(hit.name));
  });

  // ── Hover logic ────────────────────────────────────────────────────────────
  function updateHoverFromMouse() {
    if (!currentGrid || lastMouseX === null) return;
    const r = getCanvasRect();
    const [dataX, dataY] = canvasToData(lastMouseX - r.left, lastMouseY - r.top);
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

  // ── Preload — batched fetches ──────────────────────────────────────────────
  async function preloadAll() {
    title.text("Loading data…");

    // PERF: fetch in batches of 8 to avoid saturating the browser's connection pool
    const BATCH = 8;
    for (let i = 0; i < months.length; i += BATCH) {
      await Promise.all(months.slice(i, i + BATCH).map(async ym => {
        try { gridCache[ym] = await d3.json(`ndvi_json/${ym}.json`); }
        catch { gridCache[ym] = null; }
      }));
    }

    cacheReady = true;
    title.text(`NDVI — ${months[0]}`);
    populateCompareSelects();
    update();
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
      "Midwest":         [{ y: 2014, m: 3,  msg: "Lowest vegetation score recorded for the Midwest, 2000–2025" }, { y: 2025, m: 8, msg: "The Midwest's greatest outlier month: vegetation proxy 0.376 above the regional mean" }],
      "Amazon":          [{ y: 2024, m: 9,  msg: "Lowest vegetation score recorded in the Amazon region" }],
      "Western US":      [{ y: 2008, m: 1,  msg: "Lowest vegetation score recorded in the Western US" }],
      "Central America": [{ y: 2024, m: 10, msg: "Highest vegetation score recorded for any region!" }, { y: 2009, m: 4, msg: "Lowest vegetation score recorded for Central America" }],
      "Andes":           [{ y: 2003, m: 2,  msg: "Lowest vegetation score recorded in the Andes" }],
      "Canada/Arctic":   [{ y: 2012, m: 12, msg: "Lowest score recorded for any region across the full 25-year dataset!" }, { y: 2021, m: 11, msg: "Greatest month-over-month increase in vegetation score across the dataset" }, { y: 2011, m: 4, msg: "Greatest month-over-month decrease in vegetation score across the dataset" }],
    };
    const rules = interesting[regionName] || [];
    return rules.find(r => r.y === year && r.m === month) || null;
  }

  // ── Popup ──────────────────────────────────────────────────────────────────
  function getRegionScreenRect(region) {
    const canvasR = canvas.getBoundingClientRect();
    const containerRect = document.getElementById("viz-container").getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / canvasR.width, scaleY = CANVAS_HEIGHT / canvasR.height;
    const [sx1, sy1] = currentTransform.apply([region.x1, region.y1]);
    const [sx2, sy2] = currentTransform.apply([region.x2, region.y2]);
    return {
      left:   sx1 / scaleX + (canvasR.left - containerRect.left),
      top:    sy1 / scaleY + (canvasR.top  - containerRect.top),
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
    .style("left", rect.left + 10 + "px").style("top", rect.top + 10 + "px")
    .style("max-width", Math.min(rect.width - 24, 300) + "px")
    .style("transform", "none").style("opacity", 1);
    setTimeout(() => box.transition().duration(800).style("opacity", 0), displayMs);
  }

  // ── Slider & compare controls ──────────────────────────────────────────────
  slider.on("input", () => { if (!sliderLocked) update(); });
  toggleCompare.on("click", () => setCompareMode(!compareMode));
  compareRightSelect.on("change", updateCompareView);
  compareRegionExit.on("click", clearCompareRegionFocus);

  compareLeftCanvas.addEventListener("mousemove",  e => updateCompareHover(e, "left"));
  compareRightCanvas.addEventListener("mousemove", e => updateCompareHover(e, "right"));
  compareLeftCanvas.addEventListener("click", e => {
    const point = compareCanvasPointToData(e, compareLeftCanvas);
    const hit = regionAt(point.dataX, point.dataY);
    if (hit) focusCompareRegion(hit.name);
  });
  compareRightCanvas.addEventListener("click", e => {
    const point = compareCanvasPointToData(e, compareRightCanvas);
    const hit = regionAt(point.dataX, point.dataY);
    if (hit) focusCompareRegion(hit.name);
  });
  compareLeftCanvas.addEventListener("mouseleave",  () => compareLeftHover.text(compareFocusedRegion ? `${compareFocusedRegion} focus · click × to exit` : "Click a region box to zoom both maps"));
  compareRightCanvas.addEventListener("mouseleave", () => compareRightHover.text(compareFocusedRegion ? `${compareFocusedRegion} focus · click × to exit` : "Click a region box to zoom both maps"));

  // ══════════════════════════════════════════════════════════════════════════
  //  SCROLLAMA
  // ══════════════════════════════════════════════════════════════════════════
  function switchGraphicPanel(panelId) {
    if (!panelId) return;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const inner = panel.closest(".scroll-graphic__inner");
    if (!inner) return;
    inner.querySelectorAll(".graphic-panel").forEach(p => p.classList.remove("visible"));
    panel.classList.add("visible");
  }

  const STEP_ACTIONS = {
    "1-1": { graphicPanel: "panel-ndvi-map",         label: "MODIS NDVI · Americas · Jul 2024 · NASA GIBS" },
    "1-2": { graphicPanel: "panel-ndvi-map",         label: "MODIS NDVI · Americas · Jul 2024 · NASA GIBS" },
    "1-3": { graphicPanel: "panel-ndvi-map",         label: "MODIS NDVI · Americas · Jul 2024 · NASA GIBS" },
    "2-1": { graphicPanel: "panel-regional-trends",  label: "Regional NDVI trend slope · all regions positive" },
    "2-2": { graphicPanel: "panel-regional-trends",  label: "Regional NDVI trend slope · 4 significant, 2 uncertain" },
    "2-3": { graphicPanel: "panel-regional-trends",  label: "Regional NDVI trend slope · drivers of greening" },
    "2-4": { graphicPanel: "panel-amazon-comp",      label: "Amazon vs Canada/Arctic · diverging trends 2000–2025" },
    "3-1": { graphicPanel: "panel-amazon-photo",     label: "Amazon basin · dense canopy snapshot" },
    "3-2": { graphicPanel: "panel-amazon-photo",     label: "Amazon basin · density vs. momentum" },
  };

  function handleStepEnter({ element }) {
    const stepId = element.dataset.step;
    activeScrollStep = stepId;
    const action = STEP_ACTIONS[stepId];
    if (!action) return;
    if (action.graphicPanel) switchGraphicPanel(action.graphicPanel);
    const sectionNum = stepId.split("-")[0];
    const labelEl = document.getElementById(`graphic-label-${sectionNum}`);
    if (labelEl && action.label) labelEl.textContent = action.label;
    document.querySelectorAll(".step.is-active").forEach(el => el.classList.remove("is-active"));
    element.classList.add("is-active");
  }

  let ch4EntryZoomDone = false;

  function initScrollamaSteps() {
    const scroller = scrollama();
    scroller.setup({ step: ".step", offset: 0.55, debug: false })
      .onStepEnter(handleStepEnter)
      .onStepExit(() => {});
    window.addEventListener("resize", scroller.resize);
  }

  // ── Kick everything off ────────────────────────────────────────────────────
  preloadAll().catch(console.error);
  initScrollamaSteps();

  const firstStep = document.querySelector(".step");
  if (firstStep) firstStep.classList.add("is-active");
});