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
let STATS = {};        // shop_id -> {avg, n, meat, sauce, bread, value}
let MON = {};          // shop_id -> Monaco's breakdown rating row
let MINE = {};         // shop_id -> my rating row
let ADMIN_IDS = [];
let session = null, profile = null;
let activeRegion = "All", view = "best", todoOnly = false, mineOnly = false;
const TOP = new Set();
const MARKERS = {};

// ---------- Map ----------
const NZ_BOUNDS = L.latLngBounds([[-46.9, 166.4], [-34.3, 178.6]]);
const map = L.map("map", { zoomControl: false, attributionControl: false, minZoom: 4.5, maxZoom: 14, zoomSnap: 0.5, maxBounds: [[-50, 160], [-31, 184]] });
map.fitBounds(NZ_BOUNDS, { padding: [10, 10] });
L.control.zoom({ position: "bottomright" }).addTo(map);
const css = () => getComputedStyle(document.documentElement);
const landStyle = () => ({ color: css().getPropertyValue("--land-line").trim(), weight: 1.2, fillColor: css().getPropertyValue("--land").trim(), fillOpacity: 1, interactive: false });
const land = L.layerGroup().addTo(map);
fetch("nz.json").then(r => r.json()).then(polys => polys.forEach(r => land.addLayer(L.polygon(r.map(([x, y]) => [y, x]), landStyle())))).catch(() => {});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => land.eachLayer(l => l.setStyle(landStyle())));

map.createPane("labels"); map.getPane("labels").style.zIndex = 450; map.getPane("labels").style.pointerEvents = "none";
CITIES.forEach(([n, la, ln]) => L.marker([la, ln], { pane: "labels", interactive: false, icon: L.divIcon({ className: "", html: `<div class="city-label">${n}</div>`, iconSize: [120, 14], iconAnchor: [-14, 22] }) }).addTo(map));

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 42, spiderfyOnMaxZoom: true,
  iconCreateFunction: c => {
    const scores = c.getAllChildMarkers().map(m => m.shop.score).filter(s => s != null);
    const best = scores.length ? Math.max(...scores) : null;
    return L.divIcon({ className: "", iconSize: [50, 50], iconAnchor: [25, 25], html: `<div class="clus tier-${tier(best)}"><div><b>${c.getChildCount()}</b><span>best ${fmt(best)}</span></div></div>` });
  }
});
map.addLayer(cluster);

const pinIcon = s => L.divIcon({ className: "", iconSize: [40, 40], iconAnchor: [20, 48], popupAnchor: [0, -44], html: `<div class="drop"><div class="pin tier-${tier(s.score)}${TOP.has(s.id) ? " top" : ""}"><b>${s.score == null ? "?" : fmt(s.score)}</b></div></div>` });
function buildMarkers() {
  cluster.clearLayers();
  SHOPS.forEach(s => {
    const m = L.marker([s.lat, s.lng], { title: `${s.name}, ${s.town}`, riseOnHover: true, icon: pinIcon(s) });
    m.shop = s;
    m.bindPopup(() => popupHtml(s), { maxWidth: 310, minWidth: 260, autoPanPadding: [20, 60] });
    MARKERS[s.id] = m;
    cluster.addLayer(m);
  });
}
function refreshPins() { SHOPS.forEach(s => MARKERS[s.id]?.setIcon(pinIcon(s))); cluster.refreshClusters(); }

