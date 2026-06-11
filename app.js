/* NEXT BUS — London live arrivals
   Data: TfL Unified API (https://api.tfl.gov.uk), no key required. */

const API = "https://api.tfl.gov.uk";
const MODES = "bus,tube,dlr,overground,elizabeth-line,tram";
const STOP_TYPES =
  "NaptanPublicBusCoachTram,NaptanMetroStation,NaptanRailStation,NaptanBusCoachStation";
const REFRESH_MS = 30_000;
const FAVS_KEY = "nextbus.favs.v1";

const LINE_COLOURS = {
  bakerloo: "#b36305",
  central: "#e32017",
  circle: "#ffd300",
  district: "#00782a",
  "hammersmith-city": "#f3a9bb",
  jubilee: "#a0a5a9",
  metropolitan: "#9b0056",
  northern: "#444449",
  piccadilly: "#003688",
  victoria: "#0098d4",
  "waterloo-city": "#95cdba",
  dlr: "#00a4a7",
  "elizabeth-line": "#6950a1",
  elizabeth: "#6950a1",
  tram: "#84b817",
  "london-overground": "#ee7c0e",
  liberty: "#5d6061",
  lioness: "#faa61a",
  mildmay: "#0077ad",
  suffragette: "#5bbd72",
  weaver: "#823a62",
  windrush: "#ed1b00",
};
// lines whose badge colour is too light for white text
const DARK_TEXT_LINES = new Set(["circle", "hammersmith-city", "waterloo-city", "lioness", "tram"]);

const $ = (id) => document.getElementById(id);

const state = {
  view: "nearby",
  favs: loadFavs(),
  board: null, // { id, name, modes, leafIds }
  boardTimer: null,
  lastUpdated: null,
  nearbyLoaded: false,
};

/* ---------------- utilities ---------------- */

