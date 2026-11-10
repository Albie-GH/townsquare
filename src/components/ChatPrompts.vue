<template>
  <div class="chat-prompts" v-if="voice.joined">
    <div class="prompt whisper" v-if="whisper">
      <div class="text">{{ whisperText }}</div>
      <div class="buttons" v-if="voice.isHost || !whisper.locked">
        <div class="button demon" @click="endWhisper">
          {{ voice.isHost ? "End chat" : "Leave chat" }}
        </div>
      </div>
    </div>
    <div class="prompt notice" v-if="noticeText">{{ noticeText }}</div>
    <div class="prompt" v-for="req in voice.incoming" :key="req.id">
      <div class="text">{{ text(req) }}</div>
      <div class="buttons">
        <div class="button townsfolk" @click="answer(req, 'accept')">Accept</div>
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
  computed: {
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
    text(req) {
      const who = this.nameOf(req.from);
      if (req.kind === "invite") return `${who} invited you to Room ${req.num}`;
      if (req.kind === "join") return `${who} wants to join Room ${req.num}`;
      if (req.kind === "st") return `${who} wants a private chat with you`;
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
