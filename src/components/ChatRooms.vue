<template>
  <div
    class="chat-rooms"
    v-if="voice.joined && (rooms.length || privateRooms.length || canOpenPrivate)"
  >
    <h4>Private chats</h4>
    <!-- Storytellers: a hidden room to bring players into, e.g. one by one at night -->
    <div class="room new-room" v-if="canOpenPrivate" @click="openPrivate">
      <font-awesome-icon icon="plus-circle" /> Storyteller Room
    </div>
    <!-- private Storyteller chats: only the people in them (and Storytellers) see these -->
    <div
      class="room st-room"
      v-for="chat in privateRooms"
      :key="chat.id"
      :class="{ mine: isActive(chat) }"
    >
      <div class="title">
        Storyteller Room
        <small>{{ privateNote(chat) }}</small>
      </div>
      <ul class="members">
        <li
          v-for="id in chat.members"
          :key="id"
          :class="{
            speaking: voice.speakingIds.includes(id),
            unseen: isHidden(chat, id)
          }"
        >
          <span class="name">{{ nameOf(id) }}</span>
          <em v-if="isHidden(chat, id)">(unseen)</em>
          <font-awesome-icon
            v-if="showMic(chat, id)"
            class="mic"
            :class="{
              muted: roomMuted(chat, id),
              clickable: canToggle(chat, id),
              locked: lockedBySt(chat, id)
            }"
            :icon="roomMuted(chat, id) ? 'microphone-slash' : 'microphone'"
            :title="micTitle(chat, id)"
            @click.stop="toggleMic(chat, id)"
          />
          <font-awesome-icon
            v-if="canKick(id)"
            class="kick"
            icon="times"
            title="Remove from this chat"
            @click.stop="kick(id)"
          />
        </li>
      </ul>
      <!-- your own chat: always there, unless a Storyteller pulled you in -->
      <div class="action" v-if="isMine(chat) && (voice.isHost || !chat.locked)">
        <template v-if="voice.isHost">
          <span @click.stop="setHidden(!isHidden(chat, me()))">
            <font-awesome-icon icon="comments" />
            {{ isHidden(chat, me()) ? "Become visible" : "Go invisible" }}
          </span>
          <span @click.stop="leave">
            <font-awesome-icon icon="sign-out-alt" /> Leave chat
          </span>
          <span @click.stop="endStRoom">
            <font-awesome-icon icon="times-circle" /> End chat
          </span>
        </template>
        <span v-else @click.stop="leave">
          <font-awesome-icon icon="sign-out-alt" /> Leave chat
        </span>
      </div>
      <!-- Storytellers can step into any private chat -->
      <div class="action" v-else-if="voice.isHost">
        <span @click.stop="joinAs(chat, false)">
          <font-awesome-icon icon="comments" /> Join
        </span>
        <span @click.stop="joinAs(chat, true)">
          <font-awesome-icon icon="comments" /> Invisible join
        </span>
      </div>
    </div>
    <div
      class="room"
      v-for="chat in rooms"
      :key="chat.id"
      :class="{ mine: isActive(chat) }"
    >
      <div class="title">
        Room {{ chat.num }}
      </div>
      <ul class="members">
        <li
          v-for="id in shown(chat)"
          :key="id"
          :class="{
            speaking: voice.speakingIds.includes(id),
            unseen: isHidden(chat, id)
          }"
        >
          <span class="name">{{ nameOf(id) }}</span>
          <em v-if="isHidden(chat, id)">(unseen)</em>
          <font-awesome-icon
            v-if="showMic(chat, id)"
            class="mic"
            :class="{
              muted: roomMuted(chat, id),
              clickable: canToggle(chat, id),
              locked: lockedBySt(chat, id)
            }"
            :icon="roomMuted(chat, id) ? 'microphone-slash' : 'microphone'"
            :title="micTitle(chat, id)"
            @click.stop="toggleMic(chat, id)"
          />
          <font-awesome-icon
            v-if="canKick(id)"
            class="kick"
            icon="times"
            title="Remove from this room"
            @click.stop="kick(id)"
          />
        </li>
      </ul>
      <!-- every option shows straight away, nothing to open -->
      <div class="action" v-if="isMine(chat) || voice.isHost || canJoin">
        <template v-if="isMine(chat)">
          <!-- Storyteller: show yourself to the room, or slip out of view -->
          <span v-if="voice.isHost" @click.stop="setHidden(!isHidden(chat, me()))">
            <font-awesome-icon icon="comments" />
            {{ isHidden(chat, me()) ? "Become visible" : "Go invisible" }}
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
  computed: {
    // private Storyteller chats are only listed for the people in them
    rooms() {
      return this.voice.chats.filter(c => !c.whisper);
    },
    // private Storyteller chats: yours, or every one for a Storyteller (yours first)
    privateRooms() {
      const me = this.me();
      return this.voice.chats
        .filter(
          c =>
            c.whisper &&
            (this.voice.isHost || c.seen || c.members.includes(me))
        )
        .sort((a, b) => b.members.includes(me) - a.members.includes(me));
    },
    // Storytellers not already in a private chat can open a private room
    canOpenPrivate() {
      return this.voice.isHost && !(this.myChat && this.myChat.whisper);
    },
    seated() {
      const me = this.$store.state.session.playerId;
      return !!me && this.$store.state.players.players.some(p => p.id === me);
    },
    canJoin() {
      return (
        this.$store.state.session.isSpectator &&
        this.seated && // spectators can't join private chats
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
    // the chat you are talking in right now
    isActive(chat) {
      return !!this.myChat && this.myChat.id === chat.id;
    },
    isMine(chat) {
      return chat.members.includes(this.me());
    },
    privateNote(chat) {
      // a player's chat with a Storyteller: everyone sees it, nobody else can join
      if (chat.seen) return "Chatting with the Storyteller";
      if (!this.voice.isHost) return "Only you can see this";
      if (!this.isMine(chat)) return "Hidden from players";
      if (chat.members.length < 2) {
        return "Add players from their seat menu";
      }
      return "Hidden from other players";
    },
    // private chat mutes are separate from the Town Square ones
    roomMuted(chat, id) {
      return this.voice.roomMutedIds.includes(id);
    },
    // Storytellers can take players out of a chat
    canKick(id) {
      return this.voice.isHost && id !== this.me() && !voice.isSt(id);
    },
    kick(id) {
      voice.kick(id);
    },
    // the Storyteller muted this person in the room
    lockedBySt(chat, id) {
      return (chat.muted || []).includes(id);
    },
    // your own toggle, a Storyteller's toggles for players, otherwise just a muted icon
    canToggle(chat, id) {
      if (id === this.me()) return this.isActive(chat);
      return this.voice.isHost && !voice.isSt(id);
    },
    showMic(chat, id) {
      if (id === this.me()) return true;
      return this.voice.isHost || this.roomMuted(chat, id);
    },
    micTitle(chat, id) {
      if (id === this.me()) {
        if (this.voice.micLocked) return "Muted by the Storyteller";
        return this.roomMuted(chat, id) ? "Unmute yourself" : "Mute yourself";
      }
      if (this.voice.isHost) {
        return this.lockedBySt(chat, id) ? "Unmute in this room" : "Mute in this room";
      }
      return this.lockedBySt(chat, id) ? "Muted by the Storyteller" : "Muted";
    },
    toggleMic(chat, id) {
      if (!this.canToggle(chat, id)) return;
      if (id === this.me()) voice.toggleRoomMic();
      else voice.setRoomMuted(id, !this.lockedBySt(chat, id));
    },
    openPrivate() {
      voice.openPrivateRoom();
    },
    endStRoom() {
      voice.endWhisper();
    },
    leave() {
      voice.leaveChat();
    },
    join(chat) {
      voice.requestJoin(chat.id);
    },
    setHidden(hidden) {
      voice.setHidden(hidden);
    },
    joinAs(chat, hidden) {
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
  width: 255px;
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


    &.mine {
      border-color: #3ddc84;
      box-shadow: 0 0 8px #3ddc84;
    }
    &.new-room {
      text-align: center;
      font-size: 90%;
      opacity: 0.85;
      cursor: pointer;
      &:hover {
        color: #ff6b6b;
      }
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
        // a Storyteller here invisibly: their name greyed out
        &.unseen:not(.speaking) .name {
          opacity: 0.6; // the same grey as "(unseen)"
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
        // Storytellers: take this player out of the chat
        .kick {
          flex-shrink: 0;
          width: 10px;
          margin-left: 4px;
          color: white; // not the speaking green of the row
          opacity: 0.6;
          cursor: pointer;
          &:hover {
            color: red;
            opacity: 1;
          }
        }
        // the mic is pushed right, so the kick button follows it
        .name + .kick,
        em + .kick {
          margin-left: auto;
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
        cursor: pointer; // even in a room box that isn't clickable itself
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
