# Radio Calico — Project Spec

## 1. Overview

Radio Calico is a single-page web radio player that streams a live lossless HLS audio feed. It displays real-time track metadata, album art, a recently-played list, and a community thumbs-up/down rating system. There is no login, no subscription, and no ads.

---

## 2. Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | Vanilla HTML/CSS/JS (single file)   |
| Audio    | hls.js (HLS stream playback)        |
| Fonts    | Google Fonts — Montserrat, Open Sans|
| Backend  | Python / Flask                      |
| Database | SQLite (via Python stdlib)          |
| Pkg mgr  | uv                                  |
| VCS      | Git + GitHub (HTTPS)                |

---

## 3. Brand & Design System

Source: `RadioCalico_Style_Guide.txt`

### Colors

| Name          | Hex       | Usage                              |
|---------------|-----------|------------------------------------|
| Mint          | `#D8F2D5` | Accents, badges, button highlights |
| Forest Green  | `#1F4E23` | Now-playing card bg, primary btns  |
| Teal          | `#38A29D` | Nav bar, volume thumb, links       |
| Calico Orange | `#EFA63C` | Live dot pulse, "New" badge        |
| Charcoal      | `#231F20` | Body text                          |
| Cream         | `#F5EADA` | Recently-played card bg            |
| White         | `#FFFFFF` | Text on dark backgrounds           |

### Typography

| Style   | Font        | Weight | Size          |
|---------|-------------|--------|---------------|
| Heading | Montserrat  | 700    | 1.05rem+      |
| Label   | Montserrat  | 600    | 0.68–0.75rem  |
| Body    | Open Sans   | 400    | 0.8–0.875rem  |

---

## 4. Frontend — `index.html`

Single self-contained file. No build step, no framework.

### 4.1 Layout

```
<nav>          — teal bar, logo + station name
<main.main>
  .now-playing — forest green card (see §4.2)
  .recently-played — cream card (see §4.3)
<footer>       — minimal copyright line
```

Max content width: 560px, centered, 24px side padding.

### 4.2 Now-Playing Card

Two sub-rows:

**Top row:**
- Album art — 88×88px rounded square, sourced from `https://[host]/cover.jpg`
- Track info block:
  - "NOW PLAYING" label (teal, uppercase, tracked)
  - Song title — marquee animated when text overflows (see §4.5)
  - Artist name
  - Meta line: `Album · Year · bit_depth-bit / sample_rate kHz`
  - Badge row: `New` (orange), `Summer` (teal), `🎮 Games` (purple) — shown conditionally

**Bottom row (left → right):**
- Play/Pause toggle button (mint circle, forest green icon)
- LIVE badge (mint pill, pulsing orange dot)
- Volume slider (teal thumb, dark track)
- Vertical divider
- "RATE" label + 👍 count / 👎 count buttons

### 4.3 Recently Played Card

Cream background, numbered list of 5 previous tracks.
Each row: index number (teal) · song title (Montserrat 600) · artist (teal, smaller).
Rows separated by a faint forest-green border.

### 4.4 Audio Playback

Library: `hls.js` (CDN, latest).

- Stream URL: `https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8`
- Play/pause toggle: on play, initialises HLS and calls `audio.play()`; on pause, destroys HLS instance and clears `audio.src` to stop buffering.
- Safari fallback: native `<audio src=...>` when `Hls.isSupported()` is false but `canPlayType('application/vnd.apple.mpegurl')` is true.
- Status messages shown inline below the controls: "Connecting…", "Buffering…", "Playback error."

### 4.5 Marquee Title Animation

- The `.np-title` `<span>` sits inside `.np-title-wrap` (overflow hidden, fade mask on edges).
- After each metadata update, JS measures `scrollWidth - clientWidth`.
- If overflow > 0: sets CSS custom properties `--marquee-offset` (negative px) and `--marquee-duration` (scales with length at ~30px/s), adds class `.scrolling`.
- CSS `@keyframes marquee` slides `translateX` from 0 → offset, alternating, with 15% pause at each end.
- Short titles: no animation applied.

### 4.6 Metadata Polling

Endpoint: `GET https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json`

Polled every 15 seconds with a cache-bust `?_=<timestamp>` query param.
Re-renders only when `title` field changes.

Response shape:
```json
{
  "artist": "string",
  "title": "string",
  "album": "string",
  "date": "string (year)",
  "bit_depth": 16,
  "sample_rate": 44100,
  "prev_artist_1": "string", "prev_title_1": "string",
  "prev_artist_2": "string", "prev_title_2": "string",
  "prev_artist_3": "string", "prev_title_3": "string",
  "prev_artist_4": "string", "prev_title_4": "string",
  "prev_artist_5": "string", "prev_title_5": "string",
  "is_new": false,
  "is_summer": false,
  "is_vidgames": false
}
```

Album art: `GET https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg?_=<timestamp>` — cache-busted on each track change.

### 4.7 Rating Feature (Frontend)

- User identity: UUID generated once via `crypto.randomUUID()`, persisted in `localStorage` as `rc_uid`.
- Song key: `encodeURIComponent("artist|title")` — used as the URL path segment.
- On track change: `GET /ratings/<key>?uid=<uid>` → updates counts + highlights user's prior vote.
- On button click: `POST /ratings/<key>` with `{ uid, vote: "up"|"down" }` → updates counts + vote UI.
- Voted state: `.btn-rate.voted.up` (mint tint) / `.btn-rate.voted.down` (orange tint).
- Switching vote (👍 → 👎) is allowed; voting the same way twice is a no-op.

---

## 5. Backend — `api/app.py`

### 5.1 Setup

```
api/
  app.py
  pyproject.toml   ← uv-managed
  uv.lock
  .venv/           ← gitignored
  ratings.db       ← gitignored, auto-created on first run
```

Run: `uv run python app.py` (port 5000, debug mode).

Dependencies: `flask`, `flask-cors`.

### 5.2 Database Schema

SQLite, single table:

```sql
CREATE TABLE IF NOT EXISTS votes (
  song_key  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  vote      TEXT NOT NULL CHECK(vote IN ('up','down')),
  PRIMARY KEY (song_key, user_id)
);
```

### 5.3 API Endpoints

#### `GET /ratings/<song_key>?uid=<uid>`

Returns current totals and the requesting user's vote.

Response:
```json
{ "up": 12, "down": 3, "user_vote": "up" }
```
`user_vote` is `null` if the user hasn't voted.

#### `POST /ratings/<song_key>`

Body: `{ "uid": "string", "vote": "up"|"down" }`

- New vote: inserts row.
- Changed vote: updates row, adjusts both counters atomically via SQLite transaction.
- Same vote repeated: no-op, returns current totals.
- Invalid payload: `400`.

Response: same shape as GET.

### 5.4 CORS

`flask-cors` applied globally — allows the frontend served from any origin (including `file://`) to call the API.

---

## 6. Repository

- Git initialised at project root.
- GitHub repo: `https://github.com/alxcancado/radio-calico` (public, HTTPS remote).
- `.gitignore` excludes: `.DS_Store`, `*.zip`, `api/ratings.db`, `api/__pycache__/`, `api/.venv/`, `api/.python-version`.

---

## 7. Assets

| File                      | Purpose                        |
|---------------------------|--------------------------------|
| `RadioCalicoLogoTM.png`   | Logo used in nav + player card |
| `RadioCalicoLayout.png`   | Design reference layout        |
| `RadioCalico_Style_Guide.txt` | Brand/UI style reference   |
| `stream_URL.txt`          | HLS stream URL reference       |
| `RadioCalicoStyle.zip`    | Original style assets (gitignored via *.zip) |