function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem(FAVS_KEY)) || [];
  } catch {
    return [];
  }
}
function saveFavs() {
  localStorage.setItem(FAVS_KEY, JSON.stringify(state.favs));
}
function isFav(id) {
  return state.favs.some((f) => f.id === id);
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TfL API ${res.status}`);
  return res.json();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function modeFlag(modes) {
  const hasBus = modes.includes("bus");
  const hasRail = modes.some((m) => m !== "bus");
  if (hasBus && hasRail) return ["mixed", "⇄"];
  if (hasRail) return ["rail", "⊖"];
  return ["", "BUS"];
}

function lineColour(arr) {
  const id = (arr.lineId || arr.lineName || "").toLowerCase();
  if (LINE_COLOURS[id]) return [LINE_COLOURS[id], DARK_TEXT_LINES.has(id) ? "#111" : "#fff"];
  if (arr.modeName === "bus") return ["#dc241f", "#fff"];
  return ["#2a2a32", "#fff"];
}

function cleanDest(name) {
  return (name || "").replace(/ (Underground|Rail|DLR) Station$/i, "");
}

/* ---------------- clock ---------------- */

function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
tickClock();
setInterval(tickClock, 5_000);

/* ---------------- line status strip ---------------- */

async function loadLineStatus() {
  if (document.hidden) return;
  const strip = $("status-strip");
  try {
    const lines = await getJSON(`${API}/Line/Mode/tube,dlr,overground,elizabeth-line,tram/Status`);
    strip.innerHTML = lines
      .map((l) => {
        const statuses = l.lineStatuses || [];
        const ok = statuses.every((s) => s.statusSeverity === 10);
        const desc = [...new Set(statuses.map((s) => s.statusSeverityDescription))].join(" + ");
        const reason = statuses.map((s) => s.reason).filter(Boolean).join(" ");
        const colour = LINE_COLOURS[l.id] || "#555";
        return `<button class="status-chip ${ok ? "" : "disrupted"}" data-reason="${esc(reason)}"
            aria-label="${esc(l.name)}: ${esc(ok ? "good service" : desc)}">
            <span class="swatch" style="background:${colour}"></span>
            ${esc(l.name)}<span class="state">${esc(ok ? "good" : desc || "?")}</span>
          </button>`;
      })
      .join("");
    strip.querySelectorAll(".status-chip.disrupted").forEach((chip) =>
      chip.addEventListener("click", () => toggleStatusReason(chip))
    );
  } catch {
    strip.innerHTML = `<div class="status-loading">line status unavailable</div>`;
  }
}

// tapping a disrupted chip shows the reason (title tooltips don't exist on touch)
function toggleStatusReason(chip) {
  const existing = document.querySelector(".status-reason");
  const wasOpen = existing?.dataset.for === chip.dataset.reason;
  existing?.remove();
  if (wasOpen || !chip.dataset.reason) return;
  const note = document.createElement("div");
  note.className = "status-reason";
  note.dataset.for = chip.dataset.reason;
  note.textContent = chip.dataset.reason;
  $("status-strip").insertAdjacentElement("afterend", note);
}

/* ---------------- navigation ---------------- */

function showView(name) {
  state.view = name;
  for (const v of ["nearby", "search", "favs"]) {
    $(`view-${v}`).hidden = v !== name;
    $(`tab-${v}`).classList.toggle("active", v === name);
    if (v === name) $(`tab-${v}`).setAttribute("aria-current", "page");
    else $(`tab-${v}`).removeAttribute("aria-current");
  }
  closeBoard();
  if (name === "favs") renderFavs();
  if (name === "nearby" && !state.nearbyLoaded) loadNearby();
  if (name === "search") $("search-input").focus({ preventScroll: true });
}

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => showView(t.dataset.view))
);

/* ---------------- stop cards ---------------- */

function stopCard(stop, extra = "") {
  const modes = stop.modes || [];
  const [flagClass, flagText] = modeFlag(modes);
  const lines = (stop.lines || []).map((l) => l.name);
  const meta =
    extra ||
    (lines.length
      ? lines.slice(0, 7).join(" · ") + (lines.length > 7 ? " …" : "")
      : modes.join(" · ")) ||
    "stop";
  return `<button class="stop-card" data-id="${esc(stop.id)}" data-name="${esc(stop.name)}" data-modes="${esc(modes.join(","))}">
      <span class="stop-flag ${flagClass}">${flagText}</span>
      <span class="stop-info">
        <span class="stop-name">${esc(stop.name)}${stop.indicator ? ` <small style="color:var(--muted)">${esc(stop.indicator)}</small>` : ""}</span>
        <span class="stop-meta">${esc(meta)}</span>
      </span>
      ${stop.distance != null ? `<span class="stop-dist">${Math.round(stop.distance)} m</span>` : ""}
    </button>`;
}

function bindStopCards(container) {
  container.querySelectorAll(".stop-card").forEach((card) =>
    card.addEventListener("click", () =>
      openBoard({
        id: card.dataset.id,
        name: card.dataset.name,
        modes: card.dataset.modes.split(",").filter(Boolean),
      })
    )
  );
}

/* ---------------- nearby ---------------- */

async function loadNearby() {
  const list = $("nearby-list");
  list.innerHTML = `<div class="hint"><p class="hint-led led">LOCATING…</p><p>Finding stops around you.</p></div>`;
  if (!navigator.geolocation) {
    list.innerHTML = `<div class="error-note">Location isn’t available in this browser — use Search instead.</div>`;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const data = await getJSON(
          `${API}/StopPoint/?lat=${latitude}&lon=${longitude}&radius=700&modes=${MODES}&stopTypes=${STOP_TYPES}&returnLines=true`
        );
        const stops = (data.stopPoints || [])
          .filter((s) => s.commonName)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 20)
          .map((s) => ({
            id: s.id,
            name: s.commonName,
            indicator: s.indicator,
            modes: s.modes,
            lines: s.lines,
            distance: s.distance,
          }));
        state.nearbyLoaded = true;
        if (!stops.length) {
          list.innerHTML = `<div class="hint"><p class="hint-led led">NO STOPS FOUND</p><p>No stops within 700 m — are you in London?</p></div>`;
          return;
        }
        list.innerHTML = stops.map((s) => stopCard(s)).join("");
        bindStopCards(list);
      } catch (e) {
        list.innerHTML = `<div class="error-note">Couldn’t reach TfL (${esc(e.message)}). Tap refresh to retry.</div>`;
      }
    },
    (err) => {
      const msgs = {
        1: `Location is blocked for this site. Click the icon to the left of the address bar → Site settings → set Location to Allow, then try again. On a phone: allow location for your browser in system settings.`,
        2: `Your device couldn’t work out where it is. Check that location services are switched on for your browser in your device settings, or just use Search.`,
        3: `Finding your location took too long.`,
      };
      list.innerHTML = `<div class="error-note">${msgs[err.code] || "Location unavailable."}
          <div class="error-actions">
            <button class="ghost-btn" id="nearby-retry">↻ try again</button>
            <button class="ghost-btn" id="nearby-to-search">⌕ use search</button>
          </div>
        </div>`;
      $("nearby-retry").addEventListener("click", loadNearby);
      $("nearby-to-search").addEventListener("click", () => showView("search"));
    },
    { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 }
  );
}

$("nearby-refresh").addEventListener("click", () => {
  state.nearbyLoaded = false;
  loadNearby();
});

/* ---------------- search ---------------- */

let searchTimer = null;
let searchSeq = 0; // discard out-of-order responses
$("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) {
    searchSeq++;
    $("search-list").innerHTML = `<div class="hint"><p class="hint-led led">TYPE TO SEARCH</p><p>At least 3 characters.</p></div>`;
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 350);
});

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

async function runSearch(q) {
  const seq = ++searchSeq;
  const list = $("search-list");
  list.innerHTML = `<div class="hint"><p class="hint-led led">SEARCHING…</p></div>`;
  try {
    const matches = POSTCODE_RE.test(q) ? await searchByPostcode(q) : await searchByName(q);
    if (seq !== searchSeq) return; // a newer search superseded this one
    if (!matches.length) {
      list.innerHTML = `<div class="hint"><p class="hint-led led">NO MATCHES</p><p>Try a different spelling, or a full postcode like SW9 8HE.</p></div>`;
      return;
    }
    list.innerHTML = matches
      .map((s) =>
        stopCard(
          s,
          s.distance != null
            ? ""
            : [s.towards ? `towards ${s.towards}` : s.modes.join(" · "), s.zone ? `zone ${s.zone}` : null]
                .filter(Boolean)
                .join(" · ")
        )
      )
      .join("");
    bindStopCards(list);
  } catch (e) {
    if (seq !== searchSeq) return;
    list.innerHTML = `<div class="error-note">Search failed (${esc(e.message)}).</div>`;
  }
}

async function searchByName(q) {
  const data = await getJSON(
    `${API}/StopPoint/Search/${encodeURIComponent(q)}?modes=${MODES}&maxResults=18`
  );
  return (data.matches || []).map((m) => ({
    id: m.id,
    name: m.name,
    modes: m.modes || [],
    towards: m.towards,
    zone: m.zone,
  }));
}

// full UK postcode → coordinates (postcodes.io, free) → stops around it
async function searchByPostcode(q) {
  const pc = await getJSON(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`);
  const { latitude, longitude } = pc.result;
  const data = await getJSON(
    `${API}/StopPoint/?lat=${latitude}&lon=${longitude}&radius=700&modes=${MODES}&stopTypes=${STOP_TYPES}&returnLines=true`
  );
  return (data.stopPoints || [])
    .filter((s) => s.commonName)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 18)
    .map((s) => ({
      id: s.id,
      name: s.commonName,
      indicator: s.indicator,
      modes: s.modes,
      lines: s.lines,
      distance: s.distance,
    }));
}

