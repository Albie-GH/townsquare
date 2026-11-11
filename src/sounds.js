// Short sound effects for chats, deaths and the day bell, plus the wake-up music.
import Vue from "vue";
import enter from "./assets/sounds/enter.mp3";
import leave from "./assets/sounds/leave.mp3";
import call from "./assets/sounds/call.mp3";
import bell from "./assets/sounds/bell.mp3";
import death from "./assets/sounds/piano-dark.mp3";
import keepAnEye from "./assets/sounds/keep-an-eye.mp3";

const SOUNDS = { enter, leave, call, bell, death };

// ---- SFX volume (0-100%), set in the settings, saved in this browser ----
const SFX_KEY = "botcSfxVolume";
function loadSfx() {
  try {
    const saved = localStorage.getItem(SFX_KEY);
    return saved === null ? 100 : Math.max(0, Math.min(100, parseInt(saved, 10) || 0));
  } catch (e) {
    return 100;
  }
}
export const sfx = Vue.observable({ volume: loadSfx() });

// other tabs of the town in this browser follow the slider too (they hear the
// same bells and deaths, so they'd otherwise play them at the old volume)
try {
  window.addEventListener("storage", event => {
    if (event.key !== SFX_KEY) return;
    sfx.volume = loadSfx();
    applySfx();
  });
} catch (e) {
  // no window (or storage events), each tab keeps its own volume
}

export function setSfxVolume(percent) {
  sfx.volume = Math.max(0, Math.min(100, Math.round(percent) || 0));
  try {
    localStorage.setItem(SFX_KEY, String(sfx.volume));
  } catch (e) {
    // storage unavailable, the volume just won't be remembered
  }
  applySfx();
}

// sounds still playing (a long bell, the death piano, the music) follow the slider live
const playing = new Set();
function applySfx() {
  for (const audio of playing) audio.volume = scaled(audio._base);
  if (musicAudio && !musicAudio._fading) musicAudio.volume = musicLevel();
}

// Ears hear loudness on a log scale, so a straight percentage barely sounds quieter
// until the very bottom. The slider runs over 26 dB instead: 100% is full,
// 75% is -6.5 dB, 50% is -13 dB, 25% is -19.5 dB, 0% is silent.
const SFX_RANGE_DB = 26;
export function sfxGain() {
  const v = sfx.volume;
  if (v <= 0) return 0;
  return Math.pow(10, (((v - 100) / 100) * SFX_RANGE_DB) / 20);
}
const scaled = volume => Math.max(0, Math.min(1, volume * sfxGain()));
// how loud each sound plays (0-1); anything not listed plays at 0.3
const VOLUMES = { death: 0.45 };

export function playSound(name, volume) {
  const src = SOUNDS[name];
  if (!src) return;
  if (volume === undefined) volume = VOLUMES[name] || 0.3;
  // the wake-up music plays until someone dies
  if (name === "death") stopMusic();
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
export const music = Vue.observable({ playing: false });
let musicAudio = null;
let musicBase = 0; // the music's own volume, before the SFX slider
const musicLevel = () => scaled(musicBase);
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
  } catch (e) {
    // no audio support, skip the music
  }
}

// fades out over 2 seconds (from wherever it is, even mid fade-in), then stops
export function stopMusic() {
  const audio = musicAudio;
  musicAudio = null;
  music.playing = false;
  if (!audio) return;
  fade(audio, 0, FADE_OUT_MS, () => {
    audio.pause();
    audio.src = "";
  });
}
