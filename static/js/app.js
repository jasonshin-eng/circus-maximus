/* ── Constants ─────────────────────────────────────────────────────────────── */
const TEAM_COLORS = {
  "Red Bull Racing":    "#3671C6",
  "Ferrari":            "#E8002D",
  "Mercedes":           "#00A896",
  "McLaren":            "#FF8000",
  "Aston Martin":       "#229971",
  "Alpine":             "#0093CC",
  "Williams":           "#64C4FF",
  "Haas F1 Team":       "#B6BABD",
  "Kick Sauber":        "#52E252",
  "RB":                 "#6692FF",
  "Audi":               "#C0A846",
  "Cadillac":           "#FFFFFF",
};

const COMPOUND_COLORS = {
  SOFT: "#e8002d", MEDIUM: "#ffd600", HARD: "#e8e8e8",
  INTERMEDIATE: "#39b54a", WET: "#0067ff",
  HYPERSOFT: "#ff86bb", ULTRASOFT: "#7b0eff", SUPERSOFT: "#ff8000",
  UNK: "#666", UNKNOWN: "#666", TEST_UNKNOWN: "#666",
};

const PALETTE = [
  "#e10600","#3671c6","#27f4d2","#ff8000","#229971",
  "#64c4ff","#ffd600","#b6babd","#52e252","#6692ff",
  "#c0a846","#ff87bc",
];

const FLAGS = {
  "Australia":"🇦🇺","Bahrain":"🇧🇭","Saudi Arabia":"🇸🇦","Japan":"🇯🇵",
  "China":"🇨🇳","United States":"🇺🇸","USA":"🇺🇸","Italy":"🇮🇹",
  "Monaco":"🇲🇨","Canada":"🇨🇦","Spain":"🇪🇸","Austria":"🇦🇹",
  "United Kingdom":"🇬🇧","Hungary":"🇭🇺","Belgium":"🇧🇪","Netherlands":"🇳🇱",
  "Singapore":"🇸🇬","Azerbaijan":"🇦🇿","Mexico":"🇲🇽","Brazil":"🇧🇷",
  "UAE":"🇦🇪","Abu Dhabi":"🇦🇪","Qatar":"🇶🇦","Las Vegas":"🇺🇸",
};

const PLOTLY_LAYOUT = {
  paper_bgcolor: "transparent",
  plot_bgcolor:  "transparent",
  font:          { family: "Outfit, system-ui, sans-serif", color: "#dce8f8", size: 12 },
  xaxis:         { gridcolor: "#1e3352", zerolinecolor: "#243d5c", tickfont: { size: 11 }, color: "#7490b0" },
  yaxis:         { gridcolor: "#1e3352", zerolinecolor: "#243d5c", tickfont: { size: 11 }, color: "#7490b0" },
  legend:        { bgcolor: "rgba(12,22,40,0.8)", bordercolor: "#243d5c", borderwidth: 1 },
  margin:        { l: 60, r: 20, t: 30, b: 50 },
};
const CONFIG = { displayModeBar: false, responsive: true };

/* ── Driver Headshots (via Wikipedia Commons proxy) ────────────────────────── */
const KNOWN_DRIVER_CODES = new Set([
  "VER","HAM","NOR","LEC","RUS","PIA","ALO","SAI","ANT","STR",
  "ALB","GAS","OCO","TSU","LAW","BEA","HAD","DOO","COL","BOR","HUL",
]);

function driverHeadshot(code) {
  if (!KNOWN_DRIVER_CODES.has(code)) return null;
  return `/api/driver-photo/${code}`;
}

/* ── State ─────────────────────────────────────────────────────────────────── */
let schedule   = [];
let standings  = null;
let raceCache  = {};
let qualiCache = {};
let currentRound = null;
let currentUser = null;
let currentAuthTab = "login";
let _driversList = [];

/* ── Background Paths ──────────────────────────────────────────────────────── */
(function initBgPaths() {
  const svg = document.getElementById("bg-paths-svg");
  if (!svg) return;
  const ns = "http://www.w3.org/2000/svg";
  const BLUE = "74,144,217";
  const TEAL = "39,244,210";

  for (const pos of [1, -1]) {
    for (let i = 0; i < 8; i++) {
      const p = pos;
      const d = [
        `M${-380 - i*5*p} ${-189 + i*6}`,
        `C${-380 - i*5*p} ${-189 + i*6}`,
        `${-312 - i*5*p} ${216  - i*6}`,
        `${152  - i*5*p} ${343  - i*6}`,
        `C${616 - i*5*p} ${470  - i*6}`,
        `${684  - i*5*p} ${875  - i*6}`,
        `${684  - i*5*p} ${875  - i*6}`,
      ].join(" ");

      const peakOpacity = parseFloat((0.22 + i * 0.028).toFixed(3));
      const width       = (0.55 + i * 0.05).toFixed(2);
      const dur         = (14 + (i % 5) * 2.8 + (pos === -1 ? 5 : 0)) * 1000; // ms
      const delay       = -(i * 1.6 + (pos === -1 ? 7 : 0)) * 1000;            // ms, negative = start mid-cycle
      const color       = i % 3 === 0 ? TEAL : BLUE;

      const g = document.createElementNS(ns, "g");
      const el = document.createElementNS(ns, "path");
      el.setAttribute("d", d);
      el.setAttribute("stroke", `rgb(${color})`);
      el.setAttribute("stroke-width", width);
      el.classList.add("bp");
      g.appendChild(el);
      svg.appendChild(g);

      // WAAPI: opacity fade in/hold/fade out — 100% compositor thread
      g.animate(
        [
          { opacity: 0 },
          { opacity: peakOpacity, offset: 0.08 },
          { opacity: peakOpacity, offset: 0.85 },
          { opacity: 0 },
        ],
        { duration: dur, delay, iterations: Infinity, easing: "ease-in-out", fill: "backwards" }
      );

      // WAAPI: translate along path direction — compositor thread, no paint-thread glitch
      // Paths run roughly SW→NE; drift (dx,dy) simulates flow in that direction
      const dx = 60 * (pos === 1 ? 1 : -1);
      const dy = -40;
      g.animate(
        [
          { transform: `translate(0px, 0px)` },
          { transform: `translate(${dx}px, ${dy}px)` },
        ],
        { duration: dur, delay, iterations: Infinity, easing: "ease-in-out", fill: "backwards" }
      );
    }
  }
})();

/* IHB removed — using plain CSS hover */
function makeIHB() {}
function setIHBText(el, text) { if (el) el.textContent = text; }
function applyIHB() {}

/* ── Coin SVG icon ──────────────────────────────────────────────────────────── */
const COIN_SVG = `<svg class="coin-svg" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="cg" cx="38%" cy="35%" r="60%">
      <stop offset="0%"   stop-color="#ffe066"/>
      <stop offset="55%"  stop-color="#d4a017"/>
      <stop offset="100%" stop-color="#8b6500"/>
    </radialGradient>
  </defs>
  <circle cx="8" cy="8" r="7.2" fill="#8b6500"/>
  <circle cx="8" cy="8" r="6.5" fill="url(#cg)"/>
  <circle cx="8" cy="8" r="4.8" fill="none" stroke="#b8860b" stroke-width="0.7" opacity="0.6"/>
  <text x="8" y="11" text-anchor="middle" font-size="5.5" font-weight="900"
        font-family="Georgia,serif" fill="#7a5200" letter-spacing="-0.3">D</text>
</svg>`;

/* ── Init ──────────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  setupNav();
  await initAuth();
  const scheduleData = await loadSchedule();
  if (scheduleData) loadStandings(scheduleData);
  fetch("/api/drivers").then(r => r.json()).then(d => { _driversList = d.drivers || []; }).catch(() => {});

  // Refresh F1 stats every 2 minutes — silent (no UI disruption)
  setInterval(silentRefreshF1, 2 * 60_000);
  // Also register click-outside for race strip once globally
  document.addEventListener("click", function rwClickOutside(e) {
    const strip  = document.getElementById("race-strip");
    const detail = document.getElementById("race-detail");
    if (!strip || !detail) return;
    if (!strip.contains(e.target) && !detail.contains(e.target)) closeRaceDetail();
  });
});

function setupNav() {
  window.addEventListener("scroll", () => {
    if (!document.getElementById("page-main").classList.contains("hidden")) {
      const sections = ["championship","races"];
      for (const id of sections) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= 130 && rect.bottom > 130) {
          document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
          const link = document.querySelector(`.nav-link[href="#${id}"]`);
          if (link) link.classList.add("active");
          break;
        }
      }
    }
  });
}

function showLeaguesPage(e) {
  if (e) e.preventDefault();
  document.getElementById("page-main").classList.add("hidden");
  document.getElementById("page-leagues").classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  document.getElementById("nav-leagues").classList.add("active");
  window.scrollTo(0, 0);
  renderLeaguesFullSection();
}

function showMainPage() {
  if (_leagueInterval) { clearInterval(_leagueInterval); _leagueInterval = null; }
  document.getElementById("page-leagues").classList.add("hidden");
  document.getElementById("page-main").classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  document.querySelector('.nav-link[href="#championship"]').classList.add("active");
}

/* ── Auth ──────────────────────────────────────────────────────────────────── */
async function initAuth() {
  try {
    const res  = await fetch("/api/auth/me");
    const data = await res.json();
    currentUser = data.user;
  } catch (e) {
    currentUser = null;
  }
  renderAuthHeader();
  renderLeaguesPanel();
}

function renderAuthHeader() {
  const el = document.getElementById("header-auth");
  if (currentUser) {
    el.innerHTML = `
      <div class="header-user">
        <span class="header-user-dot"></span>${currentUser.name || currentUser.username}
      </div>
      <button class="auth-btn-ghost" onclick="doLogout()">Sign Out</button>`;
    document.getElementById("nav-leagues").style.display = "";
  } else {
    el.innerHTML = `
      <button class="auth-btn-ghost" onclick="openAuthModal('login')">Sign In</button>
      <button class="auth-btn" onclick="openAuthModal('signup')">Create Account</button>`;
    document.getElementById("nav-leagues").style.display = "none";
    // if currently on leagues page, go back to main
    if (!document.getElementById("page-leagues").classList.contains("hidden")) {
      showMainPage();
    }
  }
  applyIHB(el);
}

function openAuthModal(tab = "login") {
  switchAuthTab(tab);
  document.getElementById("auth-overlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("auth-username").focus(), 50);
}

function closeAuthModal(e, force = false) {
  if (!force && e && e.target !== document.getElementById("auth-overlay")) return;
  document.getElementById("auth-overlay").classList.add("hidden");
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-error").textContent = "";
  document.getElementById("auth-form").reset();
}

function switchAuthTab(tab) {
  currentAuthTab = tab;
  document.getElementById("tab-login").classList.toggle("active", tab === "login");
  document.getElementById("tab-signup").classList.toggle("active", tab === "signup");
  setIHBText(document.getElementById("auth-submit-btn"),
    tab === "login" ? "Sign In" : "Create Account");
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-password").autocomplete =
    tab === "login" ? "current-password" : "new-password";
  const nameField = document.getElementById("auth-name-field");
  const nameInput = document.getElementById("auth-name");
  if (tab === "signup") {
    nameField.classList.remove("hidden");
    nameInput.required = true;
  } else {
    nameField.classList.add("hidden");
    nameInput.required = false;
    nameInput.value = "";
  }
}

async function submitAuth(e) {
  e.preventDefault();
  const username = document.getElementById("auth-username").value.trim();
  const password = document.getElementById("auth-password").value;
  const errEl    = document.getElementById("auth-error");
  const btn      = document.getElementById("auth-submit-btn");
  errEl.classList.add("hidden");
  btn.disabled = true;
  setIHBText(btn, "…");
  try {
    const endpoint = currentAuthTab === "login" ? "/api/auth/login" : "/api/auth/signup";
    const res  = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentAuthTab === "signup"
        ? { name: document.getElementById("auth-name").value.trim(), username, password }
        : { username, password }),
    });
    const data = await res.json();
    if (data.error || data.detail) {
      errEl.textContent = data.error || data.detail;
      errEl.classList.remove("hidden");
      btn.disabled = false;
      setIHBText(btn, currentAuthTab === "login" ? "Sign In" : "Create Account");
      return;
    }
    currentUser = data.user;
    btn.disabled = false;
    setIHBText(btn, currentAuthTab === "login" ? "Sign In" : "Create Account");
    closeAuthModal(null, true);
    renderAuthHeader();
    renderLeaguesPanel();
  } catch (err) {
    errEl.textContent = "Network error — try again.";
    errEl.classList.remove("hidden");
    btn.disabled = false;
    setIHBText(btn, currentAuthTab === "login" ? "Sign In" : "Create Account");
  }
}

