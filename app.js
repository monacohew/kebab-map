// Monaco's Kebab Map — shared ratings with accounts (Supabase)
const SUPABASE_URL = "https://riwwsasulkhmdasenbwy.supabase.co";
const SUPABASE_KEY = "sb_publishable_2foFxO37pS4pih6qMWj8ig_RrxhJiTK"; // public key, safe in the browser; access is limited by database rules
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const REGIONS = ["Northland","Auckland","Waikato","Bay of Plenty","Gisborne","Taranaki","Manawatū-Whanganui","Hawke's Bay","Wellington","Nelson Tasman","Marlborough","West Coast","Canterbury","Otago","Southland"];
const CITIES = [["Auckland",-36.85,174.76],["Hamilton",-37.79,175.28],["Tauranga",-37.69,176.17],["Napier",-39.49,176.91],["New Plymouth",-39.06,174.08],["Palmerston North",-40.35,175.61],["Wellington",-41.29,174.78],["Nelson",-41.27,173.28],["Christchurch",-43.53,172.64],["Dunedin",-45.87,170.50],["Queenstown",-45.03,168.66],["Invercargill",-46.41,168.35],["Whangārei",-35.73,174.32],["Gisborne",-38.66,178.02]];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => v == null ? null : Number(v);
const tier = s => s == null ? "n" : s >= 9 ? "9" : s >= 8 ? "8" : s >= 7 ? "7" : s >= 5 ? "5" : "0";
const fmt = s => s == null ? "–" : (Number.isInteger(s) ? String(s) : s.toFixed(1));

// ---------- State ----------
let SHOPS = [];             // {id,name,town,region,lat,lng,score,note}
let STATS = {};             // shop_id -> {avg, n}
let MINE = {};              // shop_id -> {score, comment}
let session = null, profile = null;
let activeRegion = "All", view = "best";
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
    return L.divIcon({ className: "", iconSize: [46, 46], iconAnchor: [23, 23], html: `<div class="clus tier-${tier(best)}"><div><b>${c.getChildCount()}</b><span>best ${fmt(best)}</span></div></div>` });
  }
});
map.addLayer(cluster);

function buildMarkers() {
  cluster.clearLayers();
  SHOPS.forEach(s => {
    const m = L.marker([s.lat, s.lng], {
      title: `${s.name}, ${s.town}`, riseOnHover: true,
      icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 41], popupAnchor: [0, -38], html: `<div class="drop"><div class="pin tier-${tier(s.score)}${TOP.has(s.id) ? " top" : ""}"><b>${s.score == null ? "?" : fmt(s.score)}</b></div></div>` })
    });
    m.shop = s;
    m.bindPopup(() => popupHtml(s), { maxWidth: 300, minWidth: 250, autoPanPadding: [20, 60] });
    MARKERS[s.id] = m;
    cluster.addLayer(m);
  });
}

