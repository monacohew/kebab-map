// Kebab Crew for Shops: scan customer cards and see the numbers
const SUPABASE_URL = "https://riwwsasulkhmdasenbwy.supabase.co";
const SUPABASE_KEY = "sb_publishable_2foFxO37pS4pih6qMWj8ig_RrxhJiTK";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ordinal = n => n + (["th","st","nd","rd"][((n % 100) - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");
const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-NZ");
const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

let session = null, shops = [], shopId = null, SETTINGS = { program_name: "Kebab Crew", stamps_needed: 6, reward_text: "$5 off" }, days = 30;
try { shopId = localStorage.getItem("crew.shop"); } catch {}

function show(view) { ["v-login", "v-nostaff", "v-app"].forEach(v => $(v).hidden = v !== view); }

// ---------- Auth ----------
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("l-email").value.trim(), password = $("l-pass").value;
  $("l-go").disabled = true; $("l-msg").hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("l-go").disabled = false;
  if (error) { $("l-msg").textContent = /invalid/i.test(error.message) ? "That email and password don't match." : error.message; $("l-msg").className = "msg err"; $("l-msg").hidden = false; }
});
document.addEventListener("click", async e => { if (e.target.closest("[data-logout]")) { await sb.auth.signOut(); } });
sb.auth.onAuthStateChange((ev, s) => { session = s; if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") setTimeout(boot, 0); });

async function boot() {
  const { data } = await sb.auth.getSession(); session = data.session;
  const { data: st } = await sb.from("settings").select("*").maybeSingle(); if (st) SETTINGS = st;
  $("prog-name").textContent = SETTINGS.program_name;
  document.title = `${SETTINGS.program_name} for Shops`;
  if (!session) { $("sh-shop").innerHTML = ""; show("v-login"); return; }
  const { data: rows } = await sb.from("shop_staff").select("shop_id, shops(id, name, town)");
  const { data: prof } = await sb.from("profiles").select("is_admin").eq("id", session.user.id).maybeSingle();
  shops = (rows || []).map(r => r.shops).filter(Boolean);
  if (prof?.is_admin) {
    // Admin can act for any partner shop
    const { data: ps } = await sb.from("partners").select("shop_id, active, shops(id, name, town)").eq("active", true);
    (ps || []).forEach(p => { if (p.shops && !shops.some(s => s.id === p.shops.id)) shops.push(p.shops); });
  }
  if (!shops.length) {
    $("nostaff-text").textContent = `You're logged in as ${session.user.email}, but this account isn't linked to a shop yet. Send Monaco this email address and he'll set it up.`;
    $("sh-shop").innerHTML = ""; show("v-nostaff"); return;
  }
  if (!shops.some(s => s.id === shopId)) shopId = shops[0].id;
  $("sh-shop").innerHTML = shops.length > 1
    ? `<select id="shop-pick" aria-label="Which shop">${shops.map(s => `<option value="${esc(s.id)}" ${s.id === shopId ? "selected" : ""}>${esc(s.name)} · ${esc(s.town)}</option>`).join("")}</select>`
    : `${esc(shops[0].name)} · ${esc(shops[0].town)}`;
  $("shop-pick")?.addEventListener("change", e => { shopId = e.target.value; try { localStorage.setItem("crew.shop", shopId); } catch {} loadToday(); if (!$("p-stats").hidden) loadStats(); });
  $("rule-text").textContent = `Every ${ordinal(SETTINGS.stamps_needed)} kebab at your shop is ${SETTINGS.reward_text} for ${SETTINGS.program_name} members.`;
  show("v-app");
  loadToday();
}

// ---------- Tabs ----------
function tab(which) {
  $("t-scan").setAttribute("aria-selected", String(which === "scan"));
  $("t-stats").setAttribute("aria-selected", String(which === "stats"));
  $("p-scan").hidden = which !== "scan"; $("p-stats").hidden = which !== "stats";
  if (which === "stats") loadStats();
}
$("t-scan").onclick = () => tab("scan");
$("t-stats").onclick = () => tab("stats");

// ---------- Today's scans ----------
async function loadToday() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const { data } = await sb.from("scans").select("id, user_id, stamp_no, is_reward, created_at, profiles!scans_user_id_fkey(display_name)").eq("shop_id", shopId).eq("scan_day", today).order("created_at", { ascending: false }).limit(50);
  const rows = data || [];
  $("today").innerHTML = `<h2>Today: ${rows.length} ${rows.length === 1 ? "scan" : "scans"}</h2>` + rows.map(r => `
    <div class="tline"><b>${esc(r.profiles?.display_name || "Customer")}</b>
      ${r.is_reward ? `<span class="tag rw">Reward given</span>` : r.stamp_no === 1 ? `<span class="tag nw">Stamp 1</span>` : `<span class="tag">Stamp ${r.stamp_no}/${SETTINGS.stamps_needed}</span>`}
      <time>${new Date(r.created_at).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" })}</time></div>`).join("");
}

// ---------- Camera scanning ----------
let stream = null, scanning = false, detector = null;
if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { detector = null; } }
$("scan-btn").onclick = startScan;
$("cam-close").onclick = stopScan;
async function startScan() {
  $("cam").hidden = false; $("cam-hint").textContent = "Point at the QR code on the customer's phone";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
  } catch {
    $("cam-hint").textContent = "Couldn't open the camera. Allow camera access for this site in your browser settings, then try again.";
    return;
  }
  const v = $("cam-video"); v.srcObject = stream; await v.play().catch(() => {});
  scanning = true; requestAnimationFrame(scanFrame);
}
function stopScan() {
  scanning = false; $("cam").hidden = true;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}
