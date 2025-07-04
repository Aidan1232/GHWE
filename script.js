let context, analyser, source, dataArray;
let score = 0, rockMeter = 50, isGameOver = false;
const keys = ['A', 'S', 'D'];
const lanes = Array.from(document.querySelectorAll('.lane'));
let lastSpawnTime = 0;
const cooldown = 0.25;
const noteFallTime = 1.5;     // seconds from top to hit line

window.addEventListener("error", function (event) {
  console.error("Uncaught error:", event.error || event.message);
  showErrorOnScreen("An error occurred: " + (event.message || "Unknown issue"));
});

window.addEventListener("unhandledrejection", function (event) {
  console.error("Unhandled promise rejection:", event.reason);
  showErrorOnScreen("Unhandled promise rejection: " + (event.reason?.message || event.reason));
});

function haltGame() {
  isGameOver = true;
}

function showErrorOnScreen(message) {
  const overlay = document.getElementById("errorOverlay");
  overlay.textContent = "⚠️ " + message;
  overlay.style.display = "block";

  haltGame();
}

function showBrowserRecommendation() {
  const banner = document.createElement("div");
  banner.textContent = "⚠️ It's recommended to play this on Opera GX as the other browsers lack the power needed to keep in beat.";
  
  Object.assign(banner.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    backgroundColor: "#222",
    color: "#f0f0f0",
    fontSize: "12px",
    padding: "6px 12px",
    textAlign: "center",
    zIndex: "9999",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
    fontFamily: "sans-serif"
  });

  document.body.appendChild(banner);
}

function detectEnvironment() {
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
  let browser = "Unknown";

  if (/OPR|Opera|OPX/i.test(ua)) browser = "Opera";
else if (/Edg/i.test(ua)) browser = "Edge";
else if (/Chrome/i.test(ua) && !/Edg|OPR|Opera/i.test(ua)) browser = "Chrome";

  return { isMobile, browser };
}


const { isMobile: isMobileEnv, browser } = detectEnvironment();

let delayOffset = 1.4; // default for desktop

if (isMobileEnv) {
  switch (browser) {
    case "Opera":
      delayOffset = 1.5;
      break;
    case "Chrome":
      delayOffset = 1.9;
      showBrowserRecommendation();
      break;
    case "Firefox":
      delayOffset = 1.7;
      showBrowserRecommendation();
      break;
    default:
      delayOffset = 2.0;
      showBrowserRecommendation();
      alert("couldnt detect what browser you're using...");
  }
}

let lastSpikeTime = 0;
let spikeIntervals = [];
let energyHistory = [];
let recentNoteTimes = [];

async function fetchAlbumArtFromFilename(filename) {
  const name = filename.replace(/^Songs\//, "").replace(/\.mp3$/i, "");

  const dashIndex = name.indexOf("-");
  const rawArtist = name.slice(0, dashIndex);
  const rawTitle = name.slice(dashIndex + 1);
  const artist = rawArtist.replace(/[_]/g, " ").trim();
  const title = rawTitle.replace(/[_]/g, " ").trim();

  try {
    const query = encodeURIComponent(`artist:"${artist}" AND release:"${title}"`);
    const res = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json`);
  
    const data = await res.json();
    const release = data.recordings?.[0]?.releases?.[0];
    const mbid = release?.id;


    if (mbid) {
      document.getElementById("albumArt").src = `https://coverartarchive.org/release/${mbid}/front`;
    } else {
      document.getElementById("albumArt").src = "Assets/Images/default-cover.png";
    }

    // Also update "Now Playing"
    document.getElementById("nowPlaying").textContent = `Song: ${title} — ${artist}`;
  } catch (err) {
    console.error("Album fetch failed:", err);
    document.getElementById("albumArt").src = "Assets/Images/default-cover.png";
  }
}

function isMobile1() {
  return /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
}

function goFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;

  if (request) {
    try {
      request.call(el);
    } catch (err) {
      console.warn("Fullscreen API call was rejected:", err);
    }
  }
}

