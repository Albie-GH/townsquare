// Short sound effects for chats, deaths and the day bell, plus the wake-up music.
import Vue from "vue";
import enter from "./assets/sounds/enter.mp3";
import leave from "./assets/sounds/leave.mp3";
import call from "./assets/sounds/call.mp3";
import bell from "./assets/sounds/bell.mp3";
import death from "./assets/sounds/piano-dark.mp3";
import keepAnEye from "./assets/sounds/keep-an-eye.mp3";
import subTwin from "./assets/sounds/sub-twin.mp3";
import ancientSpells from "./assets/sounds/ancient-spells.mp3";

const SOUNDS = { enter, leave, call, bell, death };

// ---- SFX and music volume (0-100% each), set in the settings, saved in this browser.
// "Mute Sounds" silences both (voices are never affected). ----
const SFX_KEY = "botcSfxVolume";
const MUSIC_KEY = "botcMusicVolume";
function loadPercent(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? 100 : Math.max(0, Math.min(100, parseInt(saved, 10) || 0));
  } catch (e) {
    return 100;
  }
}
export const sfx = Vue.observable({ volume: loadPercent(SFX_KEY) });
export const musicVolume = Vue.observable({ volume: loadPercent(MUSIC_KEY) });
const soundState = { muted: false }; // "Mute Sounds" in the settings

// "Mute Night Music" in the settings: just the night music, saved in this browser
const NIGHT_MUTE_KEY = "botcMuteNightMusic";
function loadNightMuted() {
  try {
    return localStorage.getItem(NIGHT_MUTE_KEY) === "1";
  } catch (e) {
    return false;
  }
}
export const musicPrefs = Vue.observable({ nightMuted: loadNightMuted() });

export function setNightMusicMuted(on) {
  musicPrefs.nightMuted = !!on;
  try {
    localStorage.setItem(NIGHT_MUTE_KEY, musicPrefs.nightMuted ? "1" : "0");
  } catch (e) {
    // storage unavailable, the setting just won't be remembered
  }
  applyLevels();
}

// other tabs of the town in this browser follow the sliders too (they hear the
// same bells and deaths, so they'd otherwise play them at the old volume)
try {
  window.addEventListener("storage", event => {
    if (event.key === SFX_KEY) sfx.volume = loadPercent(SFX_KEY);
    else if (event.key === MUSIC_KEY) musicVolume.volume = loadPercent(MUSIC_KEY);
    else return;
    applyLevels();
  });
} catch (e) {
  // no window (or storage events), each tab keeps its own volume
}

function savePercent(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    // storage unavailable, the volume just won't be remembered
  }
}

export function setSfxVolume(percent) {
  sfx.volume = Math.max(0, Math.min(100, Math.round(percent) || 0));
  savePercent(SFX_KEY, sfx.volume);
  applyLevels();
}

export function setMusicVolume(percent) {
  musicVolume.volume = Math.max(0, Math.min(100, Math.round(percent) || 0));
  savePercent(MUSIC_KEY, musicVolume.volume);
  applyLevels();
}

// "Mute Sounds": every sound effect and all music go silent (voices carry on)
export function setSoundsMuted(on) {
  soundState.muted = !!on;
  applyLevels();
}

// sounds still playing (a long bell, the death piano, the music) follow the sliders live
const playing = new Set();
function applyLevels() {
  for (const audio of playing) audio.volume = scaled(audio._base);
  if (musicAudio && !musicAudio._fading) musicAudio.volume = musicLevel();
  applyNominationVolume();
}

// Ears hear loudness on a log scale, so a straight percentage barely sounds quieter
// until the very bottom. The sliders run over 26 dB instead: 100% is full,
// 75% is -6.5 dB, 50% is -13 dB, 25% is -19.5 dB, 0% is silent.
const SFX_RANGE_DB = 26;
function gainFor(percent) {
  if (soundState.muted || percent <= 0) return 0;
  return Math.pow(10, (((percent - 100) / 100) * SFX_RANGE_DB) / 20);
}
export function sfxGain() {
  return gainFor(sfx.volume);
}
export function musicGain() {
  return gainFor(musicVolume.volume);
}
const scaled = volume => Math.max(0, Math.min(1, volume * sfxGain()));
const scaledMusic = volume => Math.max(0, Math.min(1, volume * musicGain()));
// how loud each sound plays (0-1); anything not listed plays at 0.3
const VOLUMES = { death: 0.45 };

export function playSound(name, volume) {
  const src = SOUNDS[name];
  if (!src) return;
  if (volume === undefined) volume = VOLUMES[name] || 0.3;
  // a death ends the wake-up (and nomination) music, even if you can't hear either;
  // the night music plays on through deaths in the night
  if (name === "death" && music.track !== "night") stopMusic();
  if (soundState.muted) return;
  try {
    const audio = new Audio(src);
    audio._base = volume;
    audio.volume = scaled(volume);
    playing.add(audio);
    const done = () => playing.delete(audio);
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    audio.play().catch(done); // blocked until the page has had a click
  } catch (e) {
    // no audio support, skip the sound
  }
}

