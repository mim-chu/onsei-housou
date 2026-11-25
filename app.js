(function () {
  var CFG = window.PLAYER_CFG;
  var PAGE_SIZE = 40;

  var audio = document.getElementById("audio");
  var listEl = document.getElementById("episode-list");
  var countEl = document.getElementById("episode-count");
  var searchEl = document.getElementById("episode-search");
  var sortEl = document.getElementById("episode-sort");
  var moreBtn = document.getElementById("more-episodes");
  var emptyEl = document.getElementById("empty-list");
  var errorEl = document.getElementById("load-error");
  var heroTitle = document.getElementById("hero-title");
  var heroMeta = document.getElementById("hero-meta");
  var heroLabel = document.getElementById("hero-label");
  var heroPlay = document.getElementById("hero-play");
  var heroShuffle = document.getElementById("hero-shuffle");
  var shuffleBtn = document.getElementById("btn-shuffle");
  var nowTitle = document.getElementById("now-title");
  var nowMeta = document.getElementById("now-meta");
  var seekEl = document.getElementById("seek");
  var curEl = document.getElementById("time-current");
  var durEl = document.getElementById("time-duration");
  var playBtn = document.getElementById("btn-play");
  var speedEl = document.getElementById("speed");
  var sleepEl = document.getElementById("sleep");
  var officialLink = document.getElementById("official-link");
  var tabsEl = document.getElementById("series-tabs");
  var rangeBox = document.getElementById("ranges");

  var catalogs = {}; // seriesId -> episodes ascending
  var seriesId = CFG.series[0].id;
  var episodes = [];
  var current = null;
  var activeFilter = "all";
  var activeRange = 0; // 0=all, "guest", or range start number
  var limit = PAGE_SIZE;
  var sleepTimer = null;
  var sleepAtEnd = false;
  var lastSave = 0;
  var seeking = false;

  function loadState() {
    try {
      var raw = localStorage.getItem(CFG.storageKey);
      if (raw) { return JSON.parse(raw); }
    } catch (e) {}
    return { tracks: {}, last: {}, speed: 1, shuffle: false };
  }
  function saveState() {
    try { localStorage.setItem(CFG.storageKey, JSON.stringify(state)); } catch (e) {}
  }
  var state = loadState();
  if (!state.tracks) { state.tracks = {}; }
  if (!state.last) { state.last = {}; }

  function seriesLabel(id) {
    for (var i = 0; i < CFG.series.length; i++) { if (CFG.series[i].id === id) { return CFG.series[i].label; } }
    return "";
  }
  function fmtNum(n) {
    if (typeof n === "number" && Math.floor(n) === n) { return String(n); }
    return String(n);
  }
  function record(ep) { return state.tracks[ep.id] || { pos: 0, duration: 0, done: false }; }
  function statusOf(ep) {
    var r = record(ep);
    if (r.done) { return "done"; }
    if (r.pos && r.pos >= 5) { return "mid"; }
    return "unheard";
  }
  function statusLabel(s) {
    if (s === "done") { return "聴了"; }
    if (s === "mid") { return "途中"; }
    return "未聴";
  }
  function fmt(sec) {
    if (!sec || !isFinite(sec)) { sec = 0; }
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var ss = (s < 10 ? "0" : "") + s;
    if (h > 0) { return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss; }
    return m + ":" + ss;
  }
  function fmtDate(pubDate) {
    var d = new Date(pubDate);
    if (isNaN(d.getTime())) { return ""; }
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function filtered() {
    var q = searchEl.value ? searchEl.value.replace(/^\s+|\s+$/g, "").toLowerCase() : "";
    var out = [];
    var i, ep, st;
    for (i = 0; i < episodes.length; i++) {
      ep = episodes[i];
      if (activeRange === "guest") { if (!ep.guest) { continue; } }
      else if (activeRange > 0 && (ep.number < activeRange || ep.number > activeRange + 99)) { continue; }
      if (activeFilter !== "all") {
        st = statusOf(ep);
        if (st !== activeFilter) { continue; }
      }
      if (q) {
        var hay = (ep.title + " " + ep.number + " 第" + ep.number + "回" + (ep.guest ? " ゲスト" : "") + " " + (ep.desc || "")).toLowerCase();
        if (hay.indexOf(q) === -1) { continue; }
      }
      out.push(ep);
    }
    var dir = (sortEl && sortEl.value === "old") ? 1 : -1;
    out.sort(function (a, b) {
      var da = new Date(a.pubDate).getTime() || 0;
      var db = new Date(b.pubDate).getTime() || 0;
      if (da !== db) { return (da - db) * dir; }
      return (a.number - b.number) * dir;
    });
    return out;
  }

  function render() {
    var items = filtered();
    countEl.innerHTML = items.length + "回";
    emptyEl.style.display = items.length ? "none" : "block";
    var html = "";
    var n = Math.min(limit, items.length);
    for (var i = 0; i < n; i++) {
      var ep = items[i];
      var st = statusOf(ep);
      var playing = current && current.id === ep.id;
      html += '<li data-id="' + ep.id + '"' + (playing ? ' class="playing"' : "") + ">"
        + '<span class="ep-num">第' + fmtNum(ep.number) + '回</span>'
        + '<span class="ep-status ' + st + '">' + statusLabel(st) + "</span>"
        + '<div class="ep-title">' + escapeHtml(ep.title) + "</div>"
        + '<div class="ep-date">' + fmtDate(ep.pubDate)
        + (ep.guest ? ' <span class="ep-tag">ゲスト</span>' : "")
        + "</div>"
        + "</li>";
    }
    listEl.innerHTML = html;
    moreBtn.style.display = items.length > limit ? "block" : "none";
    var lis = listEl.getElementsByTagName("li");
    for (var j = 0; j < lis.length; j++) {
      lis[j].onclick = (function (id) {
        return function () { playById(id, true); };
      })(lis[j].getAttribute("data-id"));
    }
  }

  function episodeById(id) {
    for (var s in catalogs) {
      var arr = catalogs[s];
      for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { return arr[i]; } }
    }
    return null;
  }
  function siblingsOf(ep) { return catalogs[ep.series] || []; }
  function randomEpisode(exclude) {
    if (!episodes.length) { return null; }
    if (episodes.length === 1) { return episodes[0]; }
    var ep = null;
    for (var tries = 0; tries < 10; tries++) {
      ep = episodes[Math.floor(Math.random() * episodes.length)];
      if (!exclude || ep.id !== exclude.id) { break; }
    }
    return ep;
  }
  function updateShuffleBtn() {
    var label = state.shuffle ? "シャッフル ON" : "シャッフル OFF";
    if (shuffleBtn) { shuffleBtn.innerHTML = label; }
  }
  function prevEpisode(ep) {
    var arr = siblingsOf(ep);
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === ep.id) { return arr[i - 1] || null; } }
    return null;
  }
  function nextEpisode(ep) {
    var arr = siblingsOf(ep);
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === ep.id) { return arr[i + 1] || null; } }
    return null;
  }
  function resumeChoice() {
    var lastId = state.last[seriesId];
    if (lastId) {
      var last = episodeById(lastId);
      if (last && last.series === seriesId) {
        if (statusOf(last) !== "done") { return { ep: last, kind: "resume" }; }
        var nx = nextEpisode(last);
        if (nx) { return { ep: nx, kind: "next" }; }
        return { ep: last, kind: "again" };
      }
    }
    return episodes.length ? { ep: episodes[0], kind: "first" } : null;
  }
  function updateHero() {
    var c = resumeChoice();
    if (!c) { return; }
    heroTitle.innerHTML = escapeHtml(c.ep.title);
    heroMeta.innerHTML = "第" + fmtNum(c.ep.number) + "回 ・ " + fmtDate(c.ep.pubDate) + (CFG.series.length > 1 ? " ・ " + seriesLabel(c.ep.series) : "");
    heroLabel.innerHTML = c.kind === "resume" ? "つづきから" : (c.kind === "next" ? "つぎの回" : "はじめの一回");
    heroPlay.disabled = false;
    heroPlay.innerHTML = c.kind === "resume" ? "続きを聴く" : "この回を聴く";
    heroPlay.onclick = function () { playEpisode(c.ep, true); };
    if (heroShuffle) {
      heroShuffle.disabled = false;
      heroShuffle.onclick = function () {
        var ep = randomEpisode(current);
        if (ep) { playEpisode(ep, true); }
      };
    }
  }

  function playById(id, autoplay) {
    var ep = episodeById(id);
    if (ep) { playEpisode(ep, autoplay); }
  }
  function playEpisode(ep, autoplay) {
    current = ep;
    state.last[ep.series] = ep.id;
    saveState();
    audio.src = ep.source;
    audio.playbackRate = parseFloat(speedEl.value) || state.speed || 1;
    nowTitle.innerHTML = "第" + fmtNum(ep.number) + "回 " + escapeHtml(ep.title);
    nowMeta.innerHTML = fmtDate(ep.pubDate) + (CFG.series.length > 1 ? " ・ " + seriesLabel(ep.series) : "");
    if (ep.link) {
      officialLink.href = ep.link;
      officialLink.style.display = "inline";
    } else {
      officialLink.style.display = "none";
    }
    setupMediaSession(ep);
    var r = record(ep);
    var startPos = (r.done) ? 0 : (r.pos || 0);
    var onMeta = function () {
      audio.removeEventListener("loadedmetadata", onMeta);
      if (startPos > 5 && audio.duration && startPos < audio.duration - 10) {
        try { audio.currentTime = startPos; } catch (e) {}
      }
      if (autoplay) { try { audio.play(); } catch (e) {} }
    };
    audio.addEventListener("loadedmetadata", onMeta);
    if (autoplay) {
      // Start immediately; do NOT call audio.load() (background session teardown).
      try { audio.preload = "auto"; } catch (e) {}
      try { var pr = audio.play(); if (pr && pr.catch) { pr.catch(function () {}); } } catch (e) {}
      var onCanPlay = function () {
        audio.removeEventListener("canplay", onCanPlay);
        try { var pr2 = audio.play(); if (pr2 && pr2.catch) { pr2.catch(function () {}); } } catch (e) {}
      };
      audio.addEventListener("canplay", onCanPlay);
    }
    render();
  }

  function savePosition(force) {
    if (!current) { return; }
    var now = new Date().getTime();
    if (!force && now - lastSave < 4000) { return; }
    lastSave = now;
    var prev = state.tracks[current.id] || { pos: 0, duration: 0, done: false };
    prev.pos = audio.currentTime || 0;
    if (audio.duration) { prev.duration = audio.duration; }
    if (audio.duration && prev.pos >= audio.duration - 5) { prev.done = true; }
    state.tracks[current.id] = prev;
    saveState();
  }
  function clearSleep() {
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
    sleepAtEnd = false;
  }
  function applySleep() {
    clearSleep();
    var v = sleepEl.value;
    if (v === "-1") { sleepAtEnd = true; return; }
    var mins = parseInt(v, 10);
    if (mins > 0) {
      sleepTimer = setTimeout(function () { audio.pause(); }, mins * 60 * 1000);
    }
  }

  audio.addEventListener("play", function () { playBtn.innerHTML = "⏸ 一時停止"; });
  audio.addEventListener("pause", function () { playBtn.innerHTML = "▶ 再生"; savePosition(true); });
  audio.addEventListener("timeupdate", function () {
    if (!seeking && audio.duration) {
      seekEl.value = Math.floor((audio.currentTime / audio.duration) * 100);
    }
    curEl.innerHTML = fmt(audio.currentTime);
    durEl.innerHTML = fmt(audio.duration);
    savePosition(false);
  });
  audio.addEventListener("ended", function () {
    if (current) {
      state.tracks[current.id] = { pos: audio.duration || 0, duration: audio.duration || 0, done: true };
      saveState();
    }
    if (sleepAtEnd) { clearSleep(); render(); return; }
    if (state.shuffle) {
      var rnd = randomEpisode(current);
      if (rnd) { playEpisode(rnd, true); } else { render(); }
      return;
    }
    var nx = current ? nextEpisode(current) : null;
    if (nx) { playEpisode(nx, true); } else { render(); }
  });


  // PiP support: a tiny silent video WITH real frames rides in the
  // player bar as artwork, already playing; it carries the PiP window
  // while the episode audio keeps playing alongside it (an audio-only
  // element cannot enter PiP on iOS).
  var pipBtn = document.getElementById("btn-pip");
  var pv = document.getElementById("pip-video");
  var pipStarted = false;
  if (pipBtn && pv) {
    pipBtn.onclick = function () {
      try {
        if (pv.paused) { pv.play(); }
        if (typeof pv.webkitSetPresentationMode === "function" &&
            pv.webkitPresentationMode !== "picture-in-picture") {
          pv.webkitSetPresentationMode("picture-in-picture");
          pipStarted = true;
        } else if (typeof pv.requestPictureInPicture === "function") {
          pv.requestPictureInPicture();
          pipStarted = true;
        }
      } catch (e) {}
    };
    pv.onclick = function () {
      try {
        if (typeof pv.webkitEnterFullscreen === "function") { pv.webkitEnterFullscreen(); }
        else if (typeof pv.requestFullscreen === "function") { pv.requestFullscreen(); }
      } catch (e) {}
    };
    audio.addEventListener("play", function () {
      if (pipStarted && pv.paused) { try { pv.play(); } catch (e) {} }
    });
    audio.addEventListener("pause", function () {
      if (pipStarted && !pv.paused) { try { pv.pause(); } catch (e) {} }
    });
  } else if (pipBtn) {
    pipBtn.style.display = "none";
  }

  playBtn.onclick = function () {
    if (!current) {
      var c = resumeChoice();
      if (c) { playEpisode(c.ep, true); }
      return;
    }
    if (audio.paused) { audio.play(); } else { audio.pause(); }
  };
  function doPrev() {
    if (!current) { return; }
    if (audio.currentTime && audio.currentTime > 5) {
      try { audio.currentTime = 0; } catch (e) {}
      return;
    }
    var pv = prevEpisode(current);
    if (pv) { playEpisode(pv, true); }
  }
  function doNext() {
    if (!current) {
      var c = resumeChoice();
      if (c) { playEpisode(c.ep, true); }
      return;
    }
    if (state.shuffle) {
      var rnd = randomEpisode(current);
      if (rnd) { playEpisode(rnd, true); }
      return;
    }
    var nx2 = nextEpisode(current);
    if (nx2) { playEpisode(nx2, true); }
  }
  document.getElementById("btn-prev").onclick = doPrev;
  document.getElementById("btn-next").onclick = doNext;

  var playerEl = document.getElementById("player");
  var collapseBtn = document.getElementById("btn-collapse");
  function applyCompact() {
    var c = !!state.compact;
    if (playerEl) { playerEl.className = c ? "player compact" : "player"; }
    document.body.className = c ? "compact" : "";
    if (collapseBtn) { collapseBtn.innerHTML = c ? "▲ 大きく" : "▼ 小さく"; }
  }
  if (collapseBtn) {
    collapseBtn.onclick = function () {
      state.compact = !state.compact;
      saveState();
      applyCompact();
    };
  }
  applyCompact();

  function setupMediaSession(ep) {
    try {
      if (!("mediaSession" in navigator)) { return; }
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "第" + fmtNum(ep.number) + "回 " + ep.title,
          artist: CFG.mediaArtist,
          album: CFG.series.length > 1 ? seriesLabel(ep.series) : CFG.mediaArtist
        });
      }
      var ms = navigator.mediaSession;
      try { ms.setActionHandler("play", function () { audio.play(); }); } catch (e) {}
      try { ms.setActionHandler("pause", function () { audio.pause(); }); } catch (e) {}
      try { ms.setActionHandler("previoustrack", function () { doPrev(); }); } catch (e) {}
      try { ms.setActionHandler("nexttrack", function () { doNext(); }); } catch (e) {}
      // No seek handlers: iOS would show skip buttons instead of track buttons.
    } catch (e) {}
  }
  seekEl.onchange = function () {
    if (audio.duration) { audio.currentTime = (seekEl.value / 100) * audio.duration; }
  };
  seekEl.onmousedown = function () { seeking = true; };
  seekEl.ontouchstart = function () { seeking = true; };
  seekEl.onmouseup = function () { seeking = false; };
  seekEl.ontouchend = function () { seeking = false; };
  speedEl.onchange = function () {
    var v = parseFloat(speedEl.value) || 1;
    audio.playbackRate = v;
    state.speed = v; saveState();
  };
  sleepEl.onchange = applySleep;
  if (shuffleBtn) {
    updateShuffleBtn();
    shuffleBtn.onclick = function () {
      state.shuffle = !state.shuffle;
      saveState();
      updateShuffleBtn();
    };
  }
  if (state.speed) {
    for (var i = 0; i < speedEl.options.length; i++) {
      if (parseFloat(speedEl.options[i].value) === state.speed) { speedEl.selectedIndex = i; break; }
    }
  }

  searchEl.oninput = function () { limit = PAGE_SIZE; render(); };
  searchEl.onkeyup = function () { limit = PAGE_SIZE; render(); };
  if (sortEl) { sortEl.onchange = function () { limit = PAGE_SIZE; render(); }; }
  moreBtn.onclick = function () { limit += PAGE_SIZE; render(); };
  var filterBox = document.getElementById("filters");
  var fbtns = filterBox.getElementsByTagName("button");
  for (var k = 0; k < fbtns.length; k++) {
    fbtns[k].onclick = (function (btn) {
      return function () {
        activeFilter = btn.getAttribute("data-filter");
        for (var m = 0; m < fbtns.length; m++) { fbtns[m].className = ""; }
        btn.className = "active";
        limit = PAGE_SIZE; render();
      };
    })(fbtns[k]);
  }

  function buildRanges() {
    if (!rangeBox) { return; }
    var max = 0;
    for (var i = 0; i < episodes.length; i++) { if (episodes[i].number > max) { max = episodes[i].number; } }
    var html = '<button type="button" data-range="0" class="active">ぜんぶ</button>';
    for (var start = 1; start <= max; start += 100) {
      html += '<button type="button" data-range="' + start + '">' + start + "〜" + Math.min(start + 99, Math.floor(max)) + "</button>";
    }
    var hasGuest = false;
    for (var g = 0; g < episodes.length; g++) { if (episodes[g].guest) { hasGuest = true; break; } }
    if (hasGuest) { html += '<button type="button" data-range="guest">ゲスト</button>'; }
    rangeBox.innerHTML = html;
    var rbtns = rangeBox.getElementsByTagName("button");
    for (var r = 0; r < rbtns.length; r++) {
      rbtns[r].onclick = (function (btn) {
        return function () {
          var rv = btn.getAttribute("data-range");
          activeRange = (rv === "guest") ? "guest" : (parseInt(rv, 10) || 0);
          for (var m2 = 0; m2 < rbtns.length; m2++) { rbtns[m2].className = ""; }
          btn.className = "active";
          limit = PAGE_SIZE; render();
        };
      })(rbtns[r]);
    }
  }

  function buildTabs() {
    if (!tabsEl) { return; }
    if (CFG.series.length < 2) { tabsEl.style.display = "none"; return; }
    var html = "";
    for (var i = 0; i < CFG.series.length; i++) {
      var s = CFG.series[i];
      html += '<button type="button" data-series="' + s.id + '"' + (s.id === seriesId ? ' class="active"' : "") + ">" + escapeHtml(s.label) + "</button>";
    }
    tabsEl.innerHTML = html;
    var btns = tabsEl.getElementsByTagName("button");
    for (var j = 0; j < btns.length; j++) {
      btns[j].onclick = (function (btn) {
        return function () {
          seriesId = btn.getAttribute("data-series");
          episodes = catalogs[seriesId] || [];
          activeRange = 0; limit = PAGE_SIZE;
          for (var m = 0; m < btns.length; m++) { btns[m].className = ""; }
          btn.className = "active";
          buildRanges();
          updateHero();
          render();
        };
      })(btns[j]);
    }
  }

  // Load all series catalogs sequentially (XHR for old Safari)
  var loadIdx = 0;
  var loadFailed = false;
  function loadNext() {
    if (loadIdx >= CFG.series.length) {
      episodes = catalogs[seriesId] || [];
      buildTabs();
      buildRanges();
      updateHero();
      render();
      return;
    }
    var s = CFG.series[loadIdx];
    var xhr = new XMLHttpRequest();
    xhr.open("GET", s.url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status < 200 || xhr.status >= 300) { loadFailed = true; loadIdx++; loadNext(); return; }
      try {
        var data = JSON.parse(xhr.responseText);
        var arr = [];
        for (var i = 0; i < data.length; i++) {
          var d = data[i];
          if (d && d.source && typeof d.number === "number" && d.number > 0) {
            arr.push({
              series: s.id,
              number: d.number,
              title: d.title || "",
              desc: d.desc || "",
              source: d.source,
              link: d.link || "",
              pubDate: d.pubDate || "",
              guest: (d.title || "").indexOf("ゲスト") !== -1
            });
          }
        }
        arr.sort(function (a, b) {
          if (a.number !== b.number) { return a.number - b.number; }
          return (new Date(a.pubDate).getTime() || 0) - (new Date(b.pubDate).getTime() || 0);
        });
        for (var j = 0; j < arr.length; j++) { arr[j].id = s.id + "#" + j; }
        catalogs[s.id] = arr;
      } catch (e) { loadFailed = true; }
      loadIdx++;
      loadNext();
    };
    xhr.onerror = function () { loadFailed = true; loadIdx++; loadNext(); };
    xhr.send(null);
  }
  loadNext();
  if (loadFailed) { errorEl.style.display = "block"; }
})();
