<template>
  <div class="phase-bar" :class="[voice.phase, { ticking: voice.timerActive }]">
    <span class="phase">
      <font-awesome-icon :icon="icon" />
      {{ label }}
    </span>
    <span class="timer" v-if="voice.timerActive" :class="{ low: seconds <= 30 }">
      <font-awesome-icon icon="clock" />
      {{ clock }}
    </span>
  </div>
</template>

<script>
import voice from "../voice";

export default {
  data() {
    return { voice: voice.state, now: Date.now(), timer: null };
  },
  computed: {
    icon() {
      return this.voice.phase === "night"
        ? "moon"
        : this.voice.phase === "dusk"
        ? "cloud-sun"
        : "sun";
    },
    label() {
      return this.voice.phase === "night"
        ? "Night"
        : this.voice.phase === "dusk"
        ? "Dusk"
        : "Day";
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
  mounted() {
    this.timer = setInterval(() => (this.now = Date.now()), 250);
  },
  beforeDestroy() {
    clearInterval(this.timer);
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

  &.day .phase svg {
    color: #ffd000;
  }
  &.dusk .phase svg {
    color: #ff9a3d;
  }
  &.night .phase svg {
    color: #8fb4ff;
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
}
</style>