function startGame() {
  resetAudio();
  const track = document.getElementById("songPicker").value;
  const playerAudio = document.getElementById("playerAudio");
  const analysisAudio = document.getElementById("analysisAudio");
  analysisAudio.crossOrigin = "anonymous"; // especially if hosted on GitHub Pages
  analysisAudio.muted = false;             // ensure it's not hard-muted
  analysisAudio.volume = 0.3;                // silence it without breaking the audio graph
  analysisAudio.playbackRate = 1.000;


  function updateProgressBar() {
    if (isGameOver || playerAudio.ended) return;
    const pct = (playerAudio.currentTime / playerAudio.duration) * 100;
    document.getElementById("progressBar").style.width = pct + "%";
    requestAnimationFrame(updateProgressBar);
  }

  function updateTimeDisplay() {
    if (isGameOver || playerAudio.ended) return;
  
    const current = playerAudio.currentTime;
    const total = playerAudio.duration;
  
    document.getElementById("elapsedTime").textContent = formatTime(current);
    document.getElementById("totalTime").textContent = formatTime(total);
  
    requestAnimationFrame(updateTimeDisplay);
  }
  

  // Load song into both elements
  playerAudio.src = track;
  analysisAudio.src = track;

  // Start game UI
  document.getElementById("menu").style.display = "none";
  document.getElementById("gameUI").style.display = "block";
  if (isMobile1()) {
    setMobileControlsVisible(true);
    document.getElementById("nowPlayingContainer").style.display = "none";
  } else {
    setMobileControlsVisible(false);
    fetchAlbumArtFromFilename(track);
    fetchAlbumArtFromFilename(track);
  }


  // Setup Web Audio API
  context = new (window.AudioContext || window.webkitAudioContext)();
  const gainNode = context.createGain();
  gainNode.gain.value = 0;
  source = context.createMediaElementSource(analysisAudio);
  analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.85;
  dataArray = new Float32Array(analyser.frequencyBinCount);
  source.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(context.destination);

  analysisAudio.play();
  requestAnimationFrame(detectBeats);

  // Delay analysis track
  setTimeout(() => {
    playerAudio.play();
    context.resume();
    updateProgressBar();
    updateTimeDisplay();
    goFullscreen();
    playerAudio.onended = () => {
      if (isGameOver) return;
    
      isGameOver = true;
      document.getElementById("gameUI").style.display = "none";
      document.getElementById("winScreen").style.display = "block";
      document.getElementById("finalScore").textContent = score;
    
      const track = document.getElementById("songPicker").value;
      const key = "bestScore_" + track;
      const prev = parseInt(localStorage.getItem(key)) || 0;
      if (score > prev) {
        localStorage.setItem(key, score);
        populateSongPickerFromList()
      }
    };
  }, delayOffset * 1000);

  document.addEventListener('keydown', handleKeyDown);
  document.querySelectorAll(".laneButton").forEach(btn => {
    const handleTap = e => {
      e.preventDefault();
      const lane = parseInt(btn.dataset.lane);
      checkHit(lane);
    };

    btn.addEventListener("touchstart", handleTap);
    btn.addEventListener("click", handleTap);
  });
}

function setMobileControlsVisible(visible) {
  const el = document.getElementById("mobileControls");
  el.style.display = visible ? "flex" : "none";
}


function formatTime(seconds) {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ":" + (secs < 10 ? "0" : "") + secs;
}

function detectBeats() {
  analyser.getFloatFrequencyData(dataArray);
  const now = analysisAudio.currentTime;
  const sampleRate = context.sampleRate;
  const fftSize = analyser.fftSize;

  // Band energy functions
  const getBandEnergy = (fromHz, toHz) => {
    const binSize = sampleRate / fftSize;
    const start = Math.floor(fromHz / binSize);
    const end = Math.min(dataArray.length - 1, Math.floor(toHz / binSize));
    let sum = 0;
    for (let i = start; i <= end; i++) {
      sum += Math.pow(10, dataArray[i] / 10);
    }
    return sum / (end - start + 1);
  };

  // Sub-band energies
  const bass = getBandEnergy(20, 250);
  const mids = getBandEnergy(250, 2000);
  const highs = getBandEnergy(2000, 6000);

  // Store histories
  if (!window.bandHistory) {
    window.bandHistory = { bass: [], mids: [], highs: [] };
  }
  const bh = window.bandHistory;
  bh.bass.push(bass); if (bh.bass.length > 30) bh.bass.shift();
  bh.mids.push(mids); if (bh.mids.length > 30) bh.mids.shift();
  bh.highs.push(highs); if (bh.highs.length > 30) bh.highs.shift();

  // Average energies
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const spikeBass = bass > avg(bh.bass) * 1.25;
  const spikeMids = mids > avg(bh.mids) * 1.2;
  const spikeHighs = highs > avg(bh.highs) * 1.15;

  // Tempo-aware limiter
  const interval = now - lastSpikeTime;
  if (interval > 0.3 && interval < 2.0) {
    spikeIntervals.push(interval);
    if (spikeIntervals.length > 10) spikeIntervals.shift();
  }

  const avgInterval = spikeIntervals.length
    ? spikeIntervals.reduce((a, b) => a + b, 0) / spikeIntervals.length
    : 0.6;

  recentNoteTimes = recentNoteTimes.filter(t => now - t < 1.0);
  const canSpawn = now - lastSpawnTime > avgInterval * 0.85 && recentNoteTimes.length < 4;

  if (canSpawn && (spikeBass || spikeMids || spikeHighs)) {
    const lane = spikeBass ? 0 : spikeMids ? 1 : 2;
    const playerTime = document.getElementById("playerAudio").currentTime;
    const targetTime = playerTime + noteFallTime;

    spawnNote(lane, targetTime);
    lastSpawnTime = now;
    recentNoteTimes.push(now);
    lastSpikeTime = now;
  }

  if (!analysisAudio.paused && !analysisAudio.ended && !isGameOver) {
    requestAnimationFrame(detectBeats);
  }
}

function getTotalEnergy(freqData) {
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) {
    sum += Math.pow(10, freqData[i] / 10);
  }
  return sum / freqData.length;
}

