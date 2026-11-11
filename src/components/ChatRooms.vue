<template>
  <div class="chat-rooms" v-if="voice.joined && (rooms.length || stRoom)">
    <h4>Private chats</h4>
    <!-- only the people in a private Storyteller chat ever see this -->
    <div
      class="room st-room mine"
      v-if="stRoom"
      :class="{ open: openId === stRoom.id }"
      @click="toggle(stRoom)"
    >
      <div class="title">
        Storyteller Room
        <small>only you can see this</small>
      </div>
      <ul class="members">
        <li
          v-for="id in stRoom.members"
          :key="id"
          :class="{ speaking: voice.speakingIds.includes(id) }"
        >
          <span class="name">{{ nameOf(id) }}</span>
          <em v-if="isHidden(stRoom, id)">(unseen)</em>
          <font-awesome-icon
            v-if="showMic(id)"
            class="mic"
            :class="{
              muted: roomMuted(id),
              clickable: canToggle(id),
              locked: lockedBySt(stRoom, id)
            }"
            :icon="roomMuted(id) ? 'microphone-slash' : 'microphone'"
            :title="micTitle(stRoom, id)"
            @click.stop="toggleMic(stRoom, id)"
          />
        </li>
      </ul>
      <div class="action" v-if="openId === stRoom.id">
        <span v-if="voice.isHost" @click.stop="endStRoom">
          <font-awesome-icon icon="sign-out-alt" /> End chat
        </span>
        <span v-else-if="!stRoom.locked" @click.stop="leave">
          <font-awesome-icon icon="sign-out-alt" /> Leave chat
        </span>
        <span class="muted" v-else>The Storyteller ends this chat</span>
      </div>
    </div>
    <div
      class="room"
      v-for="chat in rooms"
      :key="chat.id"
      :class="{ mine: myChat && myChat.id === chat.id, open: openId === chat.id }"
      @click="toggle(chat)"
    >
      <div class="title">
        Room {{ chat.num }}
        <small v-if="myChat && myChat.id === chat.id">
          {{ voice.invisible ? "you're here unseen" : "you're in this room" }}
        </small>
      </div>
      <ul class="members">
        <li
          v-for="id in shown(chat)"
          :key="id"
          :class="{ speaking: voice.speakingIds.includes(id) }"
        >
          <span class="name">{{ nameOf(id) }}</span>
          <em v-if="isHidden(chat, id)">(unseen)</em>
          <font-awesome-icon
            v-if="showMic(id)"
            class="mic"
            :class="{
              muted: roomMuted(id),
              clickable: canToggle(id),
              locked: lockedBySt(chat, id)
            }"
            :icon="roomMuted(id) ? 'microphone-slash' : 'microphone'"
            :title="micTitle(chat, id)"
            @click.stop="toggleMic(chat, id)"
          />
        </li>
      </ul>
      <div class="action" v-if="openId === chat.id">
        <template v-if="myChat && myChat.id === chat.id">
          <!-- Storyteller: show yourself to the room, or slip out of view -->
          <span v-if="voice.isHost" @click.stop="setHidden(!voice.invisible)">
            <font-awesome-icon icon="comments" />
            {{ voice.invisible ? "Become visible" : "Go invisible" }}
          </span>
          <span @click.stop="leave">
            <font-awesome-icon icon="sign-out-alt" /> Leave room
          </span>
        </template>
        <template v-else-if="voice.isHost">
          <span @click.stop="joinAs(chat, false)">
            <font-awesome-icon icon="comments" /> Join
          </span>
          <span @click.stop="joinAs(chat, true)">
            <font-awesome-icon icon="comments" /> Invisible join
          </span>
        </template>
        <span v-else-if="canJoin" @click.stop="join(chat)">
          <font-awesome-icon icon="comments" /> Request to join
        </span>
        <span class="muted" v-else>You can't join right now</span>
      </div>
    </div>
  </div>
</template>

<script>
import voice from "../voice";
import chatNames from "./chatNames";