/* ---------------- favourites ---------------- */

function renderFavs() {
  const list = $("favs-list");
  if (!state.favs.length) {
    list.innerHTML = `<div class="hint"><p class="hint-led led">NO SAVED STOPS</p><p>Open a stop and tap the star to pin it here.</p></div>`;
    return;
  }
  list.innerHTML = state.favs
    .map(
      (s) => `<div class="fav-row">${stopCard(s, s.modes.join(" · "))}
        <button class="fav-remove" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)} from saved stops">✕</button>
      </div>`
    )
    .join("");
  bindStopCards(list);
  list.querySelectorAll(".fav-remove").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.favs = state.favs.filter((f) => f.id !== btn.dataset.id);
      saveFavs();
      renderFavs();
    })
  );
}

function toggleFav() {
  if (!state.board) return;
  const { id, name, modes } = state.board;
  if (isFav(id)) {
    state.favs = state.favs.filter((f) => f.id !== id);
  } else {
    state.favs.push({ id, name, modes });
  }
  saveFavs();
  updateFavButton();
}

function updateFavButton() {
  const btn = $("board-fav");
  const on = state.board && isFav(state.board.id);
  btn.textContent = on ? "★" : "☆";
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-label", on ? "Remove saved stop" : "Save stop");
}

$("board-fav").addEventListener("click", toggleFav);