// ---------- Popup ----------
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const NAV_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 2.3a1 1 0 0 0-1.1-.2l-18 8a1 1 0 0 0 .1 1.9l7.4 2 2 7.4a1 1 0 0 0 1.9.1l8-18a1 1 0 0 0-.3-1.2z"/></svg>';
function mapLinks(s) {
  const q = encodeURIComponent(`${s.name}, ${s.town}, New Zealand`);
  const links = [
    `<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${PIN_SVG}Google Maps</a>`,
    `<a class="maplink go" href="https://www.google.com/maps/dir/?api=1&destination=${q}" target="_blank" rel="noopener">${NAV_SVG}Directions</a>`
  ];
  if (IS_APPLE) links.push(`<a class="maplink" href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">${PIN_SVG}Apple Maps</a>`);
  return `<div class="maplinks">${links.join("")}</div>`;
}
function partsHtml(s) {
  const mon = MON[s.id], st = STATS[s.id];
  if (!mon && !st) return "";
  return `<div class="parts"><span class="ph"></span><span></span><span class="ph">Monaco</span><span class="ph">All</span>
    ${PARTS.map(([k, label]) => {
      const mv = mon ? num(mon[k]) : null, av = st ? st[k] : null;
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
    <p class="where">${esc(s.town)} · ${esc(s.region)}</p>
    ${mapLinks(s)}
    <div class="trio">
      <div><span>Monaco</span><b>${fmt1(s.score)}</b></div>
      <div><span>Everyone</span><b>${st ? fmt1(st.avg) : "–"}</b><em>${st ? st.n + (st.n === 1 ? " rating" : " ratings") : "no ratings yet"}</em></div>
      <div><span>You</span><b>${mine ? fmt1(num(mine.score)) : "–"}</b></div>
    </div>
    ${partsHtml(s)}
    ${monOrder ? `<p class="where">Monaco had: ${esc(monOrder)}</p>` : ""}
    ${action}
    <div class="reviews" hidden></div>
  </div>`;
}

let openPopup = null;
map.on("popupopen", e => {
  openPopup = e.popup;
  const el = e.popup.getElement().querySelector(".pop"); if (!el) return;
  loadReviews(SHOPS.find(x => x.id === el.dataset.id), e.popup);
});
map.on("popupclose", () => { openPopup = null; });
function refreshPopup(s) {
  if (!openPopup) return;
  openPopup.setContent(popupHtml(s)); openPopup.update();
  loadReviews(s, openPopup);
}
document.getElementById("map").addEventListener("click", async ev => {
  const btn = ev.target.closest(".pop [data-act]"); if (!btn) return;
  const s = SHOPS.find(x => x.id === btn.closest(".pop").dataset.id), act = btn.dataset.act;
  if (act === "login") openAuth("signup");
  else if (act === "rate") openRate(s);
  else if (act === "delrev") adminDelete(btn.closest("[data-rid]").dataset.rid, s);
});

async function loadReviews(s, popup) {
  const { data, error } = await sb.from("ratings").select("id, score, comment, style, meats, sauces, user_id, updated_at, profiles(display_name, is_admin, avatar_url)").eq("shop_id", s.id).order("updated_at", { ascending: false }).limit(20);
  const box = popup.getElement()?.querySelector(".reviews");
  if (!box || error) return;
  const rows = (data || []).filter(r => !r.profiles?.is_admin);
  if (!rows.length) return;
  box.innerHTML = rows.map(r => {
    const order = orderText(r);
    return `<div class="rev" data-rid="${r.id}">${avatarHtml(r.profiles, "sm")}<b>${esc(r.profiles?.display_name || "Someone")}</b> · ${fmt1(num(r.score))}/10
      ${profile?.is_admin && r.user_id !== session?.user.id ? ' <button class="auth-switch" type="button" data-act="delrev">remove</button>' : ""}
      ${order ? `<span class="order">${esc(order)}</span>` : ""}
      ${r.comment ? `<q>${esc(r.comment)}</q>` : ""}</div>`;
  }).join("");
  box.hidden = false;
}
async function adminDelete(id, s) {
  const { error } = await sb.from("ratings").delete().eq("id", id);
  if (!error) { await loadStats(); render(); refreshPopup(s); }
}

