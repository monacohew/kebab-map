// Monaco's Kebab Map — shared ratings with accounts (Supabase)
const SUPABASE_URL = "https://riwwsasulkhmdasenbwy.supabase.co";
const SUPABASE_KEY = "sb_publishable_2foFxO37pS4pih6qMWj8ig_RrxhJiTK"; // public key, safe in the browser; access is limited by database rules
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const REGIONS = ["Northland","Auckland","Waikato","Bay of Plenty","Gisborne","Taranaki","Manawatū-Whanganui","Hawke's Bay","Wellington","Nelson Tasman","Marlborough","West Coast","Canterbury","Otago","Southland"];
const CITIES = [["Auckland",-36.85,174.76],["Hamilton",-37.79,175.28],["Tauranga",-37.69,176.17],["Napier",-39.49,176.91],["New Plymouth",-39.06,174.08],["Palmerston North",-40.35,175.61],["Wellington",-41.29,174.78],["Nelson",-41.27,173.28],["Christchurch",-43.53,172.64],["Dunedin",-45.87,170.50],["Queenstown",-45.03,168.66],["Invercargill",-46.41,168.35],["Whangārei",-35.73,174.32],["Gisborne",-38.66,178.02]];

const PARTS = [
  ["meat", "Meat", "Taste, tenderness, how much you get"],
  ["sauce", "Sauce", "Flavour and balance"],
  ["bread", "Bread & wrap", "Fresh, toasted, holds together"],
  ["salad", "Salad", "Fresh, crisp, not soggy"],
  ["value", "Value", "Size for the price"]
];
const OPTIONS = {
  style: [["wrap","Wrap"],["pide","Pide / bread"],["chips","On chips"],["rice","On rice"],["snack_pack","Snack pack"],["plate","Plate"],["other","Other"]],
  meats: [["lamb","Lamb"],["chicken","Chicken"],["beef","Beef"],["mixed","Mixed"],["falafel","Falafel"],["other","Other"]],
  sauces: [["garlic","Garlic"],["chilli","Chilli"],["sweet_chilli","Sweet chilli"],["bbq","BBQ"],["mint_yoghurt","Mint yoghurt"],["hummus","Hummus"],["tahini","Tahini"],["tomato","Tomato"],["mayo","Mayo"],["aioli","Aioli"]],
  salads: [["lettuce","Lettuce"],["tomato","Tomato"],["onion","Onion"],["cucumber","Cucumber"],["cabbage","Cabbage"],["carrot","Carrot"],["olives","Olives"],["jalapenos","Jalapeños"],["pickles","Pickles"],["cheese","Cheese"]]
};
const LABEL = Object.fromEntries(Object.entries(OPTIONS).map(([k, v]) => [k, Object.fromEntries(v)]));

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => v == null ? null : Number(v);
const tier = s => s == null ? "n" : s >= 9 ? "9" : s >= 8 ? "8" : s >= 7 ? "7" : s >= 5 ? "5" : "0";
const fmt = s => s == null ? "–" : (Math.round(s * 10) / 10).toFixed(1).replace(/\.0$/, "");
const fmt1 = s => s == null ? "–" : (Math.round(s * 10) / 10).toFixed(1);
const round1 = v => Math.round(v * 10) / 10;

function orderText(r) {
  const meats = (r.meats || []).map(m => LABEL.meats[m]).filter(Boolean);
  const style = r.style ? LABEL.style[r.style] : "";
  let main = [meats.join(" & "), style ? style.toLowerCase() : ""].filter(Boolean).join(" ");
  if (main) main = main[0].toUpperCase() + main.slice(1);
  const sauces = (r.sauces || []).map(x => LABEL.sauces[x]?.toLowerCase()).filter(Boolean);
  return [main, sauces.length ? sauces.join(", ") + " sauce" : ""].filter(Boolean).join(" · ");
}

// ---------- State ----------
let SHOPS = [];        // {id,name,town,region,lat,lng,legacy,score}
let STATS = {};        // shop_id -> {avg, n, meat, sauce, bread, salad, value}
let MON = {};          // shop_id -> Monaco's breakdown rating row
let MINE = {};         // shop_id -> my rating row
let ADMIN_IDS = [];
let session = null, profile = null;
let activeRegion = "All", view = "best", todoOnly = false, mineOnly = false;
let mode = "monaco", showMon = true;   // mode: "monaco" (Monaco's picks) or "discover" (every shop)
const isMon = s => s.source === "monaco" || !!MON[s.id];
let shopsIStaff = [], TRIED = [];
let PARTNERS = {}, SETTINGS = { program_name: "Kebab Crew", stamps_needed: 6, reward_text: "$5 off" }, partnersOnly = false;
const isPartner = s => !!PARTNERS[s.id]?.active;
const VIS = () => SHOPS.filter(s => mode === "monaco" ? isMon(s) : ((showMon || !isMon(s)) && (!partnersOnly || isPartner(s))));
// The number on a pin: Monaco's score on his shops, everyone's average on the rest
const ps = s => (mode === "monaco" || isMon(s)) ? s.score : (STATS[s.id]?.avg ?? null);
const TOP = new Set();
const SHOP_BY_ID = () => Object.fromEntries(SHOPS.map(s => [s.id, s]));

// ---------- Map ----------
// Vector basemap (OpenFreeMap, free, no key) drawn by MapLibre: smooth fractional zoom, real streets.
const NZ_BOUNDS = [[166.2, -47.4], [178.8, -34.2]];
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  bounds: NZ_BOUNDS, fitBoundsOptions: { padding: 24 },
  minZoom: 3.8, maxZoom: 17.5, maxBounds: [[148, -56], [197, -24]],
  attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
  renderWorldCopies: false, cooperativeGestures: false, fadeDuration: 150
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation?.();
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Shop data © OpenStreetMap contributors" }), "bottom-left");
// Cartoon-style basemap: flat sunny land, bright sea, white roads, no shop/business clutter
const THEME = { land: "#FFE07A", sea: "#7ED6EE", green: "#BFE79A", built: "#FFD25E", building: "#F8C84E", road: "#FFFFFF", roadEdge: "#F2B24A", border: "#E0912B", text: "#4A2F00", halo: "#FFF6D8" };
function setP(id, prop, val) { try { map.setPaintProperty(id, prop, val); } catch {} }
map.on("style.load", () => {
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === "background") setP(id, "background-color", THEME.land);
    else if (l.type === "fill") {
      if (/water|ocean|sea|lake|river/.test(id)) { setP(id, "fill-color", THEME.sea); setP(id, "fill-opacity", 1); setP(id, "fill-outline-color", THEME.sea); }
      else if (/park|wood|forest|grass|landcover|vegetation|wetland|scrub|cemetery|pitch/.test(id)) { setP(id, "fill-color", THEME.green); setP(id, "fill-opacity", 0.7); }
      else if (/building/.test(id)) { setP(id, "fill-color", THEME.building); setP(id, "fill-opacity", ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 0.45]); setP(id, "fill-outline-color", THEME.building); }
      else if (/landuse|residential|industrial|commercial|aeroway|airport|school|hospital/.test(id)) { setP(id, "fill-color", THEME.built); setP(id, "fill-opacity", 0.18); }
      else if (/ice|glacier/.test(id)) { setP(id, "fill-color", "#FFFFFF"); setP(id, "fill-opacity", 0.7); }
    } else if (l.type === "line") {
      if (/water/.test(id)) setP(id, "line-color", THEME.sea);
      else if (/boundary|admin/.test(id)) { setP(id, "line-color", THEME.border); setP(id, "line-opacity", 0.6); }
      else if (/rail|transit/.test(id)) { setP(id, "line-color", THEME.roadEdge); setP(id, "line-opacity", 0.5); }
      else if (/casing|outline/.test(id)) setP(id, "line-color", THEME.roadEdge);
      else if (/road|highway|street|motorway|trunk|primary|secondary|tertiary|minor|service|path|track|bridge|tunnel|link/.test(id)) setP(id, "line-color", THEME.road);
    } else if (l.type === "symbol") {
      if (/poi|housenum|shield|transit|aeroway|airport|oneway|mountain|peak|label_other|label_country/.test(id) || (l.layout && l.layout["icon-image"] && !/label_(city|town|village|state|country)/.test(id))) { try { map.setLayoutProperty(id, "visibility", "none"); } catch {} }
      else { setP(id, "text-color", /water|ocean|sea|lake/.test(id) ? "#1D7FA0" : THEME.text); setP(id, "text-halo-color", /water|ocean|sea|lake/.test(id) ? "#C8F1FA" : THEME.halo); setP(id, "text-halo-width", 1.6); }
    } else if (l.type === "hillshade" || l.type === "fill-extrusion") { try { map.setLayoutProperty(id, "visibility", "none"); } catch {} }
  }
});
map.on("load", () => {
  map.resize(); map.fitBounds(NZ_BOUNDS, { padding: 24, duration: 0 });
  addShopLayers();
  // Keep the map credits folded into the small (i) button until tapped
  document.querySelectorAll(".maplibregl-ctrl-attrib.maplibregl-compact-show").forEach(e => e.classList.remove("maplibregl-compact-show"));
});

