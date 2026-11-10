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
          {{ nameOf(id) }}
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
          {{ nameOf(id) }}
        </li>
      </ul>
      <div class="action" v-if="openId === chat.id">
        <span v-if="myChat && myChat.id === chat.id" @click.stop="leave">
          <font-awesome-icon icon="sign-out-alt" /> Leave room
        </span>
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
    // the Storyteller can sit in a room without being listed
    shown(chat) {
      return chat.members.filter(id => !(chat.hidden || []).includes(id));
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
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color 150ms;
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
