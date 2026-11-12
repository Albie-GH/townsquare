<template>
  <div class="bottom-right">
    <!-- where your voice is being heard right now, and your mute button -->
    <ul class="panel mic-status" v-if="voice.joined">
      <li class="status" :class="{ off: !townHeard }">
        <font-awesome-icon :icon="townHeard ? 'microphone' : 'microphone-slash'" />
        <span>{{ voice.tsLocked ? "Town (muted by storyteller)" : "Town" }}</span>
      </li>
      <li class="status" v-if="myChat" :class="{ off: !roomHeard }">
        <font-awesome-icon :icon="roomHeard ? 'microphone' : 'microphone-slash'" />
        <span>{{
          voice.roomLocked ? roomName + " (muted by storyteller)" : roomName
        }}</span>
      </li>
      <li class="status" v-if="showLine" :class="{ off: !lineHeard }">
        <font-awesome-icon :icon="lineHeard ? 'microphone' : 'microphone-slash'" />
        <span>Storyteller line</span>
      </li>
      <!-- your mic wherever you are: your private chat, or the Town Square -->
      <li class="button" @click="toggleMic" :class="{ active: !voice.micOn }">
        <font-awesome-icon
          :icon="voice.micOn ? 'microphone' : 'microphone-slash'"
        />
        <span>{{ buttonLabel }}</span>
        <em>[M]</em>
        <div class="tip" v-if="buttonTitle">{{ buttonTitle }}</div>
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
    // muted by the Storyteller where you are right now
    locked() {
      return this.myChat ? this.voice.roomLocked : this.voice.tsLocked;
    },
    // your own choice there, which takes over once the Storyteller unmutes you
    chosenMuted() {
      return this.myChat ? !this.voice.roomMicOn : this.voice.tsSelfMuted;
    },
    buttonLabel() {
      if (this.locked) return this.chosenMuted ? "Unmute" : "Stay Muted";
      return this.voice.micOn ? "Mute" : "Unmute";
    },
    buttonTitle() {
      if (!this.locked) return "";
      return this.chosenMuted
        ? "You'll stay muted when the Storyteller unmutes you. Click to be unmuted then."
        : "You'll be unmuted when the Storyteller unmutes you. Click to stay muted.";
    },
    roomHeard() {
      return !!this.myChat && this.voice.micOn;
    },
    roomName() {
      const chat = this.myChat;
      if (!chat) return "";
      if (chat.whisper) return "Private Room";
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
  border: 3px solid black;
  border-radius: 10px;
  box-shadow: 0 0 10px black;

  // rounded ends on the rows themselves (no overflow clipping, so tips can show)
  li:first-child {
    border-top-left-radius: 7px;
    border-top-right-radius: 7px;
  }
  li:last-child {
    border-bottom-left-radius: 7px;
    border-bottom-right-radius: 7px;
  }

  li {
    position: relative;
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

    // the mute button's hover text, styled like a character's ability on its token, opening to the
    // left (the panel sits against the right edge) with its arrow pointing back
    .tip {
      position: absolute;
      right: calc(100% + 18px);
      top: 50%;
      transform: translateY(-50%);
      width: 250px;
      padding: 5px 10px;
      z-index: 25;
      font-size: 80%;
      font-weight: normal;
      color: white;
      white-space: normal;
      text-align: left;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      border: 3px solid black;
      filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5));
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ease-in-out;

      &:before {
        content: " ";
        position: absolute;
        top: 50%;
        left: 100%;
        margin-top: -10px;
        margin-left: 2px;
        width: 0;
        height: 0;
        border: 10px solid transparent;
        border-left-color: black;
      }
    }
    &:hover .tip {
      opacity: 1;
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