// ---------- Shop pins ----------
// Drawn by the map itself (GPU), not as HTML: every shop is a tiny dot when zoomed out and grows
// smoothly into a score bubble as you zoom in, with no clustering jumps.
const TIER_COL = { "9": "#0B7A43", "8": "#1FAF55", "7": "#9CD33B", "5": "#FF8A1F", "0": "#E5243B", "n": "#9AA3BF" };
const GOLD = "#FFC21A", MON_RING = "#6B3CFF";
let shopData = { type: "FeatureCollection", features: [] }, selId = null;
// Size by zoom: tiny at country view, score bubble from about city view
const R = (a, b, c, d, e) => ["interpolate", ["exponential", 1.5], ["zoom"], 4, a, 7, b, 10, c, 12.5, d, 15, e];
function shopFeatures() {
  return VIS().map(s => {
    const v = ps(s), fresh = v == null && mode === "discover" && !isMon(s);
    return { type: "Feature", id: undefined, geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { id: s.id, v: v ?? -1, col: fresh ? "#FFFFFF" : TIER_COL[tier(v)],
        ink: fresh ? "#6B7390" : tier(v) === "7" ? "#1F3B06" : "#FFFFFF",
        ring: TOP.has(s.id) || isPartner(s) ? GOLD : (mode === "discover" && isMon(s)) ? MON_RING : fresh ? "#9AA3BF" : "#FFFFFF",
        special: TOP.has(s.id) || isPartner(s) ? 1 : 0,
        label: v == null ? (fresh ? "+" : "?") : fmt(v), name: s.name } };
  });
}
function addShopLayers() {
  if (map.getSource("shops")) return;
  const fontLayer = map.getStyle().layers.find(l => l.type === "symbol" && l.layout?.["text-font"]);
  const fonts = fontLayer?.layout["text-font"];
  const bold = Array.isArray(fonts) && fonts.length ? [fonts[0].replace(/Regular|Italic/, "Bold")] : ["Noto Sans Bold"];
  map.addSource("shops", { type: "geojson", data: shopData, promoteId: "id" });
  // Soft dark shadow under every pin so it lifts off the yellow land
  map.addLayer({ id: "shop-shadow", type: "circle", source: "shops", paint: {
    "circle-color": "#2A1A00", "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.35, 12, 0.28], "circle-blur": 0.6,
    "circle-translate": [0, 1.5],
    "circle-radius": R(8.5, 8.5, 10.5, 15, 16.5) } });
  // Gold glow behind top picks and partners
  map.addLayer({ id: "shop-glow", type: "circle", source: "shops", filter: ["==", ["get", "special"], 1], paint: {
    "circle-color": GOLD, "circle-opacity": 0.55, "circle-blur": 0.35,
    "circle-radius": R(11, 11, 13.5, 19, 21) } });
  map.addLayer({ id: "shop-dot", type: "circle", source: "shops", layout: { "circle-sort-key": ["+", ["get", "v"], ["*", 20, ["get", "special"]]] }, paint: {
    "circle-color": ["get", "col"],
    "circle-radius": R(...[6.5, 6.5, 8.5, 12, 13.5].map(r => ["*", r, ["case", ["boolean", ["feature-state", "sel"], false], 1.3, ["boolean", ["feature-state", "hover"], false], 1.15, 1]])),
    "circle-stroke-color": ["get", "ring"],
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 2.2, 12, 2.6, 15, 3],
    "circle-radius-transition": { duration: 180 },
    "circle-pitch-alignment": "map" } });
  // Score number appears inside the bubble once there's room for it
  map.addLayer({ id: "shop-label", type: "symbol", source: "shops", minzoom: 9.6, layout: {
    "text-field": ["get", "label"], "text-font": bold, "text-allow-overlap": true, "text-ignore-placement": true,
    "text-size": ["interpolate", ["linear"], ["zoom"], 9.6, 8.5, 12.5, 11.5, 15, 12.5],
    "symbol-sort-key": ["+", ["get", "v"], ["*", 20, ["get", "special"]]] }, paint: {
    "text-color": ["get", "ink"], "text-opacity": ["interpolate", ["linear"], ["zoom"], 9.6, 0, 10.4, 1] } });
  let hovered = null;
  const setHover = id => { if (hovered === id) return; if (hovered) map.setFeatureState({ source: "shops", id: hovered }, { hover: false }); hovered = id; if (id) map.setFeatureState({ source: "shops", id }, { hover: true }); };
  // Generous tap target: find the nearest shop within a finger's width of the tap
  const pickAt = pt => {
    const r = window.innerWidth <= 820 ? 16 : 11;
    const feats = map.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: ["shop-dot"] });
    let best = null, bd = Infinity;
    for (const f of feats) { const q = map.project(f.geometry.coordinates), d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2; if (d < bd) { bd = d; best = f; } }
    return best;
  };
  map.on("mousemove", e => { if (picking) return; const f = pickAt(e.point); setHover(f?.properties.id || null); map.getCanvas().style.cursor = f ? "pointer" : ""; });
  map.on("mouseout", () => setHover(null));
  map.on("click", e => {
    if (picking) return;
    const f = pickAt(e.point); if (!f) return;
    e.originalEvent.stopPropagation?.();
    openShop(f.properties.id);
  });
  setShopData();
}
function setShopData() {
  shopData = { type: "FeatureCollection", features: shopFeatures() };
  const src = map.getSource("shops"); if (src) src.setData(shopData);
  drawMarkers();
}
// Selected shop: a slightly bigger pin
function drawMarkers() {
  if (!map.getSource("shops")) return;
  const want = openPopup?.shopId || null;
  if (selId && selId !== want) map.setFeatureState({ source: "shops", id: selId }, { sel: false });
  if (want) map.setFeatureState({ source: "shops", id: want }, { sel: true });
  selId = want;
}
function buildMarkers() { computeTop(); setShopData(); }
function refreshPins() { buildMarkers(); }
function computeTop() {
  TOP.clear();
  const vis = VIS();
  REGIONS.forEach(rg => {
    const scored = vis.filter(s => s.region === rg && ps(s) != null);
    if (!scored.length) return;
    const max = Math.max(...scored.map(ps));
    scored.filter(s => ps(s) === max).forEach(s => TOP.add(s.id));
  });
}

// ---------- Popup ----------
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const NAV_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 2.3a1 1 0 0 0-1.1-.2l-18 8a1 1 0 0 0 .1 1.9l7.4 2 2 7.4a1 1 0 0 0 1.9.1l8-18a1 1 0 0 0-.3-1.2z"/></svg>';
function mapLinks(s) {
  const q = encodeURIComponent(`${s.name}, ${s.address || s.town}, New Zealand`);
  const links = [
    `<a class="maplink" data-kind="maps" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${PIN_SVG}Google Maps</a>`,
    `<a class="maplink go" data-kind="directions" href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank" rel="noopener">${NAV_SVG}Directions</a>`
  ];
  if (IS_APPLE) links.push(`<a class="maplink" data-kind="maps" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">${PIN_SVG}Apple Maps</a>`);
  return `<div class="maplinks">${links.join("")}</div>`;
}
function partsHtml(s) {
  const mon = MON[s.id], st = STATS[s.id];
  if (!mon && !st) return "";
  return `<div class="parts"><span class="ph"></span><span></span><span class="ph">Monaco</span><span class="ph">All</span>
    ${PARTS.map(([k, label]) => {
      const mv = mon ? num(mon[k]) : null, av = st ? st[k] : null;
      if (mv == null && av == null) return "";
      return `<span>${label}</span><span class="bar"><i style="width:${((mv ?? av ?? 0) * 10).toFixed(0)}%"></i></span><b>${fmt1(mv)}</b><em>${fmt1(av)}</em>`;
    }).join("")}</div>`;
}
function popupHtml(s) {
  const st = STATS[s.id], mine = MINE[s.id], mon = MON[s.id];
  const action = !session
    ? `<button class="btn wide" type="button" data-act="login">Log in to rate this kebab</button>`
    : `<button class="btn wide" type="button" data-act="rate">${mine ? "Edit my rating" : "Rate this kebab"}</button>`;
  const monOrder = mon ? orderText(mon) : "";
  return `<div class="pop" data-id="${esc(s.id)}">
    <h3>${esc(s.name)}${TOP.has(s.id) ? '<span class="crown" title="Monaco\'s top pick in region">★</span>' : ""}</h3>
    <p class="where">${s.address ? esc(s.address) : esc(s.town)} · ${esc(s.region)}</p>
    ${mapLinks(s)}
    ${isPartner(s) ? `<div class="partner-banner"><b>${esc(SETTINGS.program_name)} partner</b><span>Show your card here. Every ${ordinal(SETTINGS.stamps_needed)} kebab is ${esc(SETTINGS.reward_text)}.</span></div>` : ""}
    <div class="trio">
      <div><span>Monaco</span><b>${fmt1(s.score)}</b>${s.score == null ? "<em>not tried yet</em>" : ""}</div>
      <div><span>Everyone</span><b>${st ? fmt1(st.avg) : "–"}</b><em>${st ? st.n + (st.n === 1 ? " rating" : " ratings") : "no ratings yet"}</em></div>
      <div><span>You</span><b>${mine ? fmt1(num(mine.score)) : "–"}</b></div>
    </div>
    ${partsHtml(s)}
    ${monOrder ? `<p class="where">Monaco had: ${esc(monOrder)}</p>` : ""}
    ${mon?.photo_url ? `<button type="button" class="rev-photo mon-photo" data-photo="${esc(mon.photo_url)}" data-cap="Monaco's kebab at ${esc(s.name)}"><img src="${esc(mon.photo_url)}" alt="Monaco's kebab at ${esc(s.name)}" loading="lazy"></button>` : ""}
    ${action}
    ${profile?.is_admin ? `<button type="button" class="admin-open" data-act="partner">Partner settings (admin)</button>` : ""}
    <div class="reviews" hidden></div>
  </div>`;
}

// One shop card at a time, anchored to the shop's pin
const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "330px", focusAfterOpen: false,
  offset: 18 });
