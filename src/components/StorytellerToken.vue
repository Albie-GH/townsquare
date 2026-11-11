<template>
  <div class="storyteller" :class="{ speaking }">
    <div
      class="st-token"
      :class="{ clickable: canRequest }"
      @click="toggleTokenMenu"
    >
      <font-awesome-icon icon="theater-masks" />
      <div class="speaking-ring"></div>
    </div>
    <div class="st-plate">
      <div
        class="st-name"
        :class="{ active: isMenuOpen, clickable: canAdjust || canRename }"
        @click="toggleMenu"
      >
        <span class="custom-name" v-if="displayName">{{ displayName }}</span>
        <span class="role-line">(Storyteller)</span>
      </div>
      <!-- the Storyteller's own mute toggle; players only see it while the Storyteller is muted -->
      <div
        class="mic-toggle"
        v-if="showMic"
        :class="{ muted: isMuted, readonly: !canRename }"
        :title="
          canRename ? (isMuted ? 'Unmute yourself' : 'Mute yourself') : 'Muted'
        "
        @click.stop="canRename && toggleMic()"
      >
        <font-awesome-icon
          :icon="isMuted ? 'microphone-slash' : 'microphone'"
        />
      </div>
    </div>
    <!-- Storyteller only: mute / unmute every player -->
    <div
      class="button st-muteall"
      v-if="canRename && voice.joined"
      :class="{ demon: voice.allMuted, townsfolk: !voice.allMuted }"
      @click="toggleMuteAll"
    >
      {{ voice.allMuted ? "Unmute all" : "Mute all" }}
    </div>
    <!-- Players: ask the Storyteller for a private chat -->
    <transition name="fold">
      <ul class="st-menu st-token-menu" v-if="isTokenMenuOpen && canRequest">
        <li @click="requestChat">
          <font-awesome-icon icon="comments" />Request chat
        </li>
      </ul>
    </transition>
    <transition name="fold">
      <ul class="st-menu" v-if="isMenuOpen && (canAdjust || canRename)">
        <li v-if="canRename" @click="setName">
          <font-awesome-icon icon="user-edit" />Set name
        </li>
        <li class="volume" v-if="canAdjust">
          <font-awesome-icon icon="volume-up" />
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            :value="volume"
            @input="setVolume"
            title="How loud the Storyteller is for you"
          />
          <span>{{ volume }}%</span>
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
      isMenuOpen: false,
      isTokenMenuOpen: false,
      voice: voice.state
    };
  },
  computed: {
    ...mapState(["session"]),
    hostId() {
      return this.voice.hostPlayerId;
    },
    // players can adjust how loud the Storyteller is for them
    canAdjust() {
      return this.voice.joined && this.session.isSpectator && !!this.hostId;
    },
    // players can ask the Storyteller for a private chat, if not already in one
    canRequest() {
      return (
        this.session.isSpectator &&
        this.voice.joined &&
        !!this.hostId &&
        !voice.chatOf(this.session.playerId)
      );
    },
    // only the Storyteller can rename and mute everyone
    canRename() {
      return !this.session.isSpectator;
    },
    isMuted() {
      // Town Square mute; private chats have their own toggle in the room list
      return !!this.hostId && this.voice.mutedIds.includes(this.hostId);
    },
    showMic() {
      return this.voice.joined && (this.canRename || this.isMuted);
    },
    // "Storyteller" is the default and means no custom name was chosen
    displayName() {
      const name = this.voice.hostName;
      return name && name !== "Storyteller" ? name : "";
    },
    speaking() {
      return !!this.hostId && this.voice.speakingIds.includes(this.hostId);
    },
    volume() {
      const v = this.voice.volumes[this.hostId];
      return v === undefined ? 100 : v;
    }
  },
  methods: {
    toggleMenu() {
      this.isTokenMenuOpen = false;
      if (this.canAdjust || this.canRename) this.isMenuOpen = !this.isMenuOpen;
    },
    requestChat() {
      this.isTokenMenuOpen = false;
      voice.requestStoryteller();
    },
    toggleTokenMenu() {
      if (!this.canRequest) return;
      this.isMenuOpen = false;
      this.isTokenMenuOpen = !this.isTokenMenuOpen;
    },
    setName() {
      this.isMenuOpen = false;
      const name = prompt(
        "Storyteller name (leave empty to reset)",
        this.displayName
      );
      if (name !== null) voice.setHostName(name);
    },
    toggleMic() {
      voice.toggleTsMic();
    },
    toggleMuteAll() {
      voice.setAllMuted(!this.voice.allMuted);
    },
    setVolume(event) {
      voice.setVolume(this.hostId, parseInt(event.target.value, 10));
    }
  }
};
</script>

