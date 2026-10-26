/* Spatial Plan Checker - Kota Jayapura
 * Libraries: Leaflet, Leaflet-Geoman, Turf.js 6.x, proj4js, shpjs, @tmcw/togeojson
 * Everything runs in the browser; no server needed (works on GitHub Pages).
 */
(function () {
  "use strict";

  /* =====================================================================
   * CONFIG  -  edit this block to match your own data
   * ===================================================================== */
  const CONFIG = {
    dataUrl: "data/rtrw_kotajayaoura.geojson",              // zoning polygons (WGS84 / EPSG:4326)
    center: [-2.55, 140.70],
    zoom: 12,

    // Attribute names are matched case-insensitively, first match wins.
    codeFields: ["kodkws", "kode_zona", "kodzon", "kdzona", "kode", "zona", "code", "kode_pola"],
    nameFields: ["namobj", "nama_zona", "namzon", "nama", "pola_ruang", "name", "ket", "remark"],

    // Zones whose code or name matches this pattern are flagged as restricted / protected.
    // (Production forest is NOT flagged; Hutan Lindung, Cagar Alam, mangrove, TWA, etc. are.)
    sensitivePattern: /cagar|lindung|mangrove|perlindungan setempat|taman wisata alam|badan air|konservasi|sempadan|suaka/i,

    // Overlay attributes stored on each zone polygon. A value other than noValue means the overlay applies.
    // Field meanings are my reading of the column names; please confirm against your data dictionary.
    overlays: [
      { field: "KRB_03",  label: "Disaster-prone area (KRB)" },
      { field: "KKOP_1",  label: "Flight operation safety zone (KKOP)" },
      { field: "KP2B_2",  label: "Sustainable food farmland (KP2B)" },
      { field: "CAGBUD",  label: "Cultural heritage (CAGBUD)" },
      { field: "RESAIR",  label: "Water resource / recharge (RESAIR)" },
      { field: "KSMPDN",  label: "KSMPDN overlay" },
      { field: "HANKAM",  label: "Defence & security (HANKAM)" },
      { field: "KKARST",  label: "Karst area (KKARST)" },
      { field: "PTBGMB",  label: "PTBGMB overlay" },
      { field: "MGRSAT",  label: "Wildlife migration (MGRSAT)" }
    ],
    overlayNoValue: /^(tidak ada|-|)$/i,

    // Popup on a zoning polygon: technical columns of the original RTRW file are hidden here
    // (matched case-insensitively). Everything else with a real value is shown.
    popupHide: ["objectid", "orde01", "orde02", "orde03", "orde04", "jnsrpr", "wadmpr", "wadmkk",
                "shape_length", "shape_area", "kodkws", "namobj"],
    popupLabels: { wadmkc: "District", remark: "Remark", luasha: "Area in data (ha)" },

    // Rough extent [minLon, minLat, maxLon, maxLat], only used to warn about swapped X/Y or wrong CRS.
    extent: [140.3, -3.0, 141.3, -2.2],

    // Projection used to compute areas in square meters (UTM 54S covers Jayapura).
    areaCRS: "+proj=utm +zone=54 +south +datum=WGS84 +units=m +no_defs",

    maxParcels: 50,        // max features analysed from one uploaded file
    minAreaM2: 0.01        // ignore intersection slivers smaller than this
  };

  /* Zone colours: first matching keyword wins, otherwise a colour is generated from the name. */
  const COLOR_RULES = [
    // combined zones (e.g. "Hutan Produksi Tetap/Kawasan Perumahan") match the first rule below
    [/cagar|konservasi|suaka/i,                         "#0b5d2a"],
    [/hutan lindung/i,                                  "#1e7b3a"],
    [/mangrove/i,                                       "#2a9d8f"],
    [/taman wisata alam/i,                              "#3f9c5a"],
    [/perlindungan setempat/i,                          "#7fbf9b"],
    [/rimba kota|taman kota|jalur hijau|ruang terbuka/i, "#6cc36c"],
    [/hutan produksi yang dapat dikonversi/i,           "#a9b86a"],
    [/hutan produksi/i,                                 "#7d8f4a"],
    [/badan air|sungai|danau|perairan/i,                "#4aa3df"],
    [/perikanan/i,                                      "#6fc3d9"],
    [/perumahan|permukiman/i,                           "#f6d743"],
    [/perdagangan|jasa|komersial/i,                     "#e8473f"],
    [/perkantoran|pemerintah/i,                         "#b5651d"],
    [/industri|pergudangan/i,                           "#9b59b6"],
    [/pembangkitan|infrastruktur/i,                     "#c39bd3"],
    [/tanaman pangan|pertanian|sawah/i,                 "#d9e36a"],
    [/hortikultura/i,                                   "#b7d968"],
    [/perkebunan/i,                                     "#8fbf4d"],
    [/peternakan/i,                                     "#c9a66b"],
    [/fasilitas umum|fasilitas sosial|pendidikan|kesehatan|peribadatan/i, "#f39c6b"],
    [/pariwisata/i,                                     "#ff8fb1"],
    [/pertahanan|keamanan/i,                            "#5d6d7e"],
    [/pemakaman/i,                                      "#a6a6a6"],
    [/badan jalan|transportasi|jalan|pelabuhan|bandara/i, "#8d9a9b"]
  ];

  /* =====================================================================
   * Helpers
   * ===================================================================== */
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d) => Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d == null ? 2 : d,
    maximumFractionDigits: d == null ? 2 : d
  });

  const UTM = {
    utm54: "+proj=utm +zone=54 +south +datum=WGS84 +units=m +no_defs",
    utm53: "+proj=utm +zone=53 +south +datum=WGS84 +units=m +no_defs"
  };
  const toUTMArea = proj4("EPSG:4326", CONFIG.areaCRS);
  const utmToLL = (key, x, y) => proj4(UTM[key], "EPSG:4326", [x, y]);

  function getProp(props, candidates) {
    if (!props) return "";
    const lower = {};
    Object.keys(props).forEach((k) => { lower[k.toLowerCase()] = k; });
    for (const c of candidates) {
      const k = lower[c.toLowerCase()];
      if (k && props[k] != null && String(props[k]).trim() !== "") return String(props[k]).trim();
    }
    return "";
  }

  /* the original file has non-breaking spaces / double spaces in text values; normalise them */
  function tidyProps(props) {
    const out = {};
    Object.keys(props || {}).forEach((k) => {
      const v = props[k];
      out[k] = typeof v === "string" ? v.replace(/[\s ]+/g, " ").trim() : v;
    });
    return out;
  }

  /* rows for the zone popup: hides technical columns, uses readable labels */
  function popupRows(props) {
    const hide = CONFIG.popupHide.map((s) => s.toLowerCase());
    const labels = {};
    CONFIG.overlays.forEach((o) => { labels[o.field.toLowerCase()] = o.label; });
    Object.keys(CONFIG.popupLabels).forEach((k) => { labels[k.toLowerCase()] = CONFIG.popupLabels[k]; });
    return Object.keys(props || {}).filter((k) => {
      const v = props[k];
      return hide.indexOf(k.toLowerCase()) < 0 && v != null && String(v) !== "" &&
        !CONFIG.overlayNoValue.test(String(v));
    }).map((k) => {
      const lk = k.toLowerCase();
      let v = props[k];
      if (lk === "luasha" && isFinite(v)) v = fmt(v, 2);
      return "<tr><td>" + esc(labels[lk] || k) + "</td><td>" + esc(v) + "</td></tr>";
    }).join("");
  }

  /* overlay attributes that apply to a zone polygon: [{label, value}] */
  function overlaysOf(props) {
    const out = [];
    CONFIG.overlays.forEach((o) => {
      const v = getProp(props, [o.field]);
      if (v && !CONFIG.overlayNoValue.test(v)) out.push({ label: o.label, value: v });
    });
    return out;
  }

  function zoneColor(code, name) {
    const text = name + " " + code;
    for (const [re, color] of COLOR_RULES) if (re.test(text)) return color;
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ",55%,58%)";
  }

  function toFeatures(gj) {
    if (!gj) return [];
    if (gj.type === "FeatureCollection") return gj.features || [];
    if (gj.type === "Feature") return [gj];
    if (gj.type === "GeometryCollection")
      return (gj.geometries || []).map((g) => ({ type: "Feature", properties: {}, geometry: g }));
    if (gj.type) return [{ type: "Feature", properties: {}, geometry: gj }];
    return [];
  }

  function mapCoords(coords, fn) {
    return typeof coords[0] === "number" ? fn(coords) : coords.map((c) => mapCoords(c, fn));
  }
  function firstCoord(geom) {
    let c = geom && geom.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return c;
  }
  function needsProjection(features) {
    for (const f of features) {
      const c = f && f.geometry && firstCoord(f.geometry);
      if (c && c.length >= 2) return Math.abs(c[0]) > 360 || Math.abs(c[1]) > 90;
    }
    return false;
  }
  function reprojectFeatures(features, key) {
    return features.map((f) => {
      if (!f || !f.geometry || !f.geometry.coordinates) return f;
      return {
        type: "Feature",
        properties: f.properties || {},
        geometry: {
          type: f.geometry.type,
          coordinates: mapCoords(f.geometry.coordinates, (c) => utmToLL(key, c[0], c[1]))
        }
      };
    });
  }

  const closeRing = (r) => {
    const a = r[0], b = r[r.length - 1];
    return a[0] === b[0] && a[1] === b[1] ? r : r.concat([a]);
  };
  const stripZ = (c) => [c[0], c[1]];

  /* returns a cleaned Polygon/MultiPolygon geometry, or null if invalid */
  function cleanPolygonGeometry(g) {
    const fixRings = (rings) => rings.map((r) => closeRing(mapCoords(r, stripZ)));
    let out;
    if (g.type === "Polygon") out = { type: "Polygon", coordinates: fixRings(g.coordinates) };
    else if (g.type === "MultiPolygon") out = { type: "MultiPolygon", coordinates: g.coordinates.map(fixRings) };
    else return null;
    const polys = out.type === "Polygon" ? [out.coordinates] : out.coordinates;
    for (const p of polys) for (const ring of p) if (ring.length < 4) return null;
    return out;
  }

  /* =====================================================================
   * Area (planar, in UTM meters) and geometry operations
   * ===================================================================== */
  function ringAreaUTM(ring) {
    const pts = ring.map((c) => toUTMArea.forward([c[0], c[1]]));
    const ox = pts[0][0], oy = pts[0][1];       // shift origin to keep numbers small
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const x1 = pts[i][0] - ox, y1 = pts[i][1] - oy;
      const x2 = pts[i + 1][0] - ox, y2 = pts[i + 1][1] - oy;
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s / 2);
  }
  function polygonAreaUTM(rings) {
    let a = ringAreaUTM(rings[0]);
    for (let i = 1; i < rings.length; i++) a -= ringAreaUTM(rings[i]);
    return Math.max(a, 0);
  }
  function geomAreaM2(g) {
    if (!g) return 0;
    if (g.type === "Polygon") return polygonAreaUTM(g.coordinates);
    if (g.type === "MultiPolygon") return g.coordinates.reduce((s, p) => s + polygonAreaUTM(p), 0);
    return 0;
  }

  function rawIntersect(a, b) {
    try { return turf.intersect(a, b); }                       // Turf 6.x
    catch (e) { return turf.intersect(turf.featureCollection([a, b])); }   // Turf 7.x
  }
  const INTERSECT_FAILED = { failed: true };
  function safeIntersect(a, b) {
    try { return rawIntersect(a, b); }
    catch (e1) {
      try { return rawIntersect(turf.buffer(a, 0), turf.buffer(b, 0)); }  // repair invalid rings
      catch (e2) { return INTERSECT_FAILED; }
    }
  }
  const bboxOverlap = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);

  /* =====================================================================
   * Map
   * ===================================================================== */
  // Canvas rendering keeps the map fast with thousands of polygons.
  const map = L.map("map", { preferCanvas: true }).setView(CONFIG.center, CONFIG.zoom);
  const baseLayers = {
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
    }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
    })
  };
  let currentBase = baseLayers.osm.addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  let zones = [];                         // {feature, code, name, bbox, color}
  const zoneByFeature = new WeakMap();
  let zoneLayer = null;
  let zoneOpacity = 0.5;

  const pieceGroup = L.featureGroup().addTo(map);    // coloured intersection pieces
  const parcelGroup = L.featureGroup().addTo(map);   // parcel outline / point
  let lastResults = [];

  /* =====================================================================
   * Load zoning data
   * ===================================================================== */
  function setStatus(text, kind) {
    const el = $("#dataStatus");
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
  }

  function showMsg(lines, kind) {
    const el = $("#msg");
    const arr = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    if (!arr.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.className = "msg" + (kind === "error" ? " error" : "");
    el.innerHTML = arr.map(esc).join("<br>");
    el.hidden = false;
  }

  function prepareZones(gj) {
    let feats = toFeatures(gj);
    let note = "";
    if (needsProjection(feats)) {
      feats = reprojectFeatures(feats, "utm54");
      note = " (data looked projected; assumed UTM 54S)";
    }
    zones = [];
    feats.forEach((f) => {
      if (!f || !f.geometry) return;
      const g = cleanPolygonGeometry(f.geometry);
      if (!g) return;
      const feature = { type: "Feature", properties: tidyProps(f.properties), geometry: g };
      const code = getProp(feature.properties, CONFIG.codeFields);
      const name = getProp(feature.properties, CONFIG.nameFields) || code || "Unnamed zone";
      const z = {
        feature: feature, code: code, name: name,
        bbox: turf.bbox(feature), color: zoneColor(code, name),
        sensitive: CONFIG.sensitivePattern.test(name + " " + code),
        overlays: overlaysOf(feature.properties)
      };
      zones.push(z);
      zoneByFeature.set(feature, z);
    });
    return note;
  }

  function drawZones() {
    if (zoneLayer) map.removeLayer(zoneLayer);
    zoneLayer = L.geoJSON(zones.map((z) => z.feature), {
      style: (f) => {
        const z = zoneByFeature.get(f);
        return { color: "#37474f", weight: 0.8, fillColor: z ? z.color : "#999", fillOpacity: zoneOpacity };
      },
      onEachFeature: (f, layer) => {
        const z = zoneByFeature.get(f);
        if (!z) return;
        // popup content is built only when clicked (keeps loading fast)
        layer.bindPopup(() => {
          const rows = popupRows(f.properties);
          return '<div class="zone-popup"><strong>' + esc(z.name) + "</strong>" +
            (z.code ? "<br>Code: " + esc(z.code) : "") +
            (rows ? "<table>" + rows + "</table>" : "") + "</div>";
        }, { maxWidth: 340 });
      }
    }).addTo(map);
    zoneLayer.bringToBack();
    if (zones.length) {
      const b = zoneLayer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.05));
    }
  }

  let legendControl = null;
  function drawLegend() {
    if (legendControl) map.removeControl(legendControl);
    const seen = new Map();
    zones.forEach((z) => { const k = z.code + "|" + z.name; if (!seen.has(k)) seen.set(k, z); });
    const items = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    legendControl = L.control({ position: "bottomright" });
    legendControl.onAdd = function () {
      // starts minimized; click the header to expand / collapse
      const div = L.DomUtil.create("div", "legend collapsed");
      div.innerHTML =
        '<button type="button" class="legend-toggle" aria-expanded="false">' +
        '<span>Zoning legend</span><span class="chev" aria-hidden="true">&#9650;</span></button>' +
        '<div class="legend-body">' + items.map((z) =>
          '<div><span class="sw" style="background:' + z.color + '"></span>' +
          esc(z.name) + (z.code ? " (" + esc(z.code) + ")" : "") + "</div>").join("") + "</div>";
      const toggle = div.querySelector(".legend-toggle");
      toggle.addEventListener("click", () => {
        const collapsed = div.classList.toggle("collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    legendControl.addTo(map);
  }

  /* downloads the (large) zoning file and shows how much has arrived */
  async function fetchTextWithProgress(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (!r.body || !r.body.getReader) return r.text();
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const res = await reader.read();
      if (res.done) break;
      chunks.push(res.value);
      got += res.value.length;
      setStatus("Loading zoning data… " + (got / 1048576).toFixed(1) + " MB");
    }
    return await new Blob(chunks).text();
  }
  const nextPaint = () => new Promise((res) => setTimeout(res, 30));

  async function loadZoning() {
    try {
      const gj = JSON.parse(await fetchTextWithProgress(CONFIG.dataUrl));
      setStatus("Preparing zoning data…");
      await nextPaint();
      const note = prepareZones(gj);
      if (!zones.length) throw new Error("no polygon features found");
      setStatus("Drawing map…");
      await nextPaint();
      drawZones();
      drawLegend();
      const types = new Set(zones.map((z) => z.code + "|" + z.name)).size;
      setStatus("Zoning loaded: " + zones.length + " polygons, " + types + " zone types" + note, "ok");
    } catch (err) {
      setStatus("Could not load " + CONFIG.dataUrl + " (" + err.message + ").", "error");
      showMsg("If you opened index.html directly from your disk, the browser blocks loading data files. " +
        "Run a local server (e.g. 'python -m http.server' in this folder) or publish on GitHub Pages.", "error");
    }
  }

  /* =====================================================================
   * Build analysis items from GeoJSON features
   * ===================================================================== */
  function buildItems(features, prefix) {
    const items = [];
    const notes = [];
    let skipped = 0;
    features.forEach((f) => {
      if (!f || !f.geometry) { skipped++; return; }
      const t = f.geometry.type;
      const props = f.properties || {};
      const label = () => getProp(props, ["name", "nama", "nama_persil", "id", "nib", "kode", "objectid"]) ||
        (prefix + " " + (items.length + 1));
      if (t === "Polygon" || t === "MultiPolygon") {
        const g = cleanPolygonGeometry(f.geometry);
        if (!g) { skipped++; return; }
        items.push({ kind: "polygon", name: label(), feature: { type: "Feature", properties: props, geometry: g } });
      } else if (t === "Point") {
        items.push({ kind: "point", name: label(), feature: turf.point(stripZ(f.geometry.coordinates), props) });
      } else if (t === "MultiPoint") {
        f.geometry.coordinates.forEach((c) => {
          items.push({ kind: "point", name: prefix + " " + (items.length + 1), feature: turf.point(stripZ(c), props) });
        });
      } else { skipped++; }
    });
    if (skipped) notes.push(skipped + " feature(s) were skipped (not a valid polygon or point).");
    return { items: items, notes: notes };
  }

  /* =====================================================================
   * Analysis
   * ===================================================================== */
  function polygonWarnings(item) {
    const w = [];
    try {
      const k = turf.kinks(item.feature);
      if (k.features.length) w.push(k.features.length + " self-intersection point(s) in the parcel outline; the result may be inaccurate.");
    } catch (e) { /* ignore */ }
    return w;
  }

  function outsideExtent(lon, lat) {
    const e = CONFIG.extent;
    return lon < e[0] || lon > e[2] || lat < e[1] || lat > e[3];
  }

  function analyzePolygon(item) {
    const parcel = item.feature;
    const pBbox = turf.bbox(parcel);
    const parcelArea = geomAreaM2(parcel.geometry);
    const warnings = polygonWarnings(item);
    const merged = new Map();
    const overlayMap = new Map();
    const failedZones = [];
    const pieces = [];
    let covered = 0;

    if (parcelArea <= 0) throw new Error("Parcel area is zero.");
    if (outsideExtent((pBbox[0] + pBbox[2]) / 2, (pBbox[1] + pBbox[3]) / 2)) {
      warnings.push("The parcel is outside the expected Jayapura extent. Check the coordinate order and CRS.");
    }

    zones.forEach((z) => {
      if (!bboxOverlap(pBbox, z.bbox)) return;
      const inter = safeIntersect(parcel, z.feature);
      if (inter === INTERSECT_FAILED) { failedZones.push(z.name); return; }
      if (!inter || !inter.geometry) return;
      const a = geomAreaM2(inter.geometry);
      if (a < CONFIG.minAreaM2) return;
      covered += a;
      pieces.push({ geometry: inter.geometry, color: z.color });
      const key = z.code + "|" + z.name;
      const row = merged.get(key) || { code: z.code, name: z.name, color: z.color, sensitive: z.sensitive, area: 0 };
      row.area += a;
      merged.set(key, row);
      z.overlays.forEach((o) => {
        const ok = o.label + "|" + o.value;
        const orow = overlayMap.get(ok) || { label: o.label, value: o.value, area: 0 };
        orow.area += a;
        overlayMap.set(ok, orow);
      });
    });

    const rows = Array.from(merged.values()).sort((a, b) => b.area - a.area);
    rows.forEach((r) => { r.pct = (r.area / parcelArea) * 100; });
    const overlays = Array.from(overlayMap.values()).sort((a, b) => b.area - a.area);
    overlays.forEach((o) => { o.pct = Math.min(100, (o.area / parcelArea) * 100); });

    let outside = Math.max(0, parcelArea - covered);
    if (outside / parcelArea < 0.0005) outside = 0;
    if (covered > parcelArea * 1.005) {
      warnings.push("Zoning polygons overlap each other in this area (data issue), so percentages add up to more than 100%.");
    }
    if (failedZones.length) warnings.push("The overlap with " + failedZones.length + " zone polygon(s) (" +
      Array.from(new Set(failedZones)).join(", ") + ") could not be computed because of a geometry problem; this result may be incomplete.");
    if (!rows.length) warnings.push("The parcel does not intersect any zoning polygon.");
    else if (outside > 0) warnings.push("About " + fmt((outside / parcelArea) * 100, 1) +
      "% of the parcel is outside the zoning data (no plan coverage).");

    const alerts = rows.filter((r) => r.sensitive).map((r) =>
      "Overlaps restricted / protected zone '" + r.name + "' (" + fmt(r.area) + " m\u00B2, " + fmt(r.pct, 1) +
      "%). Development may be limited.");

    return {
      kind: "polygon", name: item.name, areaM2: parcelArea, rows: rows, overlays: overlays,
      outsideM2: outside, warnings: warnings, alerts: alerts, pieces: pieces
    };
  }

  function analyzePoint(item) {
    const c = item.feature.geometry.coordinates;
    const warnings = [];
    if (outsideExtent(c[0], c[1])) warnings.push("This point is outside the expected Jayapura extent. Check the coordinate order and CRS.");
    const hits = [];
    zones.forEach((z) => {
      if (c[0] < z.bbox[0] || c[0] > z.bbox[2] || c[1] < z.bbox[1] || c[1] > z.bbox[3]) return;
      if (turf.booleanPointInPolygon(item.feature, z.feature)) hits.push(z);
    });
    if (!hits.length) warnings.push("No zoning polygon contains this point.");
    const alerts = hits.filter((z) => z.sensitive).map((z) =>
      "Located in restricted / protected zone '" + z.name + "'. Development may be limited.");
    const seen = new Set(), overlays = [];
    hits.forEach((z) => z.overlays.forEach((o) => {
      const k = o.label + "|" + o.value;
      if (!seen.has(k)) { seen.add(k); overlays.push(o); }
    }));
    return { kind: "point", name: item.name, lon: c[0], lat: c[1], zones: hits, overlays: overlays, warnings: warnings, alerts: alerts };
  }

  function analyzeItem(item) {
    try {
      return item.kind === "polygon" ? analyzePolygon(item) : analyzePoint(item);
    } catch (err) {
      return { kind: "error", name: item.name, error: err.message || String(err) };
    }
  }

  /* =====================================================================
   * Show results
   * ===================================================================== */
  function clearParcelLayers() {
    pieceGroup.clearLayers();
    parcelGroup.clearLayers();
  }

  function drawResultsOnMap(items, results) {
    clearParcelLayers();
    items.forEach((item, i) => {
      const r = results[i];
      if (r.kind === "polygon") {
        r.pieces.forEach((p) => {
          L.geoJSON({ type: "Feature", properties: {}, geometry: p.geometry }, {
            style: { color: "#111", weight: 1, fillColor: p.color, fillOpacity: 0.85 }, interactive: false
          }).addTo(pieceGroup);
        });
      }
      L.geoJSON(item.feature, {
        style: { color: "#d50000", weight: 3, dashArray: "7 4", fill: false },
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
          radius: 8, color: "#d50000", weight: 3, fillColor: "#fff", fillOpacity: 1
        })
      }).bindTooltip(esc(item.name)).addTo(parcelGroup);
    });
    parcelGroup.bringToFront();
    const b = parcelGroup.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.4), { maxZoom: 18 });
  }

  function renderPolygonCard(r) {
    let html = "<h3>" + esc(r.name) + "</h3>" +
      '<div class="meta">Parcel area: <strong>' + fmt(r.areaM2) + " m\u00B2</strong> (" + fmt(r.areaM2 / 10000, 4) + " ha)</div>";
    if (r.rows.length || r.outsideM2 > 0) {
      html += "<table><thead><tr><th>Code</th><th>Zone</th><th class='num'>m\u00B2</th><th class='num'>ha</th><th class='num'>%</th></tr></thead><tbody>";
      r.rows.forEach((x) => {
        html += "<tr" + (x.sensitive ? ' class="sens"' : "") + "><td>" + esc(x.code || "-") + "</td><td>" +
          '<span class="sw" style="background:' + x.color + '"></span>' + esc(x.name) +
          (x.sensitive ? ' <span class="flag" title="Restricted / protected zone">\u26A0</span>' : "") +
          "</td><td class='num'>" + fmt(x.area) + "</td><td class='num'>" + fmt(x.area / 10000, 4) +
          "</td><td class='num'>" + fmt(x.pct, 1) + "%</td></tr>";
      });
      if (r.outsideM2 > 0) {
        html += "<tr class='outside'><td>-</td><td>Outside zoning data</td><td class='num'>" + fmt(r.outsideM2) +
          "</td><td class='num'>" + fmt(r.outsideM2 / 10000, 4) + "</td><td class='num'>" +
          fmt((r.outsideM2 / r.areaM2) * 100, 1) + "%</td></tr>";
      }
      html += "</tbody></table>";
    }
    if (r.overlays && r.overlays.length) {
      html += '<div class="ov-title">Overlays &amp; constraints in this parcel</div><ul class="ov">';
      r.overlays.forEach((o) => {
        html += "<li><strong>" + esc(o.label) + ":</strong> " + esc(o.value) +
          " <span class='ov-area'>(" + fmt(o.area) + " m², " + fmt(o.pct, 1) + "%)</span></li>";
      });
      html += "</ul>";
    }
    html += notesList(r);
    return html;
  }

  function renderPointCard(r) {
    let html = "<h3>" + esc(r.name) + "</h3>" +
      '<div class="meta">Point: ' + r.lat.toFixed(6) + ", " + r.lon.toFixed(6) + " (lat, lon)</div>";
    r.zones.forEach((z) => {
      html += '<div class="zone-hit"><span class="sw" style="background:' + z.color + '"></span><strong>' +
        esc(z.name) + "</strong>" + (z.code ? " (" + esc(z.code) + ")" : "") +
        (z.sensitive ? ' <span class="flag">\u26A0</span>' : "") + "</div>";
    });
    if (r.overlays && r.overlays.length) {
      html += '<div class="ov-title">Overlays &amp; constraints at this point</div><ul class="ov">';
      r.overlays.forEach((o) => { html += "<li><strong>" + esc(o.label) + ":</strong> " + esc(o.value) + "</li>"; });
      html += "</ul>";
    }
    html += notesList(r);
    return html;
  }

  function notesList(r) {
    const li = [];
    (r.alerts || []).forEach((t) => li.push('<li class="alert">' + esc(t) + "</li>"));
    (r.warnings || []).forEach((t) => li.push('<li class="warn">' + esc(t) + "</li>"));
    return li.length ? "<ul>" + li.join("") + "</ul>" : "";
  }

  function renderResults(results) {
    const box = $("#results");
    box.innerHTML = "";
    results.forEach((r) => {
      const card = document.createElement("article");
      card.className = "card";
      if (r.kind === "polygon") card.innerHTML = renderPolygonCard(r);
      else if (r.kind === "point") card.innerHTML = renderPointCard(r);
      else card.innerHTML = "<h3>" + esc(r.name) + '</h3><ul><li class="alert">Could not analyse this feature: ' + esc(r.error) + "</li></ul>";
      box.appendChild(card);
    });
    $("#resultsWrap").hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function applyItems(items, notes) {
    notes = notes || [];
    if (!zones.length) { showMsg("Zoning data is not loaded, so the parcel cannot be checked.", "error"); return; }
    if (!items.length) {
      showMsg(notes.concat(["No polygon or point was found in the input."]), "error");
      return;
    }
    let list = items;
    if (list.length > CONFIG.maxParcels) {
      notes.push("Only the first " + CONFIG.maxParcels + " features were analysed.");
      list = list.slice(0, CONFIG.maxParcels);
    }
    const results = list.map(analyzeItem);
    lastResults = results;
    drawResultsOnMap(list, results);
    renderResults(results);
    showMsg(notes, "warn");
  }

  function clearAll() {
    clearParcelLayers();
    lastResults = [];
    $("#results").innerHTML = "";
    $("#resultsWrap").hidden = true;
    showMsg([]);
  }

  /* =====================================================================
   * Input 1: file upload
   * ===================================================================== */
  async function parseFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) {
      const res = await shp(await file.arrayBuffer());
      return Array.isArray(res) ? { type: "FeatureCollection", features: res.reduce((a, r) => a.concat(r.features), []) } : res;
    }
    const text = await file.text();
    if (name.endsWith(".kml")) {
      return toGeoJSON.kml(new DOMParser().parseFromString(text, "text/xml"));
    }
    return JSON.parse(text);
  }

  function itemsFromGeoJSON(gj, prefix) {
    let feats = toFeatures(gj);
    const notes = [];
    if (needsProjection(feats)) {
      const key = $("#uploadCrs").value;
      feats = reprojectFeatures(feats, key);
      notes.push("Coordinates looked projected (meters); converted from " + (key === "utm54" ? "UTM 54S" : "UTM 53S") + ".");
    }
    const built = buildItems(feats, prefix);
    return { items: built.items, notes: notes.concat(built.notes) };
  }

  async function handleFile(file) {
    if (!file) return;
    showMsg("Reading " + file.name + "...");
    try {
      const gj = await parseFile(file);
      const r = itemsFromGeoJSON(gj, "Parcel");
      applyItems(r.items, r.notes);
    } catch (err) {
      showMsg("Could not read this file: " + (err.message || err) +
        ". Supported: GeoJSON, KML, or a .zip Shapefile.", "error");
    }
  }

  const fileInput = $("#fileInput");
  fileInput.addEventListener("change", () => { handleFile(fileInput.files[0]); fileInput.value = ""; });
  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  /* =====================================================================
   * Input 0: current location (browser geolocation)
   * ===================================================================== */
  const locateBtn = $("#locateBtn");
  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showMsg("This browser does not support location. Use the Coordinates tab instead.", "error");
      return;
    }
    if (!window.isSecureContext) {
      showMsg("Location only works on a secure (https) page. GitHub Pages is https; opening the file from disk is not.", "error");
      return;
    }
    const label = locateBtn.innerHTML;
    locateBtn.disabled = true;
    locateBtn.textContent = "Getting your location…";
    showMsg("Waiting for your device to share its location. Please allow the permission request.");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false;
        locateBtn.innerHTML = label;
        const lon = pos.coords.longitude, lat = pos.coords.latitude, acc = pos.coords.accuracy || 0;
        const built = buildItems([turf.point([lon, lat])], "My location");
        built.items.forEach((it) => { it.name = "My current location"; });
        const notes = [];
        if (acc > 30) {
          notes.push("Location accuracy is about ±" + Math.round(acc) + " m. Near a zone boundary the result may be " +
            "wrong; for a precise answer use a GPS device or enter the parcel polygon.");
        }
        applyItems(built.items, notes);
        if (acc > 0) {
          const circle = L.circle([lat, lon], {
            radius: acc, color: "#1565c0", weight: 1, fillColor: "#1565c0", fillOpacity: 0.12, interactive: false
          }).addTo(parcelGroup);
          const b = circle.getBounds();
          if (b.isValid()) map.fitBounds(b.pad(0.6), { maxZoom: 18 });
        }
      },
      (err) => {
        locateBtn.disabled = false;
        locateBtn.innerHTML = label;
        const reasons = {
          1: "Location permission was denied. Allow location for this site in your browser settings and try again.",
          2: "Your device could not determine its location. Try again outdoors or enter coordinates manually.",
          3: "Getting the location took too long. Try again."
        };
        showMsg(reasons[err.code] || ("Could not get your location: " + err.message), "error");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

  /* =====================================================================
   * Input 2: coordinates table
   * ===================================================================== */
  const coordBody = $("#coordBody");

  function renumber() {
    $$("tr", coordBody).forEach((tr, i) => { $(".idx", tr).textContent = i + 1; });
  }
  function addRow(x, y) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="idx"></td>' +
      '<td><input type="text" inputmode="decimal" class="cx" autocomplete="off" value="' + esc(x || "") + '"></td>' +
      '<td><input type="text" inputmode="decimal" class="cy" autocomplete="off" value="' + esc(y || "") + '"></td>' +
      '<td><button type="button" class="icon rm" title="Remove point">&times;</button></td>';
    $(".rm", tr).addEventListener("click", () => { tr.remove(); renumber(); });
    coordBody.appendChild(tr);
    renumber();
  }
  function resetRows(n) {
    coordBody.innerHTML = "";
    for (let i = 0; i < n; i++) addRow("", "");
  }
  function updateCoordLabels() {
    const m = $("#coordMode").value;
    const labels = {
      lonlat: ["Longitude", "Latitude"],
      latlon: ["Latitude", "Longitude"],
      utm54: ["Easting (X)", "Northing (Y)"],
      utm53: ["Easting (X)", "Northing (Y)"]
    }[m];
    $("#thX").textContent = labels[0];
    $("#thY").textContent = labels[1];
  }

  function parseNumber(s) {
    const v = parseFloat(String(s).trim().replace(",", "."));
    return isFinite(v) ? v : NaN;
  }
  function splitLine(line) {
    line = line.trim();
    if (!line) return null;
    let parts = line.split(/[;\t]+|\s+/).filter(Boolean).map((p) => p.replace(/[,;]+$/, ""));
    if (parts.length === 1 && line.indexOf(",") >= 0) parts = line.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length >= 2 ? [parts[0], parts[1]] : null;
  }

  function rowToLonLat(mode, x, y) {
    if (mode === "lonlat") return [x, y];
    if (mode === "latlon") return [y, x];
    return utmToLL(mode, x, y);
  }

  function checkCoordinates() {
    const mode = $("#coordMode").value;
    const pts = [];
    let bad = 0;
    $$("tr", coordBody).forEach((tr) => {
      const xs = $(".cx", tr).value.trim();
      const ys = $(".cy", tr).value.trim();
      if (!xs && !ys) return;
      const x = parseNumber(xs), y = parseNumber(ys);
      if (isNaN(x) || isNaN(y)) { bad++; return; }
      pts.push(rowToLonLat(mode, x, y));
    });
    if (bad) { showMsg(bad + " row(s) contain a value that is not a number.", "error"); return; }
    if (pts.length === 0) { showMsg("Enter at least one coordinate.", "error"); return; }
    if (pts.length === 2) { showMsg("Two points make a line. Enter 1 point (zone lookup) or 3+ points (parcel polygon).", "error"); return; }
    for (const p of pts) {
      if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
        showMsg("A coordinate is out of range. Check the selected coordinate system and the X/Y order.", "error");
        return;
      }
    }
    const feature = pts.length === 1
      ? turf.point(pts[0])
      : { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [closeRing(pts)] } };
    const built = buildItems([feature], pts.length === 1 ? "Point" : "Parcel");
    applyItems(built.items, built.notes);
  }

  $("#coordMode").addEventListener("change", updateCoordLabels);
  $("#addRow").addEventListener("click", () => addRow("", ""));
  $("#clearRows").addEventListener("click", () => resetRows(3));
  $("#checkCoords").addEventListener("click", checkCoordinates);
  $("#fillRows").addEventListener("click", () => {
    const lines = $("#pasteBox").value.split(/\r?\n/).map(splitLine).filter(Boolean);
    if (!lines.length) { showMsg("Could not read any coordinate pairs from the pasted text.", "error"); return; }
    coordBody.innerHTML = "";
    lines.forEach((p) => addRow(p[0], p[1]));
    showMsg([]);
  });

  /* =====================================================================
   * Input 3: draw on the map (Leaflet-Geoman)
   * ===================================================================== */
  const hasDraw = !!(map.pm && map.pm.enableDraw);
  if (!hasDraw) $("#drawHint").hidden = false;

  $("#drawPoly").addEventListener("click", () => {
    if (!hasDraw) return;
    map.pm.disableDraw();
    map.pm.enableDraw("Polygon", { finishOn: null });
  });
  $("#drawPoint").addEventListener("click", () => {
    if (!hasDraw) return;
    map.pm.disableDraw();
    map.pm.enableDraw("Marker");
  });
  if (hasDraw) {
    map.on("pm:create", (e) => {
      const gj = e.layer.toGeoJSON();
      map.removeLayer(e.layer);       // we draw our own result layers
      const built = buildItems([gj], gj.geometry.type === "Point" ? "Point" : "Drawn parcel");
      applyItems(built.items, built.notes);
    });
  }

  /* =====================================================================
   * UI wiring
   * ===================================================================== */
  $$(".tab-btn").forEach((btn) => btn.addEventListener("click", () => {
    $$(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + btn.dataset.tab));
    if (hasDraw && btn.dataset.tab !== "draw") map.pm.disableDraw();
  }));

  $("#clearAll").addEventListener("click", clearAll);

  $("#basemap").addEventListener("change", (e) => {
    map.removeLayer(currentBase);
    currentBase = baseLayers[e.target.value].addTo(map);
    currentBase.bringToBack();
  });
  $("#opacity").addEventListener("input", (e) => {
    zoneOpacity = parseFloat(e.target.value);
    if (zoneLayer) zoneLayer.setStyle((f) => {
      const z = zoneByFeature.get(f);
      return { color: "#37474f", weight: 0.8, fillColor: z ? z.color : "#999", fillOpacity: zoneOpacity };
    });
  });

  $("#printBtn").addEventListener("click", () => window.print());

  $("#exportCsv").addEventListener("click", () => {
    if (!lastResults.length) return;
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [["parcel", "type", "zone_code", "zone_name", "area_m2", "area_ha", "percent_of_parcel", "restricted_zone"]];
    lastResults.forEach((r) => {
      if (r.kind === "polygon") {
        r.rows.forEach((x) => lines.push([r.name, "polygon", x.code, x.name, x.area.toFixed(2),
          (x.area / 10000).toFixed(4), x.pct.toFixed(2), x.sensitive ? "yes" : "no"]));
        (r.overlays || []).forEach((o) => lines.push([r.name, "overlay", o.label, o.value, o.area.toFixed(2),
          (o.area / 10000).toFixed(4), o.pct.toFixed(2), ""]));
        if (r.outsideM2 > 0) lines.push([r.name, "polygon", "", "Outside zoning data", r.outsideM2.toFixed(2),
          (r.outsideM2 / 10000).toFixed(4), ((r.outsideM2 / r.areaM2) * 100).toFixed(2), ""]);
      } else if (r.kind === "point") {
        if (!r.zones.length) lines.push([r.name, "point", "", "No zoning polygon", "", "", "", ""]);
        r.zones.forEach((z) => lines.push([r.name, "point", z.code, z.name, "", "", "", z.sensitive ? "yes" : "no"]));
        (r.overlays || []).forEach((o) => lines.push([r.name, "overlay", o.label, o.value, "", "", "", ""]));
      }
    });
    const csv = "\ufeff" + lines.map((l) => l.map(q).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "spatial-plan-result.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  /* init */
  resetRows(3);
  updateCoordLabels();
  loadZoning();
})();
