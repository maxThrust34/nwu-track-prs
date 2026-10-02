# NWU Track & Field PRs

A static site with every current Nebraska Wesleyan track athlete's college PRs, grouped by event, plus the American Rivers Conference top 10 and the NCAA D-III national top 25.

- **Events tab**: a **Latest meet** card at the top shows every NWU mark from the most recent meet, with new PRs flagged. Below it is one board per event (100m, 200m, 400m, …), with the team ranked by PR. Switch between Men/Women and Outdoor/Indoor/XC, and pick Lifetime PRs or any single season (the current one or earlier ones). A "26-27 PR" badge marks PRs set this season.
- **Athletes tab**: the full roster. Click anyone to see every PR, their season bests and every result, with each PR race flagged. Freshmen show "first race pending" until their first meet.
- **Conference Top 10 tab**: the top 10 in every event from TFRRS's American Rivers Conference performance lists. A dropdown picks the season and indoor or outdoor; past seasons are archived and kept. NWU athletes are highlighted, NWU athletes outside the top 10 are listed with their conference rank, and clicking an NWU row opens that athlete's profile.
- **National Top 25 tab**: NCAA D-III qualifying lists from TFRRS, with the same season dropdown and archive. NWU marks are highlighted, and NWU athletes ranked below 25th are listed under each event.
- **Search bar**: type your name to jump to your profile. It also filters every tab.

## How data updates

`scraper/update.py` (Python standard library only) does four things:
1. It reads the current roster from nwusports.com.
2. It matches each athlete to their TFRRS profile through the NWU TFRRS team pages (TF + XC).
3. It downloads each athlete's full TFRRS season history.
4. It downloads the newest NCAA D-III and American Rivers Conference indoor and outdoor lists.

It writes `docs/data/athletes.json`, `docs/data/conference.json` and `docs/data/national.json`.

`.github/workflows/update.yml` runs it at 3:00am Central every Monday and Tuesday morning (Sunday night and Monday night) on GitHub, commits any new data and republishes the site. You can also start it by hand from the Actions tab ("Run workflow"). With GitHub Pages serving `docs/`, the site updates on its own after every meet.

### Run locally

```bash
python3 scraper/update.py
python3 -m http.server 8765 --directory docs   # open http://localhost:8765
```

### Transfers
- **Linked transfers:** when TFRRS has linked a transfer's old profile, results from the previous school come in automatically. They're tagged with that school (for example UNK or Southeast CC) and count toward lifetime PRs.
- **Unlinked transfers:** if TFRRS has the old results under a separate profile, add it to `previous_profiles` in `scraper/overrides.json`.

```json
{ "previous_profiles": { "Max Matthies": ["1234567"] } }
```

### Missing athlete?
If someone has TFRRS results but doesn't match automatically (because of a nickname or a transfer), add them to `scraper/overrides.json`:

```json
{ "match": { "MaKenzie Nollette": "1234567" } }
```

The number is the ID in their TFRRS URL: `tfrrs.org/athletes/1234567/...`.