// ---- wake-up music: loops from daybreak until someone is marked dead ----
// track: "wake" (keep-an-eye, from daybreak), "nomination" (sub-twin, at dusk)
// or "night" (ancient-spells, once everyone is muted at night)
export const music = Vue.observable({ playing: false, track: "" });
let musicAudio = null;
let musicBase = 0; // the music's own volume, before the SFX slider
const musicLevel = () => scaledMusic(musicBase);
const FADE_IN_MS = 500;
const FADE_OUT_MS = 2000;

// Moves one audio element's volume to a target over a time, then calls done.
// Each element has one fade at a time; a new fade replaces the old one.
function fade(audio, to, ms, done) {
  clearInterval(audio._fade);
  const from = audio.volume;
  const start = Date.now();
  audio._fading = true;
  audio._fade = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / ms);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t >= 1) {
      clearInterval(audio._fade);
      audio._fading = false;
      if (done) done();
    }
  }, 30);
}

export function startMusic(volume = 0.05) {
  stopMusic();
  try {
    const audio = new Audio(keepAnEye);
    audio.loop = true;
    audio.volume = 0;
    audio.play().catch(() => {}); // blocked until the page has had a click
    musicBase = volume;
    fade(audio, musicLevel(), FADE_IN_MS);
    musicAudio = audio;
    music.playing = true;
    music.track = "wake";
  } catch (e) {
    // no audio support, skip the music
  }
}

// fades out over 2 seconds (from wherever it is, even mid fade-in), then stops
export function stopMusic() {
  stopLoopedTrack();
  const audio = musicAudio;
  musicAudio = null;
  music.playing = false;
  music.track = "";
  if (!audio) return;
  fade(audio, 0, FADE_OUT_MS, () => {
    audio.pause();
    audio.src = "";
  });
}

// ---- looped tracks: nomination music (dusk) and night music ----
// Played through Web Audio so every repeat can be scheduled exactly: a new play
// starts every loop length, on the dot, while the previous one rings out underneath.
const TRACKS = {
  // started by a Storyteller at dusk, a new play every 2 minutes
  nomination: { src: subTwin, loopS: 120, volume: 0.05, fadeInMs: 500 },
  // 5 seconds into the night (when everyone is muted), a new play every 1:57
  night: { src: ancientSpells, loopS: 117, volume: 0.05, fadeInMs: 100 }
};
let audioCtx = null;
const buffers = {}; // decoded tracks, loaded the first time each is played
let looped = null; // { name, gain, sources, timer, fading } while one plays
let loopToken = 0; // bumped on every start / stop, so a slow load can bail out

async function loadTrack(name) {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (!buffers[name]) {
    const response = await fetch(TRACKS[name].src);
    const data = await response.arrayBuffer();
    buffers[name] = await new Promise((resolve, reject) =>
      audioCtx.decodeAudioData(data, resolve, reject)
    );
  }
}

// plays one copy at an exact time, and books the next one a loop length later
function scheduleLoop(at) {
  const n = looped;
  if (!n) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffers[n.name];
  source.connect(n.gain);
  source.start(at);
  n.sources.push(source);
  source.onended = () => {
    n.sources = n.sources.filter(s => s !== source);
  };
  // as soon as this copy starts, book the next one: the browser always holds the
  // exact start time a whole loop ahead, so slow timers in a background tab don't matter
  const next = at + TRACKS[n.name].loopS;
  const wait = Math.max(0, (at - audioCtx.currentTime) * 1000);
  n.timer = setTimeout(() => scheduleLoop(next), wait);
}

async function startLoopedTrack(name) {
  stopMusic();
  const token = ++loopToken;
  try {
    await loadTrack(name);
  } catch (e) {
    return; // no Web Audio or the file failed to load, skip the music
  }
  if (token !== loopToken) return; // stopped (or restarted) while loading
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  const track = TRACKS[name];
  const gain = audioCtx.createGain();
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(
    trackLevel(name),
    now + track.fadeInMs / 1000
  );
  looped = { name, gain, sources: [], timer: null, fading: false };
  scheduleLoop(now + 0.05);
  music.playing = true;
  music.track = name;
}

export function startNominationMusic() {
  return startLoopedTrack("nomination");
}

export function startNightMusic() {
  return startLoopedTrack("night");
}

// fades out over 2 seconds, then stops every copy still playing
function stopLoopedTrack() {
  loopToken++;
  const n = looped;
  looped = null;
  if (!n) return;
  clearTimeout(n.timer);
  n.fading = true;
  const now = audioCtx.currentTime;
  const g = n.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + FADE_OUT_MS / 1000);
  setTimeout(() => {
    n.sources.forEach(s => {
      try {
        s.stop();
      } catch (e) {
        // already stopped
      }
    });
    n.gain.disconnect();
  }, FADE_OUT_MS + 50);
}

// the music slider (and Mute Sounds) move a looped track too, unless it's fading
function applyNominationVolume() {
  const n = looped;
  if (!n || n.fading || !audioCtx) return;
  n.gain.gain.setTargetAtTime(trackLevel(n.name), audioCtx.currentTime, 0.05);
}

// a looped track's volume: the music slider, Mute Sounds and (for the night
// music) Mute Night Music
function trackLevel(name) {
  if (name === "night" && musicPrefs.nightMuted) return 0;
  return scaledMusic(TRACKS[name].volume);
}
