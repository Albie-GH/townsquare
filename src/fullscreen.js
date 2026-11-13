// Fullscreen for the whole town, like the fullscreen button on a video: hides the
// browser bars and, on phones, turns the screen sideways. Browsers that can't do it
// (iPhone Safari only allows videos to go fullscreen) don't get the button.
import Vue from "vue";

const doc = document;
const root = doc.documentElement;

const requestFn = root.requestFullscreen || root.webkitRequestFullscreen;
const exitFn = doc.exitFullscreen || doc.webkitExitFullscreen;
const current = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;

export const fullscreen = Vue.observable({
  supported: !!(requestFn && exitFn) && doc.fullscreenEnabled !== false,
  active: !!current()
});

const update = () => {
  fullscreen.active = !!current();
};
doc.addEventListener("fullscreenchange", update);
doc.addEventListener("webkitfullscreenchange", update);

// phones and tablets: landscape, like a video (desktops ignore or refuse it)
const isTouch = () =>
  window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

async function lockLandscape() {
  if (!isTouch()) return;
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch (e) {
    // not allowed here (or already landscape-only), stay as it is
  }
}

function unlockOrientation() {
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch (e) {
    // nothing locked
  }
}

// must be called straight from a click / tap
export async function toggleFullscreen() {
  if (!fullscreen.supported) return;
  try {
    if (current()) {
      unlockOrientation();
      await exitFn.call(doc);
    } else {
      // navigationUI "hide": no browser bars on Android, as with a video
      const result = requestFn.call(root, { navigationUI: "hide" });
      if (result && result.then) await result;
      await lockLandscape();
    }
  } catch (e) {
    // the browser said no (e.g. not from a tap), nothing to undo
  }
  update();
}