<style scoped lang="scss">
@import "../vars.scss";

.storyteller {
  position: absolute;
  top: 20px;
  left: 20px;
  width: 11vh;
  z-index: 49;

  // the token itself is display only, nobody can click it
  .st-token {
    width: 100%;
    border-radius: 50%;
    border: 3px solid black;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    background: url("../assets/token.png") center center;
    background-size: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    cursor: default;
    &.clickable {
      pointer-events: auto;
      cursor: pointer;
      &:hover {
        filter: brightness(1.2);
      }
    }
    color: black;
    font-size: 4.5vh;
    &:before {
      content: " ";
      display: block;
      padding-top: 100%;
    }
    svg {
      position: absolute;
    }
  }

  .speaking-ring {
    position: absolute;
    top: -4px;
    left: -4px;
    width: calc(100% + 8px);
    aspect-ratio: 1 / 1;
    box-sizing: border-box;
    border: 4px solid #3ddc84;
    border-radius: 50%;
    box-shadow: 0 0 12px 3px rgba(61, 220, 132, 0.7);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms;
  }
  &.speaking .speaking-ring {
    opacity: 1;
  }

  .st-plate {
    position: relative;
  }

  .st-name {
    margin: 6px 0 0 -10%;
    width: 120%;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 100%;
    line-height: 120%;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.5);
    border: 3px solid black;
    border-radius: 10px;
    box-shadow: 0 0 5px black;
    padding: 0 4px;
    span {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .role-line {
      font-size: 75%;
      opacity: 0.8;
    }
    &.clickable {
      cursor: pointer;
      &:hover {
        color: red;
      }
    }
    &.active {
      color: red;
    }
  }

  // own mute toggle, to the right of the nameplate
  .mic-toggle {
    position: absolute;
    left: calc(110% + 8px);
    top: 50%;
    margin-top: 3px;
    transform: translateY(-50%);
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    border: 3px solid black;
    border-radius: 50%;
    box-shadow: 0 0 5px black;
    cursor: pointer;
    &:hover {
      color: red;
    }
    &.muted {
      color: #ff6b6b;
    }
    &.readonly {
      cursor: default;
      pointer-events: none;
    }
  }

  .st-muteall {
    display: block;
    width: 120%;
    margin: 6px 0 0 -10%;
    text-align: center;
    font-size: 80%;
  }

  .st-menu {
    position: absolute;
    left: 115%;
    top: 100%;
    margin-top: -5px;
    text-align: left;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.5);
    padding: 2px 5px;
    border-radius: 10px;
    border: 3px solid #000;
    box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
    z-index: 30;

    &.st-token-menu {
      left: 115%;
      top: 0;
      margin-top: 0;
    }

    li {
      cursor: pointer;
      &:hover {
        color: red;
      }
      &.volume {
        display: flex;
        align-items: center;
        cursor: default;
        &:hover {
          color: inherit;
        }
        input {
          width: 90px;
          margin: 0 6px;
          cursor: pointer;
        }
      }
    }
    svg {
      margin-right: 2px;
    }
  }
}
</style>
