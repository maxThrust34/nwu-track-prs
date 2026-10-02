#!/usr/bin/env python3
"""Pull the current NWU track roster, every athlete's TFRRS history, and the
latest NCAA D-III national + American Rivers conference lists. Writes JSON into docs/data/.

Standard library only so it runs anywhere (laptop, GitHub Actions).

    python3 scraper/update.py            # full refresh
    python3 scraper/update.py --cache    # reuse downloaded pages (dev)
"""
import datetime as dt
import hashlib
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data")
CACHE = os.path.join(ROOT, ".cache")
OVERRIDES = os.path.join(ROOT, "scraper", "overrides.json")
USE_CACHE = "--cache" in sys.argv

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

NWU_ROSTERS = {
    "m": "https://nwusports.com/sports/mens-track-and-field/roster",
    "f": "https://nwusports.com/sports/womens-track-and-field/roster",
}
TFRRS_TEAMS = [
    ("m", "https://www.tfrrs.org/teams/tf/NE_college_m_Nebraska_Wesleyan.html"),
    ("f", "https://www.tfrrs.org/teams/tf/NE_college_f_Nebraska_Wesleyan.html"),
    ("m", "https://www.tfrrs.org/teams/xc/NE_college_m_Nebraska_Wesleyan.html"),
    ("f", "https://www.tfrrs.org/teams/xc/NE_college_f_Nebraska_Wesleyan.html"),
]
NATIONAL_TOP = 25
CONFERENCE_TOP = 10
# TFRRS list slugs we track, by section
LIST_PATTERNS = {
    "national": r"NCAA_Division_III_(Indoor|Outdoor)",
    "conference": r"^American_Rivers_(Indoor|Outdoor)",
}


# ---------------------------------------------------------------- fetching
_last_fetch = [0.0]