function spawnNote(lane, targetTime) {
  const note = document.createElement("div");
  note.classList.add("note");
  note.dataset.hit = "false";

  const playerTime = document.getElementById("playerAudio").currentTime;
  const travel = Math.max(0.5, targetTime - playerTime);
  note.style.animation = `drop ${travel}s linear`;
  lanes[lane].appendChild(note);

  setTimeout(() => {
    if (note.dataset.hit === "false") {
      note.remove();
      rockMeter -= 10;
      updateUI();
      showJudgment("Miss");
      checkGameOver();
    }
  }, travel * 1000);
}

function handleKeyDown(e) {
  const index = keys.indexOf(e.key.toUpperCase());
  if (index !== -1) checkHit(index);
}

function checkHit(lane) {
  if (isGameOver) return;

  const hitbox = lanes[lane].querySelector(".hitbox");
  const notes = Array.from(lanes[lane].querySelectorAll(".note"));
  const timing = { perfect: 25, good: 60 };

  const target = notes.find(note => {
    const y = note.getBoundingClientRect().top;
    const hitY = hitbox.getBoundingClientRect().top;
    return Math.abs(y - hitY) < timing.good && note.dataset.hit !== "true";
  });

  if (!target) {
    rockMeter -= 8;
    showJudgment("Miss");
    updateUI();
    checkGameOver();
    return;
  }

  const delta = Math.abs(target.getBoundingClientRect().top - hitbox.getBoundingClientRect().top);
  target.dataset.hit = "true";
  target.remove();

  if (delta < timing.perfect) {
    score += 150;
    rockMeter = Math.min(100, rockMeter + 5);
    showJudgment("Perfect");
  } else {
    score += 100;
    rockMeter = Math.min(100, rockMeter + 3);
    showJudgment("Good");
  }

  updateUI();
  checkGameOver();
}

function updateUI() {
  document.getElementById("score").textContent = "Score: " + score;
  document.getElementById("rockMeterBar").style.height = Math.max(0, rockMeter) + "%";
}

function checkGameOver() {
  const playerAudio = document.getElementById("playerAudio");
  const track = document.getElementById("songPicker").value;

  if (rockMeter <= 0 && !isGameOver) {
    isGameOver = true;
    playerAudio.pause();
    showJudgment("GAME OVER");
    alert("GAME OVER! You lost the crowd!");
    location.reload();
  }

  if (!isGameOver && playerAudio.ended) {
    isGameOver = true;
    document.getElementById("gameUI").style.display = "none";
    document.getElementById("winScreen").style.display = "block";
    document.getElementById("finalScore").textContent = score;

    const key = "bestScore_" + track;
    const prev = parseInt(localStorage.getItem(key)) || 0;
    if (score > prev) {
      localStorage.setItem(key, score);
      updateSongPickerLabels();
    }
  }
}

function showJudgment(text) {
  const popup = document.createElement("div");
  popup.textContent = text;
  popup.className = "judgment";
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 800);
}

async function populateSongPickerFromList() {
  const picker = document.getElementById("songPicker");
  picker.innerHTML = "";

  try {
    const res = await fetch("Assets/list.json");
    const songs = await res.json();

    // Rebuild list with { title, artist, filename, best } structure
    const parsedSongs = songs.map(file => {
      const name = file.replace(/^Songs\//, "").replace(/\.mp3$/i, "");
      const dashIndex = name.indexOf("-");
      const rawArtist = name.slice(0, dashIndex);
      const rawTitle = name.slice(dashIndex + 1);

      const artist = rawArtist.replace(/[_]/g, " ").trim();
      const title = rawTitle.replace(/[_]/g, " ").trim();
      const key = `bestScore_Songs/${file}`;
      const best = localStorage.getItem(key) || 0;

      return { file, artist, title, best };
    });

    // Sort alphabetically by title
    parsedSongs.sort((a, b) => a.title.localeCompare(b.title));

    let currentGroup = "";
    parsedSongs.forEach(song => {
      const groupLetter = song.title[0].toUpperCase();

      if (groupLetter !== currentGroup) {
        currentGroup = groupLetter;
        const optGroup = document.createElement("optgroup");
        optGroup.label = currentGroup;
        picker.appendChild(optGroup);
      }

      const label = `${song.title} - ${song.artist}`;
      const option = document.createElement("option");
      option.value = `Songs/${song.file}`;
      option.textContent = `${label} (Best: ${song.best})`;

      // Append to last optgroup
      picker.lastChild.appendChild(option);
    });
  } catch (err) {
    console.error("Couldn't load song list:", err);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  populateSongPickerFromList();
});

function resetAudio() {
  const playerAudio = document.getElementById("playerAudio");
  const analysisAudio = document.getElementById("analysisAudio");

  // Stop both audios safely
  playerAudio.pause();
  playerAudio.currentTime = 0;
  analysisAudio.pause();
  analysisAudio.currentTime = 0;

  // Optional: cancel any previous game loops or timeouts
  isGameOver = false;
  lastSpawnTime = 0;
  energyHistory = [];
  spikeIntervals = [];
  recentNoteTimes = [];

  // Remove existing notes from screen
  document.querySelectorAll(".note").forEach(n => n.remove());
}
