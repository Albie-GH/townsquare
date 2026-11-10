// Shared helpers for the chat timer / private chat components.
import voice from "../voice";

export default {
  data() {
    return { voice: voice.state };
  },
  computed: {
    chatPlayers() {
      return this.$store.state.players.players;
    },
    myChat() {
      return voice.chatOf(this.$store.state.session.playerId);
    }
  },
  methods: {
    // seat name if the player has one, otherwise the name they joined voice with
    nameOf(playerId) {
      if (playerId && playerId === this.voice.hostPlayerId) {
        return this.voice.hostName || "Storyteller";
      }
      const seat = this.chatPlayers.find(p => p.id && p.id === playerId);
      if (seat && seat.name) return seat.name;
      const peer = this.voice.peers.find(p => p.playerId === playerId);
      if (peer && peer.name) return peer.name;
      return "Player";
    }
  }
};
