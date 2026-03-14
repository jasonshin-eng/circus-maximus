import os
import ssl
import time
import json as _json
import pickle
import traceback
import asyncio
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

# macOS Python often lacks system CA certs — use an unverified context for external fetches
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode    = ssl.CERT_NONE

import numpy as np
import pandas as pd
from datetime import datetime
import psycopg2
import psycopg2.extras
import psycopg2.errors
import secrets as _secrets
from werkzeug.security import generate_password_hash, check_password_hash

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

import fastf1

# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key="f1-circus-drachma-2026", session_cookie="f1_session")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.on_event("startup")
async def _prewarm_cache():
    """
    Minimal startup — no blocking work.
    mem_get() already reads from disk cache on first access, so all data is served
    from disk (fast) without any pre-loading. Only schedule + standings are refreshed
    in the background so the strip and championship panel are current.
    """
    async def _refresh_critical():
        await asyncio.gather(api_schedule(), api_standings(), return_exceptions=True)

    asyncio.create_task(_refresh_critical())

_executor = ThreadPoolExecutor(max_workers=6)

CACHE_DIR = "./f1_cache"
os.makedirs(CACHE_DIR, exist_ok=True)
fastf1.Cache.enable_cache(CACHE_DIR)

YEAR = 2026

# ─── Persistent Cache (survives server restarts) ───────────────────────────────
# Layer 1: in-process dict (instant reads)
# Layer 2: pickle files on disk (survives restarts; FastF1 re-processing skipped)

PERSIST_CACHE_DIR = "./api_cache"
os.makedirs(PERSIST_CACHE_DIR, exist_ok=True)

_mem: dict = {}   # hot layer

def _disk_path(key: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in key)
    return os.path.join(PERSIST_CACHE_DIR, f"{safe}.pkl")

def mem_get(key: str, ttl: int = 300):
    # 1. hot memory
    entry = _mem.get(key)
    if entry and time.time() - entry["ts"] < ttl:
        return entry["val"]
    # 2. disk
    path = _disk_path(key)
    try:
        if os.path.exists(path):
            with open(path, "rb") as f:
                entry = pickle.load(f)
            if time.time() - entry["ts"] < ttl:
                _mem[key] = entry          # promote to hot layer
                return entry["val"]
    except Exception:
        pass
    return None

def mem_set(key: str, val):
    entry = {"val": val, "ts": time.time()}
    _mem[key] = entry
    path = _disk_path(key)
    try:
        with open(path, "wb") as f:
            pickle.dump(entry, f)
    except Exception:
        pass

async def run_sync(fn, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, fn, *args)

# ─── Database ─────────────────────────────────────────────────────────────────

DATABASE_URL = (
    "postgresql://postgres:Letbebefinaleofseem070612"
    "@db.omwrevvtrredsftpoerq.supabase.co:5432/postgres"
)

