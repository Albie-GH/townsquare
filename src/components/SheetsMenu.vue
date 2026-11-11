<template>
  <div class="bottom-right">
    <!-- where your voice is being heard right now, and your mute button -->
    <ul class="panel mic-status" v-if="voice.joined">
      <li class="status" :class="{ off: !townHeard }" :title="townTitle">
        <font-awesome-icon :icon="townHeard ? 'microphone' : 'microphone-slash'" />
        <span>Town</span>
      </li>
      <li
        class="status"
        v-if="myChat"
        :class="{ off: !roomHeard }"
        :title="roomHeard ? 'Heard in this chat' : 'Muted in this chat'"
      >
        <font-awesome-icon :icon="roomHeard ? 'microphone' : 'microphone-slash'" />
        <span>{{ roomName }}</span>
      </li>
      <li
        class="status"
        v-if="showLine"
        :class="{ off: !lineHeard }"
        :title="lineHeard ? 'Heard on the Storytellers’ line' : 'Off on the Storytellers’ line'"
      >
        <font-awesome-icon :icon="lineHeard ? 'microphone' : 'microphone-slash'" />
        <span>Storyteller line</span>
      </li>
      <!-- your mic wherever you are: your private chat, or the Town Square -->
      <li
        class="button"
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
    <!-- quick links to the reference sheets and your notepad -->
    <ul class="panel sheets-menu">
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
        <em>[O]</em>
      </li>
      <li @click="toggleModal('notepad')" :class="{ active: modals.notepad }">
        <font-awesome-icon icon="sticky-note" />
        <span>Notepad</span>
        <em>[N]</em>
      </li>
    </ul>
  </div>
</template>

<script>
import { mapMutations, mapState } from "vuex";
import voice from "../voice";

export default {
  data() {
    return { voice: voice.state };
  },
  computed: {
    ...mapState(["modals", "session"]),
    me() {
      return this.session.playerId;
    },
    myChat() {
      return voice.chatOf(this.me);
    },
    // the Town Square hears you only while you are not in a private chat
    townHeard() {
      return !this.myChat && this.voice.tsMicOn;
    },
    townTitle() {
      if (this.myChat) return "Not heard in town while you're in a private chat";
      return this.townHeard ? "Heard in town" : "Muted in town";
    },
    roomHeard() {
      return !!this.myChat && this.voice.micOn;
    },
    roomName() {
      const chat = this.myChat;
      if (!chat) return "";
      if (chat.persist) return "Private Room";
      if (chat.whisper) return "Storyteller Room";
      return `Room ${chat.num}`;
    },
    // Storytellers: whether the other Storyteller hears you over your line
    showLine() {
      return this.voice.isHost && !!this.voice.cohostPlayerId;
    },
    lineHeard() {
      if (this.voice.urgent) return true;
      return (
        !this.voice.lineMuted.includes(this.me) &&
        !this.voice.lineAutoIds.includes(this.me)
      );
    }
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
.bottom-right {
  position: absolute;
  right: 10px;
  bottom: 28px; // clear of the version number
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.panel {
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

    // where you are heard: information only, not clickable
    &.status {
      cursor: default;
      min-height: 24px;
      font-size: 90%;
      &:hover {
        color: inherit;
      }
      svg {
        color: #3ddc84;
      }
      &.off {
        opacity: 0.75;
        svg {
          color: #ff6b6b;
        }
      }
    }
  }
}
</style>
