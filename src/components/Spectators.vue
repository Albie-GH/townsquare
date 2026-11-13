<template>
  <!-- everyone in voice without a seat (and not a Storyteller), right-middle of the screen -->
  <div class="spectators" v-if="voice.joined && spectators.length">
    <h4>Spectators ({{ spectators.length }})</h4>
    <ul>
      <li
        v-for="s in spectators"
        :key="s.playerId"
        :class="{ speaking: voice.speakingIds.includes(s.playerId), you: s.you }"
      >
        <span class="name">{{ s.name }}</span>
        <em v-if="s.you">(you)</em>
        <!-- Storytellers: mute / unmute this spectator in the Town Square -->
        <font-awesome-icon
          v-if="voice.isHost && !s.you"
          class="mic clickable"
          :class="{
            muted: voice.mutedIds.includes(s.playerId),
            locked: stMuted(s.playerId)
          }"
          :icon="
            voice.mutedIds.includes(s.playerId) ? 'microphone-slash' : 'microphone'
          "
          :title="stMuted(s.playerId) ? 'Unmute spectator' : 'Mute spectator'"
          @click="toggleMute(s.playerId)"
        />
        <font-awesome-icon
          v-else-if="voice.mutedIds.includes(s.playerId)"
          class="mic muted"
          icon="microphone-slash"
        />
      </li>
    </ul>
  </div>
</template>

<script>
import { mapState } from "vuex";
import voice from "../voice";

export default {
  data() {
    return { voice: voice.state };
  },
  methods: {
    // muted by a Storyteller one by one (the same mute as a seated player's)
    stMuted(playerId) {
      return (
        this.voice.mutedPlayers.includes(playerId) ||
        (this.voice.allMuted && !this.voice.exemptPlayers.includes(playerId))
      );
    },
    toggleMute(playerId) {
      voice.stToggleMute(playerId);
    }
  },
  computed: {
    ...mapState(["session"]),
    ...mapState("players", ["players"]),
    spectators() {
      const seated = new Set(this.players.map(p => p.id).filter(Boolean));
      const out = [];
      const me = this.session.playerId;
      const keep = id => id && !seated.has(id) && !voice.isSt(id);
      if (keep(me) && !this.voice.isHost) {
        out.push({ playerId: me, name: this.voice.myName || "Player", you: true });
      }
      for (const p of this.voice.peers) {
        if (p.isHost || !keep(p.playerId) || p.playerId === me) continue;
        if (out.some(s => s.playerId === p.playerId)) continue;
        out.push({ playerId: p.playerId, name: p.name || "Player", you: false });
      }
      return out;
    }
  }
};
</script>

<style scoped lang="scss">
.spectators {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 40;
  width: 170px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 3px 8px 5px;
  background: rgba(0, 0, 0, 0.5);
  border: 3px solid black;
  border-radius: 10px;
  box-shadow: 0 0 5px black;

  h4 {
    margin: 0 0 2px;
    text-align: center;
    font-weight: normal;
    opacity: 0.8;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 90%;
  }

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
      margin-left: auto;
      color: white;
      opacity: 0.8;
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
</style>