let openPopup = null;
popup.on("close", () => { const was = openPopup?.shopId; openPopup = null; if (was) drawMarkers(); });
function showPopup(s) {
  popup.setLngLat([s.lng, s.lat]).setHTML(popupHtml(s));
  if (!popup.isOpen()) popup.addTo(map);
  openPopup = popup; popup.shopId = s.id;
  rebuildPin(s.id);
  const el = popup.getElement()?.querySelector(".pop");
  el?.querySelectorAll(".mon-photo img").forEach(img => img.addEventListener("load", () => fitPopup(popup), { once: true }));
  setTimeout(() => fitPopup(popup), 60);
  logEvent(s.id, "view");
  loadReviews(s, popup);
}
function closePopup() { if (popup.isOpen()) popup.remove(); }
// Redraw just one pin (selected state) without touching the rest
function rebuildPin() { drawMarkers(); }
function refreshPopup(s) {
  if (!openPopup || !popup.isOpen()) return;
  popup.setHTML(popupHtml(s));
  loadReviews(s, popup);
  setTimeout(() => fitPopup(popup), 30);
}
function showPhoto(url, cap) { $("lb-img").src = url; $("lb-img").alt = cap || ""; $("lb-cap").textContent = cap || ""; $("lightbox").showModal(); }
$("lightbox").addEventListener("click", () => $("lightbox").close());
const PHOTO_PREFIX = SUPABASE_URL + "/storage/v1/object/public/kebab-photos/";
async function removePhotoFile(url) {
  if (!url?.startsWith(PHOTO_PREFIX)) return;
  await sb.storage.from("kebab-photos").remove([decodeURIComponent(url.slice(PHOTO_PREFIX.length))]);
}
const LOGGED = new Set();
function logEvent(shopId, kind) {
  const key = shopId + ":" + kind + ":" + (session?.user.id || "anon");
  if (LOGGED.has(key)) return; LOGGED.add(key);
  sb.from("shop_events").insert({ shop_id: shopId, kind, user_id: session?.user.id ?? null }).then(() => {}, () => {});
}
document.getElementById("map").addEventListener("click", async ev => {
  const ml = ev.target.closest(".pop .maplink");
  if (ml) { logEvent(ml.closest(".pop").dataset.id, ml.dataset.kind); return; }
  const ph = ev.target.closest(".pop [data-photo]");
  if (ph) { showPhoto(ph.dataset.photo, ph.dataset.cap); return; }
  const btn = ev.target.closest(".pop [data-act]"); if (!btn) return;
  const s = SHOPS.find(x => x.id === btn.closest(".pop").dataset.id), act = btn.dataset.act;
  if (act === "login") openAuth("signup");
  else if (act === "rate") openRate(s);
  else if (act === "partner") openPartnerSettings(s);
  else if (act === "delrev") adminDelete(btn.closest("[data-rid]").dataset.rid, s);
});

async function loadReviews(s, popup) {
  const { data, error } = await sb.from("ratings").select("id, score, comment, style, meats, sauces, photo_url, user_id, updated_at, profiles(display_name, is_admin, avatar_url)").eq("shop_id", s.id).order("updated_at", { ascending: false }).limit(20);
  const box = popup.getElement()?.querySelector(".reviews");
  if (!box || error) return;
  const rows = (data || []).filter(r => !r.profiles?.is_admin);
  if (!rows.length) return;
  const { data: ver } = await sb.rpc("verified_ratings", { p_shop: s.id });
  const VER = new Set((ver || []).map(Number));
  box.innerHTML = rows.map(r => {
    const order = orderText(r);
    return `<div class="rev" data-rid="${r.id}">${avatarHtml(r.profiles, "sm")}<b>${esc(r.profiles?.display_name || "Someone")}</b> · ${fmt1(num(r.score))}/10${VER.has(Number(r.id)) ? ' <span class="verified" title="Scanned in at this shop">✓ Verified kebab</span>' : ""}
      ${profile?.is_admin && r.user_id !== session?.user.id ? ' <button class="auth-switch" type="button" data-act="delrev">remove</button>' : ""}
      ${order ? `<span class="order">${esc(order)}</span>` : ""}
      ${r.comment ? `<q>${esc(r.comment)}</q>` : ""}
      ${r.photo_url ? `<button type="button" class="rev-photo" data-photo="${esc(r.photo_url)}" data-cap="${esc((r.profiles?.display_name || "Someone") + "'s kebab")}"><img src="${esc(r.photo_url)}" alt="${esc((r.profiles?.display_name || "Someone") + "'s kebab")}" loading="lazy"></button>` : ""}</div>`;
  }).join("");
  box.hidden = false;
  fitPopup(popup);
  box.querySelectorAll("img").forEach(img => img.addEventListener("load", () => fitPopup(popup), { once: true }));
}
// Pan the map so the whole card is visible
function fitPopup(p) {
  if (!p || !p.isOpen()) return;
  requestAnimationFrame(() => {
    const el = p.getElement(); if (!el) return;
    const m = map.getContainer().getBoundingClientRect(), r = el.getBoundingClientRect();
    const topGap = 60, sideGap = 12, bottomGap = 12;
    let dx = 0, dy = 0;
    if (r.top < m.top + topGap) dy = r.top - (m.top + topGap);
    else if (r.bottom > m.bottom - bottomGap) dy = Math.min(r.bottom - (m.bottom - bottomGap), r.top - (m.top + topGap));
    if (r.left < m.left + sideGap) dx = r.left - (m.left + sideGap);
    else if (r.right > m.right - sideGap) dx = r.right - (m.right - sideGap);
    if (dx || dy) map.panBy([dx, dy], { duration: 300 });
  });
}
async function adminDelete(id, s) {
  const { data: row } = await sb.from("ratings").select("photo_url").eq("id", id).maybeSingle();
  const { error } = await sb.from("ratings").delete().eq("id", id);
  if (!error && row?.photo_url) await removePhotoFile(row.photo_url);
  if (!error) { await loadStats(); render(); if (mode === "discover") { refreshPins(); openShop(s.id); } else refreshPopup(s); }
}

function openShop(id) {
  const s = SHOPS.find(x => x.id === id); if (!s) return;
  if (window.innerWidth <= 820) document.querySelector(".map-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
  const target = Math.max(map.getZoom(), 12.5);
  const c = map.project([s.lng, s.lat]), sz = map.getContainer().getBoundingClientRect();
  const visible = c.x > 40 && c.y > 120 && c.x < sz.width - 40 && c.y < sz.height - 20;
  if (visible && map.getZoom() >= 12) { showPopup(s); return; }
  let done = false;
  const open = () => { if (!done) { done = true; showPopup(s); } };
  map.once("moveend", open);
  setTimeout(open, 1300);
  // Put the pin in the lower part of the map so the card has room above it
  map.flyTo({ center: [s.lng, s.lat], zoom: target, offset: [0, Math.round(sz.height * 0.25)], speed: 1.6, curve: 1.3 });
}
function flyTo(region) {
  const pts = SHOPS.filter(s => region === "All" || s.region === region);
  if (!pts.length) return;
  closePopup();
  if (region === "All") { map.fitBounds(NZ_BOUNDS, { padding: 24, duration: 900 }); return; }
  const lngs = pts.map(s => s.lng), lats = pts.map(s => s.lat);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 11.5, duration: 900 });
}

// ---------- Rating sheet ----------
let rateShop = null, ratePhoto = null, rateRemovePhoto = false;
function showRatePhoto(url) {
  $("rate-photo-preview").hidden = !url;
  $("rate-photo-label").hidden = !!url;
  if (url) $("rate-photo-img").src = url;
}
$("rate-photo").addEventListener("change", async () => {
  const f = $("rate-photo").files[0]; if (!f) return;
  try { ratePhoto = await resizeJpeg(f, 1280, false); rateRemovePhoto = false; showRatePhoto(URL.createObjectURL(ratePhoto)); }
  catch { $("rate-msg").textContent = "That photo couldn't be opened. Try a JPG or PNG."; $("rate-msg").className = "msg err"; $("rate-msg").hidden = false; }
});
$("rate-photo-remove").onclick = () => { ratePhoto = null; rateRemovePhoto = true; $("rate-photo").value = ""; showRatePhoto(null); };
const PART_KEYS = PARTS.map(p => p[0]);
const freshDraft = () => ({ style: null, meats: [], sauces: [], salads: [], meat: 7, sauce: 7, bread: 7, salad: 7, value: 7, on: Object.fromEntries(PART_KEYS.map(k => [k, true])), touched: {} });
const draft = freshDraft();
// No bread or wrap with these, so switch that part off unless the person has set it themselves
const NO_BREAD = new Set(["chips", "rice", "plate", "snack_pack"]);

function renderPills() {
  document.querySelectorAll("#rate .pills").forEach(box => {
    const f = box.dataset.field, single = box.hasAttribute("data-single");
    box.innerHTML = OPTIONS[f].map(([v, l]) => {
      const on = single ? draft[f] === v : draft[f].includes(v);
      return `<button type="button" class="pill" data-v="${v}" aria-pressed="${on}">${l}</button>`;
    }).join("");
  });
}
function renderScores() {
  $("scores").innerHTML = `<p class="fine sc-help">Switch off anything you didn't have. It won't count towards your score.</p>` + PARTS.map(([k, label, hint]) => {
    const on = draft.on[k];
    return `
    <div class="sc${on ? "" : " off"}" id="sc-${k}">
      <label class="sw"><input type="checkbox" data-on="${k}" ${on ? "checked" : ""} aria-label="Rate the ${label.toLowerCase()}"><i></i></label>
      <span class="lab">${label}<small>${on ? hint : "Didn't have it, not rated"}</small></span>
      <span class="val"${on ? "" : " hidden"}><button type="button" class="step" data-k="${k}" data-d="-0.1" aria-label="${label} down 0.1">−</button><output id="o-${k}">${fmt1(draft[k])}</output><button type="button" class="step" data-k="${k}" data-d="0.1" aria-label="${label} up 0.1">+</button></span>
      <input type="range" id="s-${k}" data-k="${k}" min="0.1" max="10" step="0.1" value="${draft[k]}" aria-label="${label} score"${on ? "" : " hidden"}>
    </div>`;
  }).join("");
  updateOverall();
}
function partsOn() { return PART_KEYS.filter(k => draft.on[k]); }
function updateOverall() {
  const on = partsOn();
  $("overall").textContent = on.length ? fmt1(round1(on.reduce((t, k) => t + draft[k], 0) / on.length)) : "–";
  $("rate-save").disabled = !on.length;
}
function setPartOn(k, on, byUser) {
  draft.on[k] = on;
  if (byUser) draft.touched[k] = true;
  renderScores();
}
function setScore(k, v) {
  draft[k] = Math.min(10, Math.max(0.1, round1(v)));
  $("o-" + k).textContent = fmt1(draft[k]);
  $("s-" + k).value = draft[k];
  updateOverall();
}
function openRate(s) {
  rateShop = s;
  const mine = MINE[s.id];
  Object.assign(draft, mine
    ? { style: mine.style, meats: [...(mine.meats || [])], sauces: [...(mine.sauces || [])], salads: [...(mine.salads || [])],
        ...Object.fromEntries(PART_KEYS.map(k => [k, mine[k] == null ? 7 : num(mine[k])])),
        on: Object.fromEntries(PART_KEYS.map(k => [k, mine[k] != null])), touched: Object.fromEntries(PART_KEYS.map(k => [k, true])) }
    : freshDraft());
  $("rate-title").textContent = mine ? "Edit your rating" : "Rate this kebab";
  $("rate-where").textContent = `${s.name} · ${s.town}`;
  $("rate-comment").value = mine?.comment || "";
  $("comment-wrap").open = !!mine?.comment;
  document.querySelector("#rate details.more").open = !!(mine?.salads?.length);
  $("rate-delete").hidden = !mine;
  ratePhoto = null; rateRemovePhoto = false; $("rate-photo").value = "";
  showRatePhoto(mine?.photo_url || null);
  $("rate-msg").hidden = true;
  $("rate-save").disabled = false;
  $("rate-save").textContent = mine ? "Update rating" : "Save rating";
  renderPills(); renderScores();
  closePopup();
  $("rate").showModal();
}
$("rate").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (pill) {
    const box = pill.parentElement, f = box.dataset.field, v = pill.dataset.v;
    if (box.hasAttribute("data-single")) draft[f] = draft[f] === v ? null : v;
    else draft[f] = draft[f].includes(v) ? draft[f].filter(x => x !== v) : [...draft[f], v];
    renderPills();
    if (f === "style" && !draft.touched.bread) setPartOn("bread", !NO_BREAD.has(draft.style));
    return;
  }
  const step = e.target.closest(".step");
  if (step) { setScore(step.dataset.k, draft[step.dataset.k] + parseFloat(step.dataset.d)); return; }
  if (e.target === $("rate")) $("rate").close(); // tap outside the card
});
$("rate").addEventListener("input", e => { if (e.target.matches("input[type=range]")) setScore(e.target.dataset.k, parseFloat(e.target.value)); });
$("rate").addEventListener("change", e => { const k = e.target.dataset?.on; if (k) setPartOn(k, e.target.checked, true); });
$("rate-close").onclick = () => $("rate").close();