function openShop(id) {
  const m = MARKERS[id]; if (!m) return;
  cluster.zoomToShowLayer(m, () => m.openPopup());
  if (window.innerWidth <= 820) document.querySelector(".map-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
}
function flyTo(region) {
  const pts = SHOPS.filter(s => region === "All" || s.region === region).map(s => [s.lat, s.lng]);
  if (!pts.length) return;
  map.flyToBounds(region === "All" ? NZ_BOUNDS : L.latLngBounds(pts), { padding: [50, 50], maxZoom: 11, duration: 0.9 });
}

// ---------- Rating sheet ----------
let rateShop = null;
const draft = { style: null, meats: [], sauces: [], salads: [], meat: 7, sauce: 7, bread: 7, value: 7 };

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
  $("scores").innerHTML = PARTS.map(([k, label, hint]) => `
    <div class="sc">
      <span class="lab">${label}<small>${hint}</small></span>
      <span class="val"><button type="button" class="step" data-k="${k}" data-d="-0.1" aria-label="${label} down 0.1">−</button><output id="o-${k}">${fmt1(draft[k])}</output><button type="button" class="step" data-k="${k}" data-d="0.1" aria-label="${label} up 0.1">+</button></span>
      <input type="range" id="s-${k}" data-k="${k}" min="0.1" max="10" step="0.1" value="${draft[k]}" aria-label="${label} score">
    </div>`).join("");
  updateOverall();
}
function updateOverall() {
  const avg = (draft.meat + draft.sauce + draft.bread + draft.value) / 4;
  $("overall").textContent = fmt1(round1(avg));
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
    ? { style: mine.style, meats: [...(mine.meats || [])], sauces: [...(mine.sauces || [])], salads: [...(mine.salads || [])], meat: num(mine.meat), sauce: num(mine.sauce), bread: num(mine.bread), value: num(mine.value) }
    : { style: null, meats: [], sauces: [], salads: [], meat: 7, sauce: 7, bread: 7, value: 7 });
  $("rate-title").textContent = mine ? "Edit your rating" : "Rate this kebab";
  $("rate-where").textContent = `${s.name} · ${s.town}`;
  $("rate-comment").value = mine?.comment || "";
  $("comment-wrap").open = !!mine?.comment;
  document.querySelector("#rate details.more").open = !!(mine?.salads?.length);
  $("rate-delete").hidden = !mine;
  $("rate-msg").hidden = true;
  $("rate-save").disabled = false;
  $("rate-save").textContent = mine ? "Update rating" : "Save rating";
  renderPills(); renderScores();
  map.closePopup();
  $("rate").showModal();
}
$("rate").addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (pill) {
    const box = pill.parentElement, f = box.dataset.field, v = pill.dataset.v;
    if (box.hasAttribute("data-single")) draft[f] = draft[f] === v ? null : v;
    else draft[f] = draft[f].includes(v) ? draft[f].filter(x => x !== v) : [...draft[f], v];
    renderPills(); return;
  }
  const step = e.target.closest(".step");
  if (step) { setScore(step.dataset.k, draft[step.dataset.k] + parseFloat(step.dataset.d)); return; }
  if (e.target === $("rate")) $("rate").close(); // tap outside the card
});
$("rate").addEventListener("input", e => { if (e.target.matches("input[type=range]")) setScore(e.target.dataset.k, parseFloat(e.target.value)); });
$("rate-close").onclick = () => $("rate").close();

$("rate-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const s = rateShop, existing = MINE[s.id];
  const fields = { meat: draft.meat, sauce: draft.sauce, bread: draft.bread, value: draft.value, style: draft.style, meats: draft.meats, sauces: draft.sauces, salads: draft.salads, comment: $("rate-comment").value.trim() || null };
  $("rate-save").disabled = true; $("rate-save").textContent = "Saving…";
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
  if (profile?.is_admin) { MON[s.id] = data; applyMonaco(); }
  await loadStats();
  $("rate").close();
  render();
  openShop(s.id);
});
$("rate-delete").onclick = async () => {
  const s = rateShop;
  const { error } = await sb.from("ratings").delete().eq("shop_id", s.id).eq("user_id", session.user.id);
  if (error) { $("rate-msg").textContent = "Couldn't remove it. Try again."; $("rate-msg").className = "msg err"; $("rate-msg").hidden = false; return; }
  delete MINE[s.id];
  if (profile?.is_admin) { delete MON[s.id]; applyMonaco(); }
  await loadStats();
  $("rate").close();
  render();
};