/* ---------------- arrivals board ---------------- */

function openBoard(stop) {
  state.board = { ...stop, leafIds: null, firstRender: true };
  state.boardOpener = document.activeElement;
  $("board-name").textContent = stop.name;
  $("board-sub").textContent = "live arrivals";
  $("board-rows").innerHTML = `<div class="board-empty"><span class="led">CONNECTING…</span></div>`;
  $("board-updated").textContent = "connecting…";
  $("board").hidden = false;
  // keep keyboard/screen-reader focus inside the overlay
  $("main").inert = true;
  document.querySelector(".tabbar").inert = true;
  $("board-back").focus();
  updateFavButton();
  refreshBoard();
  state.boardTimer = setInterval(refreshBoard, REFRESH_MS);
  history.pushState({ board: stop.id }, "", `#stop`);
}

function closeBoard() {
  if (state.boardTimer) clearInterval(state.boardTimer);
  state.boardTimer = null;
  state.board = null;
  $("board").hidden = true;
  $("main").inert = false;
  document.querySelector(".tabbar").inert = false;
  if (state.view === "favs") renderFavs(); // reflect any star changes
  if (state.boardOpener?.isConnected) state.boardOpener.focus({ preventScroll: true });
  state.boardOpener = null;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.board) {
    closeBoard();
    if (location.hash === "#stop") history.back();
  }
});

$("board-back").addEventListener("click", () => {
  closeBoard();
  if (location.hash === "#stop") history.back();
});
window.addEventListener("popstate", () => {
  if (state.board) closeBoard();
});

function arrivalsFor(ids) {
  // TfL's /Arrivals endpoint takes one stop id per request.
  return Promise.all(
    ids.map((id) =>
      getJSON(`${API}/StopPoint/${encodeURIComponent(id)}/Arrivals`).catch(() => [])
    )
  ).then((lists) => lists.flat());
}

async function fetchArrivals(stop) {
  // Hubs and parent stops return no arrivals directly, so expand to
  // child stop points (cached on the stop) and query those instead.
  if (stop.leafIds) return arrivalsFor(stop.leafIds);
  const arrivals = await getJSON(`${API}/StopPoint/${encodeURIComponent(stop.id)}/Arrivals`).catch(() => []);
  if (arrivals.length) {
    stop.leafIds = [stop.id];
    return arrivals;
  }
  const detail = await getJSON(`${API}/StopPoint/${encodeURIComponent(stop.id)}`);
  const leaves = [];
  (function walk(sp) {
    if (sp.lines?.length && sp.id !== stop.id) leaves.push(sp.id);
    (sp.children || []).forEach(walk);
  })(detail);
  stop.leafIds = leaves.length ? [...new Set(leaves)].slice(0, 12) : [stop.id];
  return arrivalsFor(stop.leafIds);
}