$("rate-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const s = rateShop, existing = MINE[s.id];
  if (!partsOn().length) return;
  const fields = { ...Object.fromEntries(PART_KEYS.map(k => [k, draft.on[k] ? draft[k] : null])), style: draft.style, meats: draft.meats, sauces: draft.sauces, salads: draft.salads, comment: $("rate-comment").value.trim() || null };
  $("rate-save").disabled = true; $("rate-save").textContent = ratePhoto ? "Uploading photo…" : "Saving…";
  const oldPhoto = existing?.photo_url || null;
  if (ratePhoto) {
    const path = `${session.user.id}/${s.id}-${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from("kebab-photos").upload(path, ratePhoto, { contentType: "image/jpeg" });
    if (upErr) {
      console.error(upErr);
      $("rate-msg").textContent = "Couldn't upload your photo. Try again, or save without it.";
      $("rate-msg").className = "msg err"; $("rate-msg").hidden = false;
      $("rate-save").disabled = false; $("rate-save").textContent = existing ? "Update rating" : "Save rating";
      return;
    }
    fields.photo_url = sb.storage.from("kebab-photos").getPublicUrl(path).data.publicUrl;
  } else if (rateRemovePhoto) fields.photo_url = null;
  const q = existing
    ? sb.from("ratings").update(fields).eq("shop_id", s.id).eq("user_id", session.user.id).select().single()
    : sb.from("ratings").insert({ ...fields, shop_id: s.id, user_id: session.user.id }).select().single();
  const { data, error } = await q;
  if (error) {
    console.error(error);
    $("rate-msg").textContent = "Couldn't save your rating. Check your connection and try again.";
    $("rate-msg").className = "msg err"; $("rate-msg").hidden = false;
    $("rate-save").disabled = false; $("rate-save").textContent = existing ? "Update rating" : "Save rating";
    return;
  }
  MINE[s.id] = data;
  if (oldPhoto && oldPhoto !== data.photo_url) removePhotoFile(oldPhoto);
  if (profile?.is_admin) { MON[s.id] = data; applyMonaco(); }
  await loadStats();
  refreshPins();
  $("rate").close();
  render();
  openShop(s.id);
});
$("rate-delete").onclick = async () => {
  const s = rateShop;
  const { error } = await sb.from("ratings").delete().eq("shop_id", s.id).eq("user_id", session.user.id);
  if (error) { $("rate-msg").textContent = "Couldn't remove it. Try again."; $("rate-msg").className = "msg err"; $("rate-msg").hidden = false; return; }
  if (MINE[s.id]?.photo_url) removePhotoFile(MINE[s.id].photo_url);
  delete MINE[s.id];
  if (profile?.is_admin) { delete MON[s.id]; applyMonaco(); }
  await loadStats();
  refreshPins();
  $("rate").close();
  render();
};

// ---------- Panel ----------
function rowHtml(s) {
  const st = STATS[s.id], mine = MINE[s.id];
  const bits = [esc(s.town)];
  if (st) bits.push(`<span class="comm">Everyone ${fmt1(st.avg)} (${st.n})</span>`);
  if (mine && !profile?.is_admin) bits.push(`<span class="mine">You ${fmt1(num(mine.score))}</span>`);
  if (mode === "discover" && isMon(s) && s.score != null) bits.push(`<span class="mine">Monaco ${fmt1(s.score)}</span>`);
  if (mode === "discover" && !st && !isMon(s)) bits.push(`<span class="comm">No reviews yet</span>`);
  const redo = mode === "monaco" && profile?.is_admin && s.source === "monaco" && !MON[s.id] ? '<span class="badge">re-rate</span>' : "";
  const added = s.source === "user" ? '<span class="badge new">new</span>' : "";
  const v = ps(s);
  return `<button class="row" data-id="${esc(s.id)}">
    <span class="info"><span class="name">${esc(s.name)}${TOP.has(s.id) ? '<span class="crown" aria-label="Top pick">★</span>' : ""}${redo}${added}</span>
    <span class="where">${bits.join(" · ")}</span></span>
    <span class="score tier-${tier(v)}">${v == null ? "–" : fmt(v)}</span></button>`;
}
function presentRegions() { const v = VIS(); return REGIONS.filter(r => v.some(s => s.region === r)); }

function render() {
  const vis = VIS();
  if (activeRegion !== "All" && !vis.some(s => s.region === activeRegion)) activeRegion = "All";
  const inRegion = vis.filter(s => activeRegion === "All" || s.region === activeRegion);
  const scored = inRegion.filter(s => ps(s) != null);
  const best = scored.reduce((a, b) => (ps(b) > (a ? ps(a) : -1) ? b : a), null);
  const avg = scored.reduce((t, s) => t + ps(s), 0) / (scored.length || 1);
  $("mode-monaco").setAttribute("aria-selected", String(mode === "monaco"));
  $("mode-discover").setAttribute("aria-selected", String(mode === "discover"));
  $("discover-bar").hidden = mode !== "discover";
  $("show-mon").checked = showMon;
  $("sort").querySelector('[value="score"]').textContent = mode === "discover" ? "Top rated" : "Monaco's top rated";
  $("stats").innerHTML = mode === "monaco" ? `
    <div class="stat"><b>${inRegion.length}</b><span>shops tried</span></div>
    <div class="stat"><b>${scored.length ? avg.toFixed(1) : "–"}</b><span>Monaco's average</span></div>
    <div class="stat best"><b title="${esc(best?.name)}">${best ? esc(best.name) : "–"}</b><span>top pick ${best ? fmt1(ps(best)) + "/10" : ""}</span></div>` : `
    <div class="stat"><b>${inRegion.length}</b><span>kebab shops</span></div>
    <div class="stat"><b>${inRegion.filter(s => STATS[s.id]).length}</b><span>rated by the crew</span></div>
    <div class="stat best"><b>${inRegion.filter(s => ps(s) == null).length}</b><span>need a first review</span></div>`;

  $("chips").innerHTML = ["All", ...presentRegions()].map(r => {
    const n = r === "All" ? vis.length : vis.filter(s => s.region === r).length;
    return `<button class="chip" data-region="${esc(r)}" aria-pressed="${r === activeRegion}">${r === "All" ? "All NZ" : esc(r)}<small>${n}</small></button>`;
  }).join("");

  $("tools").hidden = view !== "all";
  let html = "", triedHtml = "";
  const toRate = TRIED.filter(id => !MINE[id]).map(id => SHOPS.find(s => s.id === id)).filter(Boolean)
    .sort((a, b) => b.lat - a.lat);
  if (session && toRate.length) {
    const done = TRIED.length - toRate.length;
    triedHtml = `<div class="tried-box"><div class="tried-head"><b>Shops you've tried</b><span>${done} of ${TRIED.length} rated</span></div>
      <div class="tried-bar"><i style="width:${(done / TRIED.length * 100).toFixed(0)}%"></i></div>
      ${toRate.map(s => `<div class="tried-row"><span><b>${esc(s.name)}</b><small>${esc(s.town)}</small></span><button type="button" class="btn" data-rate-tried="${esc(s.id)}">Rate</button></div>`).join("")}</div>`;
  } else if (session && TRIED.length) {
    triedHtml = `<div class="tried-box done"><b>All ${TRIED.length} of your shops are rated.</b> <span>Legend. Thanks for testing!</span></div>`;
  }
  $("tried").innerHTML = triedHtml; $("tried").hidden = !triedHtml;
  if (profile?.is_admin && mode === "monaco") {
    const left = SHOPS.filter(s => s.source === "monaco" && !MON[s.id]).length;
    html += `<div class="adminbar"><span>${left ? `<strong>${left}</strong> shops still need your breakdown` : "All your shops have breakdowns"}</span>${left ? `<button class="btn ghost" type="button" id="todo">${todoOnly ? "Show all" : "Show them"}</button>` : ""}</div>`;
  }
  if (view === "best" && !todoOnly) {
    const regs = activeRegion === "All" ? presentRegions() : [activeRegion];
    regs.forEach(rg => {
      const list = vis.filter(s => s.region === rg && ps(s) != null).sort((a, b) => ps(b) - ps(a)).slice(0, activeRegion === "All" ? 1 : 3);
      if (list.length) html += `<div class="region-head">${esc(rg)}</div>` + list.map(rowHtml).join("");
    });
  } else {
    const q = $("search").value.trim().toLowerCase();
    let list = inRegion.filter(s => matchesSearch(s, q));
    if (todoOnly) list = list.filter(s => s.source === "monaco" && !MON[s.id]);
    if (mineOnly) list = list.filter(s => MINE[s.id]);
    if (mineOnly) html += `<div class="adminbar"><span>Showing the <strong>${list.length}</strong> kebabs you've rated</span><button class="btn ghost" type="button" id="mine-off">Show all</button></div>`;
    const cmp = {
      score: (a, b) => (ps(b) ?? -1) - (ps(a) ?? -1),
      community: (a, b) => (STATS[b.id]?.avg ?? -1) - (STATS[a.id]?.avg ?? -1),
      north: (a, b) => b.lat - a.lat,
      az: (a, b) => a.name.localeCompare(b.name)
    }[todoOnly ? "north" : $("sort").value];
    list.sort(cmp);
    html += list.length ? list.map(rowHtml).join("") : `<p class="empty">${q ? `No shops match "${esc(q)}".` : "Nothing here."}</p>`;
    // In Monaco's mode the list only has his shops, so point to matches in all NZ shops
    if (q && mode !== "discover") {
      const more = SHOPS.filter(s => !list.includes(s) && (activeRegion === "All" || s.region === activeRegion) && matchesSearch(s, q)).length;
      if (more) html += `<button class="btn ghost wide more-matches" type="button" id="search-discover">See ${more} more match${more === 1 ? "" : "es"} in all NZ shops</button>`;
    }
  }
  $("list").innerHTML = html || `<p class="empty">No shops here yet.</p>`;
  renderCompare();
  renderAccount();
}