def fetch(url, polite=True, optional=False):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + ".html")
    if USE_CACHE and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    for attempt in range(4):
        if polite:
            wait = 1.0 - (time.time() - _last_fetch[0])
            if wait > 0:
                time.sleep(wait)
        _last_fetch[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
            return body
        except Exception as e:  # noqa: BLE001
            if optional and getattr(e, "code", None):
                return ""
            print(f"  ! {url} ({e}), retry {attempt + 1}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}")


def squash(s):
    return re.sub(r"\s+", " ", s)


def text(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).strip().replace("  ", " ").strip()


def norm_name(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z ]", "", s).split()


# ---------------------------------------------------------------- NWU roster
def scrape_nwu_roster():
    athletes = []
    for gender, url in NWU_ROSTERS.items():
        page = squash(fetch(url))
        season = re.search(r"<title>\s*(\d{4})", page)
        for chunk in page.split('<li class="sidearm-roster-player"')[1:]:
            def grab(pat):
                m = re.search(pat, chunk, re.S)
                return text(m.group(1)) if m else ""

            name = grab(r'aria-label="([^"]+?) - View Full Bio"')
            if not name:
                continue
            bio = re.search(r'data-player-url="([^"]+)"', chunk)
            img = re.search(r'<img[^>]+(?:data-src|src)="([^"]+?\.(?:jpg|jpeg|png)[^"]*)"', chunk)
            athletes.append({
                "name": name,
                "gender": gender,
                "year": grab(r'sidearm-roster-player-academic-year[^"]*">(.*?)<'),
                "group": grab(r'sidearm-roster-player-position">.*?<span class="text-bold">(.*?)</span>'),
                "hometown": grab(r'sidearm-roster-player-hometown">(.*?)<'),
                "highschool": grab(r'sidearm-roster-player-highschool">(.*?)<'),
                "bio": "https://nwusports.com" + bio.group(1) if bio else "",
                "photo": (img.group(1) if img and img.group(1).startswith("http")
                          else ("https://nwusports.com" + img.group(1) if img else "")),
            })
        print(f"NWU {gender}: {sum(a['gender'] == gender for a in athletes)} athletes"
              f" (roster season {season.group(1) if season else '?'})")
    return athletes


# ---------------------------------------------------------------- TFRRS rosters
def scrape_tfrrs_rosters():
    found = {}  # tfrrs id -> {name, gender}
    for gender, url in TFRRS_TEAMS:
        page = squash(fetch(url))
        roster = page[page.find(">ROSTER<"):]
        for aid, slug, label in re.findall(
                r'href="/athletes/(\d+)/([^"]+?)(?:\.html)?">([^<]+)</a>', roster):
            last, _, first = html.unescape(label).partition(",")
            found.setdefault(aid, {"id": aid, "name": f"{first.strip()} {last.strip()}",
                                   "gender": gender, "slug": slug})
    print(f"TFRRS rosters: {len(found)} unique athletes")
    return found


def match_athletes(nwu, tfrrs, overrides):
    by_gender = {}
    for t in tfrrs.values():
        by_gender.setdefault(t["gender"], []).append(t)
    for a in nwu:
        if a["name"] in overrides:
            a["tfrrs_id"] = overrides[a["name"]]
            continue
        a["tfrrs_id"] = None
        n = norm_name(a["name"])
        if not n:
            continue
        pool = by_gender.get(a["gender"], [])
        exact = [t for t in pool if norm_name(t["name"]) == n]
        if len(exact) == 1:
            a["tfrrs_id"] = exact[0]["id"]
            continue
        # last name match + first-name prefix (Matt / Matthew, Abby / Abigail)
        fuzzy = [t for t in pool
                 if norm_name(t["name"])[-1:] == n[-1:]
                 and (norm_name(t["name"])[0][:3] == n[0][:3])]
        if len(fuzzy) == 1:
            a["tfrrs_id"] = fuzzy[0]["id"]


# ---------------------------------------------------------------- marks
FIELD_WORDS = ("jump", "vault", "put", "throw", "discus", "hammer", "javelin", "weight")
MULTI_WORDS = ("athlon", "pentathlon", "heptathlon", "decathlon")
WIND_EVENTS = re.compile(r"^(100|200|100 hurdles|110 hurdles|long jump|triple jump)", re.I)
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def event_kind(event):
    e = event.lower()
    if any(w in e for w in MULTI_WORDS):
        return "points"
    if any(w in e for w in FIELD_WORDS):
        return "distance"
    return "time"


def parse_mark(mark, kind):
    m = mark.strip().lower()
    try:
        if kind == "distance":
            return float(m.rstrip("m")) if re.fullmatch(r"\d+(\.\d+)?m?", m) else None
        if kind == "points":
            return int(m) if m.isdigit() else None
        if not re.fullmatch(r"[\d:.]+h?", m):
            return None
        secs = 0.0
        for part in m.rstrip("h").split(":"):
            secs = secs * 60 + float(part)
        return round(secs, 3)
    except ValueError:
        return None


def parse_date(s):
    """'April 30-May 2, 2026' -> 2026-04-30 (start date)."""
    s = s.strip()
    year = re.search(r"(\d{4})", s)
    md = re.match(r"([A-Za-z]+)\.?\s*(\d{1,2})", s)
    if not (year and md):
        return ""
    mon = MONTHS.get(md.group(1)[:3].lower())
    if not mon:
        return ""
    y = int(year.group(1))
    # 'Dec 30-Jan 2, 2027': start month after end month -> previous year
    end = re.search(r"-\s*([A-Za-z]+)", s)
    if end and MONTHS.get(end.group(1)[:3].lower(), 13) < mon:
        y -= 1
    try:
        return dt.date(y, mon, int(md.group(2))).isoformat()
    except ValueError:
        return ""


def season_info(label):
    """'2026 XC' -> ('xc', '2026-27'); '2027 Indoors' -> ('indoor', '2026-27')."""
    m = re.match(r"(\d{4})\s+(.*)", label.strip())
    if not m:
        return "other", ""
    y, kind = int(m.group(1)), m.group(2).lower()
    if "xc" in kind or "cross" in kind:
        return "xc", f"{y}-{str(y + 1)[2:]}"
    t = "indoor" if "indoor" in kind else "outdoor"
    return t, f"{y - 1}-{str(y)[2:]}"


def norm_event(e):
    e = e.strip()
    e = re.sub(r"(\d)\s*k\b", lambda m: m.group(1) + "K", e, flags=re.I)
    return e


# ---------------------------------------------------------------- athlete pages
TOKEN = re.compile(
    r'Competing for\s*<a[^>]*>\s*(?P<team>[^<]+?)\s*</a>'
    r'|<h3 class="ml-5[^"]*">\s*(?P<season>[^<]+?)\s*</h3>'
    r'|<th class="panel-heading-text" colspan="100%">\s*<span style="color:black">\s*(?P<event>[^<]+?)\s*</span>'
    r'|<tr[^>]*>\s*<td class="panel-heading-text" width="33%">(?P<row>.*?)</tr>', re.S)


def scrape_athlete(aid, team="Nebraska Wesleyan"):
    url = f"https://www.tfrrs.org/athletes/{aid}.html"
    page = squash(fetch(url))
    name = re.search(r'<h3 class="panel-title large-title">\s*(.*?)\s*</h3>', page, re.S)
    yr = re.search(r"\b(FR|SO|JR|SR|GR)-(\d)\b", page)
    start = page.find('id="session-history"')
    end = page.find('id="progression"', start)
    block = page[start:end if end > 0 else None]

    # newest first; a "Competing for X" divider means everything below was for X
    results, season, event = [], "", ""
    for m in TOKEN.finditer(block):
        if m.group("team"):
            team = html.unescape(m.group("team"))
        elif m.group("season"):
            season = m.group("season")
        elif m.group("event"):
            event = norm_event(html.unescape(m.group("event")))
        elif m.group("row"):
            row = m.group("row")
            links = re.findall(r'<a [^>]*href="([^"]+)"[^>]*>\s*(.*?)\s*</a>', row)
            if not links:
                continue
            res_url, mark = links[0][0], text(links[0][1])
            meet_url, meet = (links[1][0], text(links[1][1])) if len(links) > 1 else ("", "")
            wind = re.search(r"\(\s*([+-]?\d+(?:\.\d+)?)\s*\)", row)
            wind = float(wind.group(1)) if wind else None
            date_text = text(row.split('panel-heading-normal-text">')[-1])
            stype, acad = season_info(season)
            kind = event_kind(event)
            results.append({
                "season": season, "type": stype, "acad": acad, "team": team,
                "event": event, "kind": kind, "mark": mark,
                "value": parse_mark(mark, kind),
                "wind": wind,
                "aided": bool(wind is not None and wind > 2.0 and WIND_EVENTS.match(event)),
                "relay": " x " in event.lower() or "relay" in event.lower(),
                "meet": meet, "meet_url": meet_url, "result_url": res_url,
                "date": parse_date(date_text), "date_text": date_text,
            })
    return {
        "tfrrs_name": text(name.group(1)) if name else "",
        "tfrrs_year": yr.group(0) if yr else "",
        "tfrrs_url": url,
        "results": results,
    }


# ---------------------------------------------------------------- performance lists
def current_season(today=None):
    """Academic season string, e.g. '2026-27' from August 2026 through July 2027."""
    today = today or dt.date.today()
    y = today.year if today.month >= 8 else today.year - 1
    return f"{y}-{str(y + 1)[2:]}"


def find_d3_lists(seasons_back=3):
    """Every indoor + outdoor list for each section in LIST_PATTERNS, keyed '2025-26 outdoor'."""
    year = dt.date.today().year
    lists = {section: {} for section in LIST_PATTERNS}
    for outdoor in (0, 1):
        for y in range(year + 1, year - seasons_back, -1):
            page = fetch(f"https://tf.tfrrs.org/directory_tab.html?outdoor={outdoor}&tab=d3&year={y}",
                         optional=True)
            for lid, slug in re.findall(r'href="https://tf\.tfrrs\.org/lists/(\d+)/([^"?]+)"', page):
                for section, pattern in LIST_PATTERNS.items():
                    if re.search(pattern, slug):
                        kind = "indoor" if "Indoor" in slug else "outdoor"
                        key = f"{y - 1}-{str(y)[2:]} {kind}"
                        found = lists[section]
                        if key not in found or int(lid) > int(found[key][0]):
                            found[key] = (lid, slug)
    return lists


def scrape_list(lid, slug, top):
    url = f"https://tf.tfrrs.org/lists/{lid}/{slug}"
    page = squash(fetch(url))
    title = re.search(r"<title>\s*(.*?)\s*</title>", page)
    updated = re.search(r"(?:Updated|Last updated)[^<]*?(\w+ \d{1,2}, \d{4})", page, re.I)
    events = []
    for chunk in page.split('<div class="custom-table-title">')[1:]:
        h = re.search(r"<h3[^>]*>\s*(.*?)\s*</h3>", chunk)
        if not h:
            continue
        heading = text(h.group(1))
        g = re.match(r"(.*?)\s*\((Men|Women)\)", heading)
        if not g:
            continue
        rows, nwu = [], []
        for r in chunk.split("performance-list-row")[1:]:
            cells = {}
            for label, inner in re.findall(r'data-label="([^"]+)">(.*?)</div>', r):
                if label not in cells:
                    cells[label] = inner
            if "Place" not in cells:
                continue
            ath = re.search(r'href="[^"]*/athletes/(\d+)/', cells.get("Athlete", ""))
            mark_label = next((k for k in ("Time", "Mark", "Points", "Score") if k in cells), None)
            entry = {
                "place": text(cells["Place"]),
                "athlete": text(cells.get("Athlete", "")) or text(cells.get("Team", "")) + " relay",
                "athlete_id": ath.group(1) if ath else None,
                "year": text(cells.get("Year", "")),
                "team": text(cells.get("Team", "")),
                "mark": text(cells[mark_label]) if mark_label else "",
                "meet": text(cells.get("Meet", "")),
                "date": text(cells.get("Meet Date", "")),
                "wind": text(cells.get("Wind", "")),
            }
            entry["nwu"] = "Nebraska Wesleyan" in entry["team"] or "Neb. Wesleyan" in entry["team"]
            if len(rows) < top:
                rows.append(entry)
            if entry["nwu"]:
                nwu.append(entry)
        if rows:
            events.append({"event": g.group(1), "gender": "m" if g.group(2) == "Men" else "f",
                           "top": rows, "nwu": nwu})
    title = re.sub(r"^TFRRS\s*\|\s*", "", text(title.group(1))) if title else slug.replace("_", " ")
    return {"id": lid, "title": title,
            "url": url, "updated": updated.group(1) if updated else "", "events": events}


# ---------------------------------------------------------------- main
def load_overrides():
    """overrides.json: {"match": {name: tfrrs id | null}, "previous_profiles": {name: [ids]}}"""
    if not os.path.exists(OVERRIDES):
        return {}, {}
    with open(OVERRIDES) as f:
        raw = json.load(f)
    match = {k: v for k, v in raw.items() if not k.startswith("_") and isinstance(v, (str, type(None)))}
    match.update(raw.get("match", {}))
    return match, raw.get("previous_profiles", {})


def load_json(name):
    try:
        with open(os.path.join(OUT, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def main():
    os.makedirs(OUT, exist_ok=True)
    overrides, previous = load_overrides()

    roster = scrape_nwu_roster()
    match_athletes(roster, scrape_tfrrs_rosters(), overrides)

    for i, a in enumerate(roster, 1):
        if a["tfrrs_id"]:
            print(f"[{i}/{len(roster)}] {a['name']} -> {a['tfrrs_id']}")
            a.update(scrape_athlete(a["tfrrs_id"]))
        else:
            a.update({"tfrrs_name": "", "tfrrs_year": "", "tfrrs_url": "", "results": []})
        # separate (unlinked) TFRRS profiles from a previous school
        seen = {r["result_url"] for r in a["results"]}
        for pid in previous.get(a["name"], []):
            print(f"    + previous-school profile {pid}")
            page = squash(fetch(f"https://www.tfrrs.org/athletes/{pid}.html"))
            team = re.search(r'/teams/[^"]*"[^>]*>\s*<h3[^>]*>\s*([^<]+?)\s*</h3>', page)
            old = scrape_athlete(pid, team=text(team.group(1)).title() if team else "Previous school")
            a["results"] += [r for r in old["results"] if r["result_url"] not in seen]
    unmatched = [a["name"] for a in roster
                 if not a["tfrrs_id"] and not a["year"].lower().startswith("fr")]
    if unmatched:
        print("No TFRRS match (non-freshmen) — add to scraper/overrides.json if they have one:")
        for n in unmatched:
            print("   ", n)

    # Performance lists. Past seasons never change, so keep what we already saved
    # (TFRRS eventually drops old lists from its directory) and only re-download
    # lists from the current season.
    tops = {"national": NATIONAL_TOP, "conference": CONFERENCE_TOP}
    season = current_season()
    sections = {}
    for section, found in find_d3_lists().items():
        saved = load_json(f"{section}.json").get("lists", {})
        lists = {k: v for k, v in saved.items() if "season" in v}
        for key, (lid, slug) in sorted(found.items()):
            old = lists.get(key)
            if old and old["id"] == lid and not key.startswith(season):
                continue
            print(f"{section} list ({key}): {slug}")
            lists[key] = scrape_list(lid, slug, tops[section])
            lists[key].update({"season": key.split()[0], "kind": key.split()[1]})
        sections[section] = lists

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with open(os.path.join(OUT, "athletes.json"), "w") as f:
        json.dump({"updated": now, "season": season, "athletes": roster}, f, separators=(",", ":"))
    for section, lists in sections.items():
        with open(os.path.join(OUT, f"{section}.json"), "w") as f:
            json.dump({"updated": now, "top": tops[section], "lists": lists}, f, separators=(",", ":"))
    print(f"Wrote {len(roster)} athletes, "
          + ", ".join(f"{len(v)} {k} lists" for k, v in sections.items()) + f" -> {OUT}")


if __name__ == "__main__":
    main()