let lastTry = 0;
async function scanFrame(ts) {
  if (!scanning) return;
  if (ts - lastTry > 120) {
    lastTry = ts;
    const v = $("cam-video");
    if (v.readyState >= 2) {
      let text = null;
      try {
        if (detector) { const codes = await detector.detect(v); text = codes[0]?.rawValue || null; }
        else {
          const c = $("cam-canvas"), w = 640, h = Math.round(v.videoHeight / v.videoWidth * 640) || 480;
          c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(v, 0, 0, w, h);
          const img = g.getImageData(0, 0, w, h); const r = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" }); text = r?.data || null;
        }
      } catch { text = null; }
      if (text) { onCode(text); return; }
    }
  }
  requestAnimationFrame(scanFrame);
}
async function onCode(text) {
  stopScan();
  if (!text.startsWith("kc1.")) return showResult({ status: "not_card" });
  if (navigator.vibrate) navigator.vibrate(60);
  const { data, error } = await sb.rpc("scan_card", { p_token: text, p_shop: shopId });
  if (error) { console.error(error); return showResult({ status: "error" }); }
  showResult(data);
  loadToday();
}
function dots(stamp, n) { return `<div class="dots">${Array.from({ length: n }, (_, i) => `<i class="${i < stamp ? "on" : ""}${i === n - 1 ? " last" : ""}"></i>`).join("")}</div>`; }
function avatar(r) { return `<span class="avatar">${r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : esc(initials(r.name))}</span>`; }
function showResult(r) {
  const n = r.stamps_needed || SETTINGS.stamps_needed;
  let cls = "ok", html = "";
  if (r.status === "ok" && r.is_reward) {
    cls = "reward";
    html = `<div class="icon">★</div>${avatar(r)}<p class="big">Reward: ${esc(r.reward_text)}</p><p class="sub">Give <b>${esc(r.name)}</b> ${esc(r.reward_text)} on this kebab. That's their ${ordinal(n)} visit.</p>${dots(n, n)}`;
  } else if (r.status === "ok") {
    html = `<div class="icon">✓</div>${avatar(r)}<p class="big">${esc(r.name)}</p><p class="sub">Stamp <b>${r.stamp_no} of ${n}</b>${r.first_visit ? " · first visit!" : ""}. Charge full price today.</p>${dots(r.stamp_no, n)}`;
  } else if (r.status === "already") {
    cls = "warn";
    html = `<div class="icon">!</div>${avatar(r)}<p class="big">Already scanned today</p><p class="sub">${esc(r.name)} got stamp ${r.stamp_no} of ${n} here earlier today${r.is_reward ? `, and their ${esc(r.reward_text)} reward` : ""}. One stamp per day.</p>`;
  } else {
    cls = "bad";
    const msg = {
      expired: ["Code expired", "Ask the customer to close and reopen their card, then scan again."],
      not_card: ["That's not a card code", `Ask the customer to open “My ${SETTINGS.program_name} card” on the kebab map.`],
      not_partner: ["Shop not active", `Your shop isn't an active partner right now. Contact Monaco.`],
      not_staff: ["Not linked to this shop", "This login can't scan for this shop. Contact Monaco."],
      error: ["Couldn't check that code", "Check the internet connection and try again."]
    }[r.status] || ["Something went wrong", "Try scanning again."];
    html = `<div class="icon">×</div><p class="big">${msg[0]}</p><p class="sub">${msg[1]}</p>`;
  }
  $("result").className = "result " + cls;
  $("result-in").innerHTML = html;
  $("result").hidden = false;
}
$("result-next").onclick = () => { $("result").hidden = true; startScan(); };
$("result-done").onclick = () => { $("result").hidden = true; };