// Search: ignores accents, treats "&" and "and" the same, matches words in any order,
// and forgives the common Feilding/Fielding mix-up (ie vs ei)
const normQ = t => " " + String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/ie/g, "ei").trim() + " ";
function matchesSearch(s, q) {
  if (!q) return true;
  const hay = normQ(`${s.name} ${s.town} ${s.address || ""} ${s.region}`);
  return normQ(q).trim().split(" ").filter(w => w && w !== "and").every(w => hay.includes(w));
}
document.addEventListener("click", e => {
  if (e.target.id !== "search-discover") return;
  setMode("discover");
});

function renderCompare() {
  if (!session) {
    $("compare").innerHTML = `<h2>You vs Monaco</h2><p>Make a free account, rate the kebabs you've had, and see where you agree with Monaco and where you'd argue about it.</p><button class="btn" type="button" data-open-auth="signup">Create account</button>`;
    $("compare").hidden = false; return;
  }
  if (profile?.is_admin) { $("compare").hidden = true; return; }
  $("compare").hidden = false;
  const rated = SHOPS.filter(s => MINE[s.id] && s.score != null);
  if (!rated.length) {
    $("compare").innerHTML = `<h2>You vs Monaco</h2><p>Tap any pin and rate the kebab. Once you've done a few, you'll see how your taste compares.</p>`;
    return;
  }
  const my = s => num(MINE[s.id].score);
  const gap = rated.reduce((t, s) => t + (my(s) - s.score), 0) / rated.length;
  const agree = rated.filter(s => Math.abs(my(s) - s.score) <= 0.5).length;
  const far = rated.reduce((a, b) => Math.abs(my(b) - b.score) > Math.abs(my(a) - a.score) ? b : a);
  const fd = round1(my(far) - far.score);
  // Which part do you rate most differently (only shops where Monaco has a breakdown)
  const withParts = rated.filter(s => MON[s.id]);
  let partLine = "";
  if (withParts.length >= 2) {
    const diffs = PARTS.map(([k, label]) => {
      const both = withParts.filter(s => MINE[s.id][k] != null && MON[s.id][k] != null);
      return [label, both.length >= 2 ? both.reduce((t, s) => t + (num(MINE[s.id][k]) - num(MON[s.id][k])), 0) / both.length : 0];
    });
    const [label, d] = diffs.reduce((a, b) => Math.abs(b[1]) > Math.abs(a[1]) ? b : a);
    if (Math.abs(d) >= 0.3) partLine = `<p>You're ${d > 0 ? "kinder" : "tougher"} than Monaco on <strong>${label.toLowerCase()}</strong>, by ${fmt1(Math.abs(round1(d)))} on average.</p>`;
  }
  $("compare").innerHTML = `<h2>You vs Monaco</h2>
    <p>You've rated <strong>${rated.length}</strong> of his shops and agree (within half a point) on <strong>${agree}</strong>.</p>
    <p>On average you score <strong>${Math.abs(gap) < .05 ? "the same as him" : fmt1(Math.abs(round1(gap))) + (gap > 0 ? " higher" : " lower")}</strong>.</p>
    ${partLine}
    <p>${fd === 0 ? "No big disagreements yet." : `Biggest disagreement: <strong>${esc(far.name)}</strong>, ${esc(far.town)} (you ${fmt1(my(far))}, Monaco ${fmt1(far.score)}).`}</p>`;
}

