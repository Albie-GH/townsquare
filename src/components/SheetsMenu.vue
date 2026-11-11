<template>
  <!-- Bottom right: quick links to the reference sheets and your notepad -->
  <ul class="sheets-menu">
    <li @click="toggleModal('reference')" :class="{ active: modals.reference }">
      <font-awesome-icon icon="book-open" />
      <span>Reference Sheet</span>
      <em>[R]</em>
    </li>
    <li
      @click="toggleModal('nightOrder')"
      :class="{ active: modals.nightOrder }"
    >
      <font-awesome-icon icon="moon" />
      <span>Night Order Sheet</span>
      <em>[N]</em>
    </li>
    <li @click="toggleModal('notepad')" :class="{ active: modals.notepad }">
      <font-awesome-icon icon="sticky-note" />
      <span>Notepad</span>
      <em>[P]</em>
    </li>
    <!-- your mic wherever you are: your private chat, or the Town Square -->
    <li
      v-if="voice.joined"
      @click="toggleMic"
      :class="{ active: !voice.micOn }"
      :title="voice.micLocked ? 'Muted by the Storyteller' : ''"
    >
      <font-awesome-icon
        :icon="voice.micOn ? 'microphone' : 'microphone-slash'"
      />
      <span>{{ voice.micOn ? "Mute" : "Unmute" }}</span>
      <em>[M]</em>
    </li>
  </ul>
</template>

<script>
import { mapMutations, mapState } from "vuex";
import voice from "../voice";

export default {
  data() {
    return { voice: voice.state };
  },
  computed: {
    ...mapState(["modals"])
  },
  methods: {
    ...mapMutations(["toggleModal"]),
    toggleMic() {
      voice.toggleMic();
    }
  }
};
</script>

<style scoped lang="scss">
.sheets-menu {
  position: absolute;
  right: 10px;
  bottom: 28px; // clear of the version number
  z-index: 50;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
  border: 3px solid black;
  border-radius: 10px;
  box-shadow: 0 0 10px black;

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 2px 10px;
    background: rgba(0, 0, 0, 0.7);
    cursor: pointer;
    white-space: nowrap;

    & + li {
      border-top: 1px solid rgba(255, 255, 255, 0.15);
    }
    &:hover,
    &.active {
      color: red;
    }
    svg {
      width: 18px;
    }
    span {
      flex-grow: 1;
    }
    em {
      font-style: normal;
      opacity: 0.6;
      font-size: 85%;
    }
  }
}
</style>
