<template>
  <div class="chat-prompts" v-if="voice.joined">
    <!-- the chat timer is about to close the room you're in (the bell is ringing) -->
    <div class="prompt notice closing" v-if="closingIn > 0">
      Private Room is closing in {{ closingIn }}
    </div>
    <!-- your request is waiting because they are in a chat -->
    <div class="prompt" v-if="onHold">
      <div class="text">You are on hold</div>
      <div class="buttons">
        <div class="button demon" @click="cancelHold">Cancel</div>
      </div>
    </div>
    <div class="prompt notice" v-else-if="noticeText">{{ noticeText }}</div>
    <div class="prompt" v-for="req in voice.incoming" :key="req.id">
      <div class="text">{{ text(req) }}</div>
      <div class="buttons">
        <div
          class="button townsfolk"
          v-if="req.hold && canAdd(req)"
          @click="answer(req, 'accept')"
        >
          Add to room
        </div>
        <div class="button townsfolk" v-else-if="!req.hold" @click="answer(req, 'accept')">
          Accept
        </div>
        <div class="button demon" @click="answer(req, 'decline')">Decline</div>
        <div class="button" v-if="req.kind === 'join'" @click="answer(req, 'wait')">
          Wait
        </div>
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
    return { now: Date.now(), clock: null };
  },
  mounted() {
    this.clock = setInterval(() => (this.now = Date.now()), 200);
  },
  beforeDestroy() {
    clearInterval(this.clock);
  },
  computed: {
    // seconds until the chat timer closes your room, in the last 5 seconds only
    // (private Storyteller chats don't close with the timer)
    closingIn() {
      if (!this.voice.timerActive || !this.myChat || this.myChat.whisper) return 0;
      const left = Math.ceil((this.voice.timerEnd - this.now) / 1000);
      return left > 0 && left <= 5 ? left : 0;
    },
    // a private chat with the Storyteller, only you (and they) see this
    whisper() {
      return this.myChat && this.myChat.whisper ? this.myChat : null;
    },
    whisperText() {
      if (!this.whisper) return "";
      const me = this.$store.state.session.playerId;
      if (!this.voice.isHost) return "Private chat with the Storyteller";
      const names = this.whisper.members
        .filter(id => id !== me)
        .map(id => this.nameOf(id));
      return `Private chat with ${names.join(", ")}`;
    },
    onHold() {
      return !!this.voice.notice && this.voice.notice.status === "hold";
    },
    noticeText() {
      const n = this.voice.notice;
      if (!n) return "";
      const who = n.who ? this.nameOf(n.who) : "";
      switch (n.status) {
        case "sent":
          return n.num
            ? `Asked to join Room ${n.num}...`
            : `Chat request sent to ${who}...`;
        case "accepted":
          return n.num ? `You're now in Room ${n.num}` : "Private chat started";
        case "cohost":
          return "You're now the co-Storyteller";
        case "declined":
          return `${who} declined`;
        case "wait":
          return `${who} asked you to wait`;
        case "expired":
          return "Chat request expired";
        default:
          return "";
      }
    }
  },
  methods: {
    // on hold you can pull them into your chat, unless it is a private
    // Storyteller chat (only the Storyteller adds people to those)
    canAdd(req) {
      if (req.kind === "st") return true;
      return !!this.myChat && !this.myChat.whisper;
    },
    cancelHold() {
      voice.cancelRequest(this.voice.notice.id);
    },
    text(req) {
      const who = this.nameOf(req.from);
      if (req.hold && !this.canAdd(req)) {
        return `${who} is waiting to chat with you when you're free`;
      }
      if (req.kind === "invite") return `${who} invited you to Room ${req.num}`;
      if (req.kind === "join") return `${who} wants to join Room ${req.num}`;
      if (req.kind === "st") return `${who} wants a private chat with you`;
      if (req.kind === "cohost") {
        return `${req.name || who} wants to be your co-Storyteller`;
      }
      return `${who} wants to chat privately`;
    },
    endWhisper() {
      if (this.voice.isHost) voice.endWhisper();
      else voice.leaveChat();
    },
    answer(req, answer) {
      voice.respond(req.id, answer);
    }
  }
};
</script>

<style scoped lang="scss">
@import "../vars.scss";

.chat-prompts {
  position: absolute;
  top: 35%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 70;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;

  .prompt {
    padding: 6px 12px;
    text-align: center;
    background: rgba(0, 0, 0, 0.7);
    border: 3px solid red;
    border-radius: 10px;
    box-shadow: 0 0 8px red;
    white-space: nowrap;

    &.notice {
      pointer-events: none;
      opacity: 0.9;
    }
    &.closing {
      font-size: 120%;
      font-variant-numeric: tabular-nums;
    }
    .buttons {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-top: 4px;
      .button {
        margin: 0;
        padding: 2px 10px;
        font-size: 90%;
      }
    }
  }
}
</style>
