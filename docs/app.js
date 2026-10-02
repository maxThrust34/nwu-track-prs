// NWU Track PRs — renders docs/data/*.json (written by scraper/update.py)
const state = { tab: "events", gender: "m", stype: "outdoor", scope: "all", q: "", list: {}, latestAll: false };
let ATHLETES = [], LISTS = { national: { lists: {} }, conference: { lists: {} } };

const today = new Date();
// academic season, Aug–Jul (matches scraper/update.py; overwritten by the data file)
let SEASON = (() => {
  const y = today.getFullYear(), start = today.getMonth() >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
})();
const NWU = "Nebraska Wesleyan";
const schoolTag = (r) => r.team && r.team !== NWU ? `<span class="school">${esc(r.team)}</span>` : "";

// ---------------------------------------------------------------- events
const ORDER = [
  /^55 /, /^60 Meters/, /^100 Meters/, /^200 /, /^300 /, /^400 Meters/, /^500 /, /^600 /, /^800 /,
  /^1000 /, /^1500 /, /^Mile/, /^3000 Meters/, /^3000 Steeple/, /^5000 /, /^10,?000 /,
  /^55 Hurdles/, /^60 Hurdles/, /^100 Hurdles/, /^110 Hurdles/, /^400 Hurdles/,
  /^4 x 100/, /^4 x 200/, /^4 x 400/, /^4 x 800/, /Sprint Medley/, /Distance Medley/,
  /^High Jump/, /^Pole Vault/, /^Long Jump/, /^Triple Jump/, /^Shot Put/, /^Weight Throw/,
  /^Discus/, /^Hammer/, /^Javelin/, /^Pentathlon/, /^Heptathlon/, /^Decathlon/,
  /^4 Mile/, /^4K/, /^5K/, /^6K/, /^8K/, /^10K/,
];
function eventRank(e) {
  const i = ORDER.findIndex((r) => r.test(e));
  return i < 0 ? 999 : i;
}
function shortEvent(e) {
  return e
    .replace(/^(\d[\d,]*) Meters$/, "$1m")
    .replace(/^(\d+) Meter Hurdles$/, "$1mH").replace(/^(\d+) Hurdles$/, "$1mH")
    .replace(/^3000 Steeplechase$/, "3000m Steeple")
    .replace(/^4 x (\d+) Relay$/, "4x$1");
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const better = (kind, a, b) => (kind === "time" ? a < b : a > b);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (iso) => iso ? new Date(iso + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

// best legal mark per (type, event); falls back to wind-aided if that's all there is
function bests(results, filter = () => true) {
  const out = {};
  for (const r of results) {
    if (r.relay || r.value == null || !filter(r)) continue;
    const key = r.type + "|" + r.event;
    const cur = out[key];
    if (!cur
      || (cur.aided && !r.aided)
      || (cur.aided === r.aided && better(r.kind, r.value, cur.value))) out[key] = r;
  }
  return out;
}

// flag each result that was a PR when it happened
function markPRs(a) {
  const run = {};
  const sorted = [...a.results].sort((x, y) => (x.date || "").localeCompare(y.date || ""));
  for (const r of sorted) {
    r.isPR = false;
    if (r.relay || r.value == null || r.aided) continue;
    const key = r.type + "|" + r.event;
    if (run[key] == null || better(r.kind, r.value, run[key])) { r.isPR = run[key] != null; run[key] = r.value; }
  }
}

// ---------------------------------------------------------------- search
function matches(a) {
  if (!state.q) return true;
  const q = state.q.toLowerCase().trim();
  return a.name.toLowerCase().includes(q) || (a.group || "").toLowerCase().includes(q);
}
function isMe(a) {
  const q = state.q.toLowerCase().trim();
  return q.length >= 2 && a.name.toLowerCase().includes(q);
}

// ---------------------------------------------------------------- views
function renderEvents() {
  const boards = {};
  for (const a of ATHLETES) {
    if (a.gender !== state.gender) continue;
    const pr = bests(a.results, (r) => r.type === state.stype && (state.scope === "all" || r.acad === state.scope));
    for (const r of Object.values(pr)) (boards[r.event] ||= []).push({ a, r });
  }
  const events = Object.keys(boards).sort((x, y) => eventRank(x) - eventRank(y) || x.localeCompare(y));
  const el = document.getElementById("events");
  const jump = document.getElementById("event-jump");
  if (!events.length) {
    jump.innerHTML = "";
    el.innerHTML = `<div class="empty">No ${state.stype === "xc" ? "cross country" : state.stype} marks ${state.scope === "all" ? "found" : state.scope === SEASON ? "yet this season (" + SEASON + ")" : "in " + state.scope}.</div>`;
    return;
  }
  jump.innerHTML = events.map((e) => `<a href="#ev-${slug(e)}">${esc(shortEvent(e))}</a>`).join("");
  el.innerHTML = events.map((e) => {
    const rows = boards[e].sort((x, y) => (x.r.aided - y.r.aided) || (better(x.r.kind, x.r.value, y.r.value) ? -1 : 1));
    const shown = rows.filter((x) => matches(x.a));
    if (state.q && !shown.length) return "";
    return `<article class="card" id="ev-${slug(e)}">
      <h2>${esc(shortEvent(e))} <small>${rows.length} athlete${rows.length > 1 ? "s" : ""}</small></h2>
      <table><tbody>${rows.map((x, i) => {
        if (state.q && !matches(x.a)) return "";
        const fresh = x.r.acad === SEASON;
        return `<tr class="click ${isMe(x.a) ? "me" : ""}" data-id="${x.a._i}">
          <td class="rank">${i + 1}</td>
          <td><span class="name">${esc(x.a.name)}</span><span class="yr">${esc(x.a.year)}</span>
            ${fresh && state.scope === "all" ? '<span class="badge">' + SEASON.slice(2) + " PR</span>" : ""}</td>
          <td class="mark">${esc(x.r.mark)}${x.r.aided ? ' <span class="badge w">w</span>' : ""}</td>
          <td class="meet">${esc(x.r.meet)}${schoolTag(x.r)}<br>${fmtDate(x.r.date)}</td></tr>`;
      }).join("")}</tbody></table></article>`;
  }).join("") || `<div class="empty">No marks match “${esc(state.q)}”.</div>`;
}

// Most recent meet this season: every NWU mark, with new PRs called out
function renderLatest() {
  const el = document.getElementById("latest");
  const recent = [];
  for (const a of ATHLETES) {
    if (a.gender !== state.gender) continue;
    for (const r of a.results) if (r.acad === SEASON && r.team === NWU && r.date) recent.push({ a, r });
  }
  const latest = recent.map((x) => x.r.date + "|" + x.r.meet).sort().pop();
  if (!latest) { el.innerHTML = ""; return; }
  const [date, meet] = latest.split("|");
  const rows = recent.filter((x) => x.r.date === date && x.r.meet === meet && matches(x.a))
    .sort((x, y) => eventRank(x.r.event) - eventRank(y.r.event) || x.r.event.localeCompare(y.r.event)
      || (x.r.value == null) - (y.r.value == null) || (better(x.r.kind, x.r.value, y.r.value) ? -1 : 1));
  if (!rows.length) { el.innerHTML = ""; return; }
  const prs = rows.filter((x) => x.r.isPR).length;
  const shown = state.latestAll ? rows : rows.slice(0, 8);
  el.innerHTML = `<div class="latest"><article class="card">
    <h2><span class="meet-head"><span class="kicker">Latest meet</span>${esc(meet)}</span>
      <small>${fmtDate(date)} · ${rows.length} marks${prs ? ` · ${prs} PR${prs > 1 ? "s" : ""}` : ""}</small></h2>
    <table><tbody>${shown.map((x) => `<tr class="click ${isMe(x.a) ? "me" : ""}" data-id="${x.a._i}">
      <td>${esc(shortEvent(x.r.event))}</td>
      <td><span class="name">${esc(x.a.name)}</span><span class="yr">${esc(x.a.year)}</span></td>
      <td class="mark">${esc(x.r.mark)}${x.r.isPR ? '<span class="badge">PR</span>' : ""}</td></tr>`).join("")}</tbody></table>
    ${rows.length > 8 ? `<button class="more" id="latest-more">${state.latestAll ? "Show less" : `Show all ${rows.length}`}</button>` : ""}
  </article></div>`;
  const more = document.getElementById("latest-more");
  if (more) more.onclick = () => { state.latestAll = !state.latestAll; renderLatest(); };
}

function renderAthletes() {
  const list = ATHLETES.filter((a) => a.gender === state.gender && matches(a))
    .sort((x, y) => x.name.split(" ").pop().localeCompare(y.name.split(" ").pop()));
  document.getElementById("athletes").innerHTML = list.map((a) => {
    const pr = Object.values(bests(a.results)).sort((x, y) => eventRank(x.event) - eventRank(y.event)).slice(0, 3);
    return `<button class="ath" data-id="${a._i}">
      <div class="name">${esc(a.name)}</div>
      <div class="meta">${esc([a.year, a.group, a.hometown].filter(Boolean).join(" · "))}</div>
      ${pr.length
        ? `<div class="prs">${pr.map((r) => `<b>${esc(shortEvent(r.event))}</b> ${esc(r.mark)}`).join(" · ")}</div>`
        : `<div class="pending">No college marks yet — first race pending</div>`}
    </button>`;
  }).join("") || `<div class="empty">No athletes match “${esc(state.q)}”.</div>`;
}

const SECTIONS = {
  national: { label: "NCAA Division III", file: "data/national.json" },
  conference: { label: "American Rivers Conference", file: "data/conference.json" },
};

function renderList(section) {
  const data = LISTS[section], keys = Object.keys(data.lists || {});
  const seg = document.getElementById("natlist");
  const box = document.getElementById(section);
  if (!keys.length) {
    seg.innerHTML = "";
    box.innerHTML = '<div class="empty">Lists not loaded yet.</div>';
    return;
  }
  // newest list first; default to whichever was published most recently
  keys.sort((a, b) => data.lists[b].id - data.lists[a].id);
  state.list[section] ||= keys[0];
  const key = state.list[section], top = data.top || 25;
  seg.innerHTML = keys.map((k) => {
    const L = data.lists[k], kind = L.kind === "indoor" ? "Indoor" : "Outdoor";
    return `<option value="${k}" ${k === key ? "selected" : ""}>${L.season} ${kind}${L.season === SEASON ? " (current)" : ""}</option>`;
  }).join("");
  const L = data.lists[key];
  document.getElementById(section + "-note").innerHTML =
    `<b>${esc(L.season)} ${L.kind === "indoor" ? "Indoor" : "Outdoor"}</b> · <a href="${esc(L.url)}" target="_blank" rel="noopener">${esc(L.title)}</a>${L.updated ? " · updated " + esc(L.updated) : ""}. ` +
    `Top ${top} in the ${SECTIONS[section].label}. Nebraska Wesleyan marks are highlighted — click one to open the profile.`;
  const evs = L.events.filter((e) => e.gender === state.gender);
  document.getElementById(section + "-jump").innerHTML = evs.map((e) =>
    `<a href="#${section}-${slug(e.event)}">${esc(shortEvent(e.event))}${e.nwu.length ? " ★" : ""}</a>`).join("");
  const q = state.q.toLowerCase().trim();
  const byTfrrs = Object.fromEntries(ATHLETES.filter((a) => a.tfrrs_id).map((a) => [a.tfrrs_id, a]));
  box.innerHTML = evs.map((e) => {
    const rowHit = (r) => !q || r.athlete.toLowerCase().includes(q) || r.team.toLowerCase().includes(q)
      || (byTfrrs[r.athlete_id]?.name.toLowerCase().includes(q) ?? false);
    if (q && !e.top.some(rowHit) && !e.nwu.some(rowHit)) return "";
    const outside = e.nwu.filter((r) => !e.top.some((t) => t.place === r.place && t.athlete === r.athlete));
    const row = (r) => {
      const me = byTfrrs[r.athlete_id];
      return `<tr class="${r.nwu ? "nwu" : ""} ${me ? "click" : ""}" ${me ? `data-id="${me._i}"` : ""}>
      <td class="rank">${esc(r.place)}</td>
      <td><span class="name">${esc(r.athlete)}</span><span class="yr">${esc(r.year)}</span><br><small>${esc(r.team)}</small></td>
      <td class="mark">${esc(r.mark)}${r.wind ? ` <small>(${esc(r.wind)})</small>` : ""}</td>
      <td class="meet">${esc(r.meet)}<br>${esc(r.date)}</td></tr>`;
    };
    return `<article class="card" id="${section}-${slug(e.event)}">
      <h2>${esc(shortEvent(e.event))} <small>${e.nwu.length ? e.nwu.length + " NWU on list" : ""}</small></h2>
      <table><thead><tr><th>#</th><th>Athlete</th><th>Mark</th><th class="meet">Meet</th></tr></thead>
      <tbody>${e.top.filter(rowHit).map(row).join("")}
      ${outside.filter(rowHit).length ? `<tr><th colspan="4">NWU outside the top ${top}</th></tr>${outside.filter(rowHit).map(row).join("")}` : ""}
      </tbody></table></article>`;
  }).join("") || `<div class="empty">Nothing on this list matches “${esc(state.q)}”.</div>`;
}

function openProfile(a) {
  const pr = bests(a.results);
  const sb = bests(a.results, (r) => r.acad === SEASON);
  const types = [["outdoor", "Outdoor"], ["indoor", "Indoor"], ["xc", "Cross Country"]];
  const tiles = types.map(([t, label]) => {
    const evs = Object.values(pr).filter((r) => r.type === t).sort((x, y) => eventRank(x.event) - eventRank(y.event));
    if (!evs.length) return "";
    return `<h3>${label} PRs</h3><div class="pr-grid">${evs.map((r) => {
      const s = sb[t + "|" + r.event];
      return `<div class="pr-tile"><div class="ev">${esc(shortEvent(r.event))}</div>
        <div class="mk">${esc(r.mark)}${r.aided ? ' <span class="badge w">w</span>' : ""}</div>
        <div class="sb">${esc(r.meet)} · ${fmtDate(r.date)}${schoolTag(r)}</div>
        ${s ? `<div class="sb">${SEASON} best: <b>${esc(s.mark)}</b></div>` : ""}</div>`;
    }).join("")}</div>`;
  }).join("");
  const res = [...a.results].sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  document.getElementById("profile-body").innerHTML = `
    <div class="p-head"><div>
      <h2>${esc(a.name)}</h2>
      <p>${esc([a.year, a.group, a.hometown, a.highschool].filter(Boolean).join(" · "))}</p>
      <p>${a.tfrrs_url ? `<a href="${esc(a.tfrrs_url)}" target="_blank" rel="noopener">TFRRS profile</a> · ` : ""}
         ${a.bio ? `<a href="${esc(a.bio)}" target="_blank" rel="noopener">NWU bio</a>` : ""}</p>
    </div><button class="close" aria-label="Close">×</button></div>
    <div class="p-body">
      ${tiles || `<p class="empty">No college marks yet. PRs show up here after the first race of the season.</p>`}
      ${res.length ? `<h3>All results</h3><table><thead><tr><th>Date</th><th>Event</th><th>Mark</th><th class="meet">Meet</th></tr></thead><tbody>
        ${res.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(shortEvent(r.event))} <small class="yr">${esc(r.season)}</small></td>
          <td class="mark">${r.result_url ? `<a href="${esc(r.result_url)}" target="_blank" rel="noopener">${esc(r.mark)}</a>` : esc(r.mark)}
            ${r.wind != null ? `<small>(${r.wind})</small>` : ""}${r.isPR ? '<span class="badge">PR</span>' : ""}</td>
          <td class="meet">${esc(r.meet)}${schoolTag(r)}</td></tr>`).join("")}</tbody></table>` : ""}
    </div>`;
  const d = document.getElementById("profile");
  d.showModal();
  d.querySelector(".close").onclick = () => d.close();
}

// ---------------------------------------------------------------- wiring
function render() {
  for (const v of ["events", "athletes", "conference", "national"]) document.getElementById("view-" + v).hidden = state.tab !== v;
  document.getElementById("stype").hidden = state.tab !== "events";
  document.getElementById("scope").hidden = state.tab !== "events";
  document.getElementById("natlist").hidden = !(state.tab in SECTIONS);
  if (state.tab === "events") { renderLatest(); renderEvents(); }
  if (state.tab === "athletes") renderAthletes();
  if (state.tab in SECTIONS) renderList(state.tab);
}

function segment(id, key) {
  document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (key) state[key] = b.dataset.v; else state.list[state.tab] = b.dataset.v;
    e.currentTarget.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
}

function setupSearch() {
  const input = document.getElementById("search"), box = document.getElementById("suggest");
  let hi = -1, hits = [];
  const draw = () => {
    box.hidden = !hits.length;
    box.innerHTML = hits.map((a, i) => `<li class="${i === hi ? "hi" : ""}" data-id="${a._i}">
      <span>${esc(a.name)}</span><small>${esc([a.year, a.group, a.gender === "m" ? "Men" : "Women"].filter(Boolean).join(" · "))}</small></li>`).join("");
  };
  input.addEventListener("input", () => {
    state.q = input.value;
    const q = state.q.toLowerCase().trim();
    hits = q.length >= 2 ? ATHLETES.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8) : [];
    hi = -1; draw();
    // searching someone on the other team flips the gender filter
    const genders = new Set(hits.map((a) => a.gender));
    if (genders.size === 1 && !genders.has(state.gender)) {
      state.gender = [...genders][0];
      document.querySelectorAll("#gender button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.gender));
    }
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { hi = Math.min(hi + 1, hits.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hi = Math.max(hi - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && hits.length) { openProfile(hits[Math.max(hi, 0)]); box.hidden = true; }
    else if (e.key === "Escape") { box.hidden = true; }
  });
  box.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li"); if (!li) return;
    e.preventDefault(); box.hidden = true; openProfile(ATHLETES[li.dataset.id]);
  });
  input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 100));
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-id]");
  if (t && !t.closest("#suggest")) openProfile(ATHLETES[t.dataset.id]);
  const d = document.getElementById("profile");
  if (e.target === d) d.close();
});
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
  render();
}));
segment("gender", "gender"); segment("stype", "stype");
document.getElementById("scope").addEventListener("change", (e) => { state.scope = e.target.value; render(); });
document.getElementById("natlist").addEventListener("change", (e) => { state.list[state.tab] = e.target.value; render(); });
setupSearch();

// default to whichever season is in progress
const m = today.getMonth();
state.stype = m >= 7 && m <= 10 ? "xc" : m === 11 || m <= 2 ? "indoor" : "outdoor";
document.querySelectorAll("#stype button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.stype));

Promise.all([
  fetch("data/athletes.json").then((r) => r.json()),
  ...Object.values(SECTIONS).map((s) => fetch(s.file).then((r) => r.json()).catch(() => ({ lists: {} }))),
]).then(([ath, nat, conf]) => {
  ATHLETES = ath.athletes.map((a, i) => ({ ...a, _i: i }));
  ATHLETES.forEach(markPRs);
  if (ath.season) SEASON = ath.season;
  const seasons = [...new Set(ATHLETES.flatMap((a) => a.results.map((r) => r.acad)))].filter(Boolean).sort().reverse();
  if (!seasons.includes(SEASON)) seasons.unshift(SEASON);
  document.getElementById("scope").innerHTML = `<option value="all">Lifetime PRs</option>` +
    seasons.map((s) => `<option value="${s}">${s} season${s === SEASON ? " (current)" : ""}</option>`).join("");
  LISTS = { national: nat, conference: conf };
  document.getElementById("updated").textContent =
    `${ATHLETES.length} athletes · ${SEASON} season · updated ${new Date(ath.updated).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
  render();
}).catch((err) => {
  document.getElementById("updated").textContent = "Couldn't load data — run scraper/update.py";
  console.error(err);
});