def get_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor,
                            connect_timeout=10)
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS leagues (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            owner_id INTEGER REFERENCES users(id),
            final_reward TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS league_members (
            league_id INTEGER REFERENCES leagues(id),
            user_id INTEGER REFERENCES users(id),
            bets_won INTEGER DEFAULT 0,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (league_id, user_id)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS bets (
            id SERIAL PRIMARY KEY,
            league_id INTEGER REFERENCES leagues(id),
            user_id INTEGER REFERENCES users(id),
            race_round INTEGER NOT NULL,
            bet_type TEXT NOT NULL,
            prediction TEXT NOT NULL,
            custom_wager TEXT DEFAULT '',
            result TEXT DEFAULT 'pending',
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    # Schema migrations — each in its own transaction so a failure doesn't block startup
    for migration in [
        "ALTER TABLE leagues ADD COLUMN IF NOT EXISTS final_reward TEXT DEFAULT ''",
        "ALTER TABLE league_members ADD COLUMN IF NOT EXISTS bets_won INTEGER DEFAULT 0",
        "ALTER TABLE bets ADD COLUMN IF NOT EXISTS custom_wager TEXT DEFAULT ''",
    ]:
        try:
            cur.execute(migration)
            conn.commit()
        except Exception:
            conn.rollback()
    conn.commit()
    cur.close()
    conn.close()

try:
    init_db()
except Exception as _e:
    print(f"[init_db] WARNING: {_e} — DB migrations skipped at startup")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def clean(v):
    if v is None:
        return None
    if isinstance(v, pd.Timedelta):
        return None if pd.isna(v) else v.total_seconds()
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if np.isnan(v) else float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, float) and np.isnan(v):
        return None
    return v


def td_to_sec(td):
    if td is None:
        return None
    if isinstance(td, float) and np.isnan(td):
        return None
    try:
        t = pd.Timedelta(td)
        if pd.isna(t):
            return None
        return t.total_seconds()
    except Exception:
        return None


def td_to_str(td):
    secs = td_to_sec(td)
    if secs is None:
        return None
    m = int(secs // 60)
    s = secs % 60
    return f"{m}:{s:06.3f}"


def is_past(event_date):
    try:
        dt = pd.to_datetime(event_date).to_pydatetime().replace(tzinfo=None)
        return dt <= datetime.now()
    except Exception:
        return False


def _get_schedule_sync():
    return fastf1.get_event_schedule(YEAR, include_testing=False)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def index(request: Request):
    resp = templates.TemplateResponse("index.html", {"request": request})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    return resp


@app.get("/api/schedule")
async def api_schedule(t: str = None):
    if t is None:
        cached = mem_get("schedule", ttl=3600)
        if cached:
            return cached
    try:
        sched = await run_sync(_get_schedule_sync)
        events = []
        cols = sched.columns.tolist()
        for _, ev in sched.iterrows():
            race_done  = is_past(ev["EventDate"])
            # Use Session1Date/Session1DateUtc to detect events that have started
            s1_col = next((c for c in ("Session1DateUtc", "Session1Date") if c in cols), None)
            s1_date = ev.get(s1_col) if s1_col else None
            event_started = is_past(s1_date) if s1_date is not None else race_done
            events.append({
                "round":     int(ev["RoundNumber"]),
                "name":      str(ev["EventName"]),
                "country":   str(ev["Country"]),
                "location":  str(ev["Location"]),
                "date":      str(ev["EventDate"])[:10],
                "format":    str(ev.get("EventFormat", "conventional")),
                "is_past":   race_done,
                "is_active": event_started and not race_done,
            })
        completed = sum(1 for e in events if e["is_past"])
        result = {"year": YEAR, "events": events, "total": len(events), "completed": completed}
        mem_set("schedule", result)
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _build_standings():
    sched = _get_schedule_sync()
    drv_pts = {}
    con_pts = {}
    race_names = []

    for _, ev in sched.iterrows():
        if not is_past(ev["EventDate"]):
            continue
        rnd   = int(ev["RoundNumber"])
        rname = str(ev["EventName"])
        try:
            race = fastf1.get_session(YEAR, rnd, "R")
            race.load(laps=False, telemetry=False, weather=False, messages=False)
            race_names.append({"round": rnd, "name": rname})

            for _, r in race.results.iterrows():
                code = str(r.get("Abbreviation") or "")
                if not code or len(code) > 4:
                    continue
                team = str(r.get("TeamName") or "")
                pts  = float(r["Points"]) if pd.notna(r.get("Points")) else 0.0
                pos  = int(r["Position"]) if pd.notna(r.get("Position")) else 99
                fn   = str(r.get("FirstName") or "")
                ln   = str(r.get("LastName")  or "")

                if code not in drv_pts:
                    drv_pts[code] = {"name": f"{fn} {ln}".strip(), "team": team,
                                     "total": 0.0, "wins": 0, "podiums": 0,
                                     "races": 0, "history": []}
                d = drv_pts[code]
                d["total"] += pts
                d["races"] += 1
                if pos == 1: d["wins"] += 1
                if pos <= 3: d["podiums"] += 1
                d["history"].append({"round": rnd, "pts": pts, "cum": d["total"], "pos": pos})

                if team:
                    if team not in con_pts:
                        con_pts[team] = {"total": 0.0, "wins": 0, "drivers": []}
                    con_pts[team]["total"] += pts
                    if pos == 1: con_pts[team]["wins"] += 1
                    if code not in con_pts[team]["drivers"]:
                        con_pts[team]["drivers"].append(code)
        except Exception as e:
            print(f"Standings round {rnd} error: {e}")
            continue

    drivers = sorted([{"code": k, **v} for k, v in drv_pts.items()],
                     key=lambda x: (-x["total"], x["code"]))
    for i, d in enumerate(drivers):
        d["position"] = i + 1

    constructors = sorted([{"team": k, **v} for k, v in con_pts.items()],
                          key=lambda x: -x["total"])
    for i, c in enumerate(constructors):
        c["position"] = i + 1

    all_rounds = sorted({r["round"] for r in race_names})
    top10 = [d["code"] for d in drivers[:10]]
    history_chart = []
    for code in top10:
        d = drv_pts[code]
        by_r = {h["round"]: h["cum"] for h in d["history"]}
        series, prev = [], 0
        for r in all_rounds:
            prev = by_r.get(r, prev)
            series.append(prev)
        history_chart.append({"driver": code, "name": d["name"],
                              "team": d["team"], "points": series})

    return {
        "drivers":        drivers,
        "constructors":   constructors,
        "race_names":     [r["name"] for r in race_names],
        "rounds":         all_rounds,
        "points_history": history_chart,
    }


# 2026 F1 driver roster (full names for bet predictions)
DRIVERS_2026 = sorted([
    "Alexander Albon", "Andrea Kimi Antonelli", "Carlos Sainz",
    "Charles Leclerc", "Esteban Ocon", "Fernando Alonso",
    "Franco Colapinto", "Gabriel Bortoleto", "George Russell",
    "Isack Hadjar", "Jack Doohan", "Lance Stroll",
    "Lando Norris", "Lewis Hamilton", "Liam Lawson",
    "Max Verstappen", "Nico Hülkenberg", "Oliver Bearman",
    "Oscar Piastri", "Pierre Gasly", "Yuki Tsunoda",
])


# Wikipedia page titles for each driver (used to fetch headshots via Wikipedia API)
DRIVER_WIKI = {
    "VER": "Max Verstappen",
    "HAM": "Lewis Hamilton",
    "NOR": "Lando Norris",
    "LEC": "Charles Leclerc",
    "RUS": "George Russell (racing driver)",
    "PIA": "Oscar Piastri",
    "ALO": "Fernando Alonso",
    "SAI": "Carlos Sainz Jr.",
    "ANT": "Kimi Antonelli",
    "STR": "Lance Stroll",
    "ALB": "Alexander Albon",
    "GAS": "Pierre Gasly",
    "OCO": "Esteban Ocon",
    "TSU": "Yuki Tsunoda",
    "LAW": "Liam Lawson",
    "BEA": "Oliver Bearman",
    "HAD": "Isack Hadjar",
    "DOO": "Jack Doohan (racing driver)",
    "COL": "Franco Colapinto",
    "BOR": "Gabriel Bortoleto",
    "HUL": "Nico Hülkenberg",
}

_WIKI_HEADERS = {
    "User-Agent": "CircusF1App/1.0 (educational project; contact via github) Python-urllib",
}

def _fetch_driver_photo_sync(wiki_title: str) -> bytes | None:
    """
    1. Call Wikipedia API to get the page's lead image thumbnail URL.
    2. Download that image and return the raw bytes.
    Uses an unverified SSL context to work around macOS Python CA cert issues.
    """
    # Step 1 — resolve thumbnail URL via Wikipedia pageimages API
    api_url = (
        "https://en.wikipedia.org/w/api.php"
        "?action=query"
        "&prop=pageimages"
        "&format=json"
        "&pithumbsize=600"
        f"&titles={urllib.parse.quote(wiki_title)}"
    )
    try:
        req = urllib.request.Request(api_url, headers=_WIKI_HEADERS)
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CTX) as resp:
            payload = _json.loads(resp.read())
        pages = payload.get("query", {}).get("pages", {})
        page  = next(iter(pages.values()), {})
        thumb = page.get("thumbnail", {}).get("source")
        if not thumb:
            return None
    except Exception:
        return None

    # Step 2 — download the thumbnail image
    try:
        req2 = urllib.request.Request(thumb, headers=_WIKI_HEADERS)
        with urllib.request.urlopen(req2, timeout=10, context=_SSL_CTX) as resp2:
            data = resp2.read()
        return data if len(data) > 4000 else None
    except Exception:
        return None


@app.get("/api/driver-photo/{code}")
async def api_driver_photo(code: str):
    wiki_title = DRIVER_WIKI.get(code.upper())
    if not wiki_title:
        raise HTTPException(status_code=404, detail="Unknown driver code")
    cache_key = f"photo_{code.upper()}"
    cached = mem_get(cache_key, ttl=604800)   # cache 7 days — Wikipedia images rarely change
    if cached:
        return Response(cached, media_type="image/jpeg")
    data = await run_sync(_fetch_driver_photo_sync, wiki_title)
    if not data:
        raise HTTPException(status_code=404, detail="Photo not available")
    mem_set(cache_key, data)
    return Response(data, media_type="image/jpeg")


@app.get("/api/drivers")
async def api_drivers():
    return {"drivers": DRIVERS_2026}


def _build_past_season_sync(code: str, year: int = 2025):
    """Aggregate a driver's full-season results for a past year."""
    sched = fastf1.get_event_schedule(year, include_testing=False)
    out = {
        "year": year, "code": code,
        "races": 0, "wins": 0, "podiums": 0,
        "pts_finishes": 0, "no_pts": 0, "dnfs": 0,
        "total_pts": 0.0, "best_pos": None,
        "history": [],
    }
    for _, ev in sched.iterrows():
        if not is_past(ev["EventDate"]):
            continue
        rnd = int(ev["RoundNumber"])
        try:
            sess = fastf1.get_session(year, rnd, "R")
            sess.load(laps=False, telemetry=False, weather=False, messages=False)
            row = sess.results[sess.results["Abbreviation"] == code]
            if row.empty:
                continue
            r   = row.iloc[0]
            pos = int(r["Position"]) if pd.notna(r.get("Position")) else None
            pts = float(r["Points"])  if pd.notna(r.get("Points"))  else 0.0
            status = str(r.get("Status", "") or "").lower()
            out["races"]      += 1
            out["total_pts"]  += pts
            if pos == 1:
                out["wins"] += 1
            if pos and pos <= 3:
                out["podiums"] += 1
            if pts > 0:
                out["pts_finishes"] += 1
            else:
                out["no_pts"] += 1
            if any(k in status for k in ("dnf", "accident", "collision", "mechanical", "retired", "withdrawal")):
                out["dnfs"] += 1
            if pos and (out["best_pos"] is None or pos < out["best_pos"]):
                out["best_pos"] = pos
            out["history"].append({
                "round": rnd,
                "name": str(ev["EventName"]).replace(" Grand Prix", "").strip(),
                "pos": pos, "pts": pts,
            })
        except Exception:
            continue
    return out


@app.get("/api/driver-past-season/{code}")
async def api_driver_past_season(code: str, year: int = 2025):
    key = f"past_season_{code.upper()}_{year}"
    cached = mem_get(key, ttl=604800)   # past seasons never change — cache 7 days
    if cached:
        return cached
    try:
        result = await run_sync(_build_past_season_sync, code.upper(), year)
        mem_set(key, result)
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _get_race_result_sync(rnd: int):
    """Return race outcome data for auto-resolving bets."""
    cache_key = f"race_result_{rnd}"
    cached = mem_get(cache_key, ttl=86400)
    if cached:
        return cached
    try:
        race = fastf1.get_session(YEAR, rnd, "R")
        race.load(laps=False, telemetry=False, weather=False, messages=False)
        results = race.results.sort_values("Position")

        def fullname(r):
            return f"{r.get('FirstName', '')} {r.get('LastName', '')}".strip()

        winner = None
        podium = []
        fastest = None
        constructor_winner = None

        for _, r in results.iterrows():
            pos = r.get("Position")
            if pd.notna(pos):
                pos = int(pos)
                name = fullname(r)
                if pos == 1:
                    winner = name
                    constructor_winner = str(r.get("TeamName", ""))
                if pos <= 3:
                    podium.append(name)
            if r.get("FastestLap") is True or str(r.get("FastestLap")) == "True":
                fastest = fullname(r)

        # Qualifying for pole
        pole = winner  # fallback
        try:
            quali = fastf1.get_session(YEAR, rnd, "Q")
            quali.load(laps=False, telemetry=False, weather=False, messages=False)
            for _, r in quali.results.sort_values("Position").iterrows():
                pos = r.get("Position")
                if pd.notna(pos) and int(pos) == 1:
                    pole = fullname(r)
                    break
        except Exception:
            pass

        # Sprint winner
        sprint_winner = None
        try:
            sprint_sess = fastf1.get_session(YEAR, rnd, "S")
            sprint_sess.load(laps=False, telemetry=False, weather=False, messages=False)
            for _, r in sprint_sess.results.sort_values("Position").iterrows():
                pos = r.get("Position")
                if pd.notna(pos) and int(pos) == 1:
                    sprint_winner = f"{r.get('FirstName', '')} {r.get('LastName', '')}".strip()
                    break
        except Exception:
            pass

        out = {
            "race_winner": winner, "pole_position": pole,
            "fastest_lap": fastest, "podium": podium,
            "constructor_winner": constructor_winner,
            "sprint_winner": sprint_winner,
        }
        mem_set(cache_key, out)
        return out
    except Exception:
        return None


def _name_matches(prediction: str, actual: str) -> bool:
    if not actual:
        return False
    p, a = prediction.strip().lower(), actual.strip().lower()
    return p in a or a in p or p.split()[-1] in a


def try_resolve_bet(bet: dict, completed_rounds: set) -> str | None:
    """Return new result string or None if cannot resolve yet."""
    if bet["result"] != "pending":
        return None
    rnd = bet["race_round"]
    if rnd not in completed_rounds:
        return None
    race_data = _get_race_result_sync(rnd)
    if not race_data:
        return None
    btype = bet["bet_type"]
    pred  = bet["prediction"]
    if btype == "race_winner":
        result = "win" if _name_matches(pred, race_data["race_winner"]) else "loss"
    elif btype == "pole_position":
        result = "win" if _name_matches(pred, race_data["pole_position"]) else "loss"
    elif btype == "fastest_lap":
        result = "win" if _name_matches(pred, race_data["fastest_lap"]) else "loss"
    elif btype == "podium":
        result = "win" if any(_name_matches(pred, p) for p in (race_data["podium"] or [])) else "loss"
    elif btype == "constructor_winner":
        result = "win" if _name_matches(pred, race_data["constructor_winner"]) else "loss"
    elif btype == "sprint_winner":
        if race_data.get("sprint_winner") is None:
            return None  # sprint hasn't happened yet
        result = "win" if _name_matches(pred, race_data["sprint_winner"]) else "loss"
    else:
        return None
    return result


@app.get("/api/standings")
async def api_standings(t: str = None):
    if t is None:
        cached = mem_get("standings", ttl=3600)
        if cached:
            return cached
    try:
        result = await run_sync(_build_standings)
        mem_set("standings", result)
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _round_event_date(rnd: int):
    """Return the EventDate for a given round from the schedule (no network if cached)."""
    try:
        sched = _get_schedule_sync()
        row = sched[sched["RoundNumber"] == rnd]
        if not row.empty:
            return row.iloc[0]["EventDate"]
    except Exception:
        pass
    return None

def _round_session_date(rnd: int, session_num: int):
    """Return the date of a specific session (1-5) for a round. Uses UTC columns first."""
    try:
        sched = _get_schedule_sync()
        row = sched[sched["RoundNumber"] == rnd]
        if row.empty:
            return None
        ev = row.iloc[0]
        cols = sched.columns.tolist()
        for col in (f"Session{session_num}DateUtc", f"Session{session_num}Date"):
            if col in cols:
                val = ev.get(col)
                if val is not None and str(val) not in ("NaT", "nan", "None", ""):
                    return val
    except Exception:
        pass
    return None

def _build_race(rnd: int):
    ev_date = _round_event_date(rnd)
    if ev_date is not None and not is_past(ev_date):
        return None   # Race hasn't happened yet — don't try to load from FastF1
    sess = fastf1.get_session(YEAR, rnd, "R")
    sess.load(telemetry=False, weather=False, messages=False)

    results = []
    for _, r in sess.results.iterrows():
        results.append({
            "pos":    int(r["Position"])    if pd.notna(r.get("Position"))    else None,
            "driver": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
            "code":   str(r.get("Abbreviation") or ""),
            "team":   str(r.get("TeamName") or ""),
            "pts":    float(r["Points"])    if pd.notna(r.get("Points"))      else 0,
            "status": str(r.get("Status")   or ""),
            "grid":   int(r["GridPosition"]) if pd.notna(r.get("GridPosition")) else None,
            "time":   str(r.get("Time") or "") if pd.notna(r.get("Time")) else None,
        })

    laps_data = []
    try:
        laps = sess.laps
        top6 = sess.results.head(6)["Abbreviation"].tolist()
        for drv in top6:
            dl = laps.pick_drivers(drv).pick_quicklaps()
            pts_list = []
            for _, lap in dl.iterrows():
                if pd.notna(lap.get("LapTime")):
                    lt = lap["LapTime"].total_seconds()
                    if 60 < lt < 300:
                        pts_list.append({"n": int(lap["LapNumber"]),
                                         "t": round(lt, 3),
                                         "c": str(lap.get("Compound") or "UNK")})
            if pts_list:
                laps_data.append({"drv": drv, "laps": pts_list})
    except Exception as e:
        print(f"Lap data error: {e}")

    strategy = []
    try:
        laps = sess.laps
        for _, r in sess.results.iterrows():
            drv = str(r.get("Abbreviation") or "")
            dl = laps.pick_drivers(drv).sort_values("LapNumber") if drv else pd.DataFrame()
            if dl.empty:
                continue
            stints, prev_c, s_start = [], None, None
            for _, lap in dl.iterrows():
                c = str(lap.get("Compound") or "UNK")
                n = int(lap["LapNumber"])
                if c != prev_c:
                    if prev_c is not None:
                        stints.append({"c": prev_c, "start": s_start, "end": n - 1})
                    prev_c, s_start = c, n
            if prev_c and s_start is not None:
                stints.append({"c": prev_c, "start": s_start,
                               "end": int(dl["LapNumber"].max())})
            if stints:
                strategy.append({"drv": drv, "team": str(r.get("TeamName") or ""),
                                 "stints": stints})
    except Exception as e:
        print(f"Strategy error: {e}")

    total_laps = int(sess.laps["LapNumber"].max()) if not sess.laps.empty else 0
    return {
        "event":      sess.event["EventName"],
        "results":    results,
        "laps":       laps_data,
        "strategy":   strategy,
        "total_laps": total_laps,
    }


@app.get("/api/race/{rnd}")
async def api_race(rnd: int):
    key = f"race_{rnd}"
    cached = mem_get(key, ttl=86400)
    if cached:
        return cached
    try:
        result = await run_sync(_build_race, rnd)
        if result is None:
            return {"not_available": True}
        mem_set(key, result)
        return result
    except Exception:
        return {"not_available": True}


def _build_qualifying(rnd: int):
    # Qualifying is session 4 in both sprint and conventional weekends
    s4 = _round_session_date(rnd, 4)
    if s4 is not None and not is_past(s4):
        return None
    sess = fastf1.get_session(YEAR, rnd, "Q")
    sess.load(laps=False, telemetry=False, weather=False, messages=False)
    results = []
    for _, r in sess.results.iterrows():
        results.append({
            "pos":    int(r["Position"]) if pd.notna(r.get("Position")) else None,
            "driver": f"{r.get('FirstName','')} {r.get('LastName','')}".strip(),
            "code":   str(r.get("Abbreviation") or ""),
            "team":   str(r.get("TeamName") or ""),
            "q1":     td_to_str(r.get("Q1")),
            "q2":     td_to_str(r.get("Q2")),
            "q3":     td_to_str(r.get("Q3")),
            "q1s":    td_to_sec(r.get("Q1")),
            "q2s":    td_to_sec(r.get("Q2")),
            "q3s":    td_to_sec(r.get("Q3")),
        })
    return {"event": sess.event["EventName"], "results": results}


@app.get("/api/qualifying/{rnd}")
async def api_qualifying(rnd: int):
    key = f"quali_{rnd}"
    cached = mem_get(key, ttl=86400)
    if cached:
        return cached
    try:
        result = await run_sync(_build_qualifying, rnd)
        if result is None:
            return {"not_available": True}
        mem_set(key, result)
        return result
    except Exception:
        return {"not_available": True}


def _build_practice(rnd: int, fp: int):
    label = f"FP{fp}"
    sess = fastf1.get_session(YEAR, rnd, label)
    sess.load(laps=True, telemetry=False, weather=False, messages=False)
    results = []
    for code in sess.laps["Driver"].unique():
        try:
            drv_laps = sess.laps.pick_drivers(code)
            fastest  = drv_laps.pick_fastest()
            if fastest is None or (hasattr(fastest, "empty") and fastest.empty):
                continue
            lap_time = fastest["LapTime"]
            lap_sec  = lap_time.total_seconds() if pd.notna(lap_time) else None
            lap_str  = td_to_str(lap_time) if pd.notna(lap_time) else None
            row = sess.results[sess.results["Abbreviation"] == code]
            team = str(row["TeamName"].values[0]) if len(row) > 0 else ""
            fn   = str(row["FirstName"].values[0]) if len(row) > 0 else ""
            ln   = str(row["LastName"].values[0])  if len(row) > 0 else ""
            results.append({
                "code":     code,
                "driver":   f"{fn} {ln}".strip() or code,
                "team":     team,
                "lap_time": lap_str,
                "lap_sec":  lap_sec,
            })
        except Exception:
            continue
    results.sort(key=lambda x: x["lap_sec"] or 9999)
    for i, r in enumerate(results):
        r["pos"] = i + 1
    return {"session": label, "event": sess.event["EventName"], "results": results}


@app.get("/api/practice/{rnd}/{fp}")
async def api_practice(rnd: int, fp: int):
    if fp not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="fp must be 1, 2, or 3")
    key = f"practice_{rnd}_{fp}"
    cached = mem_get(key, ttl=86400)
    if cached:
        return cached
    try:
        result = await run_sync(_build_practice, rnd, fp)
        mem_set(key, result)
        return result
    except Exception:
        return {"not_available": True}


def _build_sprint(rnd: int):
    """Sprint race results."""
    # Sprint is session 3 in a sprint weekend; skip if not happened yet
    s3 = _round_session_date(rnd, 3)
    if s3 is not None and not is_past(s3):
        return None
    sess = fastf1.get_session(YEAR, rnd, "S")
    sess.load(laps=False, telemetry=False, weather=False, messages=False)
    results = []
    for _, r in sess.results.sort_values("Position").iterrows():
        pos = r.get("Position")
        fn  = str(r.get("FirstName", "") or "")
        ln  = str(r.get("LastName",  "") or "")
        results.append({
            "pos":    int(pos) if pd.notna(pos) else None,
            "driver": f"{fn} {ln}".strip(),
            "code":   str(r.get("Abbreviation") or ""),
            "team":   str(r.get("TeamName") or ""),
            "time":   str(r.get("Time") or ""),
            "status": str(r.get("Status") or ""),
            "pts":    float(r["Points"]) if pd.notna(r.get("Points")) else 0,
        })
    winner = next((r["driver"] for r in results if r["pos"] == 1), None)
    return {"session": "Sprint", "event": sess.event["EventName"], "results": results, "winner": winner}


def _build_sprint_qualifying(rnd: int):
    """Sprint qualifying / shootout results."""
    sess = fastf1.get_session(YEAR, rnd, "SQ")
    sess.load(laps=True, telemetry=False, weather=False, messages=False)

    # Detect whether the official API has Q1/Q2/Q3 data
    has_q_data = any(
        pd.notna(r.get("Q1")) or pd.notna(r.get("Q2")) or pd.notna(r.get("Q3"))
        for _, r in sess.results.iterrows()
    ) if "Q1" in sess.results.columns else False

    results = []

    if has_q_data:
        # Use official Q1/Q2/Q3 lap times
        for _, r in sess.results.sort_values("Position").iterrows():
            pos  = r.get("Position")
            fn   = str(r.get("FirstName", "") or "")
            ln   = str(r.get("LastName",  "") or "")
            code = str(r.get("Abbreviation") or "")
            team = str(r.get("TeamName") or "")
            def best_in(q):
                try:
                    t = r.get(q)
                    return td_to_str(t) if pd.notna(t) else None, t.total_seconds() if pd.notna(t) else None
                except Exception:
                    return None, None
            q1, q1s = best_in("Q1")
            q2, q2s = best_in("Q2")
            q3, q3s = best_in("Q3")
            results.append({
                "pos": int(pos) if pd.notna(pos) else None,
                "driver": f"{fn} {ln}".strip(), "code": code, "team": team,
                "q1": q1, "q1s": q1s, "q2": q2, "q2s": q2s, "q3": q3, "q3s": q3s,
            })
    else:
        # Fallback: rank by fastest lap from raw timing data
        fastest_per = {}
        for code in sess.laps["Driver"].unique():
            try:
                lap = sess.laps.pick_drivers(code).pick_fastest()
                if lap is not None and pd.notna(lap["LapTime"]):
                    fastest_per[code] = lap["LapTime"]
            except Exception:
                continue
        sorted_drivers = sorted(fastest_per.items(), key=lambda x: x[1])
        for pos, (code, lap_time) in enumerate(sorted_drivers, 1):
            row  = sess.results[sess.results["Abbreviation"] == code]
            fn   = str(row["FirstName"].values[0]) if len(row) > 0 else ""
            ln   = str(row["LastName"].values[0])  if len(row) > 0 else ""
            team = str(row["TeamName"].values[0])   if len(row) > 0 else ""
            lap_str = td_to_str(lap_time)
            lap_sec = lap_time.total_seconds()
            results.append({
                "pos": pos, "driver": f"{fn} {ln}".strip() or code,
                "code": code, "team": team,
                "q1": lap_str, "q1s": lap_sec,
                "q2": None, "q2s": None, "q3": None, "q3s": None,
            })

    return {"session": "Sprint Qualifying", "event": sess.event["EventName"], "results": results}


@app.get("/api/sprint/{rnd}")
async def api_sprint(rnd: int):
    key = f"sprint_{rnd}"
    cached = mem_get(key, ttl=86400)
    if cached:
        return cached
    try:
        result = await run_sync(_build_sprint, rnd)
        if result is None:
            return {"not_available": True}
        mem_set(key, result)
        return result
    except Exception:
        return {"not_available": True}


@app.get("/api/sprint-qualifying/{rnd}")
async def api_sprint_qualifying(rnd: int):
    key = f"sprint_qualifying_{rnd}"
    cached = mem_get(key, ttl=86400)
    if cached:
        return cached
    try:
        result = await run_sync(_build_sprint_qualifying, rnd)
        mem_set(key, result)
        return result
    except Exception:
        return {"not_available": True}


def _build_telemetry(rnd: int, stype: str):
    sess = fastf1.get_session(YEAR, rnd, stype)
    sess.load(telemetry=True, weather=False, messages=False)

    top_drvs = sess.results["Abbreviation"].tolist()[:8]
    drivers = []

    for drv in top_drvs:
        try:
            lap = sess.laps.pick_drivers(drv).pick_fastest()
            if lap is None or (hasattr(lap, "empty") and lap.empty):
                continue

            tel = lap.get_car_data().add_distance()
            n   = min(len(tel), 300)
            idx = np.linspace(0, len(tel) - 1, n, dtype=int)
            t   = tel.iloc[idx]

            row  = sess.results[sess.results["Abbreviation"] == drv]
            team = str(row["TeamName"].values[0]) if len(row) > 0 else ""

            sectors = {
                "s1": lap["Sector1Time"].total_seconds() if pd.notna(lap.get("Sector1Time")) else None,
                "s2": lap["Sector2Time"].total_seconds() if pd.notna(lap.get("Sector2Time")) else None,
                "s3": lap["Sector3Time"].total_seconds() if pd.notna(lap.get("Sector3Time")) else None,
            }

            brake_col = t["Brake"].astype(float) if "Brake" in t.columns else pd.Series([], dtype=float)

            drivers.append({
                "code":     drv,
                "team":     team,
                "lap_time": lap["LapTime"].total_seconds() if pd.notna(lap.get("LapTime")) else None,
                "sectors":  sectors,
                "tel": {
                    "dist":     t["Distance"].round(1).tolist(),
                    "speed":    t["Speed"].round(1).tolist(),
                    "throttle": t["Throttle"].round(1).tolist(),
                    "brake":    brake_col.tolist(),
                    "gear":     t["nGear"].astype(int).tolist() if "nGear" in t.columns else [],
                    "drs":      t["DRS"].tolist()              if "DRS"  in t.columns else [],
                },
            })
        except Exception as e:
            print(f"Telemetry error {drv}: {e}")
            continue

    return {"drivers": drivers, "session_type": stype}


@app.get("/api/telemetry/{rnd}")
async def api_telemetry(rnd: int, request: Request):
    stype = request.query_params.get("type", "Q")
    key = f"telemetry_{rnd}_{stype}"
    cached = mem_get(key, ttl=86400)
    if cached:
        return cached
    try:
        result = await run_sync(_build_telemetry, rnd, stype)
        mem_set(key, result)
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.get("/api/auth/me")
async def api_auth_me(request: Request):
    uid = request.session.get("user_id")
    if not uid:
        return {"user": None}
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, name, username FROM users WHERE id = %s", (uid,))
    user = cur.fetchone()
    cur.close()
    conn.close()
    if not user:
        request.session.clear()
        return {"user": None}
    return {"user": {"id": user["id"], "name": user["name"], "username": user["username"]}}


@app.post("/api/auth/signup")
async def api_auth_signup(request: Request):
    data = await request.json()
    name     = (data.get("name")     or "").strip()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    if not name or not username or not password:
        raise HTTPException(status_code=400, detail="Name, username and password are required")
    if len(name) < 2 or len(name) > 50:
        raise HTTPException(status_code=400, detail="Name must be 2–50 characters")
    if len(username) < 3 or len(username) > 20:
        raise HTTPException(status_code=400, detail="Username must be 3–20 characters")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (name, username, password_hash) VALUES (%s, %s, %s) RETURNING id, name, username",
            (name, username, generate_password_hash(password))
        )
        user = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        request.session["user_id"] = user["id"]
        request.session["username"] = user["username"]
        return {"user": {"id": user["id"], "name": user["name"], "username": user["username"]}}
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="Username already taken")