const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
function avatarHtml(p, cls = "") {
  const url = p?.avatar_url;
  return `<span class="avatar ${cls}">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials(p?.display_name))}</span>`;
}
function renderAccount() {
  const btn = $("me-btn");
  if (!session) {
    btn.innerHTML = `<span class="me-login">Log in</span>`;
    btn.setAttribute("aria-label", "Log in or create an account");
    closeMenu();
    return;
  }
  btn.innerHTML = avatarHtml(profile || { display_name: session.user.email });
  btn.setAttribute("aria-label", "Your profile menu");
  $("me-menu").innerHTML = `
    <div class="who"><b>${esc(profile?.display_name || "You")}</b><span>${esc(session.user.email)}${profile?.is_admin ? " · admin" : ""}</span></div>
    <button type="button" id="m-card" class="m-card">My ${esc(SETTINGS.program_name)} card</button>
    <button type="button" id="m-profile">Edit profile & photo</button>
    ${shopsIStaff.length ? `<a class="m-link" href="shop/">Open the shop app</a>` : ""}
    ${profile?.is_admin ? "" : `<button type="button" id="m-mine">My ratings</button>`}
    <button type="button" id="logout">Log out</button>`;
}
function closeMenu() { $("me-menu").hidden = true; $("me-btn").setAttribute("aria-expanded", "false"); }
$("me-btn").addEventListener("click", e => {
  e.stopPropagation();
  if (!session) { openAuth("login"); return; }
  const open = $("me-menu").hidden;
  $("me-menu").hidden = !open; $("me-btn").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", e => { if (!e.target.closest("#me")) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
$("me-menu").addEventListener("click", e => {
  if (e.target.id === "m-profile") { closeMenu(); openProfile(); }
  if (e.target.id === "m-card") { closeMenu(); openCard(); }
  if (e.target.id === "m-mine") {
    closeMenu(); view = "all"; mineOnly = true;
    $("tab-all").setAttribute("aria-selected", "true"); $("tab-best").setAttribute("aria-selected", "false");
    render();
    document.querySelector(".panel-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// ---------- Profile ----------
let pendingPhoto = null, removePhoto = false;
function previewAvatar(url) {
  $("pf-avatar").innerHTML = url ? `<img src="${esc(url)}" alt="Your photo">` : esc(initials($("pf-name").value || profile?.display_name));
  $("pf-remove").hidden = !url;
}
function openProfile() {
  pendingPhoto = null; removePhoto = false;
  $("pf-name").value = profile?.display_name || "";
  $("pf-email").textContent = `Signed in with ${session.user.email}. Only your name and photo are shown to others.`;
  $("pf-msg").hidden = true; $("pf-save").disabled = false; $("pf-save").textContent = "Save profile";
  previewAvatar(profile?.avatar_url);
  $("profile").showModal();
}
$("profile-close").onclick = () => $("profile").close();
$("pf-name").addEventListener("input", () => { if (!pendingPhoto && (removePhoto || !profile?.avatar_url)) previewAvatar(null); });
$("pf-remove").onclick = () => { pendingPhoto = null; removePhoto = true; $("pf-file").value = ""; previewAvatar(null); };
$("pf-file").addEventListener("change", async () => {
  const f = $("pf-file").files[0]; if (!f) return;
  try {
    pendingPhoto = await squareJpeg(f, 320);
    removePhoto = false;
    previewAvatar(URL.createObjectURL(pendingPhoto));
  } catch {
    $("pf-msg").textContent = "That photo couldn't be opened. Try a JPG or PNG."; $("pf-msg").className = "msg err"; $("pf-msg").hidden = false;
  }
});
// Shrink photos before upload (optionally crop to a centred square) so they stay small and fast
const squareJpeg = (file, size) => resizeJpeg(file, size, true);
function resizeJpeg(file, max, square) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement("canvas"), ctx = c.getContext("2d");
      if (square) {
        const s = Math.min(W, H); c.width = c.height = max;
        ctx.drawImage(img, (W - s) / 2, (H - s) / 2, s, s, 0, 0, max, max);
      } else {
        const k = Math.min(1, max / Math.max(W, H)); c.width = Math.round(W * k); c.height = Math.round(H * k);
        ctx.drawImage(img, 0, 0, c.width, c.height);
      }
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? resolve(b) : reject(new Error("encode")), "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("load"));
    img.src = URL.createObjectURL(file);
  });
}
$("profile-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("pf-name").value.trim();
  const msg = (t, ok) => { $("pf-msg").textContent = t; $("pf-msg").className = "msg " + (ok ? "ok" : "err"); $("pf-msg").hidden = false; };
  if (!name) return msg("Add a name so people know whose reviews are whose.");
  $("pf-save").disabled = true; $("pf-save").textContent = "Saving…";
  try {
    const patch = { display_name: name };
    const uid = session.user.id;
    if (pendingPhoto) {
      const path = `${uid}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, pendingPhoto, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw upErr;
      patch.avatar_url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    } else if (removePhoto) {
      patch.avatar_url = null;
    }
    const { error } = await sb.from("profiles").update(patch).eq("id", uid);
    if (error) throw error;
    // tidy up old photos
    if (pendingPhoto || removePhoto) {
      const { data: files } = await sb.storage.from("avatars").list(uid);
      const keep = patch.avatar_url?.split("/").pop();
      const old = (files || []).map(f => `${uid}/${f.name}`).filter(p => !keep || !p.endsWith(keep));
      if (old.length) await sb.storage.from("avatars").remove(old);
    }
    profile = { ...profile, ...patch };
    renderAccount();
    $("profile").close();
    if (openPopup) refreshPopup(SHOPS.find(x => x.id === openPopup.getElement()?.querySelector(".pop")?.dataset.id));
  } catch (err) {
    console.error(err);
    msg("Couldn't save your profile. Check your connection and try again.");
    $("pf-save").disabled = false; $("pf-save").textContent = "Save profile";
  }
});

// ---------- Data ----------
function applyMonaco() {
  SHOPS.forEach(s => { s.score = MON[s.id] ? num(MON[s.id].score) : s.legacy; });
  refreshPins();
}
async function loadShops() {
  const { data, error } = await sb.from("shops").select("id,name,town,region,lat,lng,monaco_score,source,address").eq("active", true);
  if (error) throw error;
  SHOPS = data.map(r => ({ ...r, legacy: num(r.monaco_score), score: num(r.monaco_score) }));
}
async function loadPartners() {
  const [{ data: ps }, { data: st }] = await Promise.all([sb.from("partners").select("*"), sb.from("settings").select("*").maybeSingle()]);
  PARTNERS = {}; (ps || []).forEach(p => PARTNERS[p.shop_id] = p);
  if (st) SETTINGS = st;
}
const ordinal = n => n + (["th","st","nd","rd"][((n % 100) - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");
async function loadMonaco() {
  const { data: admins } = await sb.from("profiles").select("id").eq("is_admin", true);
  ADMIN_IDS = (admins || []).map(a => a.id);
  MON = {};
  if (!ADMIN_IDS.length) return;
  const { data } = await sb.from("ratings").select("*").in("user_id", ADMIN_IDS).order("updated_at", { ascending: true });
  (data || []).forEach(r => MON[r.shop_id] = r);
}
async function loadStats() {
  const { data } = await sb.from("shop_stats").select("*");
  STATS = {};
  (data || []).forEach(r => STATS[r.shop_id] = { avg: num(r.avg_score), n: r.rating_count, meat: num(r.avg_meat), sauce: num(r.avg_sauce), bread: num(r.avg_bread), salad: num(r.avg_salad), value: num(r.avg_value) });
}
async function loadMine() {
  MINE = {}; profile = null; shopsIStaff = []; TRIED = [];
  if (!session) return;
  const [{ data: rows }, { data: prof }] = await Promise.all([
    sb.from("ratings").select("*").eq("user_id", session.user.id),
    sb.from("profiles").select("display_name, is_admin, avatar_url").eq("id", session.user.id).maybeSingle()
  ]);
  (rows || []).forEach(r => MINE[r.shop_id] = r);
  profile = prof;
  const { data: st } = await sb.from("shop_staff").select("shop_id");
  shopsIStaff = (st || []).map(x => x.shop_id);
  const { data: tr } = await sb.from("tried_shops").select("shop_id").eq("user_id", session.user.id);
  TRIED = (tr || []).map(x => x.shop_id);
}

// ---------- Auth ----------
let authMode = "signup";
function setAuthMode(mode) {
  authMode = mode;
  const t = {
    signup: ["Join the kebab crew", "Make an account to rate kebabs and see how you stack up against Monaco.", "Create account", "Already have an account?", "Log in"],
    login: ["Welcome back", "Log in to add and update your ratings.", "Log in", "New here?", "Create an account"],
    forgot: ["Reset your password", "We'll email you a link to set a new password.", "Send reset link", "Remembered it?", "Log in"],
    newpass: ["Set a new password", "Choose a new password for your account.", "Save password", "", ""]
  }[mode];
  [$("auth-title").textContent, $("auth-blurb").textContent, $("auth-submit").textContent, $("auth-alt-text").textContent, $("auth-alt").textContent] = t;
  $("f-name").hidden = mode !== "signup";
  $("f-email").hidden = mode === "newpass";
  $("f-pass").hidden = mode === "forgot";
  $("in-pass").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-forgot").hidden = mode !== "login";
  $("auth-alt").parentElement.hidden = mode === "newpass";
  $("auth-msg").hidden = true;
  $("auth-submit").disabled = false;
}
function openAuth(mode) { setAuthMode(mode); closePopup(); $("auth").showModal(); }
function authMsg(text, ok) { const m = $("auth-msg"); m.textContent = text; m.className = "msg " + (ok ? "ok" : "err"); m.hidden = false; }
const friendly = err => {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match. Try again or reset your password.";
  if (m.includes("already registered")) return "There's already an account with that email. Log in instead.";
  if (m.includes("email not confirmed")) return "Check your inbox and tap the confirmation link first.";
  if (m.includes("rate limit")) return "Too many tries just now. Wait a few minutes and try again.";
  if (m.includes("password")) return "Passwords need at least 6 characters.";
  return err?.message || "Something went wrong. Try again.";
};

$("auth-alt").onclick = () => setAuthMode(authMode === "signup" ? "login" : authMode === "login" ? "signup" : "login");
$("auth-forgot").onclick = () => setAuthMode("forgot");
$("auth-close").onclick = () => $("auth").close();
$("auth-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("in-email").value.trim(), password = $("in-pass").value, name = $("in-name").value.trim();
  const here = location.origin + location.pathname;
  if (authMode !== "newpass" && !/^\S+@\S+\.\S+$/.test(email)) return authMsg("Enter a valid email address.");
  if ((authMode === "signup" || authMode === "newpass") && password.length < 6) return authMsg("Passwords need at least 6 characters.");
  if (authMode === "signup" && !name) return authMsg("Add a name so people know whose review it is.");
  $("auth-submit").disabled = true;
  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: here } });
      if (error) throw error;
      if (!data.session) { authMsg(`Nearly there. We've sent a link to ${email}. Tap it to finish creating your account.`, true); return; }
      $("auth").close();
    } else if (authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $("auth").close();
    } else if (authMode === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here });
      if (error) throw error;
      authMsg(`If there's an account for ${email}, a reset link is on its way.`, true); return;
    } else if (authMode === "newpass") {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      $("auth").close();
    }
  } catch (err) { authMsg(friendly(err)); }
  finally { $("auth-submit").disabled = false; }
});

let booted = false;
sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (event === "PASSWORD_RECOVERY") { setTimeout(() => { setAuthMode("newpass"); $("auth").showModal(); }, 0); }
  if (booted && (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED")) {
    setTimeout(async () => { todoOnly = false; mineOnly = false; closeMenu(); await loadMine(); render(); closePopup(); }, 0);
  }
});

// ---------- Events ----------
document.addEventListener("click", async e => {
  const oa = e.target.closest("[data-open-auth]"); if (oa) { openAuth(oa.dataset.openAuth); return; }
  if (e.target.closest("#logout")) { closeMenu(); await sb.auth.signOut(); return; }
  if (e.target.closest("#todo")) { todoOnly = !todoOnly; render(); return; }
  if (e.target.closest("#mine-off")) { mineOnly = false; render(); return; }
  const rt = e.target.closest("[data-rate-tried]");
  if (rt) { const s = SHOPS.find(x => x.id === rt.dataset.rateTried); if (s) openRate(s); return; }
  const chip = e.target.closest(".chip");
  if (chip) { activeRegion = chip.dataset.region; render(); flyTo(activeRegion); return; }
  const row = e.target.closest(".row");
  if (row) openShop(row.dataset.id);
});
$("tab-best").onclick = () => { view = "best"; todoOnly = false; mineOnly = false; $("tab-best").setAttribute("aria-selected", "true"); $("tab-all").setAttribute("aria-selected", "false"); render(); };
$("tab-all").onclick = () => { view = "all"; mineOnly = false; $("tab-all").setAttribute("aria-selected", "true"); $("tab-best").setAttribute("aria-selected", "false"); render(); };
$("search").addEventListener("input", render);
$("sort").addEventListener("change", render);
$("reset").onclick = () => { activeRegion = "All"; render(); flyTo("All"); closePopup(); };