async function doLogout() {
  await fetch("/api/auth/logout", { method: "POST" });
  currentUser = null;
  renderAuthHeader();
  renderLeaguesPanel();
}

/* ── Leagues Panel (sidebar) ───────────────────────────────────────────────── */
async function renderLeaguesPanel() {
  const panel = document.getElementById("leagues-panel");
  if (!panel) return;

  if (!currentUser) {
    panel.innerHTML = `
      <div class="leagues-panel-title">My Leagues</div>
      <div class="leagues-gate">
        <div class="leagues-gate-text">Sign in to join or create a fantasy betting league between your friends!</div>
        <div class="leagues-action-row">
          <button class="auth-btn-ghost" onclick="openAuthModal('login')">Sign In</button>
          <button class="auth-btn" onclick="openAuthModal('signup')">Create Account</button>
        </div>
      </div>`;
    applyIHB(panel);
    return;
  }

  panel.innerHTML = `<div class="leagues-panel-title">My Leagues</div>
    <div style="color:var(--muted);font-size:12px;text-align:center;padding:8px 0">Loading…</div>`;

  try {
    const res  = await fetch("/api/leagues/mine");
    const data = await res.json();
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    renderLeaguesPanelContent(data.leagues);
  } catch (e) {
    panel.innerHTML += `<div class="error-state">${e.message}</div>`;
  }
}

