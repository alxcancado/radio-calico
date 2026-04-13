// ── PURE HELPERS (testable, no DOM deps) ─────────────────────────────────────

function songKey(artist, title) {
  return encodeURIComponent(`${artist}|${title}`);
}

function buildMetaParts(d) {
  const parts = [];
  if (d.album) parts.push(d.album);
  if (d.date)  parts.push(d.date);
  if (d.bit_depth && d.sample_rate)
    parts.push(`${d.bit_depth}-bit / ${(d.sample_rate / 1000).toFixed(1)} kHz`);
  return parts.join(" · ");
}

function buildRecentTracks(d) {
  const tracks = [];
  for (let i = 1; i <= 5; i++) {
    const artist = d[`prev_artist_${i}`], title = d[`prev_title_${i}`];
    if (artist || title) tracks.push({ artist: artist || "—", title: title || "—" });
  }
  return tracks;
}

function getUID(storage) {
  let uid = storage.getItem("rc_uid");
  if (!uid) { uid = crypto.randomUUID(); storage.setItem("rc_uid", uid); }
  return uid;
}

// ── DOM BOOTSTRAP (only runs in browser) ─────────────────────────────────────
if (typeof document !== "undefined") {
  // ── PLAYER ──
  const STREAM = "https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8";
  const audio        = document.getElementById("audio");
  const playBtn      = document.getElementById("playBtn");
  const iconPlay     = document.getElementById("iconPlay");
  const iconPause    = document.getElementById("iconPause");
  const volumeSlider = document.getElementById("volume");
  const statusEl     = document.getElementById("status");

  let hls = null, playing = false;

  function setStatus(msg) { statusEl.textContent = msg; }

  function initHls() {
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(STREAM);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        audio.play().catch(() => setStatus("Tap play to start."));
      });
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setStatus("Stream error — retrying…"); });
    } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = STREAM;
      audio.play().catch(() => setStatus("Tap play to start."));
    } else {
      setStatus("HLS not supported in this browser.");
    }
  }

  function destroyHls() {
    if (hls) { hls.destroy(); hls = null; }
    audio.src = "";
  }

  function togglePlay() {
    if (!playing) {
      setStatus("Connecting…");
      initHls();
      playing = true;
      playBtn.setAttribute("aria-pressed", "true");
      playBtn.setAttribute("aria-label", "Pause");
      iconPlay.style.display  = "none";
      iconPause.style.display = "";
    } else {
      audio.pause();
      destroyHls();
      playing = false;
      playBtn.setAttribute("aria-pressed", "false");
      playBtn.setAttribute("aria-label", "Play");
      iconPlay.style.display  = "";
      iconPause.style.display = "none";
      setStatus("");
    }
  }

  audio.addEventListener("playing", () => setStatus(""));
  audio.addEventListener("waiting", () => setStatus("Buffering…"));
  audio.addEventListener("error",   () => setStatus("Playback error."));
  playBtn.addEventListener("click", togglePlay);
  volumeSlider.addEventListener("input", () => { audio.volume = volumeSlider.value; });

  // ── METADATA ──
  const METADATA_URL = "https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json";
  let lastTitle = null;

  function applyVoteUI(vote) {
    const up = document.getElementById("rateUp"), down = document.getElementById("rateDown");
    up.classList.toggle("voted",   vote === "up");
    down.classList.toggle("voted", vote === "down");
    up.setAttribute("aria-pressed",   String(vote === "up"));
    down.setAttribute("aria-pressed", String(vote === "down"));
  }

  function updateCounts(data) {
    document.getElementById("rateUp").querySelector(".count").textContent   = data.up   ?? 0;
    document.getElementById("rateDown").querySelector(".count").textContent = data.down ?? 0;
  }

  // ── RATINGS ──
  const API = "http://localhost:5000";
  const UID = getUID(localStorage);
  let currentKey = null;

  async function loadRatings(artist, title) {
    currentKey = songKey(artist, title);
    try {
      const res = await fetch(`${API}/ratings/${currentKey}?uid=${encodeURIComponent(UID)}`);
      if (!res.ok) return;
      const data = await res.json();
      updateCounts(data);
      applyVoteUI(data.user_vote);
    } catch (_) {}
  }

  async function castVote(type) {
    if (!currentKey) return;
    try {
      const res = await fetch(`${API}/ratings/${currentKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: UID, vote: type })
      });
      if (!res.ok) return;
      const data = await res.json();
      updateCounts(data);
      applyVoteUI(data.user_vote);
    } catch (_) {}
  }

  function renderMetadata(d) {
    const cover = document.getElementById("npCover");
    cover.src = "https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg?_=" + Date.now();
    cover.alt = d.title ? `${d.title} — ${d.artist}` : "Album art";

    loadRatings(d.artist || "", d.title || "");

    document.getElementById("npTitle").textContent  = d.title  || "—";
    document.getElementById("npArtist").textContent = d.artist || "—";

    const titleEl = document.getElementById("npTitle");
    titleEl.classList.remove("scrolling");
    titleEl.style.removeProperty("--marquee-offset");
    titleEl.style.removeProperty("--marquee-duration");
    requestAnimationFrame(() => {
      const overflow = titleEl.scrollWidth - titleEl.parentElement.clientWidth;
      if (overflow > 0) {
        titleEl.style.setProperty("--marquee-offset", `-${overflow}px`);
        titleEl.style.setProperty("--marquee-duration", `${Math.max(4, overflow / 30)}s`);
        titleEl.classList.add("scrolling");
      }
    });

    document.getElementById("npMeta").textContent = buildMetaParts(d);

    const badges = document.getElementById("npBadges");
    badges.innerHTML = "";
    if (d.is_new)      badges.innerHTML += `<span class="badge badge-new">New</span>`;
    if (d.is_summer)   badges.innerHTML += `<span class="badge badge-summer">Summer</span>`;
    if (d.is_vidgames) badges.innerHTML += `<span class="badge badge-games">🎮 Games</span>`;

    const list = document.getElementById("recentList");
    list.innerHTML = "";
    buildRecentTracks(d).forEach((t, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="track-num">${i + 1}</span>
        <div class="track-info">
          <div class="t-title">${t.title}</div>
          <div class="t-artist">${t.artist}</div>
        </div>`;
      list.appendChild(li);
    });
  }

  async function fetchMetadata() {
    try {
      const res = await fetch(METADATA_URL + "?_=" + Date.now());
      if (!res.ok) return;
      const d = await res.json();
      if (d.title !== lastTitle) { lastTitle = d.title; renderMetadata(d); }
    } catch (_) {}
  }

  document.getElementById("rateUp").addEventListener("click",   () => castVote("up"));
  document.getElementById("rateDown").addEventListener("click", () => castVote("down"));

  fetchMetadata();
  setInterval(fetchMetadata, 15000);
}