export default {
  mixins: [chatNames],
  data() {
    return { openId: 0 };
  },
  computed: {
    // private Storyteller chats are never listed
    rooms() {
      return this.voice.chats.filter(c => !c.whisper);
    },
    // your private chat with the Storyteller, if you are in one
    stRoom() {
      return this.myChat && this.myChat.whisper ? this.myChat : null;
    },
    canJoin() {
      return (
        this.$store.state.session.isSpectator &&
        !this.myChat &&
        this.voice.timerActive
      );
    }
  },
  methods: {
    // the Storyteller can sit in a room without being listed (they still see themselves)
    shown(chat) {
      if (this.voice.isHost) return chat.members;
      return chat.members.filter(id => !(chat.hidden || []).includes(id));
    },
    isHidden(chat, id) {
      return (chat.hidden || []).includes(id);
    },
    me() {
      return this.$store.state.session.playerId;
    },
    // private chat mutes are separate from the Town Square ones
    roomMuted(id) {
      return this.voice.roomMutedIds.includes(id);
    },
    // the Storyteller muted this person in the room
    lockedBySt(chat, id) {
      return (chat.muted || []).includes(id);
    },
    // your own toggle, every toggle for the Storyteller, otherwise just a muted icon
    canToggle(id) {
      return id === this.me() || this.voice.isHost;
    },
    showMic(id) {
      if (id === this.me()) return this.myChat && this.myChat.members.includes(id);
      return this.voice.isHost || this.roomMuted(id);
    },
    micTitle(chat, id) {
      if (id === this.me()) {
        if (this.voice.micLocked) return "Muted by the Storyteller";
        return this.roomMuted(id) ? "Unmute yourself" : "Mute yourself";
      }
      if (this.voice.isHost) {
        return this.lockedBySt(chat, id) ? "Unmute in this room" : "Mute in this room";
      }
      return this.lockedBySt(chat, id) ? "Muted by the Storyteller" : "Muted";
    },
    toggleMic(chat, id) {
      if (id === this.me()) voice.toggleRoomMic();
      else if (this.voice.isHost) voice.setRoomMuted(id, !this.lockedBySt(chat, id));
    },
    toggle(chat) {
      this.openId = this.openId === chat.id ? 0 : chat.id;
    },
    endStRoom() {
      this.openId = 0;
      voice.endWhisper();
    },
    leave() {
      this.openId = 0;
      voice.leaveChat();
    },
    join(chat) {
      this.openId = 0;
      voice.requestJoin(chat.id);
    },
    setHidden(hidden) {
      this.openId = 0;
      voice.setHidden(hidden);
    },
    joinAs(chat, hidden) {
      this.openId = 0;
      voice.joinChat(chat.id, hidden);
    }
  }
};
</script>

<style scoped lang="scss">
.chat-rooms {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 40;
  width: 170px;
  max-height: 50vh;
  overflow-y: auto;

  h4 {
    margin: 0 0 4px;
    text-align: center;
    font-weight: normal;
    opacity: 0.8;
  }

  .room {
    margin-bottom: 6px;
    padding: 3px 8px 5px;
    background: rgba(0, 0, 0, 0.5);
    border: 3px solid black;
    border-radius: 10px;
    box-shadow: 0 0 5px black;
    cursor: pointer;

    &:hover,
    &.open {
      color: #ff6b6b;
    }
    &.mine {
      border-color: #3ddc84;
      box-shadow: 0 0 8px #3ddc84;
    }

    .title {
      font-weight: bold;
      small {
        display: block;
        font-weight: normal;
        opacity: 0.7;
        color: white;
      }
    }
    .members {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 90%;
      color: white;
      li {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        transition: color 150ms;
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        em {
          font-style: normal;
          opacity: 0.6;
          font-size: 85%;
        }
        .mic {
          flex-shrink: 0;
          width: 12px;
          margin-left: auto; // right-aligned in the room box
          color: white;
          opacity: 0.8;
          cursor: default;
          &.muted {
            color: #ff6b6b;
            opacity: 1;
          }
          &.locked {
            filter: drop-shadow(0 0 2px red);
          }
          &.clickable {
            cursor: pointer;
            &:hover {
              color: red;
            }
          }
        }
        &.speaking {
          color: #3ddc84;
          font-weight: bold;
        }
      }
    }
    .action {
      margin-top: 4px;
      padding-top: 3px;
      border-top: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      span {
        display: block;
      }
      span:hover {
        color: red;
      }
      .muted {
        opacity: 0.6;
        cursor: default;
        &:hover {
          color: white;
        }
      }
    }
  }
}
</style>
