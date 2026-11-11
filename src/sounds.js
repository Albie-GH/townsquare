// Short sound effects for chats, deaths and the day bell.
import enter from "./assets/sounds/enter.mp3";
import leave from "./assets/sounds/leave.mp3";
import call from "./assets/sounds/call.mp3";
import bell from "./assets/sounds/bell.mp3";
import death from "./assets/sounds/piano-dark.mp3";

const SOUNDS = { enter, leave, call, bell, death };

export function playSound(name, volume = 0.5) {
  const src = SOUNDS[name];
  if (!src) return;
  try {
    const audio = new Audio(src);
    audio.volume = volume;
    audio.play().catch(() => {}); // blocked until the page has had a click
  } catch (e) {
    // no audio support, skip the sound
  }
}