// ---------- Stats ----------
document.querySelector(".range").addEventListener("click", e => {
  const b = e.target.closest("[data-days]"); if (!b) return;
  days = +b.dataset.days;
  document.querySelectorAll(".range button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  loadStats();
});
const PARTS = [["meat", "Meat"], ["sauce", "Sauce"], ["bread", "Bread & wrap"], ["value", "Value"]];
async function loadStats() {
  $("stats-body").innerHTML = `<p class="fine">Loading your numbers…</p>`;
  const { data: r, error } = await sb.rpc("shop_report", { p_shop: shopId, p_days: days });
  if (error || !r) { $("stats-body").innerHTML = `<p class="fine">Couldn't load your numbers. Check the connection and try again.</p>`; return; }
  const max = Math.max(1, ...r.daily.map(d => d.scans));
  const bars = r.daily.map(d => {
    const dt = new Date(d.day + "T12:00:00");
    return `<div><em>${d.scans || ""}</em><i style="height:${(d.scans / max * 100).toFixed(0)}%"></i><small>${dt.toLocaleDateString("en-NZ", { weekday: "narrow" })}</small></div>`;
  }).join("");
  let cmp = "", tips = [];
  if (r.ratings?.n) {
    cmp = `<div class="cmp"><span class="h"></span><span></span><span class="h">You</span><span class="h">Region</span>` + PARTS.map(([k, l]) => {
      const you = Number(r.ratings[k]), reg = Number(r.region_avg?.[k]);
      const d = you - reg, cls = d >= 0.3 ? "up" : d <= -0.3 ? "down" : "";
      if (d >= 0.5) tips.push(`Your ${l.toLowerCase()} beats the regional average by ${d.toFixed(1)}. Shout about it!`);
      if (d <= -0.5) tips.push(`Your ${l.toLowerCase()} is ${Math.abs(d).toFixed(1)} below the regional average. Worth a look.`);
      return `<span>${l}</span><span class="bar"><i style="width:${(you * 10).toFixed(0)}%"></i></span><b class="${cls}">${you.toFixed(1)}</b><span>${isNaN(reg) ? "–" : reg.toFixed(1)}</span>`;
    }).join("") + `</div>`;
  }
  $("stats-body").innerHTML = `
    <div class="hero-stat"><b>${r.map_new_customers}</b><span>new customers found you on ${esc(SETTINGS.program_name)} in the last ${r.days} days</span>
      <small>${r.map_new_returned} of them have already come back. They've spent about ${money(r.map_revenue)} with you.</small></div>
    <div class="tiles">
      <div class="tile money"><b>${money(r.est_revenue)}</b><span>spent by ${esc(SETTINGS.program_name)} members (about ${money(r.avg_price)} a kebab)</span></div>
      <div class="tile"><b>${r.scans}</b><span>kebabs scanned</span></div>
      <div class="tile"><b>${r.new_customers}</b><span>first-time customers</span></div>
      <div class="tile"><b>${r.returning_customers}</b><span>regulars (2+ visits)</span></div>
      <div class="tile"><b>${r.views}</b><span>people looked at your shop on the map</span></div>
      <div class="tile"><b>${r.directions}</b><span>tapped Directions or Maps</span></div>
      <div class="tile"><b>${r.rewards}</b><span>rewards given (${esc(SETTINGS.reward_text)} each)</span></div>
      <div class="tile"><b>${r.ratings?.n ? Number(r.ratings.avg).toFixed(1) : "–"}</b><span>your rating from ${r.ratings?.n || 0} ${r.ratings?.n === 1 ? "review" : "reviews"}</span></div>
    </div>
    <div class="panel-box"><h3>Scans, last 14 days</h3><div class="bars">${bars}</div></div>
    <div class="panel-box"><h3>How customers rate you</h3>${cmp || `<p class="fine">No reviews yet. Customers get asked to rate you after each scan.</p>`}
      ${tips.length ? `<ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}</div>`;
}

boot();