// ---------- Map controls ----------
$("z-in").onclick = () => map.zoomIn({ duration: 300 });
$("z-out").onclick = () => map.zoomOut({ duration: 300 });
// Live location: a pulsing blue dot that follows you while the map is open
let meMarker = null, watchId = null, firstFix = true, lastPos = null;
function showMe(pos) {
  $("locate").classList.remove("busy");
  const ll = [pos.coords.longitude, pos.coords.latitude];
  lastPos = ll;
  if (!meMarker) {
    const e = document.createElement("div"); e.className = "me-dot"; e.innerHTML = "<i></i>";
    e.setAttribute("aria-label", "You are here");
    meMarker = new maplibregl.Marker({ element: e }).setLngLat(ll).addTo(map);
  } else meMarker.setLngLat(ll);
  // Accuracy halo in screen pixels at the current zoom (hidden when it would be tiny or huge)
  const mPerPx = 156543.03 * Math.cos(ll[1] * Math.PI / 180) / 2 ** map.getZoom();
  const halo = Math.min(160, (pos.coords.accuracy || 0) / mPerPx);
  meMarker.getElement().style.setProperty("--acc", (halo > 14 ? halo : 0) + "px");
  if (firstFix) { firstFix = false; map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 12.5), speed: 1.6 }); }
}
function startLive(fly) {
  if (!navigator.geolocation || watchId != null) return;
  firstFix = fly; $("locate").classList.add("busy", "live");
  watchId = navigator.geolocation.watchPosition(showMe, err => {
    // Only give up if location is blocked; a weak signal now and then is normal, keep following
    if (err.code === 1) { stopLive(); $("locate").title = "Location is blocked for this site. Allow it in your browser settings."; }
    else if (!lastPos) $("locate").classList.remove("busy");
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  try { localStorage.setItem("kebab.live", "1"); } catch {}
}
function stopLive() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; lastPos = null;
  if (meMarker) { meMarker.remove(); meMarker = null; }
  $("locate").classList.remove("busy", "live");
  try { localStorage.removeItem("kebab.live"); } catch {}
}
$("locate").onclick = () => {
  if (watchId == null) return startLive(true);
  // Already live: first tap re-centres on you, a tap when you're already centred turns it off
  if (lastPos) {
    const c = map.project(lastPos), m = map.getContainer();
    if (Math.abs(c.x - m.clientWidth / 2) < 30 && Math.abs(c.y - m.clientHeight / 2) < 30) return stopLive();
    map.flyTo({ center: lastPos, zoom: Math.max(map.getZoom(), 12.5), speed: 1.6 });
  }
};
map.on("zoom", () => { if (meMarker && lastPos) meMarker.getElement().style.setProperty("--acc", "0px"); });
// Turn it back on automatically if you had it on last time and the browser still allows it
try {
  if (localStorage.getItem("kebab.live") && navigator.permissions) navigator.permissions.query({ name: "geolocation" }).then(p => { if (p.state === "granted") startLive(false); }).catch(() => {});
} catch {}

// ---------- Discover ----------
function setMode(m) {
  mode = m; todoOnly = false; mineOnly = false;
  $("fine").textContent = m === "monaco"
    ? "Pin colours and numbers are Monaco's scores. Pins sit in the right town or suburb, not always on the exact street."
    : "Pins show everyone's average score. Shops with an M are Monaco's, showing his score. Dashed pins have no reviews yet, so be the first.";
  closePopup();
  refreshPins();
  render();
  try { localStorage.setItem("kebab.mode", m); } catch {}
}
$("mode-monaco").onclick = () => setMode("monaco");
$("mode-discover").onclick = () => setMode("discover");
$("partners-only").addEventListener("change", e => { partnersOnly = e.target.checked; closePopup(); refreshPins(); render(); });
$("show-mon").addEventListener("change", e => { showMon = e.target.checked; closePopup(); refreshPins(); render(); });

// Add a missing shop
let newLoc = null, picking = false, pickMarker = null;
$("as-region").innerHTML = REGIONS.map(r => `<option>${esc(r)}</option>`).join("");
function nearestRegion(lat, lng) {
  let best = null, d = Infinity;
  SHOPS.forEach(s => { const dd = (s.lat - lat) ** 2 + (s.lng - lng) ** 2; if (dd < d) { d = dd; best = s; } });
  return best?.region;
}
function setNewLoc(lat, lng, how, address) {
  newLoc = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, address: address || null };
  const r = nearestRegion(lat, lng); if (r) $("as-region").value = r;
  $("as-loc").textContent = `Location set (${how})${address ? ": " + address : ""}.`;
  if (pickMarker) pickMarker.remove();
  const pe = document.createElement("div"); pe.className = "mk mk-s"; pe.innerHTML = '<div class="pin fresh sel"><b>+</b></div>';
  pickMarker = new maplibregl.Marker({ element: pe, anchor: "bottom" }).setLngLat([newLoc.lng, newLoc.lat]).addTo(map);
  map.easeTo({ center: [newLoc.lng, newLoc.lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  dupHint();
}
function asMsg(text, ok) { $("as-msg").textContent = text; $("as-msg").className = "msg " + (ok ? "ok" : "err"); $("as-msg").hidden = false; }
$("add-shop").onclick = () => {
  if (!session) { openAuth("signup"); return; }
  newLoc = null; $("as-name").value = ""; $("as-town").value = ""; $("as-paste").value = ""; $("as-loc").textContent = "No location set yet.";
  $("as-msg").hidden = true; $("as-save").disabled = false; $("as-dup").hidden = true;
  if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  $("addshop").showModal();
};
$("addshop-close").onclick = () => { $("addshop").close(); if (pickMarker) { pickMarker.remove(); pickMarker = null; } };
$("as-here").onclick = () => {
  if (!navigator.geolocation) return asMsg("Your browser can't share your location. Tap it on the map instead.");
  $("as-loc").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    p => setNewLoc(p.coords.latitude, p.coords.longitude, "your current location"),
    () => { $("as-loc").textContent = "No location set yet."; asMsg("Couldn't get your location. Tap it on the map instead."); },
    { enableHighAccuracy: true, timeout: 10000 });
};
// Paste from Google Maps: a link, coordinates, an address, or the text Google's Share button copies
const inNZ = (lat, lng) => lat > -47.6 && lat < -34 && lng > 166 && lng < 179;
function coordsFrom(t) {
  const pats = [/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/];
  for (const re of pats) {
    const m = t.match(re); if (!m) continue;
    let lat = +m[1], lng = +m[2];
    if (lat > 0 && inNZ(-lat, lng)) lat = -lat; // "40.22 S" style without the minus
    if (inNZ(lat, lng)) return { lat, lng };
  }
  return null;
}
function townFrom(a) { return a?.suburb || a?.town || a?.city || a?.village || a?.hamlet || ""; }
async function geocode(q) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=nz&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { "Accept-Language": "en-NZ" } });
  if (!r.ok) throw new Error("geocode " + r.status);
  return (await r.json())[0] || null;
}
async function reverseTown(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en-NZ" } });
    return r.ok ? townFrom((await r.json()).address) : "";
  } catch { return ""; }
}
$("as-find").onclick = async () => {
  const raw = $("as-paste").value.trim();
  $("as-msg").hidden = true;
  if (!raw) return asMsg("Paste a Google Maps link, the address, or the coordinates first.");
  // Name from a full Google Maps link (…/maps/place/Kebab+%26+Chips/…)
  const pm = raw.match(/\/maps\/place\/([^/@?]+)/);
  if (pm && !$("as-name").value.trim()) $("as-name").value = decodeURIComponent(pm[1].replace(/\+/g, " ")).slice(0, 80);
  const c = coordsFrom(raw);
  if (c) {
    setNewLoc(c.lat, c.lng, "from what you pasted");
    if (!$("as-town").value.trim()) reverseTown(c.lat, c.lng).then(t => { if (t && !$("as-town").value.trim()) $("as-town").value = t; });
    return;
  }
  // Google's Share text is usually "Name\nAddress\nhttps://maps.app.goo.gl/…": short links can't be opened from here, so use the address lines
  const lines = raw.split(/\n+/).map(l => l.trim()).filter(l => l && !/^https?:/i.test(l));
  if (!lines.length) return asMsg("That short Google link can't be opened from here. In Google Maps, copy the address (or press and hold the pin to copy its coordinates) and paste that instead.");
  let addr = lines.find(l => /\d/.test(l) && /[a-z]{3}/i.test(l)) || lines[lines.length - 1];
  if (lines.length > 1 && lines[0] !== addr && !$("as-name").value.trim()) $("as-name").value = lines[0].slice(0, 80);
  $("as-find").disabled = true; $("as-loc").textContent = "Looking up that address…";
  try {
    let hit = await geocode(addr);
    if (!hit && $("as-town").value.trim()) hit = await geocode(addr + ", " + $("as-town").value.trim());
    if (!hit) { $("as-loc").textContent = newLoc ? $("as-loc").textContent : "No location set yet."; return asMsg("Couldn't find that address. Check the spelling, or paste the coordinates from Google Maps instead."); }
    const lat = +hit.lat, lng = +hit.lon;
    if (!inNZ(lat, lng)) return asMsg("That address isn't in New Zealand.");
    const a = hit.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    setNewLoc(lat, lng, "found the address", street || addr.split(",")[0]);
    if (!$("as-town").value.trim()) { const t = townFrom(a); if (t) $("as-town").value = t; }
  } catch (e) {
    console.error(e); asMsg("Couldn't look up the address right now. Paste the coordinates instead, or tap it on the map.");
    if (!newLoc) $("as-loc").textContent = "No location set yet.";
  } finally { $("as-find").disabled = false; }
};
// Warn if the shop looks like one that's already on the map
function dupHint() {
  const name = $("as-name").value.trim(), town = $("as-town").value.trim();
  const box = $("as-dup");
  if (name.length < 3) { box.hidden = true; return; }
  const words = normQ(name).trim().split(" ").filter(w => w.length > 2 && !["kebab", "kebabs", "turkish", "the", "and", "cafe", "grill", "house", "takeaways"].includes(w));
  const hits = SHOPS.filter(s => {
    const n = normQ(s.name);
    const nameHit = words.length ? words.every(w => n.includes(" " + w)) : normQ(s.name).trim() === normQ(name).trim();
    const townHit = !town || normQ(`${s.town} ${s.address || ""}`).includes(normQ(town).trim().split(" ")[0]) || (newLoc && Math.hypot(s.lat - newLoc.lat, s.lng - newLoc.lng) < 0.05);
    return nameHit && townHit;
  }).slice(0, 3);
  box.hidden = !hits.length;
  box.innerHTML = hits.length ? `Already on the map? ` + hits.map(s => `<button type="button" class="linkish" data-dup="${esc(s.id)}">${esc(s.name)}, ${esc(s.town)}</button>`).join(" · ") : "";
}
["as-name", "as-town"].forEach(id => $(id).addEventListener("input", dupHint));
$("as-dup").addEventListener("click", e => {
  const id = e.target.dataset?.dup; if (!id) return;
  $("addshop").close(); if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  if (mode !== "discover") setMode("discover");
  openShop(id);
});
$("as-paste").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("as-find").click(); } });
$("as-paste").addEventListener("paste", () => setTimeout(() => $("as-find").click(), 0));

$("as-pick").onclick = () => {
  picking = true; $("addshop").close();
  document.body.classList.add("picking"); $("pickbar").hidden = false;
  if (window.innerWidth <= 820) document.querySelector(".map-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
};
function endPick() { picking = false; document.body.classList.remove("picking"); $("pickbar").hidden = true; $("addshop").showModal(); }
$("pick-cancel").onclick = endPick;
map.on("click", e => { if (!picking) return; setNewLoc(e.lngLat.lat, e.lngLat.lng, "tapped on the map"); endPick(); });
const slug = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
$("addshop-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("as-name").value.trim(), town = $("as-town").value.trim(), region = $("as-region").value;
  if (name.length < 2) return asMsg("Add the shop's name.");
  if (town.length < 2) return asMsg("Add the town or suburb.");
  if (!newLoc) return asMsg("Set where the shop is: paste it from Google Maps, use your location, or tap the map.");
  if (newLoc.lat < -47.6 || newLoc.lat > -34 || newLoc.lng < 166 || newLoc.lng > 179) return asMsg("That spot isn't in New Zealand. Try tapping the map again.");
  const near = SHOPS.find(s => (s.lat - newLoc.lat) ** 2 + (s.lng - newLoc.lng) ** 2 < 0.0004 ** 2 * 4 && slug(s.name) === slug(name));
  if (near) return asMsg(`${near.name} in ${near.town} is already on the map.`);
  $("as-save").disabled = true; $("as-save").textContent = "Adding…";
  const row = { id: `${slug(name + "-" + town)}-${Math.random().toString(36).slice(2, 6)}`, name, town, region, lat: newLoc.lat, lng: newLoc.lng, address: newLoc.address || null, source: "user", added_by: session.user.id };
  const { error } = await sb.from("shops").insert(row);
  $("as-save").textContent = "Add shop";
  if (error) { console.error(error); $("as-save").disabled = false; return asMsg("Couldn't add the shop. Check your connection and try again."); }
  SHOPS.push({ ...row, monaco_score: null, legacy: null, score: null });
  $("addshop").close();
  if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  if (mode !== "discover") setMode("discover"); else { refreshPins(); render(); }
  openShop(row.id);
});

