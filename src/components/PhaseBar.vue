<template>
  <div
    class="phase-bar"
    :class="[
      voice.phase,
      { ticking: voice.timerActive, editable: canEdit, open: isMenuOpen }
    ]"
    :title="canEdit ? 'Set the phase or start a chat timer' : ''"
    @click="toggleMenu"
  >
    <span class="phase">
      <font-awesome-icon :icon="icon" />
      {{ label }}
    </span>
    <span class="timer" v-if="voice.timerActive" :class="{ low: seconds <= 30 }">
      <font-awesome-icon icon="clock" />
      {{ clock }}
    </span>
    <!-- Storyteller only: phase and chat timer -->
    <transition name="fold">
      <ul class="phase-menu" v-if="isMenuOpen && canEdit" @click.stop>
        <li class="headline">Set phase</li>
        <li
          v-for="p in phases"
          :key="p.id"
          :class="{ current: voice.phase === p.id }"
          @click="setPhase(p.id)"
        >
          <font-awesome-icon :icon="p.icon" />{{ p.label }}
          <em v-if="voice.phase === p.id">(current)</em>
        </li>
        <li class="headline">Chat timer</li>
        <li v-if="voice.timerActive" @click="stopTimer">
          <font-awesome-icon icon="clock" />Stop chat timer
        </li>
        <li
          v-else
          @click="startTimer"
          :class="{ disabled: voice.phase !== 'day' || !voice.joined }"
        >
          <font-awesome-icon icon="clock" />Start chat timer
        </li>
      </ul>
    </transition>
  </div>
</template>

<script>
import { mapState } from "vuex";
import voice from "../voice";

export default {
  data() {
    return {
      voice: voice.state,
      now: Date.now(),
      timer: null,
      isMenuOpen: false,
      phases: [
        { id: "day", label: "Day", icon: "sun" },
        { id: "dusk", label: "Dusk", icon: "cloud-sun" },
        { id: "night", label: "Night", icon: "moon" },
        { id: "end", label: "End of Game", icon: "flag-checkered" }
      ]
    };
  },
  computed: {
    ...mapState(["session"]),
    // only the Storyteller can change the phase or run the chat timer
    canEdit() {
      return !this.session.isSpectator;
    },
    current() {
      return this.phases.find(p => p.id === this.voice.phase) || this.phases[0];
    },
    icon() {
      return this.current.icon;
    },
    label() {
      return this.current.label;
    },
    seconds() {
      return Math.max(0, Math.ceil((this.voice.timerEnd - this.now) / 1000));
    },
    clock() {
      const m = Math.floor(this.seconds / 60);
      const s = this.seconds % 60;
      return `${m}:${s < 10 ? "0" : ""}${s}`;
    }
  },
  methods: {
    toggleMenu() {
      if (this.canEdit) this.isMenuOpen = !this.isMenuOpen;
    },
    onDocClick(event) {
      if (this.isMenuOpen && !this.$el.contains(event.target)) {
        this.isMenuOpen = false;
      }
    },
    // Switches the shared phase, and the grimoire's night flag to match
    setPhase(phase) {
      this.isMenuOpen = false;
      voice.setPhase(phase);
      // leaving the End of Game: turn every revealed role back over
      if (phase !== "end") {
        this.$store.state.players.players.forEach(player => {
          if (player.revealed) {
            this.$store.commit("players/update", {
              player,
              property: "revealed",
              value: ""
            });
          }
        });
      }
      const night = phase === "night";
      if (!!this.$store.state.grimoire.isNight !== night) {
        this.$store.commit("toggleNight", night);
        if (night) this.$store.commit("session/setMarkedPlayer", -1);
      }
    },
    startTimer() {
      if (this.voice.phase !== "day" || !this.voice.joined) return;
      this.isMenuOpen = false;
      const input = prompt("Chat timer length in minutes", "5");
      const minutes = parseFloat(input);
      if (minutes > 0) voice.startTimer(minutes * 60);
    },
    stopTimer() {
      this.isMenuOpen = false;
      voice.stopTimer();
    }
  },
  mounted() {
    this.timer = setInterval(() => (this.now = Date.now()), 250);
    document.addEventListener("click", this.onDocClick);
  },
  beforeDestroy() {
    clearInterval(this.timer);
    document.removeEventListener("click", this.onDocClick);
  }
};
</script>

<style scoped lang="scss">
.phase-bar {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 4px 18px;
  font-size: 130%;
  line-height: 130%;
  background: rgba(0, 0, 0, 0.5);
  border: 3px solid black;
  border-radius: 10px;
  box-shadow: 0 0 8px black;
  pointer-events: none;
  white-space: nowrap;

  // only the Storyteller can click the bar
  &.editable {
    pointer-events: auto;
    cursor: pointer;
    &:hover,
    &.open {
      box-shadow: 0 0 8px red;
    }
  }

  &.day .phase svg {
    color: #ffd000;
  }
  &.dusk .phase svg {
    color: #ff9a3d;
  }
  &.night .phase svg {
    color: #8fb4ff;
  }
  &.end .phase svg {
    color: #e0e0e0;
  }
  .timer {
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    &.low {
      color: #ff6b6b;
    }
  }
  svg {
    margin-right: 4px;
  }

  .phase-menu {
    position: absolute;
    left: 0;
    top: 100%;
    margin: 6px 0 0;
    padding: 2px 8px;
    list-style: none;
    text-align: left;
    font-size: 75%;
    line-height: 140%;
    background: rgba(0, 0, 0, 0.85);
    border: 3px solid #000;
    border-radius: 10px;
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
    cursor: default;

    li {
      cursor: pointer;
      &:hover {
        color: red;
      }
      &.headline {
        cursor: default;
        text-align: center;
        opacity: 0.7;
        font-size: 85%;
        &:hover {
          color: inherit;
        }
      }
      &.current {
        color: #3ddc84;
      }
      &.disabled {
        cursor: not-allowed;
        opacity: 0.5;
        &:hover {
          color: inherit;
        }
      }
    }
  }
}
</style>
