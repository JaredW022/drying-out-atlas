# 🌵 Drying Out Atlas

> An interactive data story about drought, vegetation stress, and changing plant life across the Americas.

Satellite data can make the planet look like it's simply getting greener. But greenness alone doesn't tell the whole story. A region can look lush from space and still be losing resilience. A forest can stay dense while its long-term growth quietly slows. A dry region can show temporary gains that drought keeps erasing.

This project explores where vegetation is changing, where drought pressure is showing up, and why the Amazon's slow growth matters even when it still looks green.

---

## 🌍 The Question

If much of the Americas appears to be getting greener, **where are drought and environmental stress still visible?**

The answer isn't the same everywhere. In the Western US, drought stress is direct and obvious. In Central America, vegetation follows the wet and dry seasons. In the Amazon, the concern is more subtle: the forest stays green, but its growth trend is weak compared to almost everywhere else.

> **A green map can still contain a drought story.**

---

## 🗺️ What's Inside

### Scrollytelling Homepage
Walks through the regional vegetation story using maps, charts, and side-by-side comparisons. It starts broad, then narrows toward the Amazon as the main focus.

### Quiz Game (`game.html`)
A short "drive the Americas" experience. A jeep moves from region to region. At each stop, you guess the main environmental pressure, then see a real photo, an explanation, and a trend chart. Making a guess first helps the data stick better than just reading a chart.

---

## 🌎 Regions Covered

| Region | Focus |
|---|---|
| **Western US** | Drought stress and long-term vegetation decline |
| **Central America** | Wet and dry season swings and climate sensitivity |
| **Amazon** | Slow growth despite staying green |
| **Andes** | Elevation, snowpack, and vegetation shifts |
| **Midwest** | Seasonal peaks driven by crops |
| **Canada / Arctic** | Vegetation change from warming temperatures |

---

## 🚀 Running Locally

This is a static site that reads local data files, so use a local server rather than opening the HTML file directly.

```bash
cd finall_project/drying-out-atlas
python3 -m http.server 8787
```

Then visit:

| Page | URL |
|---|---|
| Main story | http://localhost:8787/ |
| Quiz game | http://localhost:8787/game.html |

---

## 📁 File Guide

```
├── index.html              # Main story page
├── game.html               # Quiz game page
├── main.js                 # Homepage map, scroll, and comparison logic
├── js/
│   └── roadtrip-game.js    # Quiz logic, map movement, and charts
├── css/
│   ├── main.css            # Main site styles
│   ├── roadtrip-game.css   # Quiz styles
│   └── tokens.css          # Shared design tokens
├── data/
│   ├── monthly-by-year.json       # Monthly vegetation values by region and year
│   ├── region-year-treecover.json # Annual tree cover by region
│   ├── region-deviations.json     # Yearly deviations from regional averages
│   ├── pixel-distributions.json   # Distribution data for the main charts
│   └── processed/
│       └── region_trends.csv      # Annual values used in quiz charts
├── ndvi_json/              # Monthly map snapshots for the interactive map
├── quiz_assets/            # Region photos and quiz assets
└── quiz_data_notebook.ipynb  # Notebook used to prepare quiz data and assets
```

---

## 📊 Data

The site uses vegetation index data organized by region, year, and month. This makes it possible to compare long-term trends and seasonal patterns across very different places.

The quiz charts use trend lines to show whether each region's vegetation is growing, shrinking, or staying flat over time.

---

## 🛠️ Built With

- HTML / CSS / JavaScript
- [D3.js](https://d3js.org/)
- [TopoJSON](https://github.com/topojson/topojson)
- Processed vegetation index datasets

---

## 🎤 Presenting This Project

A good order for a live demo:

1. Start with the idea that a green-looking map can still hide drought
2. Show how different regions respond to dry conditions in different ways
3. Use the **Western US** as the clearest example of visible drought stress
4. Use the **Amazon** as the surprising one: still green, but growing slowly
5. End with the **quiz** so the audience can test what they picked up

---

## Why This Exists

This is a visual communication project, not a climate model. The goal is to take regional vegetation data and turn it into a story that's easy to follow and hard to forget. Drought is easy to miss when a map looks green. This project tries to make it visible.