@app.post("/api/auth/login")
async def api_auth_login(request: Request):
    data = await request.json()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username = %s", (username,))
    user = cur.fetchone()
    cur.close()
    conn.close()
    if not user or not check_password_hash(user["password_hash"], password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session["user_id"] = user["id"]
    request.session["username"] = user["username"]
    return {"user": {"id": user["id"], "name": user["name"], "username": user["username"]}}


@app.post("/api/auth/logout")
async def api_auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


# ─── Leagues ──────────────────────────────────────────────────────────────────

@app.get("/api/leagues/mine")
async def api_leagues_mine(request: Request):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT l.id, l.name, l.code, l.owner_id, l.final_reward,
               COUNT(lm2.user_id) AS member_count,
               lm.bets_won AS my_bets_won
        FROM leagues l
        JOIN league_members lm ON lm.league_id = l.id AND lm.user_id = %s
        LEFT JOIN league_members lm2 ON lm2.league_id = l.id
        GROUP BY l.id, l.name, l.code, l.owner_id, l.final_reward, l.created_at, lm.bets_won
        ORDER BY l.created_at DESC
    """, (uid,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"leagues": [dict(r) for r in rows]}


@app.post("/api/leagues/create")
async def api_leagues_create(request: Request):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = await request.json()
    name         = (data.get("name") or "").strip()
    final_reward = (data.get("final_reward") or "").strip()[:200]
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="League name must be at least 3 characters")
    code = _secrets.token_hex(3).upper()
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO leagues (name, code, owner_id, final_reward) VALUES (%s, %s, %s, %s) RETURNING id",
        (name, code, uid, final_reward)
    )
    league_id = cur.fetchone()["id"]
    cur.execute("INSERT INTO league_members (league_id, user_id) VALUES (%s, %s)", (league_id, uid))
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "code": code, "league": {"id": league_id, "name": name, "code": code}}


@app.post("/api/leagues/join")
async def api_leagues_join(request: Request):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = await request.json()
    code = (data.get("code") or "").strip().upper()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM leagues WHERE code = %s", (code,))
    league = cur.fetchone()
    if not league:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="No league found with that code")
    cur.execute(
        "SELECT 1 FROM league_members WHERE league_id = %s AND user_id = %s",
        (league["id"], uid)
    )
    existing = cur.fetchone()
    if existing:
        cur.close()
        conn.close()
        raise HTTPException(status_code=409, detail="Already a member of this league")
    cur.execute("INSERT INTO league_members (league_id, user_id) VALUES (%s, %s)", (league["id"], uid))
    conn.commit()
    cur.close()
    conn.close()
    return {"ok": True, "league": {"id": league["id"], "name": league["name"], "code": league["code"]}}


# ─── League Detail & Bets ─────────────────────────────────────────────────────

@app.get("/api/leagues/{lid}")
async def api_league_detail(lid: int, request: Request):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_db()
    cur = conn.cursor()
    # verify membership
    cur.execute("SELECT 1 FROM league_members WHERE league_id = %s AND user_id = %s", (lid, uid))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise HTTPException(status_code=403, detail="Not a member of this league")
    # league info
    cur.execute("SELECT * FROM leagues WHERE id = %s", (lid,))
    league = cur.fetchone()
    if not league:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="League not found")
    # members with bets_won, sorted by wins desc
    cur.execute("""
        SELECT u.id, u.name, u.username, lm.bets_won, lm.joined_at
        FROM league_members lm
        JOIN users u ON u.id = lm.user_id
        WHERE lm.league_id = %s
        ORDER BY lm.bets_won DESC
    """, (lid,))
    members = [dict(r) for r in cur.fetchall()]
    cur.close(); conn.close()
    return {
        "league": dict(league),
        "members": members,
        "current_user_id": uid,
    }


@app.get("/api/leagues/{lid}/bets")
async def api_league_bets(lid: int, request: Request):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM league_members WHERE league_id = %s AND user_id = %s", (lid, uid))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise HTTPException(status_code=403, detail="Not a member")
    cur.execute("""
        SELECT b.*, u.name AS user_name, u.username AS user_username
        FROM bets b
        JOIN users u ON u.id = b.user_id
        WHERE b.league_id = %s
        ORDER BY b.created_at DESC
    """, (lid,))
    bets = [dict(r) for r in cur.fetchall()]

    # Auto-resolve pending bets for completed rounds
    try:
        sched = await run_sync(_get_schedule_sync)
        completed_rounds = {
            int(ev["RoundNumber"])
            for _, ev in sched.iterrows()
            if is_past(ev["EventDate"])
        }
        for bet in bets:
            if bet["result"] != "pending":
                continue
            new_result = await run_sync(try_resolve_bet, bet, completed_rounds)
            if new_result:
                cur.execute(
                    "UPDATE bets SET result = %s WHERE id = %s",
                    (new_result, bet["id"])
                )
                if new_result == "win":
                    cur.execute(
                        "UPDATE league_members SET bets_won = bets_won + 1 WHERE league_id = %s AND user_id = %s",
                        (lid, bet["user_id"])
                    )
                bet["result"] = new_result
        conn.commit()
    except Exception:
        traceback.print_exc()

    cur.close(); conn.close()
    return {"bets": bets}


@app.post("/api/leagues/{lid}/bets")
async def api_league_bet_create(lid: int, request: Request):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = await request.json()
    race_round    = int(data.get("race_round", 0))
    bet_type      = (data.get("bet_type") or "").strip()
    prediction    = (data.get("prediction") or "").strip()
    custom_wager  = (data.get("custom_wager") or "").strip()[:200]
    note          = (data.get("note") or "").strip()[:200]
    if not bet_type or not prediction or not race_round:
        raise HTTPException(status_code=400, detail="race_round, bet_type and prediction are required")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM league_members WHERE league_id = %s AND user_id = %s", (lid, uid))
    if not cur.fetchone():
        cur.close(); conn.close()
        raise HTTPException(status_code=403, detail="Not a member")
    cur.execute(
        """INSERT INTO bets (league_id, user_id, race_round, bet_type, prediction, custom_wager, note)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, created_at""",
        (lid, uid, race_round, bet_type, prediction, custom_wager or None, note or None)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close(); conn.close()
    return {"ok": True, "bet_id": row["id"]}


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=5001, reload=True)