async function refreshBoard() {
  const stop = state.board;
  if (!stop) return;
  try {
    const arrivals = await fetchArrivals(stop);
    if (state.board !== stop) return; // board changed while fetching
    renderArrivals(arrivals);
    state.lastUpdated = Date.now();
    $("board-updated").textContent = `updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  } catch (e) {
    $("board-updated").textContent = `update failed — retrying`;
  }
}

function renderArrivals(arrivals) {
  const rows = $("board-rows");
  // animate rows on the first paint only, not on every 30s refresh
  rows.classList.toggle("no-anim", !state.board?.firstRender);
  if (state.board) state.board.firstRender = false;
  if (!arrivals.length) {
    rows.innerHTML = `<div class="board-empty"><span class="led">NO DEPARTURES</span>Nothing due in the next 30 minutes.<br/>Check line status above for disruptions.</div>`;
    return;
  }
  const sorted = [...arrivals]
    // hide trains terminating at this station — they're not departures
    .filter((a) => !(a.destinationNaptanId && a.destinationNaptanId === a.naptanId))
    .sort((a, b) => a.timeToStation - b.timeToStation)
    .slice(0, 25);
  if (!sorted.length) {
    rows.innerHTML = `<div class="board-empty"><span class="led">NO DEPARTURES</span>Nothing due in the next 30 minutes.</div>`;
    return;
  }
  rows.innerHTML = sorted
    .map((a, i) => {
      const [bg, fg] = lineColour(a);
      const mins = Math.floor(a.timeToStation / 60);
      const due = mins < 1;
      const dest = cleanDest(a.destinationName) || a.towards || "Check front of train";
      const platName = a.platformName && !/^null$/i.test(a.platformName) ? a.platformName : null;
      const plat = [platName ? (a.modeName === "bus" ? `Stop ${platName}` : platName) : null,
                    a.modeName !== "bus" ? a.lineName : null]
        .filter(Boolean)
        .join(" · ");
      return `<div class="arr-row" style="--i:${i}">
          <span class="arr-line" style="background:${bg};color:${fg}">${esc(a.modeName === "bus" ? a.lineName : abbrevLine(a.lineName))}</span>
          <span class="arr-dest">
            <span class="to">${esc(dest)}</span>
            ${plat ? `<span class="plat">${esc(plat)}</span>` : ""}
          </span>
          <span class="arr-time led ${due ? "due" : ""}">${due ? "due" : mins}<small>${due ? "now" : mins === 1 ? "min" : "mins"}</small></span>
        </div>`;
    })
    .join("");
}

function abbrevLine(name = "") {
  const short = {
    "Hammersmith & City": "H&C",
    "Waterloo & City": "W&C",
    "Elizabeth line": "Eliz",
    Elizabeth: "Eliz",
    Metropolitan: "Met",
    Piccadilly: "Picc",
    Bakerloo: "Bkr",
    Victoria: "Vic",
    Northern: "Nthn",
    Jubilee: "Jub",
    District: "Dist",
    Central: "Cent",
    Circle: "Circ",
  };
  return short[name] || name;
}

/* ---------------- lifecycle ---------------- */

// pause polling while the tab is hidden; catch up immediately on return
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.boardTimer) clearInterval(state.boardTimer);
    state.boardTimer = null;
  } else {
    loadLineStatus();
    if (state.board && !state.boardTimer) {
      refreshBoard();
      state.boardTimer = setInterval(refreshBoard, REFRESH_MS);
    }
  }
});

/* ---------------- boot ---------------- */

if (location.hash) history.replaceState(null, "", location.pathname); // clear stale #stop
loadLineStatus();
setInterval(loadLineStatus, 120_000);
showView("nearby");