// ---------- Admin: partner settings in a shop card ----------
function openPartnerSettings(s) {
  const d = $("partner-dlg");
  d.dataset.shop = s.id;
  $("partner-title").textContent = s.name;
  $("partner-where").textContent = s.address || s.town;
  d.querySelector(".ap-body").innerHTML = "Loading…";
  d.showModal();
  loadAdminPartner(d);
}
$("partner-close").onclick = () => $("partner-dlg").close();
$("partner-dlg").addEventListener("click", ev => {
  const ap = ev.target.closest("[data-ap]");
  if (ap) adminPartnerAction(ap);
  else if (ev.target === $("partner-dlg")) $("partner-dlg").close();
});
async function loadAdminPartner(d) {
  const shopId = d.dataset.shop, p = PARTNERS[shopId], body = d.querySelector(".ap-body");
  let staffHtml = "";
  if (p) {
    const { data: staff } = await sb.rpc("admin_list_staff", { p_shop: shopId });
    staffHtml = `<div class="ap-staff">${(staff || []).map(u => `<div>${esc(u.name)} <small>${esc(u.email)}</small> <button type="button" class="auth-switch" data-ap="unstaff" data-user="${u.user_id}">remove</button></div>`).join("") || "<small>No staff yet.</small>"}</div>
      <div class="ap-row"><input type="email" placeholder="Staff member's email" data-ap-email><button type="button" class="btn ghost" data-ap="staff">Add staff</button></div>
      <small>They need to make a normal account on the site first, using that email.</small>`;
  }
  body.innerHTML = `
    <label class="ap-row"><span>Partner shop</span><input type="checkbox" data-ap="toggle" ${p?.active ? "checked" : ""}></label>
    <label class="ap-row"><span>Average kebab price $</span><input type="number" min="5" max="100" step="0.5" value="${p ? num(p.avg_price) : 18}" data-ap-price><button type="button" class="btn ghost" data-ap="price">Save</button></label>
    ${staffHtml}
    <p class="ap-msg"></p>`;
}
async function adminPartnerAction(btn) {
  const d = btn.closest(".admin-partner"), shopId = d.dataset.shop, msg = d.querySelector(".ap-msg");
  const price = parseFloat(d.querySelector("[data-ap-price]")?.value) || 18;
  const say = t => { if (msg) msg.textContent = t; };
  let error = null;
  if (btn.dataset.ap === "toggle") ({ error } = await sb.rpc("admin_set_partner", { p_shop: shopId, p_active: btn.checked, p_avg_price: price }));
  else if (btn.dataset.ap === "price") ({ error } = await sb.rpc("admin_set_partner", { p_shop: shopId, p_active: PARTNERS[shopId]?.active ?? true, p_avg_price: price }));
  else if (btn.dataset.ap === "staff") {
    const email = d.querySelector("[data-ap-email]").value.trim();
    const r = await sb.rpc("admin_add_staff", { p_shop: shopId, p_email: email }); error = r.error;
    if (!error && r.data?.status === "no_account") return say(`No account uses ${email} yet. Ask them to sign up on the site first.`);
  } else if (btn.dataset.ap === "unstaff") ({ error } = await sb.rpc("admin_remove_staff", { p_shop: shopId, p_user: btn.dataset.user }));
  if (error) { console.error(error); return say("Couldn't save that. Try again."); }
  await loadPartners();
  const shop = SHOPS.find(s => s.id === shopId);
  refreshPins();
  if (openPopup && shop) refreshPopup(shop);
  await loadAdminPartner(d);
  d.querySelector(".ap-msg").textContent = "Saved.";
}

// ---------- My Kebab Crew card ----------
let cardTimer = null, cardChannel = null, cardExpires = 0;
async function myScans() {
  const { data } = await sb.from("scans").select("shop_id, stamp_no, is_reward, scan_day, created_at").eq("user_id", session.user.id).order("created_at", { ascending: false });
  return data || [];
}
function drawQR(text) {
  const qr = qrcode(0, "M"); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), c = $("card-qr"), px = 8, q = 3, size = (n + q * 2) * px;
  c.width = c.height = size;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#12183A";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + q) * px, (r + q) * px, px, px);
}
async function refreshToken() {
  const { data, error } = await sb.rpc("issue_card_token");
  if (error || !data?.token) { $("card-status").textContent = "Couldn't load your card. Check your connection."; return; }
  drawQR(data.token);
  cardExpires = Date.now() + 30000;
  $("card-qr").classList.remove("stale");
}
function tickCard() {
  const left = Math.max(0, cardExpires - Date.now());
  $("card-ring").style.setProperty("--p", (left / 30000).toFixed(3));
  $("card-clock").textContent = new Date().toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  if (left <= 0) refreshToken();
}
async function renderCardStamps() {
  const scans = await myScans();
  const n = SETTINGS.stamps_needed, byShop = {};
  scans.forEach(sc => { (byShop[sc.shop_id] ||= []).push(sc); });
  const shopsVisited = Object.keys(byShop).map(id => SHOPS.find(s => s.id === id)).filter(Boolean);
  const regions = new Set(shopsVisited.map(s => s.region));
  $("card-passport").innerHTML = `
    <div class="pp"><b>${shopsVisited.length}</b><span>shops</span></div>
    <div class="pp"><b>${regions.size}</b><span>regions</span></div>
    <div class="pp"><b>${scans.length}</b><span>kebabs scanned</span></div>`;
  const badges = [[1, "First scan"], [5, "5 shops"], [10, "10 shops"], [25, "25 shops"]].filter(([k]) => shopsVisited.length >= k).map(([, l]) => l);
  if (regions.size >= 3) badges.push("3 regions");
  if (regions.has("Northland") && regions.has("Southland")) badges.push("North to South");
  $("card-badges").innerHTML = badges.map(b => `<span class="pbadge">${esc(b)}</span>`).join("");
  $("card-cards").innerHTML = shopsVisited.length ? shopsVisited.map(s => {
    const list = byShop[s.id], have = list.length % n, last = list[0];
    const rewardToday = last.is_reward && last.scan_day === new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
    const dots = Array.from({ length: n }, (_, i) => `<i class="${i < (rewardToday ? n : have) ? "on" : ""}${i === n - 1 ? " last" : ""}"></i>`).join("");
    return `<div class="stampcard"><div><b>${esc(s.name)}</b><small>${esc(s.town)}</small></div><div class="dots">${dots}</div>
      <small class="next">${rewardToday ? `Reward used today: ${esc(SETTINGS.reward_text)}` : have === n - 1 ? `Next kebab here is ${esc(SETTINGS.reward_text)}!` : `${n - 1 - have} more until ${esc(SETTINGS.reward_text)}`}</small></div>`;
  }).join("") : `<p class="fine">No stamps yet. Look for the partner badge on the map, then show this card when you order.</p>`;
}
async function openCard() {
  if (!session) { openAuth("signup"); return; }
  $("card-name").textContent = profile?.display_name || "You";
  $("card-avatar").outerHTML = avatarHtml(profile, "card-av").replace('class="avatar card-av"', 'class="avatar card-av" id="card-avatar"');
  $("card-rule").textContent = `Every ${ordinal(SETTINGS.stamps_needed)} kebab at the same partner shop is ${SETTINGS.reward_text}.`;
  $("card-status").textContent = "";
  $("card-result").hidden = true;
  $("card").showModal();
  await refreshToken();
  clearInterval(cardTimer); cardTimer = setInterval(tickCard, 250);
  renderCardStamps();
  // live update when a shop scans this card
  cardChannel = sb.channel("my-scans-" + session.user.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "scans", filter: `user_id=eq.${session.user.id}` }, payload => onScanned(payload.new))
    .subscribe();
}
function onScanned(sc) {
  const s = SHOPS.find(x => x.id === sc.shop_id), n = SETTINGS.stamps_needed;
  $("card-result").innerHTML = sc.is_reward
    ? `<b>Reward unlocked!</b><span>${esc(SETTINGS.reward_text)} on this kebab at ${esc(s?.name || "this shop")}.</span>`
    : `<b>Stamp ${sc.stamp_no} of ${n}</b><span>at ${esc(s?.name || "this shop")}. ${n - sc.stamp_no} more until ${esc(SETTINGS.reward_text)}.</span>`;
  $("card-result").className = "card-result" + (sc.is_reward ? " reward" : "");
  $("card-result").hidden = false;
  if (navigator.vibrate) navigator.vibrate(sc.is_reward ? [80, 60, 80, 60, 160] : 80);
  renderCardStamps();
  refreshToken();
  if (s) $("card-rate").innerHTML = `<button type="button" class="btn wide" data-card-rate="${esc(s.id)}">Rate this kebab</button>`;
}
function closeCard() {
  clearInterval(cardTimer); cardTimer = null;
  if (cardChannel) { sb.removeChannel(cardChannel); cardChannel = null; }
  $("card-rate").innerHTML = "";
  if ($("card").open) $("card").close();
}
$("card-close").onclick = closeCard;
$("card").addEventListener("close", closeCard);
$("card").addEventListener("click", e => {
  const b = e.target.closest("[data-card-rate]");
  if (b) { const s = SHOPS.find(x => x.id === b.dataset.cardRate); closeCard(); if (s) openRate(s); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && $("card").open) refreshToken(); });

// ---------- Start ----------
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    session = data.session;
    await Promise.all([loadShops(), loadStats(), loadMine(), loadMonaco(), loadPartners()]);
    try { if (localStorage.getItem("kebab.mode") === "discover") mode = "discover"; } catch {}
    applyMonaco();
    if (mode === "discover") setMode("discover"); else render();
  } catch (err) {
    console.error(err);
    $("list").innerHTML = `<p class="empty">Couldn't load the shops. Check your connection and refresh the page.</p>`;
    renderAccount();
  }
  booted = true;
  setTimeout(() => map.resize(), 200);
})();
