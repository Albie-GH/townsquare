<template>
  <div
    class="storyteller"
    :class="{
      speaking,
      cohost,
      'menu-open': isMenuOpen || isTokenMenuOpen,
      'muted-talking': isSelf && voice.mutedTalking
    }"
  >
    <div
      class="st-token"
      :class="{ clickable: hasTokenMenu, 'out-of-room': outOfRoom }"
      @click="toggleTokenMenu"
    >
      <font-awesome-icon icon="theater-masks" />
      <div class="speaking-ring"></div>
    </div>
    <!-- the dead marker: a Storyteller marks both Storytellers dead at once -->
    <div
      class="st-shroud"
      :class="{ dead: voice.stDead, clickable: canKill }"
      :title="canKill ? (voice.stDead ? 'Bring the Storytellers back to life' : 'Mark the Storytellers as dead') : ''"
      @click.stop="toggleDead"
    ></div>
    <!-- Storytellers only: the always-open line between the two Storytellers.
         Either Storyteller can mute themselves or the other one on it. -->
    <div
      class="line-toggle"
      v-if="showLine"
      :class="{ muted: lineMuted || lineAuto, auto: lineAuto && !lineMuted, speaking: lineSpeaking }"
      :title="lineTitle"
      @click.stop="toggleLine"
    >
      <font-awesome-icon icon="people-arrows" />
    </div>
    <div class="st-plate">
      <div
        class="st-name"
        :class="{ active: isMenuOpen, clickable: hasNameMenu }"
        @click="toggleMenu"
      >
        <span class="custom-name" v-if="displayName">{{ displayName }}</span>
        <span class="role-line">{{
          cohost ? "(Co-Storyteller)" : "(Storyteller)"
        }}</span>
      </div>
      <!-- your own mute toggle; everyone else only sees it while you are muted -->
      <div
        class="mic-toggle"
        v-if="showMic"
        :class="{ muted: isMuted, readonly: !isSelf }"
        @click.stop="isSelf && toggleMic()"
      >
        <font-awesome-icon
          :icon="isMuted ? 'microphone-slash' : 'microphone'"
        />
        <div class="tip">
          {{ isSelf ? (isMuted ? "Unmute yourself" : "Mute yourself") : "Muted" }}
        </div>
      </div>
    </div>
    <!-- Storytellers, under their own token: mute / unmute every player -->
    <div
      class="button st-muteall"
      v-if="isSelf && voice.joined"
      :class="{ demon: voice.allMuted, townsfolk: !voice.allMuted }"
      @click="toggleMuteAll"
    >
      {{ voice.allMuted ? "Unmute all" : "Mute all" }}
    </div>
    <!-- Storytellers, under the other Storyteller's token: both go quiet everywhere
         and only talk to each other over the line -->
    <div
      class="button st-muteall st-urgent"
      v-if="showUrgent"
      :class="{ on: voice.urgent }"
      :title="
        voice.urgent
          ? 'Back to normal: your own mutes come back'
          : 'Mute both Storytellers everywhere and talk only over the line'
      "
      @click="toggleUrgent"
    >
      {{ voice.urgent ? "End Urgent Line" : "Urgent Line" }}
    </div>
    <!-- Players: ask for a private chat, or to help as co-Storyteller.
         Storytellers: remove the co-Storyteller -->
    <transition name="fold">
      <ul class="st-menu st-token-menu" v-if="isTokenMenuOpen && hasTokenMenu">
        <li v-if="canRequest" @click="requestChat">
          <font-awesome-icon icon="comments" />Request chat
        </li>
        <li v-if="canRequestCohost" @click="requestCohost">
          <font-awesome-icon icon="user-friends" />Request co-storyteller
        </li>
        <li v-if="canRemoveCohost" @click="removeCohost">
          <font-awesome-icon icon="times-circle" />Remove co-storyteller
        </li>
      </ul>
    </transition>
    <transition name="fold">
      <ul class="st-menu" v-if="isMenuOpen && hasNameMenu">
        <li v-if="isSelf" @click="setName">
          <font-awesome-icon icon="user-edit" />Set name
        </li>
        <li v-if="isSelf && cohost" @click="stepDown">
          <font-awesome-icon icon="sign-out-alt" />Step down
        </li>
        <li class="volume" v-if="canAdjust">
          <font-awesome-icon icon="volume-up" />
          <input
            type="range"
            min="0"
            max="200"
            step="5"
            :value="volume"
            @input="setVolume"
            :title="
              cohost
                ? 'How loud the co-Storyteller is for you'
                : 'How loud the Storyteller is for you'
            "
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
  props: {
    // the co-Storyteller's token (to the right) instead of the Storyteller's
    cohost: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      isMenuOpen: false,
      isTokenMenuOpen: false,
      voice: voice.state
    };
  },
  computed: {
    ...mapState(["session"]),
    ...mapState("players", ["players"]),
    // playerId of the Storyteller this token belongs to
    hostId() {
      return this.cohost ? this.voice.cohostPlayerId : this.voice.hostPlayerId;
    },
    // this token is you: you can rename yourself and mute everyone
    isSelf() {
      if (this.cohost) return this.voice.isCoHost;
      return !this.session.isSpectator && !this.session.isCoHost;
    },
    // everyone else can adjust how loud this Storyteller is for them
    canAdjust() {
      return this.voice.joined && !this.isSelf && !!this.hostId;
    },
    // players can ask a Storyteller for a private chat, if not already in one
    canRequest() {
      return (
        this.session.isSpectator &&
        this.voice.joined &&
        !!this.hostId &&
        !voice.chatOf(this.session.playerId)
      );
    },
    // a player without a seat can offer to help as the co-Storyteller
    canRequestCohost() {
      return (
        !this.cohost &&
        this.session.isSpectator &&
        this.voice.joined &&
        !!this.hostId &&
        !this.voice.cohostPlayerId &&
        !this.players.some(p => p.id && p.id === this.session.playerId)
      );
    },
    // the Storytellers' line, shown to both Storytellers once there are two
    showLine() {
      return (
        this.voice.joined &&
        this.voice.isHost &&
        !!this.voice.cohostPlayerId &&
        !!this.hostId
      );
    },
    // talking over the Storytellers' line (whether or not they are heard elsewhere too)
    lineSpeaking() {
      return !!this.hostId && this.voice.lineSpeakingIds.includes(this.hostId);
    },
    // the Urgent Line keeps both lines open, whatever they were set to
    lineMuted() {
      return !this.voice.urgent && this.voice.lineMuted.includes(this.hostId);
    },
    canKill() {
      return this.voice.joined && this.voice.isHost;
    },
    showUrgent() {
      return (
        this.voice.joined &&
        this.voice.isHost &&
        !this.isSelf &&
        !!this.hostId &&
        !!this.voice.cohostPlayerId
      );
    },
    // off for now: the other Storyteller already hears them where they both are
    lineAuto() {
      return this.voice.lineAutoIds.includes(this.hostId);
    },
    lineTitle() {
      const who = this.isSelf
        ? "yourself"
        : this.cohost
        ? "the co-Storyteller"
        : "the Storyteller";
      if (this.lineAuto && !this.lineMuted) {
        return (
          "Line off while you're unmuted in the same place " +
          "(click to keep it muted after)"
        );
      }
      return (
        (this.lineMuted ? "Unmute " : "Mute ") + who + " on the Storytellers' line"
      );
    },
    canRemoveCohost() {
      return this.cohost && !this.isSelf && this.voice.isHost && !this.voice.isCoHost;
    },
    hasTokenMenu() {
      return (
        this.canRequest ||
        this.canRequestCohost ||
        this.canRemoveCohost
      );
    },
    hasNameMenu() {
      return this.isSelf || this.canAdjust;
    },
    isMuted() {
      // Town Square mute; private chats have their own toggle in the room list
      return !!this.hostId && this.voice.mutedIds.includes(this.hostId);
    },
    // darkened while you're in a private room the Storyteller isn't (visibly) in
    outOfRoom() {
      const mine = voice.chatOf(this.session.playerId);
      if (!mine) return false;
      const theirs = voice.chatOf(this.hostId);
      return !(theirs && theirs.id === mine.id);
    },
    showMic() {
      return this.voice.joined && (this.isSelf || this.isMuted);
    },
    // "Storyteller" is the default and means no custom name was chosen
    displayName() {
      const name = this.cohost ? this.voice.cohostName : this.voice.hostName;
      const fallback = this.cohost ? "Co-Storyteller" : "Storyteller";
      return name && name !== fallback ? name : "";
    },
    speaking() {
      return !!this.hostId && this.voice.speakingIds.includes(this.hostId);
    },
    volume() {
      const v = this.voice.volumes[this.hostId];
      return v === undefined ? 100 : v;
    }
  },
  // a click anywhere outside this Storyteller token closes its open menus
  mounted() {
    document.addEventListener("pointerdown", this.closeIfOutside, true);
  },
  beforeDestroy() {
    document.removeEventListener("pointerdown", this.closeIfOutside, true);
  },
  methods: {
    closeIfOutside(event) {
      if (!this.isMenuOpen && !this.isTokenMenuOpen) return;
      if (this.$el.contains(event.target)) return;
      this.isMenuOpen = false;
      this.isTokenMenuOpen = false;
    },
    toggleMenu() {
      this.isTokenMenuOpen = false;
      if (this.hasNameMenu) this.isMenuOpen = !this.isMenuOpen;
    },
    requestChat() {
      this.isTokenMenuOpen = false;
      voice.requestStoryteller(this.hostId);
    },
    requestCohost() {
      this.isTokenMenuOpen = false;
      const name = prompt("Your name as co-Storyteller", this.voice.myName || "");
      if (name === null) return;
      voice.requestCohost(name);
    },
    toggleDead() {
      if (!this.canKill) return;
      const who = this.voice.cohostPlayerId ? "both Storytellers" : "the Storyteller";
      const ok = this.voice.stDead
        ? confirm(`Bring ${who} back to life?`)
        : confirm(`Mark ${who} as dead?`);
      if (ok) voice.setStDead(!this.voice.stDead);
    },
    toggleUrgent() {
      voice.setUrgent(!this.voice.urgent);
    },
    toggleLine() {
      voice.setLineMuted(this.hostId, !this.lineMuted);
    },
    removeCohost() {
      this.isTokenMenuOpen = false;
      if (confirm("Remove the co-Storyteller? They go back to being a player.")) {
        voice.removeCohost();
      }
    },
    stepDown() {
      this.isMenuOpen = false;
      if (confirm("Step down as co-Storyteller? You go back to being a player.")) {
        voice.removeCohost();
      }
    },
    toggleTokenMenu() {
      if (!this.hasTokenMenu) return;
      this.isMenuOpen = false;
      this.isTokenMenuOpen = !this.isTokenMenuOpen;
    },
    setName() {
      this.isMenuOpen = false;
      const name = prompt(
        (this.cohost ? "Co-Storyteller" : "Storyteller") +
          " name (leave empty to reset)",
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
  // to the right of the Storyteller, clear of their mute toggle
  &.cohost {
    left: calc(20px + 13.2vh + 50px);
  }
  // an open menu goes over the other Storyteller's token and the seats
  &.menu-open {
    z-index: 55;
  }
  // the co-Storyteller's line toggle sits on the top left, facing the Storyteller's
  &.cohost .line-toggle {
    right: auto;
    left: -20px;
  }

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
    &.out-of-room {
      filter: brightness(0.35);
    }
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

  // the Storytellers' line, on the token's top right corner
  .line-toggle {
    position: absolute;
    top: -6px;
    right: -20px;
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: #3ddc84;
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid black;
    border-radius: 50%;
    box-shadow: 0 0 5px black;
    cursor: pointer;
    z-index: 2;
    transition: border-color 120ms, box-shadow 120ms;
    &:hover {
      color: red;
    }
    // talking over the line: the same green ring as the portrait
    &.speaking {
      border-color: #3ddc84;
      box-shadow: 0 0 0 2px #3ddc84, 0 0 10px 3px rgba(61, 220, 132, 0.7);
    }
    // muted automatically (not by a click): a softer look
    &.muted.auto {
      color: #bbb;
      opacity: 0.6;
      &:after {
        background: #bbb !important;
      }
    }
    &.muted {
      color: #ff6b6b;
      opacity: 0.8;
      // a slash through the icon, like the mic toggles
      &:after {
        content: "";
        position: absolute;
        width: 2px;
        height: 22px;
        background: #ff6b6b;
        transform: rotate(45deg);
      }
    }
  }

  // the dead marker, like a seat's: drawn over the top of the token, clickable
  // (by Storytellers) only on a small box at the top
  .st-shroud {
    position: absolute;
    top: 0;
    left: 25%;
    width: 50%;
    height: 2.75vh; // a quarter of the 11vh token
    z-index: 1;
    pointer-events: none;
    filter: drop-shadow(0 0 5px rgba(0, 0, 0, 0.8));
    &.clickable {
      pointer-events: auto;
      cursor: pointer;
    }
    &:before {
      content: " ";
      position: absolute;
      top: 0;
      left: 50%;
      width: 200%;
      margin-left: -100%;
      height: 4.95vh; // 45% of the token
      background: url("../assets/shroud.png") center -10px no-repeat;
      background-size: auto 110%;
      opacity: 0;
      transform: perspective(400px) scale(1.5);
      transform-origin: top center;
      transition: all 200ms;
      pointer-events: none;
    }
    &.clickable:hover:before {
      opacity: 0.5;
      transform: scale(1);
    }
    &.dead:before,
    &.dead.clickable:hover:before {
      opacity: 1;
      transform: perspective(400px) scale(1);
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
  // only on your own token: you're talking, but muted so nobody hears it
  &.muted-talking .speaking-ring {
    opacity: 1;
    border-color: #ff4d4d;
    box-shadow: 0 0 12px 3px rgba(255, 77, 77, 0.7);
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
    // hover text, styled like a character's ability on its token, above the button
    .tip {
      position: absolute;
      bottom: calc(100% + 16px);
      left: 50%;
      transform: translateX(-50%);
      width: 200px;
      padding: 5px 10px;
      z-index: 25;
      font-size: 13px;
      font-weight: normal;
      line-height: 1.3;
      color: white;
      white-space: normal;
      text-align: center;
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
        top: 100%;
        left: 50%;
        margin-left: -10px;
        margin-top: 2px;
        width: 0;
        height: 0;
        border: 10px solid transparent;
        border-top-color: black;
      }
    }
    &:hover .tip {
      opacity: 1;
    }

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

  // amber, glowing while it is on
  .st-urgent {
    background: radial-gradient(
          at 0 -15%,
          rgba(255, 255, 255, 0.07) 70%,
          rgba(255, 255, 255, 0) 71%
        )
        0 0/80% 90% no-repeat content-box,
      linear-gradient(#b86e00, rgba(5, 0, 0, 0.22)) content-box,
      linear-gradient(#292929, #422400) border-box;
    box-shadow: inset 0 1px 1px #9c5c00, 0 0 10px #000;
    &:hover {
      color: #ffc04d;
    }
    &.on {
      box-shadow: inset 0 1px 1px #9c5c00, 0 0 12px 3px rgba(255, 170, 0, 0.8);
    }
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
        // fixed width so "100%" doesn't widen the menu mid-drag
        span {
          display: inline-block;
          min-width: 4ch;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      }
    }
    svg {
      margin-right: 2px;
    }
  }
}
</style>