// ---------- Panel ----------
function rowHtml(s) {
  const st = STATS[s.id], mine = MINE[s.id];
  const bits = [esc(s.town)];
  if (st) bits.push(`<span class="comm">Everyone ${fmt1(st.avg)} (${st.n})</span>`);
  if (mine && !profile?.is_admin) bits.push(`<span class="mine">You ${fmt1(num(mine.score))}</span>`);
  const redo = profile?.is_admin && !MON[s.id] ? '<span class="badge">re-rate</span>' : "";
  return `<button class="row" data-id="${esc(s.id)}">
    <span class="info"><span class="name">${esc(s.name)}${TOP.has(s.id) ? '<span class="crown" aria-label="Top pick">★</span>' : ""}${redo}</span>
    <span class="where">${bits.join(" · ")}</span></span>
    <span class="score tier-${tier(s.score)}">${fmt(s.score)}</span></button>`;
}
function presentRegions() { return REGIONS.filter(r => SHOPS.some(s => s.region === r)); }

function render() {
  const inRegion = SHOPS.filter(s => activeRegion === "All" || s.region === activeRegion);
  const scored = inRegion.filter(s => s.score != null);
  const best = scored.reduce((a, b) => (b.score > (a?.score ?? -1) ? b : a), null);
  const avg = scored.reduce((t, s) => t + s.score, 0) / (scored.length || 1);
  $("stats").innerHTML = `
    <div class="stat"><b>${inRegion.length}</b><span>shops tried</span></div>
    <div class="stat"><b>${scored.length ? avg.toFixed(1) : "–"}</b><span>Monaco's average</span></div>
    <div class="stat best"><b title="${esc(best?.name)}">${best ? esc(best.name) : "–"}</b><span>top pick ${best ? fmt1(best.score) + "/10" : ""}</span></div>`;

  $("chips").innerHTML = ["All", ...presentRegions()].map(r => {
    const n = r === "All" ? SHOPS.length : SHOPS.filter(s => s.region === r).length;
    return `<button class="chip" data-region="${esc(r)}" aria-pressed="${r === activeRegion}">${r === "All" ? "All NZ" : esc(r)}<small>${n}</small></button>`;
  }).join("");

  $("tools").hidden = view !== "all";
  let html = "";
  if (profile?.is_admin) {
    const left = SHOPS.filter(s => !MON[s.id]).length;
    html += `<div class="adminbar"><span>${left ? `<strong>${left}</strong> shops still need your breakdown` : "All your shops have breakdowns"}</span>${left ? `<button class="btn ghost" type="button" id="todo">${todoOnly ? "Show all" : "Show them"}</button>` : ""}</div>`;
  }
  if (view === "best" && !todoOnly) {
    const regs = activeRegion === "All" ? presentRegions() : [activeRegion];
    regs.forEach(rg => {
      const list = SHOPS.filter(s => s.region === rg && s.score != null).sort((a, b) => b.score - a.score).slice(0, activeRegion === "All" ? 1 : 3);
      if (list.length) html += `<div class="region-head">${esc(rg)}</div>` + list.map(rowHtml).join("");
    });
  } else {
    const q = $("search").value.trim().toLowerCase();
    let list = inRegion.filter(s => !q || (s.name + " " + s.town).toLowerCase().includes(q));
    if (todoOnly) list = list.filter(s => !MON[s.id]);
    if (mineOnly) list = list.filter(s => MINE[s.id]);
    if (mineOnly) html += `<div class="adminbar"><span>Showing the <strong>${list.length}</strong> kebabs you've rated</span><button class="btn ghost" type="button" id="mine-off">Show all</button></div>`;
    const cmp = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
      community: (a, b) => (STATS[b.id]?.avg ?? -1) - (STATS[a.id]?.avg ?? -1),
      north: (a, b) => b.lat - a.lat,
      az: (a, b) => a.name.localeCompare(b.name)
    }[todoOnly ? "north" : $("sort").value];
    list.sort(cmp);
    html += list.length ? list.map(rowHtml).join("") : `<p class="empty">${q ? `No shops match "${esc(q)}".` : "Nothing here."}</p>`;
  }
  $("list").innerHTML = html || `<p class="empty">No shops here yet.</p>`;
  renderCompare();
  renderAccount();
}

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
    const diffs = PARTS.map(([k, label]) => [label, withParts.reduce((t, s) => t + (num(MINE[s.id][k]) - num(MON[s.id][k])), 0) / withParts.length]);
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
    <button type="button" id="m-profile">Edit profile & photo</button>
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
// Crop to a centred square and shrink, so uploads stay small and fast
function squareJpeg(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas"); c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
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
  TOP.clear();
  REGIONS.forEach(rg => {
    const scored = SHOPS.filter(s => s.region === rg && s.score != null);
    if (!scored.length) return;
    const max = Math.max(...scored.map(s => s.score));
    scored.filter(s => s.score === max).forEach(s => TOP.add(s.id));
  });
  refreshPins();
}
async function loadShops() {
  const { data, error } = await sb.from("shops").select("id,name,town,region,lat,lng,monaco_score").eq("active", true);
  if (error) throw error;
  SHOPS = data.map(r => ({ ...r, legacy: num(r.monaco_score), score: num(r.monaco_score) }));
}
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
  (data || []).forEach(r => STATS[r.shop_id] = { avg: num(r.avg_score), n: r.rating_count, meat: num(r.avg_meat), sauce: num(r.avg_sauce), bread: num(r.avg_bread), value: num(r.avg_value) });
}
async function loadMine() {
  MINE = {}; profile = null;
  if (!session) return;
  const [{ data: rows }, { data: prof }] = await Promise.all([
    sb.from("ratings").select("*").eq("user_id", session.user.id),
    sb.from("profiles").select("display_name, is_admin, avatar_url").eq("id", session.user.id).maybeSingle()
  ]);
  (rows || []).forEach(r => MINE[r.shop_id] = r);
  profile = prof;
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
function openAuth(mode) { setAuthMode(mode); map.closePopup(); $("auth").showModal(); }
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
    setTimeout(async () => { todoOnly = false; mineOnly = false; closeMenu(); await loadMine(); render(); map.closePopup(); }, 0);
  }
});

