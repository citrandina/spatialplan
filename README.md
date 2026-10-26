# Spatial Plan Checker 

A static WebGIS (no server, no build step). Users upload a parcel polygon, type coordinates, or draw on the map,
and the page reports which spatial-plan zones the parcel falls in, with area (m2, ha) and percentage per zone.

## Files

```
index.html               page structure + library links
style.css                styling
app.js                   all logic (edit the CONFIG block at the top)
data/zoning.geojson      RTRW Kota Jayapura zoning (4,163 polygons, 42 zone types, ~11 MB)
```

## Publish on GitHub Pages

1. Create a new **public** repository on GitHub.
2. Upload all files, keeping the `data/` folder.
3. Go to **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After a minute the site is live at `https://<username>.github.io/<repo-name>/`.

## Test locally

Opening `index.html` by double-click will not load the data (browser security). Run a small server instead:

```
python -m http.server 8000
```

then open http://localhost:8000

## Updating or replacing the zoning data

1. Prepare the layer in QGIS: fix geometries, reproject to **EPSG:4326**, keep only the attributes you need.
2. Simplify if the file is big (QGIS *Simplify* or mapshaper) - aim for under ~20 MB.
3. Export as GeoJSON to `data/zoning.geojson`.
4. In `app.js` > `CONFIG`, make sure `codeFields` and `nameFields` include your attribute names
   (the current data uses `KODKWS` and `NAMOBJ`). Matching is case-insensitive. Overlay columns (disaster hazard,
   KKOP, KP2B, etc.) are listed in `CONFIG.overlays`.
5. Adjust `sensitivePattern` (zones flagged with a warning), `extent`, and the colours in `COLOR_RULES` if needed.

## Inputs

| Input | Notes |
|---|---|
| Upload | GeoJSON, KML, zipped Shapefile (.shp .dbf .prj). Projected files without CRS info are read as UTM 54S/53S (selectable). |
| Coordinates | WGS84 lon/lat, lat/lon, or UTM 54S/53S. 1 point = zone lookup, 3+ points = polygon. |
| Draw | Polygon or point drawn on the map. |
| My location | "Use my current location" button: the browser's GPS/location, shown with its accuracy circle. Needs https (GitHub Pages) and the user's permission. Nothing is sent or stored. |

## Notes

- `data/zoning.geojson` was slimmed from the original file: Z values removed, coordinates rounded to 6 decimals (~0.1 m),
  and only the attributes the app uses were kept (zone name/code, district, remark and the overlay columns).
- The overlay column meanings in `CONFIG.overlays` (e.g. `KSMPDN`, `PTBGMB`) are inferred from the column names; confirm them against the data dictionary.
- Zones flagged as restricted/protected are set by `CONFIG.sensitivePattern` (Cagar Alam, Hutan Lindung, mangrove, Perlindungan Setempat, Taman Wisata Alam, Badan Air).
- Areas are computed in UTM 54S (meters), so they are not distorted by lat/long degrees.
- The repository (and therefore the zoning data) is public on a free GitHub account.
- Results are indicative only and are not an official KKPR/KRK.
