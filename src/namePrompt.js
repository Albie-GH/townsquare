// "Enter player name": shown as a modal (NameModal.vue) instead of the browser's
// prompt, so asking for a name returns a promise that resolves when it's answered.
import Vue from "vue";

export const namePrompt = Vue.observable({ open: false, initial: "" });
let waiting = []; // everyone waiting for this answer

// resolves with the typed name, or null if the modal was closed without one
export function askPlayerName(initial = "") {
  return new Promise(resolve => {
    waiting.push(resolve);
    namePrompt.initial = initial;
    namePrompt.open = true;
  });
}

export function answerName(name) {
  namePrompt.open = false;
  const done = waiting;
  waiting = [];
  done.forEach(resolve => resolve(name));
}