// ---------- Events ----------
document.addEventListener("click", async e => {
  const oa = e.target.closest("[data-open-auth]"); if (oa) { openAuth(oa.dataset.openAuth); return; }
  if (e.target.closest("#logout")) { closeMenu(); await sb.auth.signOut(); return; }
  if (e.target.closest("#todo")) { todoOnly = !todoOnly; render(); return; }
  if (e.target.closest("#mine-off")) { mineOnly = false; render(); return; }
  const chip = e.target.closest(".chip");
  if (chip) { activeRegion = chip.dataset.region; render(); flyTo(activeRegion); return; }
  const row = e.target.closest(".row");
  if (row) openShop(row.dataset.id);
});
$("tab-best").onclick = () => { view = "best"; todoOnly = false; mineOnly = false; $("tab-best").setAttribute("aria-selected", "true"); $("tab-all").setAttribute("aria-selected", "false"); render(); };
$("tab-all").onclick = () => { view = "all"; mineOnly = false; $("tab-all").setAttribute("aria-selected", "true"); $("tab-best").setAttribute("aria-selected", "false"); render(); };
$("search").addEventListener("input", render);
$("sort").addEventListener("change", render);
$("reset").onclick = () => { activeRegion = "All"; render(); flyTo("All"); map.closePopup(); };

// ---------- Start ----------
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    session = data.session;
    await Promise.all([loadShops(), loadStats(), loadMine(), loadMonaco()]);
    buildMarkers();
    applyMonaco();
    render();
  } catch (err) {
    console.error(err);
    $("list").innerHTML = `<p class="empty">Couldn't load the shops. Check your connection and refresh the page.</p>`;
    renderAccount();
  }
  booted = true;
  setTimeout(() => map.invalidateSize(), 200);
})();