function renderLeaguesPanelContent(leagues) {
  const panel = document.getElementById("leagues-panel");
  if (!leagues.length) {
    panel.innerHTML = `
      <div class="leagues-panel-title">My Leagues</div>
      <div class="leagues-gate">
        <div class="leagues-gate-text">You're not in any leagues yet.<br>Join one or create your own!</div>
        <div class="leagues-action-row">
          <button class="modal-btn" onclick="openLeaguesModal('join')">Join League</button>
          <button class="modal-btn-secondary" onclick="openLeaguesModal('create')">Create League</button>
        </div>
      </div>`;
    applyIHB(panel);
    openLeaguesModal("join");
    return;
  }
  const cards = leagues.map(l => `
    <div class="league-card" style="cursor:pointer" onclick="openLeagueView(${l.id})">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div class="league-card-name">${l.name}</div>
        <span class="league-card-code">${l.code}</span>
      </div>
      <div class="league-card-meta" style="margin-top:6px">
        <span>${l.member_count} member${l.member_count !== 1 ? "s" : ""}</span>
        <span class="wins-badge">${l.bets_won ?? 0} win${(l.bets_won ?? 0) !== 1 ? "s" : ""}</span>
      </div>
    </div>`).join("");

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="leagues-panel-title">My Leagues</div>
      <button class="auth-btn-ghost" style="font-size:11px;padding:4px 10px" onclick="openLeaguesModal('join')">+ Join</button>
    </div>
    ${cards}`;
  applyIHB(panel);
}

async function renderLeaguesFullSection() {
  const content = document.getElementById("leagues-full-content");
  if (!content) return;

  if (!currentUser) {
    content.innerHTML = `
      <div class="leagues-gate">
        <div class="leagues-gate-text">Sign in to join or create a fantasy betting league between your friends!</div>
        <div class="leagues-action-row">
          <button class="auth-btn-ghost" onclick="openAuthModal('login')">Sign In</button>
          <button class="auth-btn" onclick="openAuthModal('signup')">Create Account</button>
        </div>
      </div>`;
    applyIHB(content);
    return;
  }

  content.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:16px 0">Loading…</div>`;
  try {
    const res  = await fetch("/api/leagues/mine");
    const data = await res.json();
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    const leagues = data.leagues;
    if (!leagues.length) {
      content.innerHTML = `
        <div class="leagues-gate">
          <div class="leagues-gate-text">You're not in any leagues yet.<br>Join one or create your own!</div>
          <div class="leagues-action-row">
            <button class="modal-btn" onclick="openLeaguesModal('join')">Join League</button>
            <button class="modal-btn-secondary" onclick="openLeaguesModal('create')">Create League</button>
          </div>
        </div>`;
      applyIHB(content);
      return;
    }
    const cards = leagues.map(l => `
      <div class="league-card" style="cursor:pointer" onclick="openLeagueView(${l.id})">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <div class="league-card-name">${l.name}</div>
          <span class="league-card-code">${l.code}</span>
        </div>
        <div class="league-card-meta" style="margin-top:6px">
          <span>${l.member_count} member${l.member_count !== 1 ? "s" : ""}</span>
          <span class="wins-badge">${l.my_bets_won || 0} win${(l.my_bets_won || 0) !== 1 ? "s" : ""}</span>
        </div>
      </div>`).join("");
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
        <button class="auth-btn-ghost" style="font-size:12px;padding:6px 14px" onclick="openLeaguesModal('join')">+ Join League</button>
      </div>
      <div class="leagues-cards-grid">${cards}</div>`;
    applyIHB(content);
  } catch (e) {
    content.innerHTML = `<div class="error-state">${e.message}</div>`;
  }
}

function openLeaguesModal(mode) {
  document.getElementById("leagues-overlay").classList.remove("hidden");
  renderLeaguesModalBody(mode);
}

function closeLeaguesModal(e, force = false) {
  if (!force && e && e.target !== document.getElementById("leagues-overlay")) return;
  document.getElementById("leagues-overlay").classList.add("hidden");
}

function renderLeaguesModalBody(mode) {
  const body = document.getElementById("leagues-modal-body");
  if (mode === "join") {
    body.innerHTML = `
      <div class="modal-title">Join a League</div>
      <div class="modal-sub">Enter the 6-character league code shared by your league commissioner.</div>
      <div class="modal-input-row">
        <input id="join-code-input" type="text" maxlength="6" placeholder="ABCDEF" oninput="this.value=this.value.toUpperCase()">
        <button class="modal-btn" onclick="submitJoinLeague()">Join</button>
      </div>
      <div id="join-error" class="modal-error hidden"></div>
      <div class="modal-divider">or</div>
      <button class="modal-btn-secondary" style="width:100%" onclick="renderLeaguesModalBody('create')">Create a New League</button>`;
    applyIHB(body);
    setTimeout(() => document.getElementById("join-code-input").focus(), 50);
  } else {
    body.innerHTML = `
      <div class="modal-title">Create a League</div>
      <div class="modal-sub">Start your own fantasy betting league with friends. Share the code to invite them.</div>
      <div class="modal-field">
        <label>League Name</label>
        <input id="create-name-input" type="text" maxlength="40" placeholder="e.g. Tifosi Fantasy">
      </div>
      <div class="modal-field">
        <label>Final Reward <span style="color:var(--muted);font-weight:400">(what does the winner get?)</span></label>
        <input id="create-reward-input" type="text" maxlength="200" placeholder="e.g. Winner gets free dinner from everyone">
      </div>
      <div id="create-error" class="modal-error hidden"></div>
      <div id="create-code-result" class="hidden"></div>
      <button class="modal-btn" style="width:100%" onclick="submitCreateLeague()">Create League</button>
      <div class="modal-divider">or</div>
      <button class="modal-btn-secondary" style="width:100%;margin-top:0" onclick="renderLeaguesModalBody('join')">Join an Existing League</button>`;
    applyIHB(body);
    setTimeout(() => document.getElementById("create-name-input").focus(), 50);
  }
}

async function submitJoinLeague() {
  const code  = document.getElementById("join-code-input").value.trim().toUpperCase();
  const errEl = document.getElementById("join-error");
  errEl.classList.add("hidden");
  if (code.length < 4) { errEl.textContent = "Enter a valid league code."; errEl.classList.remove("hidden"); return; }
  try {
    const res  = await fetch("/api/leagues/join", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.error || data.detail) { errEl.textContent = data.error || data.detail; errEl.classList.remove("hidden"); return; }
    closeLeaguesModal(null, true);
    renderLeaguesPanel();
  } catch (e) {
    errEl.textContent = "Network error — try again."; errEl.classList.remove("hidden");
  }
}

async function submitCreateLeague() {
  const name         = document.getElementById("create-name-input").value.trim();
  const final_reward = document.getElementById("create-reward-input")?.value.trim() || "";
  const errEl = document.getElementById("create-error");
  errEl.classList.add("hidden");
  if (name.length < 3) { errEl.textContent = "Name must be at least 3 characters."; errEl.classList.remove("hidden"); return; }
  try {
    const res  = await fetch("/api/leagues/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, final_reward }),
    });
    const data = await res.json();
    if (data.error || data.detail) { errEl.textContent = data.error || data.detail; errEl.classList.remove("hidden"); return; }
    document.getElementById("leagues-modal-body").innerHTML = `
      <div class="modal-title">League Created! 🏁</div>
      <div class="modal-sub">Share this code with friends so they can join <strong>${name}</strong>.</div>
      <div class="modal-code-display">
        <div class="code-val">${data.code}</div>
        <div class="code-lbl">League Code — share this with friends</div>
      </div>
      <button class="modal-btn" style="width:100%;margin-top:16px" onclick="closeLeaguesModal(null,true);renderLeaguesPanel()">Done</button>`;
    applyIHB(document.getElementById("leagues-modal-body"));
  } catch (e) {
    errEl.textContent = "Network error — try again."; errEl.classList.remove("hidden");
  }
}

/* ── Schedule ──────────────────────────────────────────────────────────────── */
async function loadSchedule() {
  try {
    const res  = await fetch("/api/schedule");
    const data = await res.json();
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    schedule = data.events;

    const completed = schedule.filter(e => e.is_past);
    const upcoming  = schedule.filter(e => !e.is_past && !e.is_active);

    renderRaceStrip(schedule, upcoming);
    updateHeaderMeta(completed.length, data.total);

    // Auto-open: prefer in-progress event, else most recent completed
    if (currentRound === null) {
      const active = schedule.find(e => e.is_active);
      const target = active || (completed.length ? completed[completed.length - 1] : null);
      if (target) openRace(target.round, target.name);
    }

    return data;
  } catch (err) {
    document.getElementById("champ-loading").innerHTML =
      `<div class="error-state">Failed to load schedule: ${err.message}</div>`;
    return null;
  }
}

function updateHeaderMeta(completed, total) {
  document.getElementById("header-meta").textContent =
    `Round ${completed}/${total} complete`;
}

function renderRaceStrip(allEvents, upcomingEvents) {
  const strip = document.getElementById("race-strip");
  if (!allEvents.length) {
    strip.innerHTML = '<div class="empty-state">No schedule available.</div>';
    return;
  }
  const nextRound = upcomingEvents.length ? upcomingEvents[0].round : null;

  strip.innerHTML = allEvents.map(ev => {
    const flag     = FLAGS[ev.country] || "🏁";
    const isPast   = ev.is_past;
    const isActive = ev.is_active;
    const isNext   = ev.round === nextRound;
    const status   = isPast ? "past" : isActive ? "active" : isNext ? "next" : "future";
    const badgeLabel = isPast ? "Past" : isActive ? "Live" : isNext ? "Next" : "Upcoming";
    const safeName = ev.name.replace(/'/g, "\\'");

    const winnerSlot = isPast
      ? `<div class="rw-body-winner" id="rw-winner-${ev.round}">
           <div class="rw-body-winner-label">Winner</div>
           <div class="rw-body-winner-name" style="color:var(--muted)">Loading…</div>
         </div>`
      : isActive
        ? `<div class="rw-body-hint rw-body-hint--live">Weekend in progress</div>`
        : `<div class="rw-body-hint">
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
             Not yet raced
           </div>`;

    const onclick = (isPast || isActive) ? `onclick="openRace(${ev.round},'${safeName}')"` : "";

    return `
    <div class="rw-card rw-${status}" id="rcard-${ev.round}" ${onclick}>
      <div class="rw-pill">
        <div class="rw-pill-flag">${flag}</div>
        <div class="rw-pill-num">${String(ev.round).padStart(2,"0")}</div>
      </div>
      <div class="rw-body">
        <span class="rw-badge ${status}">${badgeLabel}</span>
        <div class="rw-body-flag">${flag}</div>
        <div class="rw-body-round">Round ${String(ev.round).padStart(2,"0")}</div>
        <div class="rw-body-name">${ev.name}</div>
        <div class="rw-body-loc">${ev.location}</div>
        <div class="rw-body-date">${formatDate(ev.date)}</div>
        ${winnerSlot}
      </div>
    </div>`;
  }).join("");

  // (click-outside registered once at init)
}


/* ── Silent background refresh ─────────────────────────────────────────────── */
async function silentRefreshF1() {
  try {
    const ts = Date.now(); // bust backend mem-cache by adding a unique param
    const [schedRes, standRes] = await Promise.all([
      fetch(`/api/schedule?t=${ts}`),
      fetch(`/api/standings?t=${ts}`),
    ]);
    const schedData  = await schedRes.json();
    const standData  = await standRes.json();
    if (schedData.events) {
      schedule = schedData.events;
      const completed = schedule.filter(e => e.is_past);
      const upcoming  = schedule.filter(e => !e.is_past && !e.is_active);
      // Re-render strip but don't auto-open any race
      renderRaceStrip(schedule, upcoming);
      updateHeaderMeta(completed.length, schedData.total);
    }
    if (!standData.error && !standData.detail) {
      standings = standData;
      renderLeaderPanel(standData);
      renderDriverChart(standData);
      renderConstructorChart(standData);
      // Update winner labels on race strip
      if (standData.drivers) {
        standData.drivers.forEach(d => {
          (d.history || []).forEach(h => {
            if (h.pos === 1) {
              const el = document.getElementById(`rw-winner-${h.round}`);
              if (el) el.innerHTML = `
                <div class="rw-body-winner-label">Winner</div>
                <div class="rw-body-winner-name">${d.name}</div>`;
            }
          });
        });
      }
      if (standData.drivers && standData.drivers[0] && schedData.total) {
        const l = standData.drivers[0];
        document.getElementById("header-meta").innerHTML =
          `<span style="color:var(--muted)">Leader:</span> <strong>${l.name}</strong>
           &nbsp;·&nbsp; ${l.total} pts &nbsp;·&nbsp; R${standData.rounds.length}/${schedData.total}`;
      }
    }
  } catch (e) { /* silent */ }
}

/* ── Championship Standings ────────────────────────────────────────────────── */
async function loadStandings(scheduleData) {
  const loading = document.getElementById("champ-loading");
  try {
    const res  = await fetch("/api/standings");
    const data = await res.json();
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    standings = data;
    loading.classList.add("hidden");
    document.getElementById("champ-split").classList.remove("hidden");

    renderLeaderPanel(data);
    renderDriverChart(data);
    renderConstructorChart(data);

    // Update race strip winner labels
    if (data.drivers) {
      data.drivers.forEach(d => {
        (d.history || []).forEach(h => {
          if (h.pos === 1) {
            const el = document.getElementById(`rw-winner-${h.round}`);
            if (el) el.innerHTML = `
              <div class="rw-body-winner-label">Winner</div>
              <div class="rw-body-winner-name">${d.name}</div>`;
          }
        });
      });
    }

    if (data.drivers && data.drivers[0]) {
      const l = data.drivers[0];
      document.getElementById("header-meta").innerHTML =
        `<span style="color:var(--muted)">Leader:</span> <strong>${l.name}</strong>
         &nbsp;·&nbsp; ${l.total} pts &nbsp;·&nbsp; R${data.rounds.length}/${scheduleData.total}`;
    }
  } catch (err) {
    loading.innerHTML = `<div class="error-state">Standings unavailable: ${err.message}</div>`;
  }
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// Debut season for each driver on the current grid
const DRIVER_DEBUT = {
  HAM: 2007, ALO: 2001, VER: 2015, LEC: 2019, NOR: 2019,
  RUS: 2019, SAI: 2015, PIA: 2023, ANT: 2025, HUL: 2010,
  TSU: 2021, ALB: 2019, STR: 2017, GAS: 2017, OCO: 2017,
  BOT: 2013, ZHO: 2022, MAG: 2014, LAW: 2023, BEA: 2025,
  DOO: 2025, HAD: 2025, BOR: 2025,
};

// State kept so showLpTab can trigger lazy loads
let _lpCode  = null;
let _lpColor = null;

function showLpTab(year) {
  document.querySelectorAll(".lp-tab-panel").forEach(p =>
    p.classList.toggle("hidden", p.id !== `lp-tab-yr-${year}`));
  document.querySelectorAll(".lp-tab-btn").forEach(b =>
    b.classList.toggle("active", +b.dataset.year === year));

  const panel = document.getElementById(`lp-tab-yr-${year}`);
  if (!panel) return;

  // Lazy-load if the panel still shows the loading spinner
  if (panel.querySelector(".lp-past-loading") && _lpCode) {
    _loadLpSeason(_lpCode, year, _lpColor);
  }

  // Resize Plotly charts now that the panel is visible
  setTimeout(() => {
    panel.querySelectorAll(".js-plotly-plot").forEach(el => Plotly.Plots.resize(el));
  }, 50);
}

function _lpDonut(elId, hist, dColor, centerLabel) {
  const el = document.getElementById(elId);
  if (!el || !hist.length) return;
  const wins  = hist.filter(h => h.pos === 1).length;
  const pods  = hist.filter(h => h.pos === 2 || h.pos === 3).length;
  const ptsF  = hist.filter(h => h.pos >= 4 && h.pts > 0).length;
  const noPts = Math.max(hist.length - wins - pods - ptsF, 0);
  Plotly.newPlot(elId, [{
    type: "pie", hole: 0.55,
    values: [wins, pods, ptsF, noPts],
    labels: ["Wins", "Podiums", "Points Finish", "No Points"],
    textinfo: "none",
    hovertemplate: "<b>%{label}</b>: %{value} race(s) — %{percent}<extra></extra>",
    marker: {
      colors: [dColor, hexToRgba(dColor,0.72), hexToRgba(dColor,0.38), "#1a2d48"],
      line: { color: "rgba(12,22,40,0.6)", width: 2 },
    },
  }], {
    ...PLOTLY_LAYOUT,
    height: 230,
    margin: { l: 8, r: 8, t: 8, b: 68 },
    showlegend: true,
    legend: {
      orientation: "h", x: 0.5, xanchor: "center",
      y: -0.06, yanchor: "top", bgcolor: "transparent",
      font: { size: 11, color: "#7490b0", family: "Outfit, sans-serif" },
    },
    annotations: [{
      text: centerLabel,
      x: 0.5, y: 0.5, xanchor: "center", yanchor: "middle",
      showarrow: false,
      font: { size: 15, color: dColor, family: "Outfit, sans-serif" },
    }],
  }, CONFIG);
}

function _lpMiniStats(wins, pods, races, pts, dnfs, bestPos) {
  const avg = races ? (pts / races).toFixed(1) : "—";
  const items = [
    ["Wins",    wins],
    ["Podiums", pods],
    ["Races",   races],
    ["Pts/Race",avg],
    ["Best",    bestPos ? `P${bestPos}` : "—"],
    ["DNFs",    dnfs],
  ];
  return `<div class="lp-past-stats">${items.map(([l,v]) =>
    `<div class="lp-past-stat"><div class="lp-past-val">${v}</div><div class="lp-past-lbl">${l}</div></div>`
  ).join("")}</div>`;
}

function renderLeaderPanel(data) {
  const panel = document.getElementById("leader-panel");
  if (!data.drivers || !data.drivers.length) { panel.innerHTML = ""; return; }

  const drv     = data.drivers[0];
  const drv2    = data.drivers[1];
  const con     = data.constructors?.[0];
  const dColor  = getTeamColor(drv.team);
  const cColor  = con ? getTeamColor(con.team) : "#888";
  const gap     = drv2 ? drv.total - drv2.total : null;
  const photo   = driverHeadshot(drv.code);
  const hist    = drv.history || [];
  const avgPts  = hist.length ? (drv.total / hist.length).toFixed(1) : "—";
  const bestPos = hist.length ? Math.min(...hist.map(h => h.pos).filter(Boolean)) : "—";

  // Build season tabs from current year down to debut
  const CURRENT_YEAR = 2026;
  const debut = DRIVER_DEBUT[drv.code] || 2022;
  const years = [];
  for (let y = CURRENT_YEAR; y >= debut; y--) years.push(y);

  _lpCode  = drv.code;
  _lpColor = dColor;

  const tabBtns = years.map((y, i) =>
    `<button class="lp-tab-btn${i === 0 ? " active" : ""}" data-year="${y}" onclick="showLpTab(${y})">${y}</button>`
  ).join("");

  const tabPanels = years.map((y, i) => {
    if (y === CURRENT_YEAR) {
      return `<div id="lp-tab-yr-${y}" class="lp-tab-panel">
        ${hist.length
          ? `<div id="lp-cur-chart"></div>`
          : `<div class="not-yet-state"><div class="not-yet-icon">🏁</div><div class="not-yet-sub">No ${y} races completed yet.</div></div>`}
      </div>`;
    }
    return `<div id="lp-tab-yr-${y}" class="lp-tab-panel hidden">
      <div class="lp-past-loading">
        <div class="spinner" style="width:22px;height:22px;border-width:2px"></div>
        <span style="color:var(--muted);font-size:13px">Loading ${y} stats…</span>
      </div>
    </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="lp-hero${!photo ? " lp-hero-no-photo" : ""}">
      ${photo ? `<div class="lp-hero-img-loading" id="lp-hero-shimmer"></div>
        <img class="lp-hero-img" src="${photo}" alt="${drv.name}"
          onload="document.getElementById('lp-hero-shimmer')?.remove()"
          onerror="this.closest('.lp-hero').classList.add('lp-hero-no-photo'); document.getElementById('lp-hero-shimmer')?.remove(); this.remove();">` : ""}
      <div class="lp-hero-gradient"></div>
      <div class="lp-hero-info">
        <div class="lp-section-tag" style="color:${dColor}">Drivers' Championship Leader</div>
        <div class="lp-name">${drv.name}</div>
        <div class="lp-team"><span class="team-dot" style="background:${dColor}"></span>${drv.team}</div>
        <div class="lp-pts-row">
          <div class="lp-pts-big" style="color:${dColor}">${drv.total}</div>
          <div class="lp-pts-lbl">PTS</div>
          ${gap !== null ? `<div class="lp-gap-inline">+${gap} over ${drv2.name.split(" ").pop()}</div>` : ""}
        </div>
      </div>
    </div>

    <div class="lp-body">
      <div class="lp-stats">
        <div class="lp-stat"><div class="lp-stat-val">${drv.wins}</div><div class="lp-stat-lbl">Wins</div></div>
        <div class="lp-stat"><div class="lp-stat-val">${drv.podiums}</div><div class="lp-stat-lbl">Podiums</div></div>
        <div class="lp-stat"><div class="lp-stat-val">${bestPos !== "—" ? "P"+bestPos : "—"}</div><div class="lp-stat-lbl">Best</div></div>
        <div class="lp-stat"><div class="lp-stat-val">${avgPts}</div><div class="lp-stat-lbl">Avg Pts</div></div>
      </div>
      <div class="lp-tab-bar">${tabBtns}</div>
      ${tabPanels}
    </div>

    ${con ? `
    <div class="lp-constructor">
      <div class="lp-section-tag" style="color:${cColor}">Constructors' Championship Leader</div>
      <div class="lp-name" style="font-size:22px">${con.team}</div>
      <div class="lp-con-pts-row">
        <div class="lp-con-pts" style="color:${cColor}">${con.total}</div>
        <div class="lp-pts-lbl">PTS</div>
      </div>
      <div class="lp-drivers-pills">
        ${(con.drivers || []).map(c => `<span class="lp-driver-pill">${c}</span>`).join("")}
      </div>
    </div>` : ""}`;

  // Render current year donut immediately
  if (hist.length) {
    _lpDonut("lp-cur-chart", hist, dColor, `<b>${hist.length}</b><br>races`);
  }
}

async function _loadLpSeason(code, year, dColor) {
  const container = document.getElementById(`lp-tab-yr-${year}`);
  if (!container) return;
  try {
    const res = await fetch(`/api/driver-past-season/${code}?year=${year}`);
    const d   = await res.json();
    if (d.detail) throw new Error(d.detail);

    const hist = d.history || [];
    const chartId = `lp-chart-${year}`;
    container.innerHTML =
      _lpMiniStats(d.wins, d.podiums, d.races, d.total_pts, d.dnfs, d.best_pos) +
      (hist.length ? `<div id="${chartId}"></div>` : "");

    if (hist.length) {
      _lpDonut(chartId, hist, dColor, `<b>${d.races}</b><br>races`);
    }
  } catch (err) {
    container.innerHTML = `<div class="error-state" style="margin:12px 0">${year} stats unavailable: ${err.message}</div>`;
  }
}

function renderDriverChart(data) {
  const drivers = [...data.drivers].sort((a, b) => b.total - a.total);
  const maxPts = Math.max(...drivers.map(d => d.total), 1);
  const stub = maxPts * 0.018;
  const rowH = 32;
  const h = drivers.length * rowH + 28;

  Plotly.newPlot("driver-champ-chart", [{
    type: "bar",
    orientation: "h",
    x: drivers.map(d => d.total > 0 ? d.total : stub),
    y: drivers.map(d => d.code),
    text: drivers.map(d => `${d.total} pts`),
    textposition: "auto",
    insidetextanchor: "end",
    textfont: { color: "#fff", size: 11, family: "Outfit, sans-serif" },
    outsidetextfont: { color: "#7490b0", size: 10, family: "Outfit, sans-serif" },
    marker: {
      color: drivers.map(d => getTeamColor(d.team)),
      cornerradius: 6,
      line: { width: 0 },
      opacity: drivers.map(d => d.total > 0 ? 1 : 0.18),
    },
    customdata: drivers.map(d => [d.name, d.team, d.total]),
    hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}<br>%{customdata[2]} pts<extra></extra>",
  }], {
    ...PLOTLY_LAYOUT,
    autosize: true,
    height: h,
    bargap: 0.1,
    margin: { l: 44, r: 4, t: 2, b: 18 },
    xaxis: {
      ...PLOTLY_LAYOUT.xaxis,
      title: "",
      fixedrange: true,
      range: [0, maxPts * 1.04],
      tickfont: { size: 9, color: "#7490b0" },
    },
    yaxis: {
      ...PLOTLY_LAYOUT.yaxis,
      fixedrange: true,
      autorange: "reversed",
      tickfont: { size: 11, color: "#dce8f8", family: "Outfit, sans-serif" },
      ticksuffix: "  ",
    },
  }, CONFIG);
}

function renderConstructorChart(data) {
  const cons = [...data.constructors].sort((a, b) => b.total - a.total);
  const maxPts = Math.max(...cons.map(c => c.total), 1);
  const stub = maxPts * 0.018;
  const rowH = 38;
  const h = cons.length * rowH + 28;

  Plotly.newPlot("constructor-champ-chart", [{
    type: "bar",
    orientation: "h",
    x: cons.map(c => c.total > 0 ? c.total : stub),
    y: cons.map(c => c.team),
    text: cons.map(c => `${c.total} pts`),
    textposition: "auto",
    insidetextanchor: "end",
    textfont: { color: "#fff", size: 11, family: "Outfit, sans-serif" },
    outsidetextfont: { color: "#7490b0", size: 10, family: "Outfit, sans-serif" },
    marker: {
      color: cons.map(c => getTeamColor(c.team)),
      cornerradius: 6,
      line: { width: 0 },
      opacity: cons.map(c => c.total > 0 ? 1 : 0.18),
    },
    customdata: cons.map(c => c.total),
    hovertemplate: "<b>%{y}</b><br>%{customdata} pts<extra></extra>",
  }], {
    ...PLOTLY_LAYOUT,
    autosize: true,
    height: h,
    bargap: 0.12,
    margin: { l: 10, r: 4, t: 2, b: 18 },
    xaxis: {
      ...PLOTLY_LAYOUT.xaxis,
      title: "",
      fixedrange: true,
      range: [0, maxPts * 1.04],
      tickfont: { size: 9, color: "#7490b0" },
    },
    yaxis: {
      ...PLOTLY_LAYOUT.yaxis,
      automargin: true,
      fixedrange: true,
      autorange: "reversed",
      tickfont: { size: 10, color: "#dce8f8" },
      ticksuffix: "  ",
    },
  }, CONFIG);
}

function switchDriverTab(tab) {
  document.getElementById("driver-tab-standings").classList.toggle("hidden", tab !== "standings");
  document.getElementById("driver-tab-teammate").classList.toggle("hidden", tab !== "teammate");
  document.querySelectorAll(".chart-mini-tab").forEach((b, i) =>
    b.classList.toggle("active", ["standings", "teammate"][i] === tab));
  if (tab === "teammate" && standings) renderTeammateChart(standings);
}

function renderTeammateChart(data) {
  if (!data || !data.drivers) return;

  // Group by team, sort each team's pair by total desc
  const teamMap = {};
  data.drivers.forEach(d => {
    if (!teamMap[d.team]) teamMap[d.team] = [];
    teamMap[d.team].push(d);
  });

  const teams = Object.entries(teamMap)
    .map(([name, drivers]) => ({ name, drivers: [...drivers].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.drivers[0].total - a.drivers[0].total);

  const maxPts = Math.max(...data.drivers.map(d => d.total), 1);
  const stub   = maxPts * 0.018;

  const teamNames = teams.map(t => t.name);
  const d1 = teams.map(t => t.drivers[0]);
  const d2 = teams.map(t => t.drivers[1] || null);

  const traceBase = {
    type: "bar", orientation: "h",
    insidetextanchor: "end",
    textposition: "auto",
    textfont: { color: "#fff", size: 11, family: "Outfit, sans-serif" },
    outsidetextfont: { color: "#7490b0", size: 10, family: "Outfit, sans-serif" },
  };

  const trace1 = {
    ...traceBase,
    name: "Driver 1",
    y: teamNames,
    x: d1.map(d => d.total > 0 ? d.total : stub),
    text: d1.map(d => `${d.code}  ${d.total} pts`),
    marker: {
      color: teams.map(t => getTeamColor(t.name)),
      opacity: 1,
      cornerradius: 4,
      line: { width: 0 },
    },
    customdata: d1.map(d => [d.name, d.total]),
    hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]} pts<extra></extra>",
    showlegend: false,
  };

  const trace2 = {
    ...traceBase,
    name: "Driver 2",
    y: teamNames,
    x: d2.map(d => d ? (d.total > 0 ? d.total : stub) : null),
    text: d2.map(d => d ? `${d.code}  ${d.total} pts` : ""),
    marker: {
      color: teams.map(t => getTeamColor(t.name)),
      opacity: 0.45,
      cornerradius: 4,
      line: { width: 0 },
    },
    customdata: d2.map(d => d ? [d.name, d.total] : ["", 0]),
    hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]} pts<extra></extra>",
    showlegend: false,
  };

  const rowH = 26;
  const h = teams.length * rowH * 2 + 50;

  Plotly.newPlot("driver-teammate-chart", [trace1, trace2], {
    ...PLOTLY_LAYOUT,
    autosize: true,
    height: h,
    barmode: "group",
    bargap: 0.22,
    bargroupgap: 0.06,
    margin: { l: 110, r: 4, t: 2, b: 18 },
    xaxis: {
      ...PLOTLY_LAYOUT.xaxis,
      title: "",
      fixedrange: true,
      range: [0, maxPts * 1.1],
      tickfont: { size: 9, color: "#7490b0" },
    },
    yaxis: {
      ...PLOTLY_LAYOUT.yaxis,
      fixedrange: true,
      autorange: "reversed",
      automargin: true,
      tickfont: { size: 10, color: "#dce8f8", family: "Outfit, sans-serif" },
    },
  }, CONFIG);
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function notYetHtml(sessionName) {
  return `<div class="not-yet-state">
    <div class="not-yet-icon">🏁</div>
    <div class="not-yet-title">${sessionName} — Coming Soon</div>
    <div class="not-yet-sub">This session hasn't taken place yet. Check back once the weekend begins.</div>
  </div>`;
}

function skeletonTableHtml(headers, rows = 18) {
  const widths = [28, 140, 110, 80, 60, 70];
  const thHtml = headers.map(h => `<th>${h}</th>`).join("");
  const tdHtml = headers.map((_, i) => {
    const w = widths[i] || 80;
    return `<td><div class="skeleton-bar" style="height:13px;width:${w}px;border-radius:3px"></div></td>`;
  }).join("");
  const rowHtml = Array(rows).fill(`<tr>${tdHtml}</tr>`).join("");
  return `<div class="table-wrap">
    <table class="skeleton-table">
      <thead><tr>${thHtml}</tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
  </div>`;
}

/* ── Race Detail ───────────────────────────────────────────────────────────── */
const ALL_RACE_TABS = ["qualifying","race","laptimes","strategy","sprint","sprint_qualifying","practice"];

function _tabsForEvent(event) {
  const isSprint = event && (event.format === "sprint_qualifying" || event.format === "sprint");
  if (isSprint) {
    return [
      { id: "qualifying",        label: "Qualifying"       },
      { id: "race",              label: "Race"             },
      { id: "laptimes",          label: "Lap Times"        },
      { id: "strategy",          label: "Tire Strategy"    },
      { id: "sprint",            label: "Sprint Race"      },
      { id: "sprint_qualifying", label: "Sprint Qualifying" },
      { id: "practice",          label: "Practice"         },
    ];
  }
  return [
    { id: "qualifying", label: "Qualifying"    },
    { id: "race",       label: "Race"          },
    { id: "laptimes",   label: "Lap Times"     },
    { id: "strategy",   label: "Tire Strategy" },
    { id: "practice",   label: "Practice"      },
  ];
}

async function openRace(round, name) {
  currentRound = round;

  document.querySelectorAll(".rw-card").forEach(c => c.classList.remove("selected"));
  const card = document.getElementById(`rcard-${round}`);
  if (card) {
    card.classList.add("selected");
    card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  const detail = document.getElementById("race-detail");
  detail.classList.remove("hidden");
  document.getElementById("race-detail-title").textContent = `Round ${round} — ${name}`;

  document.getElementById("races").scrollIntoView({ behavior: "smooth", block: "start" });

  // Determine event format and build tab bar dynamically
  const event = schedule.find(e => e.round === round);
  const tabs   = _tabsForEvent(event);
  const isSprint = event && (event.format === "sprint_qualifying" || event.format === "sprint");

  const tabBar = document.querySelector(".race-tabs");
  tabBar.innerHTML = tabs.map((t, i) =>
    `<button class="tab-btn${i === 0 ? " active" : ""}" onclick="showRaceTab('${t.id}')">${t.label}</button>`
  ).join("");

  // Skeleton placeholders — each tab gets a table-shaped shimmer matching its headers
  const SKELETON_HEADERS = {
    qualifying:        ["Pos", "Driver", "Team", "Q3", "Q2", "Q1"],
    race:              ["Pos", "Driver", "Team", "Grid", "Pts", "Status"],
    laptimes:          ["Lap", "Driver", "Time", "Delta"],
    strategy:          ["Driver", "Team", "Stint 1", "Stint 2", "Stint 3"],
    sprint:            ["Pos", "Driver", "Team", "Grid", "Pts", "Status"],
    sprint_qualifying: ["Pos", "Driver", "Team", "SQ3", "SQ2", "SQ1"],
    practice:          ["Pos", "Driver", "Team", "Fastest Lap"],
  };
  ALL_RACE_TABS.forEach(t => {
    const el = document.getElementById(`race-tab-${t}`);
    el.innerHTML = skeletonTableHtml(SKELETON_HEADERS[t] || ["", "", "", ""]);
    el.classList.add("hidden");
  });
  document.getElementById("race-tab-qualifying").classList.remove("hidden");

  const loads = [loadQualifying(round), loadRaceData(round), loadPractice(round, isSprint)];
  if (isSprint) {
    loads.push(loadSprint(round));
    loads.push(loadSprintQualifying(round));
  }
  await Promise.all(loads);
}

function closeRaceDetail() {
  document.getElementById("race-detail").classList.add("hidden");
  document.querySelectorAll(".rw-card").forEach(c => c.classList.remove("selected"));
  currentRound = null;
}

function showRaceTab(tab) {
  ALL_RACE_TABS.forEach(t => document.getElementById(`race-tab-${t}`).classList.add("hidden"));
  document.getElementById(`race-tab-${tab}`).classList.remove("hidden");
  document.querySelectorAll(".race-tabs .tab-btn").forEach(b =>
    b.classList.toggle("active", b.getAttribute("onclick") === `showRaceTab('${tab}')`));
}

async function loadQualifying(round) {
  const tab = document.getElementById("race-tab-qualifying");
  try {
    if (!qualiCache[round]) {
      const res = await fetch(`/api/qualifying/${round}`);
      qualiCache[round] = await res.json();
    }
    const data = qualiCache[round];
    if (data.not_available) { tab.innerHTML = notYetHtml("Qualifying"); return; }
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    renderQualifying(data, tab, round);
  } catch (err) {
    tab.innerHTML = `<div class="error-state">Qualifying unavailable: ${err.message}</div>`;
  }
}

function renderQualifying(data, tab, round) {
  const q3exists = data.results.some(r => r.q3);
  const q2exists = data.results.some(r => r.q2);

  tab.innerHTML = "";

  // Delta bar chart
  const allWithTime = data.results.filter(r => r.q3s || r.q2s || r.q1s);
  if (allWithTime.length) {
    const best = Math.min(...allWithTime.map(r => r.q3s || r.q2s || r.q1s));
    const rev  = [...allWithTime].reverse();
    const chartDiv = document.createElement("div");
    chartDiv.className = "chart-wrap";
    chartDiv.innerHTML = `<div class="chart-title">Qualifying Gap to Pole</div><div id="quali-chart-${round}"></div>`;
    tab.appendChild(chartDiv);

    Plotly.newPlot(`quali-chart-${round}`, [{
      type: "bar", orientation: "h",
      x: rev.map(r => +((r.q3s || r.q2s || r.q1s) - best).toFixed(3)),
      y: rev.map(r => r.code),
      text: rev.map(r => r.q3 || r.q2 || r.q1),
      textposition: "outside",
      customdata: rev.map(r => r.driver),
      marker: { color: rev.map(r => getTeamColor(r.team)) },
      hovertemplate: "<b>%{customdata}</b><br>Best time: %{text}<br>Delta: +%{x:.3f}s<extra></extra>",
    }], {
      ...PLOTLY_LAYOUT, height: 400,
      margin: { l: 50, r: 150, t: 20, b: 40 },
      xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Gap to pole (s)", tickformat: "+.3f" },
    }, CONFIG);
  }

  // Table
  const tableDiv = document.createElement("div");
  tableDiv.className = "table-wrap";
  tableDiv.innerHTML = `
    <table>
      <thead><tr>
        <th>Pos</th><th>Driver</th><th>Team</th>
        ${q3exists ? "<th>Q3</th>" : ""}${q2exists ? "<th>Q2</th>" : ""}<th>Q1</th>
      </tr></thead>
      <tbody>${data.results.map(r => `
        <tr>
          <td><span class="pos-badge${r.pos <= 3 ? ` p${r.pos}` : ""}">${r.pos || "—"}</span></td>
          <td class="driver-name">
            <span class="team-dot" style="background:${getTeamColor(r.team)}"></span>${r.driver}
          </td>
          <td class="text-muted" style="font-size:11px">${r.team}</td>
          ${q3exists ? `<td class="${r.pos === 1 ? "text-red font-bold" : ""}">${r.q3 || "—"}</td>` : ""}
          ${q2exists ? `<td>${r.q2 || "—"}</td>` : ""}
          <td>${r.q1 || "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  tab.appendChild(tableDiv);
}

async function loadRaceData(round) {
  const raceTab  = document.getElementById("race-tab-race");
  const lapTab   = document.getElementById("race-tab-laptimes");
  const stratTab = document.getElementById("race-tab-strategy");
  try {
    if (!raceCache[round]) {
      const res = await fetch(`/api/race/${round}`);
      raceCache[round] = await res.json();
    }
    const data = raceCache[round];
    if (data.not_available) {
      [raceTab, lapTab, stratTab].forEach(t => t.innerHTML = notYetHtml("Race"));
      return;
    }
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    renderRaceResults(data, raceTab);
    renderLapTimes(data, lapTab, round);
    renderTireStrategy(data, stratTab, round);
  } catch (err) {
    [raceTab, lapTab, stratTab].forEach(t =>
      t.innerHTML = `<div class="error-state">Race data unavailable: ${err.message}</div>`);
  }
}

async function loadPractice(round, isSprint = false) {
  const tab = document.getElementById("race-tab-practice");
  try {
    // Sprint weekends only have FP1; conventional have FP1/FP2/FP3
    const fetches = isSprint
      ? [fetch(`/api/practice/${round}/1`).then(r => r.json())]
      : [
          fetch(`/api/practice/${round}/1`).then(r => r.json()),
          fetch(`/api/practice/${round}/2`).then(r => r.json()),
          fetch(`/api/practice/${round}/3`).then(r => r.json()),
        ];
    const results = await Promise.allSettled(fetches);
    const sessions = results
      .map(r => r.status === "fulfilled" && !r.value.detail && !r.value.not_available ? r.value : null)
      .filter(Boolean);
    if (!sessions.length) {
      tab.innerHTML = notYetHtml("Free Practice");
      return;
    }
    renderPractice(sessions, tab, round);
  } catch (err) {
    tab.innerHTML = `<div class="error-state">Practice unavailable: ${err.message}</div>`;
  }
}

async function loadSprint(round) {
  const tab = document.getElementById("race-tab-sprint");
  try {
    const res  = await fetch(`/api/sprint/${round}`);
    const data = await res.json();
    if (data.not_available) { tab.innerHTML = notYetHtml("Sprint Race"); return; }
    if (data.detail) throw new Error(data.detail);
    renderSprintResults(data, tab, round);
  } catch (err) {
    tab.innerHTML = `<div class="error-state">Sprint race data unavailable: ${err.message}</div>`;
  }
}

async function loadSprintQualifying(round) {
  const tab = document.getElementById("race-tab-sprint_qualifying");
  try {
    const res  = await fetch(`/api/sprint-qualifying/${round}`);
    const data = await res.json();
    if (data.not_available) { tab.innerHTML = notYetHtml("Sprint Qualifying"); return; }
    if (data.detail) throw new Error(data.detail);
    renderSprintQualifying(data, tab, round);
  } catch (err) {
    tab.innerHTML = `<div class="error-state">Sprint qualifying data unavailable: ${err.message}</div>`;
  }
}

function renderSprintResults(data, tab, round) {
  tab.innerHTML = "";
  if (!data.results || !data.results.length) {
    tab.innerHTML = `<div class="error-state">Sprint results not yet available.</div>`;
    return;
  }

  // Points bar chart
  const chartId = `sprint-chart-${round}`;
  const chartWrap = document.createElement("div");
  chartWrap.className = "chart-wrap";
  chartWrap.innerHTML = `<div class="chart-title">Sprint Race — Points Scored</div><div id="${chartId}"></div>`;
  tab.appendChild(chartWrap);

  const withPts = data.results.filter(r => r.pts > 0).reverse();
  if (withPts.length) {
    Plotly.newPlot(chartId, [{
      type: "bar", orientation: "h",
      x: withPts.map(r => r.pts),
      y: withPts.map(r => r.code),
      text: withPts.map(r => r.pts),
      textposition: "outside",
      customdata: withPts.map(r => r.driver),
      marker: { color: withPts.map(r => getTeamColor(r.team)) },
      hovertemplate: "<b>%{customdata}</b><br>Points: %{x}<extra></extra>",
    }], {
      ...PLOTLY_LAYOUT, height: 320,
      margin: { l: 50, r: 60, t: 20, b: 40 },
      xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Points" },
    }, CONFIG);
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time/Status</th><th>Pts</th></tr></thead>
      <tbody>${data.results.map(r => `
        <tr>
          <td><span class="pos-badge${r.pos <= 3 ? ` p${r.pos}` : ""}">${r.pos || "—"}</span></td>
          <td class="driver-name">
            <span class="team-dot" style="background:${getTeamColor(r.team)}"></span>${r.driver}
          </td>
          <td class="text-muted" style="font-size:11px">${r.team}</td>
          <td>${r.time || r.status || "—"}</td>
          <td class="${r.pos === 1 ? "text-red font-bold" : ""}">${r.pts || "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  tab.appendChild(tableWrap);
}

function renderSprintQualifying(data, tab, round) {
  tab.innerHTML = "";
  if (!data.results || !data.results.length) {
    tab.innerHTML = `<div class="error-state">Sprint qualifying results not yet available.</div>`;
    return;
  }

  const q3exists = data.results.some(r => r.q3);
  const q2exists = data.results.some(r => r.q2);

  // Gap chart
  const allWithTime = data.results.filter(r => r.q3s || r.q2s || r.q1s);
  if (allWithTime.length) {
    const best    = Math.min(...allWithTime.map(r => r.q3s || r.q2s || r.q1s));
    const rev     = [...allWithTime].reverse();
    const chartId = `sq-chart-${round}`;
    const chartWrap = document.createElement("div");
    chartWrap.className = "chart-wrap";
    chartWrap.innerHTML = `<div class="chart-title">Sprint Qualifying Gap to Pole</div><div id="${chartId}"></div>`;
    tab.appendChild(chartWrap);

    Plotly.newPlot(chartId, [{
      type: "bar", orientation: "h",
      x: rev.map(r => +((r.q3s || r.q2s || r.q1s) - best).toFixed(3)),
      y: rev.map(r => r.code),
      text: rev.map(r => r.q3 || r.q2 || r.q1),
      textposition: "outside",
      customdata: rev.map(r => r.driver),
      marker: { color: rev.map(r => getTeamColor(r.team)) },
      hovertemplate: "<b>%{customdata}</b><br>Best: %{text}<br>Delta: +%{x:.3f}s<extra></extra>",
    }], {
      ...PLOTLY_LAYOUT, height: 400,
      margin: { l: 50, r: 150, t: 20, b: 40 },
      xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Gap to pole (s)", tickformat: "+.3f" },
    }, CONFIG);
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  tableWrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Pos</th><th>Driver</th><th>Team</th>
        ${q3exists ? "<th>SQ3</th>" : ""}${q2exists ? "<th>SQ2</th>" : ""}<th>SQ1</th>
      </tr></thead>
      <tbody>${data.results.map(r => `
        <tr>
          <td><span class="pos-badge${r.pos <= 3 ? ` p${r.pos}` : ""}">${r.pos || "—"}</span></td>
          <td class="driver-name">
            <span class="team-dot" style="background:${getTeamColor(r.team)}"></span>${r.driver}
          </td>
          <td class="text-muted" style="font-size:11px">${r.team}</td>
          ${q3exists ? `<td class="${r.pos === 1 ? "text-red font-bold" : ""}">${r.q3 || "—"}</td>` : ""}
          ${q2exists ? `<td>${r.q2 || "—"}</td>` : ""}
          <td>${r.q1 || "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  tab.appendChild(tableWrap);
}

function toggleFpCard(header) {
  const card = header.closest(".fp-card");
  const isOpen = card.classList.toggle("open");
  if (isOpen) {
    // Resize the Plotly chart now that it's visible
    card.querySelectorAll(".js-plotly-plot").forEach(el => Plotly.Plots.resize(el));
  }
}

function renderPractice(sessions, tab, round) {
  tab.innerHTML = `<div class="fp-accordion"></div>`;
  const accordion = tab.querySelector(".fp-accordion");

  sessions.forEach((data, idx) => {
    if (!data.results || !data.results.length) return;

    const best    = data.results[0].lap_sec;
    const chartId = `practice-chart-${round}-${data.session}`;
    const top3    = data.results.slice(0, 3).map(r => r.code).join(" · ");
    const fastest = data.results[0].lap_time || "—";

    // Build card — first session open by default
    const card = document.createElement("div");
    card.className = `fp-card${idx === 0 ? " open" : ""}`;
    card.innerHTML = `
      <div class="fp-card-header" onclick="toggleFpCard(this)">
        <div class="fp-card-title">
          <span class="fp-card-name">${data.session}</span>
          <span class="fp-card-meta">${top3}</span>
        </div>
        <div class="fp-card-right">
          <span class="fp-card-best">${fastest}</span>
          <svg class="fp-card-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="fp-card-body">
        <div class="chart-wrap" style="margin-top:8px">
          <div class="chart-title">${data.session} — Fastest Lap Delta</div>
          <div id="${chartId}"></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Fastest Lap</th></tr></thead>
            <tbody>${data.results.map(r => `
              <tr>
                <td><span class="pos-badge${r.pos <= 3 ? ` p${r.pos}` : ""}">${r.pos}</span></td>
                <td class="driver-name">
                  <span class="team-dot" style="background:${getTeamColor(r.team)}"></span>${r.driver}
                </td>
                <td class="text-muted" style="font-size:11px">${r.team}</td>
                <td class="${r.pos === 1 ? "text-red font-bold" : ""}">${r.lap_time || "—"}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
    accordion.appendChild(card);

    // Render chart (only visible if open; others will render on expand via resize)
    const rev = [...data.results].reverse();
    Plotly.newPlot(chartId, [{
      type: "bar", orientation: "h",
      x: rev.map(r => r.lap_sec != null ? +(r.lap_sec - best).toFixed(3) : null),
      y: rev.map(r => r.code),
      text: rev.map(r => r.lap_time || "—"),
      textposition: "outside",
      customdata: rev.map(r => r.driver),
      marker: { color: rev.map(r => getTeamColor(r.team)) },
      hovertemplate: "<b>%{customdata}</b><br>Fastest: %{text}<br>Delta: +%{x:.3f}s<extra></extra>",
    }], {
      ...PLOTLY_LAYOUT, height: 380,
      margin: { l: 50, r: 150, t: 20, b: 40 },
      xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Gap to fastest (s)", tickformat: "+.3f" },
    }, CONFIG);
  });
}

function renderRaceResults(data, tab) {
  tab.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Grid</th><th>Pts</th><th>Status</th></tr></thead>
        <tbody>${data.results.map(r => `
          <tr>
            <td><span class="pos-badge${r.pos <= 3 ? ` p${r.pos}` : ""}">${r.pos || "—"}</span></td>
            <td class="driver-name">
              <span class="team-dot" style="background:${getTeamColor(r.team)}"></span>${r.driver}
            </td>
            <td class="text-muted" style="font-size:11px">${r.team}</td>
            <td>${r.grid !== null ? (r.grid === 0 ? "PL" : r.grid) : "—"}</td>
            <td class="pts-value ${r.pts > 0 ? "text-red" : "text-muted"}">${r.pts}</td>
            <td class="text-muted" style="font-size:11px">${r.status}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderLapTimes(data, tab, round) {
  tab.innerHTML = "";
  if (!data.laps || !data.laps.length) {
    tab.innerHTML = '<div class="empty-state">Lap time data unavailable.</div>';
    return;
  }
  const chartDiv = document.createElement("div");
  chartDiv.className = "chart-wrap";
  chartDiv.innerHTML = `<div class="chart-title">Race Lap Times — top 6 drivers</div><div id="lap-chart-${round}"></div>`;
  tab.appendChild(chartDiv);

  const traces = data.laps.map((d, i) => ({
    type: "scatter", mode: "lines",
    name: d.drv,
    x: d.laps.map(l => l.n),
    y: d.laps.map(l => l.t),
    line: { color: PALETTE[i % PALETTE.length], width: 1.5 },
    hovertemplate: `<b>${d.drv}</b> Lap %{x}<br>%{y:.3f}s<extra></extra>`,
  }));

  Plotly.newPlot(`lap-chart-${round}`, traces, {
    ...PLOTLY_LAYOUT, height: 360,
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Lap" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, title: "Lap Time (s)" },
  }, CONFIG);
}

function renderTireStrategy(data, tab, round) {
  tab.innerHTML = "";
  if (!data.strategy || !data.strategy.length) {
    tab.innerHTML = '<div class="empty-state">Tire strategy data unavailable.</div>';
    return;
  }
  const chartDiv = document.createElement("div");
  chartDiv.className = "chart-wrap";
  chartDiv.innerHTML = `<div class="chart-title">Tire Strategy</div><div id="strat-chart-${round}"></div>`;
  tab.appendChild(chartDiv);

  const totalLaps = data.total_laps || 60;
  const traces = [];

  data.strategy.forEach(d => {
    d.stints.forEach(s => {
      traces.push({
        type: "bar", orientation: "h",
        name: s.c,
        x: [s.end - s.start + 1],
        y: [d.drv],
        base: [s.start - 1],
        marker: { color: COMPOUND_COLORS[s.c] || "#666" },
        hovertemplate: `<b>${d.drv}</b> — ${s.c}<br>Laps ${s.start}–${s.end}<extra></extra>`,
        showlegend: !traces.some(t => t.name === s.c),
      });
    });
  });

  Plotly.newPlot(`strat-chart-${round}`, traces, {
    ...PLOTLY_LAYOUT,
    barmode: "stack",
    height: Math.max(300, data.strategy.length * 28 + 80),
    margin: { l: 50, r: 30, t: 20, b: 50 },
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Lap", range: [0, totalLaps] },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, automargin: true },
    legend: { ...PLOTLY_LAYOUT.legend, title: { text: "Compound" } },
  }, CONFIG);
}

/* ── Advanced Analysis ─────────────────────────────────────────────────────── */
async function loadAnalysis() {
  const round = document.getElementById("analysis-race-select").value;
  const stype = document.getElementById("analysis-session-select").value;
  if (!round) return;

  const content = document.getElementById("analysis-content");
  const loading = document.getElementById("analysis-loading");
  content.classList.add("hidden");
  loading.classList.remove("hidden");
  loading.innerHTML = `<div class="spinner"></div><p>Loading telemetry (may take a moment)…</p>`;

  try {
    const res  = await fetch(`/api/telemetry/${round}?type=${stype}`);
    const data = await res.json();
    if (data.error || data.detail) throw new Error(data.error || data.detail);
    loading.classList.add("hidden");
    content.classList.remove("hidden");
    renderAnalysis(data);
    showAnalysisTab("speed");
  } catch (err) {
    loading.innerHTML = `<div class="error-state">Telemetry unavailable: ${err.message}</div>`;
  }
}

function renderAnalysis(data) {
  if (!data.drivers || !data.drivers.length) {
    document.getElementById("analysis-content").innerHTML =
      '<div class="empty-state">No telemetry data available.</div>';
    return;
  }
  renderSpeedTrace(data);
  renderThrottleBrake(data);
  renderSectorTimes(data);
  renderGearChart(data);
  renderDriverCards(data);
}

function renderSpeedTrace(data) {
  const traces = data.drivers.map((d, i) => ({
    type: "scatter", mode: "lines",
    name: d.code,
    x: d.tel.dist, y: d.tel.speed,
    line:   { color: PALETTE[i % PALETTE.length], width: 1.8 },
    hovertemplate: `<b>${d.code}</b><br>%{x:.0f}m — %{y:.0f} km/h<extra></extra>`,
  }));
  Plotly.newPlot("speed-chart", traces, {
    ...PLOTLY_LAYOUT, height: 360,
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Distance (m)" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, title: "Speed (km/h)" },
  }, CONFIG);
}

function renderThrottleBrake(data) {
  const thTraces = data.drivers.map((d, i) => ({
    type: "scatter", mode: "lines", name: d.code,
    x: d.tel.dist, y: d.tel.throttle,
    line: { color: PALETTE[i % PALETTE.length], width: 1.5 },
    hovertemplate: `<b>${d.code}</b><br>Throttle: %{y:.0f}%<extra></extra>`,
  }));
  const brTraces = data.drivers.map((d, i) => ({
    type: "scatter", mode: "lines", name: d.code,
    x: d.tel.dist, y: d.tel.brake,
    showlegend: false,
    line: { color: PALETTE[i % PALETTE.length], width: 1.5 },
    hovertemplate: `<b>${d.code}</b><br>Brake: %{y:.0f}<extra></extra>`,
  }));
  Plotly.newPlot("throttle-chart", thTraces, {
    ...PLOTLY_LAYOUT, height: 260,
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Distance (m)" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, title: "Throttle (%)", range: [0, 105] },
  }, CONFIG);
  Plotly.newPlot("brake-chart", brTraces, {
    ...PLOTLY_LAYOUT, height: 200,
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Distance (m)" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, title: "Brake", range: [-0.1, 1.1] },
  }, CONFIG);
}

function renderSectorTimes(data) {
  const drivers = data.drivers.filter(d => d.sectors.s1 || d.sectors.s2 || d.sectors.s3);
  if (!drivers.length) {
    document.getElementById("sector-chart").innerHTML = '<div class="empty-state">No sector data.</div>';
    return;
  }
  const bests = [
    Math.min(...drivers.map(d => d.sectors.s1 || Infinity)),
    Math.min(...drivers.map(d => d.sectors.s2 || Infinity)),
    Math.min(...drivers.map(d => d.sectors.s3 || Infinity)),
  ];
  const traces = ["s1","s2","s3"].map((s, si) => ({
    type: "bar",
    name: `Sector ${si + 1}`,
    x: drivers.map(d => d.code),
    y: drivers.map(d => d.sectors[s] ? +(d.sectors[s] - bests[si]).toFixed(3) : null),
    text: drivers.map(d => d.sectors[s] ? d.sectors[s].toFixed(3) + "s" : ""),
    textposition: "outside",
    marker: { color: ["#3671c6","#e10600","#27f4d2"][si] },
    hovertemplate: `S${si+1} delta: +%{y:.3f}s<extra></extra>`,
  }));
  Plotly.newPlot("sector-chart", traces, {
    ...PLOTLY_LAYOUT, height: 340, barmode: "group",
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Driver" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, title: "Delta to fastest (s)", tickformat: "+.3f" },
  }, CONFIG);
}

function renderGearChart(data) {
  const traces = data.drivers.map((d, i) => ({
    type: "scatter", mode: "lines", name: d.code,
    x: d.tel.dist, y: d.tel.gear,
    line: { color: PALETTE[i % PALETTE.length], width: 1.5, shape: "hv" },
    hovertemplate: `<b>${d.code}</b><br>%{x:.0f}m — Gear %{y}<extra></extra>`,
  }));
  Plotly.newPlot("gear-chart", traces, {
    ...PLOTLY_LAYOUT, height: 280,
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Distance (m)" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, title: "Gear", dtick: 1, range: [0.5, 9.5] },
  }, CONFIG);
}

function renderDriverCards(data) {
  const s1Times = data.drivers.map(d => d.sectors.s1).filter(Boolean);
  const s2Times = data.drivers.map(d => d.sectors.s2).filter(Boolean);
  const s3Times = data.drivers.map(d => d.sectors.s3).filter(Boolean);
  const bests   = [Math.min(...s1Times), Math.min(...s2Times), Math.min(...s3Times)];

  document.getElementById("driver-comparison-table").innerHTML = `
    <div class="section-title" style="margin-top:24px">Driver Comparison</div>
    <div class="driver-grid">${data.drivers.map((d, i) => `
      <div class="driver-compare-card" style="border-left-color:${PALETTE[i % PALETTE.length]}">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <div class="driver-compare-code" style="color:${PALETTE[i % PALETTE.length]}">${d.code}</div>
            <div class="driver-compare-team text-muted">${d.team}</div>
          </div>
        </div>
        <div class="driver-sectors">
          ${["s1","s2","s3"].map((s, si) => {
            const t     = d.sectors[s];
            const isBest = t && isFinite(bests[si]) && Math.abs(t - bests[si]) < 0.001;
            return `<div class="sector-cell">
              <div class="sector-label">S${si+1}</div>
              <div class="sector-time ${isBest ? "best" : ""}">${t ? t.toFixed(3) : "—"}</div>
            </div>`;
          }).join("")}
        </div>
        <div class="lap-time-total">
          <span class="lap-label">Fastest lap</span>
          <span class="lap-time">${d.lap_time ? formatLapTime(d.lap_time) : "—"}</span>
        </div>
      </div>`).join("")}
    </div>`;
}

function showAnalysisTab(tab) {
  ["speed","throttle","sectors","gear"].forEach(t =>
    document.getElementById(`analysis-tab-${t}`).classList.add("hidden"));
  document.getElementById(`analysis-tab-${tab}`).classList.remove("hidden");
  document.querySelectorAll(".analysis-tabs .tab-btn").forEach((b, i) =>
    b.classList.toggle("active", ["speed","throttle","sectors","gear"][i] === tab));
  const ids = { speed:"speed-chart", throttle:"throttle-chart", sectors:"sector-chart", gear:"gear-chart" };
  if (ids[tab]) try { Plotly.Plots.resize(ids[tab]); } catch(e) {}
  if (tab === "throttle") try { Plotly.Plots.resize("brake-chart"); } catch(e) {}
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function getTeamColor(team) { return TEAM_COLORS[team] || "#888"; }

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatLapTime(secs) {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3);
  return `${m}:${s.padStart(6, "0")}`;
}

// ── League View ──────────────────────────────────────────────────────────────

let _currentLeagueId = null;
let _playerColorMap = {};
let _prevBetResults = {};      // bet_id → result, for detecting changes
let _leagueInterval = null;    // polling interval for league view
let _f1Interval     = null;    // polling interval for F1 data
const PLAYER_COLORS = [
  "#4a90d9","#27f4d2","#ff8000","#e8002d","#229971",
  "#ffd600","#ff87bc","#c0a846","#64c4ff","#b6babd",
];
const CARD_H = 96, CARD_GAP = 12;
const COLLAPSED_OFFSETS = [0, 12, 24, 36];
const STACK_PREVIEW = 4; // cards visible in collapsed state

function openLeagueView(leagueId) {
  _currentLeagueId = leagueId;
  _prevBetResults  = {};
  if (document.getElementById("page-leagues").classList.contains("hidden")) {
    showLeaguesPage();
  }
  document.getElementById("leagues-list-view").classList.add("hidden");
  document.getElementById("league-view").classList.remove("hidden");
  window.scrollTo(0, 0);
  loadLeagueView(leagueId);
  // Poll every 60 s
  if (_leagueInterval) clearInterval(_leagueInterval);
  _leagueInterval = setInterval(() => {
    if (_currentLeagueId) silentRefreshLeague(_currentLeagueId);
  }, 60_000);
}

function closeLeagueView() {
  if (_leagueInterval) { clearInterval(_leagueInterval); _leagueInterval = null; }
  document.getElementById("league-view").classList.add("hidden");
  document.getElementById("leagues-list-view").classList.remove("hidden");
  _currentLeagueId = null;
  renderLeaguesFullSection();
}

async function loadLeagueView(lid) {
  document.getElementById("league-view-title").textContent = "Loading…";
  document.getElementById("league-members-panel").innerHTML = `<div class="spinner" style="margin:32px auto"></div>`;
  document.getElementById("league-bets-panel").innerHTML   = `<div class="spinner" style="margin:32px auto"></div>`;
  try {
    const [detailRes, betsRes] = await Promise.all([
      fetch(`/api/leagues/${lid}`),
      fetch(`/api/leagues/${lid}/bets`),
    ]);
    const detail   = await detailRes.json();
    const betsData = await betsRes.json();
    if (detail.detail) throw new Error(detail.detail);
    const bets = betsData.bets || [];
    // Seed known states so first load doesn't fire toasts
    bets.forEach(b => { _prevBetResults[b.id] = b.result; });
    renderLeagueViewContent(detail, bets);
  } catch (e) {
    document.getElementById("league-view-title").textContent = "Error";
    document.getElementById("league-members-panel").innerHTML = `<div class="error-state">${e.message}</div>`;
  }
}

async function silentRefreshLeague(lid) {
  try {
    const [detailRes, betsRes] = await Promise.all([
      fetch(`/api/leagues/${lid}`),
      fetch(`/api/leagues/${lid}/bets`),
    ]);
    const detail   = await detailRes.json();
    const betsData = await betsRes.json();
    if (detail.detail) return;
    const bets = betsData.bets || [];
    // Detect newly resolved bets
    bets.forEach(b => {
      const prev = _prevBetResults[b.id];
      if (prev === "pending" && b.result !== "pending") {
        showBetToast(b, detail.members);
      }
      _prevBetResults[b.id] = b.result;
    });
    renderLeagueViewContent(detail, bets);
  } catch (e) { /* silent */ }
}

function renderLeagueViewContent(detail, bets) {
  const { league, members, current_user_id } = detail;
  document.getElementById("league-view-title").textContent = league.name;
  document.getElementById("league-view-code").textContent  = league.code;

  // Show final reward banner
  const rewardEl = document.getElementById("league-reward-banner");
  if (rewardEl) {
    if (league.final_reward) {
      rewardEl.textContent = `🏆 Final Reward: ${league.final_reward}`;
      rewardEl.classList.remove("hidden");
    } else {
      rewardEl.classList.add("hidden");
    }
  }

  renderWinsChart(members);
  renderMembersPanel(members, current_user_id);
  renderBetsPanel(bets, members);
}

// ── Wins Rankings Chart ───────────────────────────────────────────────────────
function renderWinsChart(members) {
  const wrap = document.getElementById("league-chart-wrap");
  if (!wrap) return;
  wrap.classList.remove("hidden");

  const sorted = [...members].sort((a, b) => (b.bets_won || 0) - (a.bets_won || 0));
  const colors = sorted.map(m => _playerColorMap[m.id] || "#4a90d9");
  const names  = sorted.map(m => m.name || m.username);
  const wins   = sorted.map(m => m.bets_won || 0);

  Plotly.react("league-drachma-chart", [{
    type: "bar",
    orientation: "h",
    y: names,
    x: wins,
    text: wins.map(w => w === 0 ? "0 wins" : `${w} win${w !== 1 ? "s" : ""}`),
    textposition: "outside",
    marker: { color: colors, opacity: 0.9 },
    hovertemplate: "<b>%{y}</b><br>%{x} bets won<extra></extra>",
  }], {
    ...PLOTLY_LAYOUT,
    height: Math.max(120, sorted.length * 42),
    margin: { l: 110, r: 80, t: 8, b: 30 },
    xaxis: { ...PLOTLY_LAYOUT.xaxis, title: "Bets Won", dtick: 1, rangemode: "tozero" },
    yaxis: { ...PLOTLY_LAYOUT.yaxis, automargin: true },
  }, CONFIG);
}

// ── Toast Notifications ───────────────────────────────────────────────────────
function showToast(title, msg, type = "info", icon = "ℹ️") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 5500);
}

function showBetToast(bet, members) {
  const member = (members || []).find(m => m.id === bet.user_id);
  const who  = member ? (member.name || member.username) : `@${bet.user_username}`;
  const type = bet.prediction;
  if (bet.result === "win") {
    showToast(
      `🎉 ${who} won a bet!`,
      `${type} · R${String(bet.race_round).padStart(2,"0")}${bet.custom_wager ? ` · ${bet.custom_wager}` : ""}`,
      "win", "🏆"
    );
  } else {
    showToast(
      `${who}'s bet settled`,
      `${type} · R${String(bet.race_round).padStart(2,"0")} · Better luck next time`,
      "loss", "❌"
    );
  }
}

function renderMembersPanel(members, currentUserId) {
  // Assign a stable color per user_id — used by bet cards too
  _playerColorMap = {};
  members.forEach((m, i) => {
    _playerColorMap[m.id] = PLAYER_COLORS[i % PLAYER_COLORS.length];
  });

  const panel = document.getElementById("league-members-panel");
  const rankClass = i => i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
  const rows = members.map((m, i) => {
    const color = _playerColorMap[m.id];
    return `
    <div class="member-row" style="border-left: 3px solid ${color}; padding-left: 10px;">
      <div class="member-rank ${rankClass(i)}">${i + 1}</div>
      <div class="member-avatar" style="border-color:${color};box-shadow:0 0 6px ${color}40">${(m.name || m.username)[0].toUpperCase()}</div>
      <div class="member-info">
        <div class="member-name">${m.name || m.username} ${m.id === currentUserId ? '<span class="you-badge">You</span>' : ''}</div>
        <div class="member-username">@${m.username}</div>
      </div>
      <div class="member-wins">${m.bets_won || 0} <span style="font-size:10px;color:var(--muted)">WIN${(m.bets_won || 0) !== 1 ? "S" : ""}</span></div>
    </div>`;
  }).join("");
  panel.innerHTML = `
    <div class="members-panel-title">Members · ${members.length}</div>
    ${rows}`;
}

const BET_TYPE_ICONS = {
  race_winner: "🏆", pole_position: "⚡", fastest_lap: "⏱", constructor_winner: "🏎", podium: "🥉"
};
const BET_TYPE_LABELS = {
  race_winner: "Race Winner", pole_position: "Pole Position", fastest_lap: "Fastest Lap",
  constructor_winner: "Constructor Win", podium: "Podium Finish"
};

function buildBetCardHTML(bet, color) {
  const icon  = BET_TYPE_ICONS[bet.bet_type]  || "🎯";
  const label = BET_TYPE_LABELS[bet.bet_type] || bet.bet_type;
  const ts    = new Date(bet.created_at).toLocaleDateString("en-GB", { day:"numeric", month:"short" });
  const resultClass = bet.result === "win" ? "win" : bet.result === "loss" ? "loss" : "pending";
  const resultText  = bet.result === "win" ? "Won" : bet.result === "loss" ? "Lost" : "Pending";
  const col = color || _playerColorMap[bet.user_id] || "#4a90d9";
  const stakeHtml = bet.custom_wager
    ? `<div class="bet-card-stake" style="color:${col}cc">Stake: ${bet.custom_wager}</div>`
    : "";
  return `
    <div class="bet-card-icon" style="background:${col}18;border-color:${col}40;color:${col}">${icon}</div>
    <div class="bet-card-body">
      <div class="bet-card-type">R${String(bet.race_round).padStart(2,"0")} · ${label}</div>
      <div class="bet-card-prediction">${bet.prediction}</div>
      ${stakeHtml}
      <div class="bet-card-meta" style="color:${col}99">@${bet.user_username} · ${ts}</div>
    </div>
    <div class="bet-result-badge ${resultClass}">${resultText}</div>`;
}

function renderBetsPanel(bets, members) {
  const panel = document.getElementById("league-bets-panel");
  if (!bets.length) {
    panel.innerHTML = `
      <div class="bets-panel-header">
        <div class="bets-panel-title">Recent Actions</div>
      </div>
      <div class="no-bets-state">No bets placed yet.<br>Be the first to place a bet!</div>`;
    return;
  }

  const visible = bets.slice(0, STACK_PREVIEW);
  const hasMore = bets.length > STACK_PREVIEW;

  // Build collapsed card positions
  const cardEls = visible.map((bet, i) => {
    const zIndex = STACK_PREVIEW - i;
    const col = _playerColorMap[bet.user_id] || "#4a90d9";
    return `<div class="bet-card" data-index="${i}" style="top:${COLLAPSED_OFFSETS[i] || i*12}px;z-index:${zIndex};--player-color:${col}">${buildBetCardHTML(bet, col)}</div>`;
  }).join("");

  panel.innerHTML = `
    <div class="bets-panel-header">
      <div class="bets-panel-title">Recent Actions · ${bets.length}</div>
      ${hasMore ? `<button class="view-all-btn" onclick="openAllBetsModal()">View all →</button>` : ""}
    </div>
    <div class="bets-stack-wrap collapsed" id="bets-stack" onclick="toggleBetsStack(event)">
      ${cardEls}
      <div class="bets-expand-hint">Click to expand</div>
    </div>
    <button class="bets-show-less" id="bets-show-less" onclick="collapseBetsStack()">Show less</button>`;

  // Store bets on the element for expand/collapse
  document.getElementById("bets-stack")._bets = bets;
  updateBetsStackPositions(false);
}

function toggleBetsStack(e) {
  const stack = document.getElementById("bets-stack");
  if (!stack) return;
  const isExpanded = stack.classList.contains("expanded");
  if (isExpanded) return; // clicking expanded stack does nothing (use show-less button)
  expandBetsStack();
}

function expandBetsStack() {
  const stack = document.getElementById("bets-stack");
  if (!stack) return;
  stack.classList.remove("collapsed");
  stack.classList.add("expanded");
  document.getElementById("bets-show-less").classList.add("visible");
  updateBetsStackPositions(true);
}

function collapseBetsStack() {
  const stack = document.getElementById("bets-stack");
  if (!stack) return;
  stack.classList.remove("expanded");
  stack.classList.add("collapsed");
  document.getElementById("bets-show-less").classList.remove("visible");
  updateBetsStackPositions(false);
}

function updateBetsStackPositions(expanded) {
  const stack = document.getElementById("bets-stack");
  if (!stack) return;
  const cards = stack.querySelectorAll(".bet-card");
  const totalH = cards.length * (CARD_H + CARD_GAP);
  if (expanded) {
    stack.style.minHeight = totalH + "px";
    cards.forEach((card, i) => {
      card.style.top = (i * (CARD_H + CARD_GAP)) + "px";
      card.style.zIndex = cards.length - i;
    });
  } else {
    stack.style.minHeight = "140px";
    cards.forEach((card, i) => {
      card.style.top = (COLLAPSED_OFFSETS[i] || Math.min(i * 12, 36)) + "px";
      card.style.zIndex = cards.length - i;
    });
  }
}

// All bets modal
function openAllBetsModal() {
  const stack = document.getElementById("bets-stack");
  const bets  = stack ? stack._bets || [] : [];
  const list  = bets.map(bet => {
    const col = _playerColorMap[bet.user_id] || "#4a90d9";
    return `
    <div class="all-bet-row" style="border-left:3px solid ${col};padding-left:12px">
      <div class="bet-card-icon" style="width:36px;height:36px;font-size:16px;border-radius:10px;background:${col}18;border-color:${col}40;color:${col}">${BET_TYPE_ICONS[bet.bet_type] || "🎯"}</div>
      <div class="bet-card-body">
        <div class="bet-card-type">R${String(bet.race_round).padStart(2,"0")} · ${BET_TYPE_LABELS[bet.bet_type] || bet.bet_type}</div>
        <div class="bet-card-prediction">${bet.prediction}</div>
        <div class="bet-card-meta" style="color:${col}99">@${bet.user_username} · ${new Date(bet.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>
      </div>
      <div class="bet-result-badge ${bet.result === "win" ? "win" : bet.result === "loss" ? "loss" : "pending"}">${bet.result === "win" ? "Won" : bet.result === "loss" ? "Lost" : "Pending"}</div>
    </div>`;
  }).join("");
  document.getElementById("all-bets-list").innerHTML = list || "<div style='color:var(--muted);text-align:center;padding:24px'>No actions yet.</div>";
  document.getElementById("all-bets-overlay").classList.remove("hidden");
}

function closeAllBetsModal(e, force = false) {
  if (!force && e && e.target !== document.getElementById("all-bets-overlay")) return;
  document.getElementById("all-bets-overlay").classList.add("hidden");
}

// Bet placement modal
const BET_TYPES = [
  { value: "race_winner",        label: "Race Winner",       icon: "🏆", sprintOnly: false },
  { value: "pole_position",      label: "Pole Position",     icon: "⚡", sprintOnly: false },
  { value: "fastest_lap",        label: "Fastest Lap",       icon: "⏱", sprintOnly: false },
  { value: "constructor_winner", label: "Constructor Win",   icon: "🏎", sprintOnly: false },
  { value: "podium",             label: "Podium Finish",     icon: "🥉", sprintOnly: false },
  { value: "sprint_winner",      label: "Sprint Winner",     icon: "💨", sprintOnly: true  },
];

function _isSprintRound(roundVal) {
  const ev = schedule.find(e => e.round === parseInt(roundVal));
  return ev && (ev.format === "sprint_qualifying" || ev.format === "sprint");
}

function _betTypeOpts(roundVal) {
  const isSprint = _isSprintRound(roundVal);
  return BET_TYPES
    .filter(t => !t.sprintOnly || isSprint)
    .map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`)
    .join("");
}

function updateBetTypes(roundVal) {
  const el = document.getElementById("bet-type");
  if (el) el.innerHTML = _betTypeOpts(roundVal);
}

function openBetModal() {
  if (!currentUser) { openAuthModal("login"); return; }
  document.getElementById("bet-modal-body").innerHTML = buildBetModalHTML();
  document.getElementById("bet-overlay").classList.remove("hidden");
}

function buildBetModalHTML() {
  const upcomingEvents = schedule.filter(e => !e.is_past);
  const raceOpts = upcomingEvents
    .map(e => {
      const sprintTag = (e.format === "sprint_qualifying" || e.format === "sprint") ? " ⚡ Sprint" : "";
      return `<option value="${e.round}">${e.name}${sprintTag}</option>`;
    })
    .join("");
  const firstRound = upcomingEvents.length ? upcomingEvents[0].round : "";
  const raceSelect = raceOpts
    ? `<select id="bet-round" onchange="updateBetTypes(this.value)" style="width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px">${raceOpts}</select>`
    : `<input id="bet-round" type="number" min="1" max="24" placeholder="Round number" style="width:100%">`;

  const typeOpts = _betTypeOpts(firstRound);

  const drivers = _driversList.length ? _driversList : [
    "Alexander Albon","Andrea Kimi Antonelli","Carlos Sainz","Charles Leclerc",
    "Esteban Ocon","Fernando Alonso","Franco Colapinto","Gabriel Bortoleto",
    "George Russell","Isack Hadjar","Jack Doohan","Lance Stroll",
    "Lando Norris","Lewis Hamilton","Liam Lawson","Max Verstappen",
    "Nico Hülkenberg","Oliver Bearman","Oscar Piastri","Pierre Gasly","Yuki Tsunoda",
  ];
  const driverOpts = `<option value="">— Select driver —</option>` +
    drivers.map(d => `<option value="${d}">${d}</option>`).join("");

  return `
    <div class="modal-title">Place a Bet</div>
    <div class="modal-sub">Make your prediction. Settle your custom stake with friends when results are in.</div>
    <div class="modal-field">
      <label>Race</label>
      ${raceSelect}
    </div>
    <div class="modal-field">
      <label>Bet Type</label>
      <select id="bet-type" style="width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px">
        ${typeOpts}
      </select>
    </div>
    <div class="modal-field">
      <label>Your Prediction</label>
      <select id="bet-prediction" style="width:100%;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px">
        ${driverOpts}
      </select>
    </div>
    <div class="modal-field">
      <label>Your Stake <span style="color:var(--muted);font-weight:400">(optional — e.g. "I'll buy everyone lunch")</span></label>
      <input id="bet-wager" type="text" maxlength="200" placeholder="e.g. I'll buy everyone lunch" style="width:100%">
    </div>
    <div id="bet-error" class="modal-error hidden"></div>
    <button class="modal-btn" style="width:100%;margin-top:8px" onclick="submitBet()">Place Bet</button>`;
}

async function submitBet() {
  const roundEl     = document.getElementById("bet-round");
  const round       = parseInt(roundEl.value);
  const bet_type    = document.getElementById("bet-type").value;
  const prediction  = document.getElementById("bet-prediction").value;
  const custom_wager = document.getElementById("bet-wager").value.trim();
  const errEl       = document.getElementById("bet-error");
  errEl.classList.add("hidden");
  if (!round || round < 1) {
    errEl.textContent = "Select a race."; errEl.classList.remove("hidden"); return;
  }
  if (!prediction) {
    errEl.textContent = "Select a driver prediction."; errEl.classList.remove("hidden"); return;
  }
  try {
    const res  = await fetch(`/api/leagues/${_currentLeagueId}/bets`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ race_round: round, bet_type, prediction, custom_wager }),
    });
    const data = await res.json();
    if (data.detail) { errEl.textContent = data.detail; errEl.classList.remove("hidden"); return; }
    closeBetModal(null, true);
    loadLeagueView(_currentLeagueId);
  } catch (e) {
    errEl.textContent = "Network error — try again."; errEl.classList.remove("hidden");
  }
}

function closeBetModal(e, force = false) {
  if (!force && e && e.target !== document.getElementById("bet-overlay")) return;
  document.getElementById("bet-overlay").classList.add("hidden");
}