// ---------- Popup ----------
function verdict(s, v) {
  if (v == null) return "";
  if (s.score == null) return "Monaco hasn't scored this one yet.";
  const d = v - s.score;
  if (d === 0) return "Spot on. You and Monaco agree.";
  return d > 0 ? `You rate it ${fmt(Math.abs(d))} higher than Monaco.` : `You rate it ${fmt(Math.abs(d))} lower than Monaco.`;
}
function popupHtml(s) {
  const st = STATS[s.id], mine = MINE[s.id];
  const yours = mine ? fmt(mine.score) : "–";
  let rate;
  if (!session) {
    rate = `<button class="btn wide" type="button" data-act="login">Log in to add your score</button>`;
  } else {
    const v = mine ? mine.score : 7;
    rate = `<label for="r-${s.id}">${mine ? "Your score" : "Add your score"}</label>
      <div class="sliderline"><input id="r-${s.id}" type="range" min="0" max="10" step="0.5" value="${v}"><output>${fmt(v)}</output></div>
      <textarea id="c-${s.id}" maxlength="280" placeholder="What was it like? (optional)">${esc(mine?.comment || "")}</textarea>
      <div class="actions"><button class="btn" type="button" data-act="save">${mine ? "Update" : "Save score"}</button>
      ${mine ? '<button class="btn ghost" type="button" data-act="del">Remove</button>' : ""}
      <span class="status" aria-live="polite"></span></div>
      <p class="verdict">${verdict(s, mine?.score)}</p>`;
  }
  return `<div class="pop" data-id="${esc(s.id)}">
    <h3>${esc(s.name)}${TOP.has(s.id) ? '<span class="crown" title="Monaco\'s top pick in region">★</span>' : ""}</h3>
    <p class="where">${esc(s.town)} · ${esc(s.region)}</p>
    <div class="trio">
      <div><span>Monaco</span><b>${fmt(s.score)}</b></div>
      <div><span>Everyone</span><b>${st ? fmt(st.avg) : "–"}</b><em>${st ? st.n + (st.n === 1 ? " rating" : " ratings") : "no ratings yet"}</em></div>
      <div><span>You</span><b class="mine-val">${yours}</b></div>
    </div>
    ${rate}
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
// Delegated handlers so they survive popup content refreshes
document.getElementById("map").addEventListener("input", ev => {
  if (ev.target.matches(".pop input[type=range]")) ev.target.parentElement.querySelector("output").textContent = fmt(parseFloat(ev.target.value));
});
document.getElementById("map").addEventListener("click", async ev => {
  const btn = ev.target.closest(".pop [data-act]"); if (!btn) return;
  const el = btn.closest(".pop"), s = SHOPS.find(x => x.id === el.dataset.id), act = btn.dataset.act;
  if (act === "login") { openAuth("signup"); return; }
  if (act === "delrev") { await adminDelete(btn.closest("[data-rid]").dataset.rid, s); return; }
  const status = el.querySelector(".status"), btns = el.querySelectorAll(".actions .btn");
  btns.forEach(b => b.disabled = true); status.textContent = "Saving…";
  try {
    if (act === "save") {
      const score = parseFloat(el.querySelector("input[type=range]").value);
      const comment = el.querySelector("textarea").value.trim() || null;
      const { error } = await sb.from("ratings").upsert({ shop_id: s.id, user_id: session.user.id, score, comment }, { onConflict: "shop_id,user_id" });
      if (error) throw error;
      MINE[s.id] = { score, comment };
    } else if (act === "del") {
      const { error } = await sb.from("ratings").delete().eq("shop_id", s.id).eq("user_id", session.user.id);
      if (error) throw error;
      delete MINE[s.id];
    }
    await loadStats();
    render();
    refreshPopup(s);
  } catch (err) {
    status.textContent = "Couldn't save. Check your connection and try again.";
    btns.forEach(b => b.disabled = false);
    console.error(err);
  }
});

async function loadReviews(s, popup) {
  const { data, error } = await sb.from("ratings").select("id, score, comment, user_id, updated_at, profiles(display_name)").eq("shop_id", s.id).order("updated_at", { ascending: false }).limit(20);
  const box = popup.getElement()?.querySelector(".reviews");
  if (!box || error || !data?.length) return;
  box.innerHTML = data.map(r => `<div class="rev" data-rid="${r.id}"><b>${esc(r.profiles?.display_name || "Someone")}</b> · ${fmt(num(r.score))}/10
    ${profile?.is_admin && r.user_id !== session?.user.id ? ' <button class="auth-switch" type="button" data-act="delrev">remove</button>' : ""}
    ${r.comment ? `<q>${esc(r.comment)}</q>` : ""}</div>`).join("");
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

// ---------- Panel ----------
function rowHtml(s) {
  const st = STATS[s.id], mine = MINE[s.id];
  const bits = [esc(s.town)];
  if (st) bits.push(`<span class="comm">Everyone ${fmt(st.avg)} (${st.n})</span>`);
  if (mine) bits.push(`<span class="mine">You ${fmt(mine.score)}</span>`);
  return `<button class="row" data-id="${esc(s.id)}">
    <span class="info"><span class="name">${esc(s.name)}${TOP.has(s.id) ? '<span class="crown" aria-label="Top pick">★</span>' : ""}</span>
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
    <div class="stat best"><b title="${esc(best?.name)}">${best ? esc(best.name) : "–"}</b><span>top pick ${best ? fmt(best.score) + "/10" : ""}</span></div>`;

  $("chips").innerHTML = ["All", ...presentRegions()].map(r => {
    const n = r === "All" ? SHOPS.length : SHOPS.filter(s => s.region === r).length;
    return `<button class="chip" data-region="${esc(r)}" aria-pressed="${r === activeRegion}">${r === "All" ? "All NZ" : esc(r)}<small>${n}</small></button>`;
  }).join("");

  $("tools").hidden = view !== "all";
  let html = "";
  if (view === "best") {
    const regs = activeRegion === "All" ? presentRegions() : [activeRegion];
    regs.forEach(rg => {
      const list = SHOPS.filter(s => s.region === rg && s.score != null).sort((a, b) => b.score - a.score).slice(0, activeRegion === "All" ? 1 : 3);
      if (list.length) html += `<div class="region-head">${esc(rg)}</div>` + list.map(rowHtml).join("");
    });
  } else {
    const q = $("search").value.trim().toLowerCase();
    const list = inRegion.filter(s => !q || (s.name + " " + s.town).toLowerCase().includes(q));
    const sort = $("sort").value;
    const cmp = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
      community: (a, b) => (STATS[b.id]?.avg ?? -1) - (STATS[a.id]?.avg ?? -1),
      north: (a, b) => b.lat - a.lat,
      az: (a, b) => a.name.localeCompare(b.name)
    }[sort];
    list.sort(cmp);
    html = list.length ? list.map(rowHtml).join("") : `<p class="empty">No shops match "${esc(q)}".</p>`;
  }
  $("list").innerHTML = html || `<p class="empty">No shops here yet.</p>`;
  renderCompare();
  renderAccount();
}

function renderCompare() {
  if (!session) {
    $("compare").innerHTML = `<h2>You vs Monaco</h2><p>Make a free account, score the shops you've been to, and see where you agree with Monaco and where you'd argue about it.</p><button class="btn" type="button" data-open-auth="signup">Create account</button>`;
    return;
  }
  const rated = SHOPS.filter(s => MINE[s.id] && s.score != null);
  if (!rated.length) {
    $("compare").innerHTML = `<h2>You vs Monaco</h2><p>Tap any pin and add your score. Once you've rated a few, you'll see how your taste compares.</p>`;
    return;
  }
  const gap = rated.reduce((t, s) => t + (MINE[s.id].score - s.score), 0) / rated.length;
  const agree = rated.filter(s => Math.abs(MINE[s.id].score - s.score) <= 0.5).length;
  const far = rated.reduce((a, b) => Math.abs(MINE[b.id].score - b.score) > Math.abs(MINE[a.id].score - a.score) ? b : a);
  const fd = MINE[far.id].score - far.score;
  $("compare").innerHTML = `<h2>You vs Monaco</h2>
    <p>You've scored <strong>${rated.length}</strong> of his shops and agree (within half a point) on <strong>${agree}</strong>.</p>
    <p>On average you rate <strong>${Math.abs(gap) < .05 ? "the same as him" : fmt(Math.abs(Math.round(gap * 10) / 10)) + (gap > 0 ? " higher" : " lower")}</strong>.</p>
    <p>${fd === 0 ? "No big disagreements yet." : `Biggest disagreement: <strong>${esc(far.name)}</strong>, ${esc(far.town)} (you ${fmt(MINE[far.id].score)}, Monaco ${fmt(far.score)}).`}</p>`;
}

function renderAccount() {
  $("account").innerHTML = session
    ? `<span class="who">Signed in as <b>${esc(profile?.display_name || session.user.email)}</b>${profile?.is_admin ? " · admin" : ""}</span><button class="btn ghost" type="button" id="logout">Log out</button>`
    : `<span class="who">Score shops and compare with Monaco</span><button class="btn" type="button" data-open-auth="login">Log in</button>`;
}

// ---------- Data ----------
async function loadShops() {
  const { data, error } = await sb.from("shops").select("id,name,town,region,lat,lng,monaco_score,note").eq("active", true);
  if (error) throw error;
  SHOPS = data.map(r => ({ ...r, score: num(r.monaco_score) }));
  TOP.clear();
  REGIONS.forEach(rg => {
    const scored = SHOPS.filter(s => s.region === rg && s.score != null);
    if (!scored.length) return;
    const max = Math.max(...scored.map(s => s.score));
    scored.filter(s => s.score === max).forEach(s => TOP.add(s.id));
  });
}
async function loadStats() {
  const { data } = await sb.from("shop_stats").select("*");
  STATS = {};
  (data || []).forEach(r => STATS[r.shop_id] = { avg: num(r.avg_score), n: r.rating_count });
}
async function loadMine() {
  MINE = {}; profile = null;
  if (!session) return;
  const [{ data: rows }, { data: prof }] = await Promise.all([
    sb.from("ratings").select("shop_id, score, comment").eq("user_id", session.user.id),
    sb.from("profiles").select("display_name, is_admin").eq("id", session.user.id).maybeSingle()
  ]);
  (rows || []).forEach(r => MINE[r.shop_id] = { score: num(r.score), comment: r.comment });
  profile = prof;
}

// ---------- Auth ----------
let authMode = "signup";
function setAuthMode(mode) {
  authMode = mode;
  const t = {
    signup: ["Join the kebab crew", "Make an account to score shops and see how you stack up against Monaco.", "Create account", "Already have an account?", "Log in"],
    login: ["Welcome back", "Log in to add and update your scores.", "Log in", "New here?", "Create an account"],
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

sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (event === "PASSWORD_RECOVERY") { setTimeout(() => { setAuthMode("newpass"); $("auth").showModal(); }, 0); }
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
    setTimeout(async () => { await loadMine(); render(); map.closePopup(); }, 0);
  }
});

// ---------- Events ----------
document.addEventListener("click", async e => {
  const oa = e.target.closest("[data-open-auth]"); if (oa) { openAuth(oa.dataset.openAuth); return; }
  if (e.target.closest("#logout")) { await sb.auth.signOut(); return; }
  const chip = e.target.closest(".chip");
  if (chip) { activeRegion = chip.dataset.region; render(); flyTo(activeRegion); return; }
  const row = e.target.closest(".row");
  if (row) openShop(row.dataset.id);
});
$("tab-best").onclick = () => { view = "best"; $("tab-best").setAttribute("aria-selected", "true"); $("tab-all").setAttribute("aria-selected", "false"); render(); };
$("tab-all").onclick = () => { view = "all"; $("tab-all").setAttribute("aria-selected", "true"); $("tab-best").setAttribute("aria-selected", "false"); render(); };
$("search").addEventListener("input", render);
$("sort").addEventListener("change", render);
$("reset").onclick = () => { activeRegion = "All"; render(); flyTo("All"); map.closePopup(); };

// ---------- Start ----------
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    session = data.session;
    await Promise.all([loadShops(), loadStats(), loadMine()]);
    buildMarkers();
    render();
  } catch (err) {
    console.error(err);
    $("list").innerHTML = `<p class="empty">Couldn't load the shops. Check your connection and refresh the page.</p>`;
    renderAccount();
  }
  setTimeout(() => map.invalidateSize(), 200);
})();
