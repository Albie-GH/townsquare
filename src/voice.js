import Vue from "vue";
import { playSound, startMusic, stopMusic } from "./sounds";

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add a TURN server here if some players connect but can't hear each other:
    // { urls: "turn:HOST:3478", username: "user", credential: "pass" }
  ]
};

// Talking ring: loudness (RMS, in dB) above which a sound counts as talking. Quiet
// enough to catch anything that really gets sent; your own ring also waits for the
// noise gate, so it lights exactly when the gate lets your sound through.
const SPEAKING_DB = -55;
const SPEAKING_HOLD_MS = 350; // keep the ring lit briefly so it doesn't flicker
// talking while muted is judged on the raw mic (no noise filter), so it needs a bit more
const MUTED_TALK_LEVEL = 12;
const VOLUME_KEY = "botcVoiceVolumes";
const HOST_NAME_KEY = "botcStorytellerName";
const DEFAULT_HOST_NAME = "Storyteller"; // means "no custom name set"

function loadHostName() {
  try {
    return localStorage.getItem(HOST_NAME_KEY) || DEFAULT_HOST_NAME;
  } catch (e) {
    return DEFAULT_HOST_NAME;
  }
}

const RNNOISE_URL = (process.env.BASE_URL || "/") + "rnnoise/";

const GATE_KEY = "botcNoiseGate2";
const OLD_GATE_KEY = "botcNoiseGate"; // the weaker scale the slider used to have
const DEFAULT_GATE = 50; // noise gate strength until the player picks their own

// gate strength 0-100 -> threshold in dB (0 = off, 50 = -34dB, 100 = -10dB)
function gateDb(level) {
  return level <= 0 ? -100 : -58 + level * 0.48;
}

// a setting saved on the old scale (0-100 = -70dB to -25dB) moves to the
// new number that gives the same strength, so nobody's gate changes
function fromOldGate(old) {
  if (old <= 0) return 0;
  const db = -70 + old * 0.45;
  return Math.max(1, Math.min(100, Math.round((db + 58) / 0.48)));
}

function loadGatePref() {
  try {
    const saved = localStorage.getItem(GATE_KEY);
    if (saved !== null) return parseInt(saved, 10) || 0;
    const old = localStorage.getItem(OLD_GATE_KEY);
    if (old !== null) {
      const level = fromOldGate(parseInt(old, 10) || 0);
      localStorage.setItem(GATE_KEY, String(level));
      localStorage.removeItem(OLD_GATE_KEY);
      return level;
    }
    return DEFAULT_GATE;
  } catch (e) {
    return DEFAULT_GATE;
  }
}

function loadVolumes() {
  try {
    return JSON.parse(localStorage.getItem(VOLUME_KEY)) || {};
  } catch (e) {
    return {};
  }
}

class VoiceChat {
  constructor() {
    // reactive state, bound by Menu.vue and Player.vue
    this.state = Vue.observable({
      joined: false,
      micOn: true,
      level: 0,
      error: "",
      peers: [], // { id, name, playerId, hear, talk, speaking, status, rtt, route }
      speakingIds: [], // playerIds currently talking, including your own
      mutedTalking: false, // you're talking but muted, so nobody hears you (only you see this)
      lineSpeakingIds: [], // Storytellers heard talking only over the Storytellers' line
      volumes: loadVolumes(), // playerId -> 0-100, how loud you hear each player
      hostPlayerId: "", // playerId of the storyteller in the voice room, if known
      hostName: loadHostName(), // the Storyteller's chosen name ("Storyteller" = none)
      isHost: false, // this client is a Storyteller (the Storyteller or the co-Storyteller)
      isCoHost: false, // this client is the co-Storyteller
      cohostPlayerId: "", // playerId of the co-Storyteller, if there is one
      cohostName: "", // the co-Storyteller's name
      lineMuted: [], // Storytellers muted on the always-open line between the two Storytellers
      lineAutoIds: [], // Storytellers whose line is off for now: the other one already hears them
      urgent: false, // Urgent Line: both Storytellers muted everywhere, only on their line
      stDead: false, // the Storytellers have been marked dead (both of them together)
      allMuted: false, // the Storyteller has muted everyone (players can't unmute)
      mutedIds: [], // playerIds currently muted (self-muted or muted by the Storyteller)
      handIds: [], // playerIds with a raised hand, including your own
      handUp: false, // your own hand is raised
      phase: "day", // day | dusk | night, shared by the Storyteller
      timerActive: false, // the chat timer is running (private chats allowed)
      timerEnd: 0, // local clock time (ms) when the chat timer runs out
      chats: [], // chats you may see: { id, num, whisper, members: [playerId], hidden: [playerId] }
      busy: [], // playerIds in a private Storyteller chat, nobody outside can hear them
      invisible: false, // Storyteller: sitting in a room unseen, mic locked off
      mutedPlayers: [], // playerIds the Storyteller has muted one by one
      lockedMute: false, // the Storyteller has muted you personally (Town Square)
      roomMicOn: true, // your own mute toggle inside a private chat
      tsMicOn: true, // your Town Square mic: your own toggle, and not muted by the Storyteller
      tsSelfMuted: false, // your own Town Square toggle (what happens once the Storyteller unmutes you)
      tsLocked: false, // the Storyteller has you muted in the Town Square
      roomLocked: false, // the Storyteller has you muted in your private chat
      roomMutedIds: [], // playerIds muted inside their private chat
      micLocked: false, // the Storyteller has muted you where you are right now
      bluffsPulse: 0, // goes up each time the Storyteller sends you demon bluffs
      grimoirePulse: 0, // goes up each time the Storyteller sends you the Grimoire
      incoming: [], // requests waiting for your answer
      notice: null, // latest status of a request you made
      rnnoise: true, // RNNoise noise suppression, always on
      rnnoiseStatus: "off", // off | loading | waiting | on | unsupported | error
      browserNs: true, // also use the browser's own noise filter, always on
      gate: loadGatePref() // noise gate strength 0-100, 0 = off
    });
    this._mutedKey = "";
    this._handKey = "";
    this._noticeTimer = null;
    // Muting is separate in the Town Square and in private chats:
    // _selfMuted is your Town Square choice, _roomSelfMuted your choice in the chat you are in
    this._roomSelfMuted = false;
    this._roomKey = ""; // which chat (and whether unseen) your room mute belongs to
    this._micKey = ""; // last mic state sent to the server
    this._selfMuted = false; // the player muted themselves; Storyteller unmutes keep it
    this._trackOn = true; // your mic is being sent (your chat, or the Storytellers' line)
    this._prevChat = null; // { id, members } of your own chat, to hear people come and go
    this._bellTimer = null; // rings the bell 5 seconds before the chat timer ends
    this._serverPhase = ""; // last phase the server told us about, to ring the bell on day
    this.onBluffs = null; // set by socket.js, stores the bluffs you were sent
    this.onGrimoire = null; // set by socket.js, shows the Grimoire you were sent
    this.onCohost = null; // set by socket.js, you became (true) or stopped being (false) the co-Storyteller
    this.onStSync = null; // set by socket.js, Grimoire changes from the other Storyteller
    this._joinedAsHost = false; // joined as the Storyteller (not the co-Storyteller)
    this._levelTimer = null;
    this._pollingLevels = false;
    this._busy = false;
    this._gen = 0; // bumped on every teardown so a stale join can bail out
    this._ws = null;
    this._stream = null;
    this._track = null; // the track currently sent to peers
    this._rawTrack = null; // the microphone track itself
    this._pipeline = null; // RNNoise audio graph, once loaded
    this._playerId = "";
    this._conns = new Map(); // id -> { pc, audio, sender, playerId, meter, lastLoud }
    this._names = new Map(); // id -> { name, playerId } from peer-joined
    this._ctx = null;
    this._selfMeter = null;
    this._selfLoud = 0;
    this._probeTrack = null; // a copy of your mic that stays on, only to notice you talking while muted
    this._probeMeter = null;
    this._mutedLoud = 0;
    this._speakingKey = "";
    this._tickTimer = null;
    this._statsTimer = null;
    this._unlockHandler = null;
  }

  async join(room, name, playerId, isHost = false) {
    if (this._ws || this._busy) return;
    this._busy = true;
    this.state.error = "";
    this._playerId = playerId || "";
    this.state.hostPlayerId = isHost ? this._playerId : "";
    this._joinedAsHost = !!isHost;
    if (isHost) name = this.state.hostName;
    this.state.isHost = !!isHost;
    this.state.allMuted = false;
    const gen = this._gen;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (e) {
      this._busy = false;
      this.state.error =
        "Microphone blocked. Allow mic access (needs HTTPS or localhost).";
      return;
    }
    if (gen !== this._gen) {
      // left (or switched session) while the mic prompt was open
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    this._stream = stream;
    this._track = stream.getAudioTracks()[0];
    this.state.micOn = true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this._ctx = this._createContext(AudioCtx);
    this._ctx.onstatechange = () => this._activatePipeline();
    this._selfMeter = this._makeMeter(this._stream);
    this._rawTrack = this._track;
    // muting switches the mic itself off, so a separate copy is kept on (never sent
    // anywhere) to light your ring red when you talk while muted
    try {
      this._probeTrack = this._rawTrack.clone();
      this._probeTrack.enabled = true;
      this._probeMeter = this._makeMeter(new MediaStream([this._probeTrack]));
    } catch (e) {
      this._probeTrack = this._probeMeter = null;
    }
    this._applyBrowserNs();
    this._initDenoise(gen);

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/voice`);
    this._ws = ws;
    this._busy = false;
    ws.onopen = () =>
      this._send({
        type: "join",
        room: String(room),
        name,
        playerId,
        isHost: !!isHost
      });
    ws.onmessage = e => this._onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this._ws === ws) this._teardown("Voice server disconnected.");
    };
    this._tickTimer = setInterval(() => this._tick(), 100);
    this._statsTimer = setInterval(() => this._pollStats(), 3000);
    this._levelTimer = setInterval(() => this._pollLevels(), 200);

    // Browsers block audio until the page has been clicked. If we joined
    // automatically on page load, start playback on the first interaction.
    this._unlockHandler = () => this._unlock();
    ["pointerdown", "keydown"].forEach(ev =>
      document.addEventListener(ev, this._unlockHandler)
    );
  }

  leave() {
    this._teardown("");
  }

  // Your mic where you are right now: in your private chat if you are in one, else the Town Square
  // The mute button / [M]: your mic where you are. While the Storyteller has you muted
  // it still flips your own choice ("Stay Muted" / "Unmute"), which takes effect
  // once the Storyteller unmutes you.
  toggleMic() {
    if (this.chatOf(this._playerId)) this.toggleRoomMic(true);
    else this.toggleTsMic(true);
  }

  // Town Square mute (your seat / Storyteller token). Players can always mute,
  // but can't unmute while the Storyteller has them muted (unless choosing for later).
  toggleTsMic(choose = false) {
    if (!this._track) return;
    const locked =
      !this.state.isHost && (this.state.lockedMute || this.state.allMuted);
    if (locked && this._selfMuted && !choose) return;
    this._selfMuted = !this._selfMuted;
    this._applyMic();
  }

  // Private chat mute (next to your name in the room)
  toggleRoomMic(choose = false) {
    if (!this._track) return;
    const mine = this.chatOf(this._playerId);
    if (!mine) return;
    const locked =
      !this.state.isHost && (mine.muted || []).includes(this._playerId);
    if (locked && this._roomSelfMuted && !choose) return;
    this._roomSelfMuted = !this._roomSelfMuted;
    this._applyMic();
  }

  // Works out whether your mic should be live, applies it, and tells everyone your
  // Town Square and private chat mute toggles.
  _applyMic() {
    const mine = this.chatOf(this._playerId);
    const host = this.state.isHost;
    let locked;
    let on;
    if (mine) {
      locked = !host && (mine.muted || []).includes(this._playerId);
      on = !this._roomSelfMuted && !locked;
    } else {
      locked = !host && (this.state.lockedMute || this.state.allMuted);
      on = !this._selfMuted && !locked;
    }
    const urgent = this._urgentSelf();
    if (urgent) on = false;
    this.state.micLocked = locked;
    this.state.roomMicOn = !this._roomSelfMuted;
    this.state.tsSelfMuted = this._selfMuted;
    this.state.tsLocked = !host && (this.state.lockedMute || this.state.allMuted);
    this.state.roomLocked =
      !host && !!mine && (mine.muted || []).includes(this._playerId);
    this.state.tsMicOn = !this._selfMuted && !urgent && !this.state.tsLocked;
    // the Storytellers' line keeps your mic going for the other Storyteller; everyone
    // else goes by your chat / Town Square toggles, which they are told about below
    this.state.micOn = on;
    this._trackOn = on || this._lineOn(this._playerId);
    if (this._track) {
      this._track.enabled = this._trackOn;
      if (this._rawTrack) this._rawTrack.enabled = this._trackOn;
    }
    // everyone else silences you by these, so they include the Urgent Line
    const tsOn = !this._selfMuted && !urgent;
    const roomOn = !this._roomSelfMuted && !urgent;
    const key = `${tsOn},${roomOn}`;
    if (key !== this._micKey) {
      this._micKey = key;
      this._send({ type: "mic", on: tsOn, room: roomOn });
    }
    this._refreshMuted();
  }

  // Raise or lower your own hand; everyone in the room sees it.
  setHand(on) {
    on = !!on;
    this.state.handUp = on;
    this._send({ type: "hand", on });
    this._refreshHands();
  }

  toggleHand() {
    this.setHand(!this.state.handUp);
  }

  // Storyteller only: ask a player's client to lower their hand.
  lowerHand(playerId) {
    if (!this.state.isHost || !playerId) return;
    this._send({ type: "lower-hand", playerId });
  }

  _refreshHands() {
    const ids = [];
    if (this._playerId && this.state.handUp) ids.push(this._playerId);
    for (const p of this.state.peers) {
      if (p.hand && p.playerId) ids.push(p.playerId);
    }
    const key = ids.join(",");
    if (key !== this._handKey) {
      this._handKey = key;
      this.state.handIds = ids;
    }
  }

  // Audio from someone the Storyteller has muted is silenced on every client too,
  // so it holds even if their client ignores it. Town Square and chat mutes are separate.
  _forced(c) {
    if (this.isSt(c.playerId)) return false;
    const theirs = this.chatOf(c.playerId);
    if (theirs) return (theirs.muted || []).includes(c.playerId);
    return this.state.mutedPlayers.includes(c.playerId) || this.state.allMuted;
  }

  // Storyteller only: mute or unmute someone inside their private chat.
  setRoomMuted(playerId, on) {
    if (!this.state.isHost || !playerId) return;
    this._send({ type: "room-mute", playerId, on: !!on });
  }

  // Storyteller only: mute or unmute one player.
  setPlayerMuted(playerId, on) {
    if (!this.state.isHost || !playerId) return;
    this._applyPlayerMuted(playerId, !!on);
    this._send({ type: "mute-player", playerId, on: !!on });
  }

  _applyPlayerMuted(playerId, on) {
    const list = this.state.mutedPlayers.filter(id => id !== playerId);
    if (on) list.push(playerId);
    this.state.mutedPlayers = list;
    if (playerId === this._playerId && !this.state.isHost) this._applyLocked();
    this._syncAllAudio();
    this._refreshMuted();
  }

  // Your own mic follows a personal mute from the Storyteller.
  _applyLocked() {
    const locked = this.state.mutedPlayers.includes(this._playerId);
    if (locked === this.state.lockedMute) return;
    this.state.lockedMute = locked;
    this._applyMic();
  }

  // Runs whenever the list of chats changes.
  _onChatsChanged() {
    const mine = this.chatOf(this._playerId);
    this._chatSounds(mine);
    // once you are in a chat, any request you were waiting on is gone
    const n = this.state.notice;
    if (mine && n && (n.status === "hold" || n.status === "sent")) this._setNotice(null);
    // a new chat starts unmuted; the Storyteller joining unseen starts muted
    const hidden = !!(mine && (mine.hidden || []).includes(this._playerId));
    const key = mine ? `${mine.id}:${hidden}` : "";
    if (key !== this._roomKey) {
      this._roomKey = key;
      this._roomSelfMuted = hidden;
    }
    this.state.invisible = hidden;
    this._applyMic();
    this._syncAllAudio();
    this._refreshMuted();
  }

  // enter.mp3 when you (or someone else) come into your chat, leave.mp3 when anyone goes
  _chatSounds(mine) {
    const prev = this._prevChat;
    this._prevChat = mine ? { id: mine.id, members: [...mine.members] } : null;
    if (!prev && !mine) return;
    if (!prev || (mine && mine.id !== prev.id)) return playSound("enter");
    if (!mine) return playSound("leave");
    if (mine.members.some(m => !prev.members.includes(m))) playSound("enter");
    else if (prev.members.some(m => !mine.members.includes(m))) playSound("leave");
  }

  // Storyteller only: send the three demon bluffs to the demon's Other Characters tray
  sendBluffs(playerId, roles) {
    if (!this.state.isHost || !playerId) return;
    this._send({ type: "send-bluffs", to: playerId, roles });
  }

  // Storyteller only: show one player (the Spy) every seat's character and reminder tokens
  sendGrimoire(playerId, seats) {
    if (!this.state.isHost || !playerId) return;
    this._send({ type: "send-grimoire", to: playerId, players: seats });
  }

  // Storyteller only
  joinChat(chatId, hidden) {
    if (!this.state.isHost) return;
    this._send({ type: "chat-join", chatId, hidden: !!hidden });
  }

  // Storyteller only: become visible in the room you're in, or go invisible again.
  // Players see you come in or leave (with the enter / leave sounds).
  setHidden(hidden) {
    if (!this.state.isHost) return;
    this._send({ type: "chat-visibility", hidden: !!hidden });
  }

  // Storytellers: open a hidden private room, then add players to it from their seat menu
  openPrivateRoom() {
    if (!this.state.isHost) return;
    this._send({ type: "st-room-open" });
  }

  whisper(playerId) {
    if (!this.state.isHost || !playerId) return;
    this._send({ type: "whisper-start", to: playerId });
  }

  endWhisper() {
    if (!this.state.isHost) return;
    this._send({ type: "whisper-end" });
  }

  // Players: ask the Storyteller for a private chat, in any phase
  requestStoryteller(to) {
    this._send({ type: "chat-request", kind: "st", to: to || "" });
  }

  // Works out which playerIds are muted: in the Town Square (icon by each nameplate)
  // and inside private chats (icon by each name in the room list).
  _refreshMuted() {
    const muted = [];
    const roomMuted = [];
    const host = this.state.isHost;
    if (this._playerId) {
      const tsLocked = !host && (this.state.lockedMute || this.state.allMuted);
      const urgent = this._urgentSelf();
      if (this._selfMuted || tsLocked || urgent) muted.push(this._playerId);
      const mine = this.chatOf(this._playerId);
      const roomLocked =
        !host && !!mine && (mine.muted || []).includes(this._playerId);
      if (mine && (this._roomSelfMuted || roomLocked || urgent)) {
        roomMuted.push(this._playerId);
      }
    }
    for (const [id, c] of this._conns) {
      if (!c.playerId) continue;
      const peer = this.state.peers.find(p => p.id === id);
      const tsOff = !!peer && peer.micOn === false;
      if (tsOff || this._tsForced(c)) muted.push(c.playerId);
      const theirs = this.chatOf(c.playerId);
      const roomOff = !!peer && peer.roomMicOn === false;
      if (theirs && (roomOff || this._forced(c))) roomMuted.push(c.playerId);
    }
    const auto = [this.state.hostPlayerId, this.state.cohostPlayerId].filter(
      id => id && this._lineAuto(id)
    );
    const key =
      muted.join(",") + "|" + roomMuted.join(",") + "|" + auto.join(",");
    if (key !== this._mutedKey) {
      this._mutedKey = key;
      this.state.mutedIds = muted;
      this.state.roomMutedIds = roomMuted;
      this.state.lineAutoIds = auto;
    }
  }

  // muted by the Storyteller in the Town Square (mute all or one by one)
  _tsForced(c) {
    if (this.isSt(c.playerId)) return false;
    return this.state.mutedPlayers.includes(c.playerId) || this.state.allMuted;
  }

  // Storyteller only: change the name shown on the Storyteller token for everyone.
  setHostName(name) {
    if (this.state.isCoHost) {
      const own = String(name || "").trim().slice(0, 30) || "Co-Storyteller";
      this.state.cohostName = own;
      this._send({ type: "rename", name: own });
      return;
    }
    const clean = String(name || "").trim().slice(0, 30) || DEFAULT_HOST_NAME;
    this.state.hostName = clean;
    try {
      localStorage.setItem(HOST_NAME_KEY, clean);
    } catch (e) {
      // storage unavailable, the name just won't be remembered
    }
    this._send({ type: "rename", name: clean });
  }

  // Storyteller only: mute or unmute every player (the Storyteller stays live).
  setAllMuted(on) {
    if (!this.state.isHost) return;
    this._applyAllMuted(on, true);
    this._send({ type: "mute-all", on: !!on });
  }

  muteAll() {
    this.setAllMuted(true);
  }

  unmuteAll() {
    this.setAllMuted(false);
  }

  // toggled: someone just pressed Mute all / Unmute all (not joining a muted town).
  // Both Storytellers are muted in the Town Square too, but can unmute themselves.
  _applyAllMuted(on, toggled = false) {
    on = !!on;
    if (toggled && this.state.isHost) this._selfMuted = on;
    this.state.allMuted = on;
    // players' Town Square mics follow the Storyteller's toggle; unmuting puts back
    // whatever the player chose for themselves. Private chats are not affected.
    this._applyMic();
    // also silence incoming audio from muted players, so it holds even if
    // someone's client ignores the mute
    for (const id of this._conns.keys()) this._syncAudio(id);
    this._refreshMuted();
  }

  _syncAudio(id) {
    const c = this._conns.get(id);
    if (!c) return;
    const peer = this.state.peers.find(p => p.id === id);
    const hear = peer ? peer.hear : true;
    const silent = !hear || !this._hears(c, peer);
    if (c.boost) {
      // boosted: the audio element stays muted and the gain node plays instead
      c.audio.muted = true;
      c.boost.gain.gain.value = silent ? 0 : this._volumeFor(c.playerId);
    } else {
      c.audio.muted = silent;
    }
  }

  // Volume up to 100% uses the audio element. Above that (mic boost, up to 200%)
  // the player's audio is played through a Web Audio gain node instead, since
  // an audio element can't go louder than 100%.
  _applyVolume(id) {
    const c = this._conns.get(id);
    if (!c) return;
    const v = this._volumeFor(c.playerId);
    const stream = c.audio.srcObject;
    if (v > 1 && this._ctx && stream) {
      if (!c.boost) {
        const source = this._ctx.createMediaStreamSource(stream);
        const gain = this._ctx.createGain();
        source.connect(gain);
        gain.connect(this._ctx.destination);
        c.boost = { source, gain, stream };
      }
      c.audio.volume = 1;
    } else {
      this._dropBoost(c);
      c.audio.volume = Math.min(1, v);
    }
    this._syncAudio(id);
  }

  _dropBoost(c) {
    if (!c.boost) return;
    try {
      c.boost.source.disconnect();
      c.boost.gain.disconnect();
    } catch (e) {
      // already disconnected
    }
    c.boost = null;
  }

  // Whether you hear someone at all: over the Storytellers' line, or where you both are
  // (and only while their mic is on there, since the line can keep it sending)
  _hears(c, peer) {
    if (this._onLine(c)) return true;
    return !this._forced(c) && this._audible(c) && this._contextMic(c, peer);
  }

  // Storytellers always hear each other, unless the speaker is muted on the line
  _onLine(c) {
    return this.state.isHost && this.isSt(c.playerId) && this._lineOn(c.playerId);
  }

  _lineOn(playerId) {
    if (this.state.urgent && this.state.isHost && this.isSt(playerId)) {
      return !!this.state.cohostPlayerId;
    }
    return (
      this.state.isHost &&
      !!this.state.cohostPlayerId &&
      this.isSt(playerId) &&
      !this.state.lineMuted.includes(playerId) &&
      !this._lineAuto(playerId)
    );
  }

  // A Storyteller who is unmuted in the same place as the other Storyteller (both in the
  // Town Square, or in the same room) is already heard there, so their line is off for now.
  // Worked out per Storyteller: it only depends on their own mic and where both of them are.
  _lineAuto(playerId) {
    const { hostPlayerId, cohostPlayerId } = this.state;
    if (!hostPlayerId || !cohostPlayerId) return false;
    const other = playerId === hostPlayerId ? cohostPlayerId : hostPlayerId;
    const mine = this.chatOf(playerId);
    const theirs = this.chatOf(other);
    const together = (!mine && !theirs) || (!!mine && !!theirs && mine.id === theirs.id);
    return together && this._placeMicOn(playerId);
  }

  // Someone's own mute toggle for where they are: their room, or the Town Square
  _placeMicOn(playerId) {
    if (playerId === this._playerId) return this.state.micOn;
    const peer = this.state.peers.find(p => p.playerId === playerId);
    if (!peer) return false;
    return this.chatOf(playerId)
      ? peer.roomMicOn !== false
      : peer.micOn !== false;
  }

  // Their own mute toggle for where you hear them: their room, or the Town Square
  _contextMic(c, peer) {
    if (!peer) return true;
    const mine = this.chatOf(this._playerId);
    const withMe =
      !!mine &&
      (mine.members.includes(c.playerId) ||
        (mine.god || []).includes(c.playerId));
    const inChat = withMe || !!this.chatOf(c.playerId);
    return inChat ? peer.roomMicOn !== false : peer.micOn !== false;
  }

  // Storytellers: mark both Storytellers dead, or alive again
  setStDead(on) {
    if (!this.state.isHost) return;
    this._send({ type: "st-dead", on: !!on });
  }

  // Storytellers: stop the wake-up music for everyone
  stopMusicAll() {
    if (!this.state.isHost) return;
    stopMusic();
    this._send({ type: "music-stop" });
  }

  _urgentSelf() {
    return this.state.urgent && this.state.isHost && !!this.state.cohostPlayerId;
  }

  // Storytellers: turn the Urgent Line on or off for both Storytellers
  setUrgent(on) {
    if (!this.state.isHost || !this.state.cohostPlayerId) return;
    this._send({ type: "st-urgent", on: !!on });
  }

  // Storytellers: mute or unmute yourself or the other Storyteller on your line
  setLineMuted(playerId, on) {
    if (!this.state.isHost || !this.isSt(playerId)) return;
    this._send({ type: "st-line", playerId, on: !!on });
  }

  _applyLine(muted) {
    this.state.lineMuted = Array.isArray(muted) ? muted : [];
    this._applyMic();
    this._syncAllAudio();
  }

  // Private chats: inside a chat you only hear the people in it, and outside
  // of one you only hear people who are not in a chat.
  _audible(c) {
    const mine = this.chatOf(this._playerId);
    const theirs = this.chatOf(c.playerId);
    if (mine) {
      if (theirs && theirs.id === mine.id) return true;
      // a Storyteller sitting in your room unseen
      return (mine.god || []).includes(c.playerId);
    }
    if (theirs) return false;
    return !this.state.busy.includes(c.playerId);
  }

  chatOf(playerId) {
    if (!playerId) return null;
    return this.state.chats.find(c => c.members.includes(playerId)) || null;
  }

  // The Storyteller or the co-Storyteller
  isSt(playerId) {
    return (
      !!playerId &&
      (playerId === this.state.hostPlayerId ||
        playerId === this.state.cohostPlayerId)
    );
  }

  // ---- co-Storyteller ----

  // An unseated player asks the Storyteller to become the co-Storyteller
  requestCohost(name) {
    if (this.state.isHost) return;
    this._send({ type: "cohost-request", name: String(name || "").slice(0, 30) });
  }

  // The Storyteller removes the co-Storyteller, or the co-Storyteller steps down
  removeCohost() {
    if (!this.state.isHost) return;
    this._send({ type: "cohost-remove" });
  }

  // Storytellers: take a player out of whatever private chat they are in
  kick(playerId) {
    if (!this.state.isHost || !playerId) return;
    this._send({ type: "chat-kick", playerId });
  }

  // Grimoire changes for the other Storyteller (see socket.js)
  sendStSync(data) {
    if (!this.state.isHost || !this.state.cohostPlayerId) return;
    this._send({ type: "st-sync", data });
  }

  // force: on welcome, so a co-Storyteller removed while disconnected finds out too
  _setCohost(info, force = false) {
    const pid = (info && info.playerId) || "";
    this.state.cohostPlayerId = pid;
    this.state.cohostName = pid ? info.name || "Co-Storyteller" : "";
    const me = !!pid && pid === this._playerId;
    if (!this._joinedAsHost && (force || me !== this.state.isCoHost)) {
      this.state.isCoHost = me;
      this.state.isHost = me;
      if (this.onCohost) this.onCohost(me);
    }
    this._applyMic();
    this._syncAllAudio();
    this._refreshMuted();
  }

  _syncAllAudio() {
    for (const id of this._conns.keys()) this._syncAudio(id);
  }

  // ---- phase, chat timer and private chats ----

  // Storyteller only: day, dusk or night. Ends the chat timer and any private chats.
  setPhase(phase) {
    if (!this.state.isHost || !["day", "dusk", "night", "end"].includes(phase)) return;
    this.state.phase = phase;
    if (this.state.timerActive) this._setTimer(0);
    this._send({ type: "phase", phase });
  }

  startTimer(seconds) {
    if (!this.state.isHost || this.state.phase !== "day") return;
    this._send({ type: "timer-start", seconds });
  }

  stopTimer() {
    if (!this.state.isHost) return;
    this._send({ type: "timer-stop" });
  }

  _setTimer(leftMs) {
    clearTimeout(this._bellTimer);
    this._bellTimer = null;
    if (leftMs > 5000) {
      this._bellTimer = setTimeout(() => playSound("bell"), leftMs - 5000);
    }
    this.state.timerActive = leftMs > 0;
    this.state.timerEnd = leftMs > 0 ? Date.now() + leftMs : 0;
    if (leftMs <= 0) {
      // rooms are closed by the server; requests for a chat with the Storyteller stay
      this.state.incoming = this.state.incoming.filter(r => r.kind === "st");
    }
  }

  requestChat(playerId) {
    this._send({ type: "chat-request", kind: "new", to: playerId });
  }

  invite(playerId) {
    this._send({ type: "chat-request", kind: "invite", to: playerId });
  }

  requestJoin(chatId) {
    this._send({ type: "chat-request", kind: "join", chatId });
  }

  // Gives up on a chat request you made (e.g. while on hold)
  cancelRequest(id) {
    this._send({ type: "chat-cancel", id });
    if (this.state.notice && this.state.notice.id === id) this._setNotice(null);
  }

  respond(id, answer) {
    this._send({ type: "chat-respond", id, answer });
    this.state.incoming = this.state.incoming.filter(r => r.id !== id);
  }

  leaveChat() {
    const mine = this.chatOf(this._playerId);
    if (mine && mine.locked && !this.state.isHost) return;
    this._send({ type: "chat-leave" });
  }

  _setNotice(notice) {
    clearTimeout(this._noticeTimer);
    this.state.notice = notice;
    // "on hold" stays up until you cancel or it changes
    if (notice && notice.status !== "hold") {
      this._noticeTimer = setTimeout(() => (this.state.notice = null), 7000);
    }
  }

  // "Hear" mutes a player locally; "Talk" stops sending your mic to them (whispering).
  setHear(id, on) {
    this._patch(id, { hear: on });
    this._syncAudio(id);
  }

  setTalk(id, on) {
    const c = this._conns.get(id);
    if (c) c.sender.replaceTrack(on ? this._track : null);
    this._patch(id, { talk: on });
  }

  // How loud one player is for you only (0-200, over 100 is a boost). Saved per player in this browser.
  setVolume(playerId, percent) {
    if (!playerId) return;
    const v = Math.max(0, Math.min(200, Math.round(percent)));
    this.state.volumes = { ...this.state.volumes, [playerId]: v };
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.state.volumes));
    } catch (e) {
      // storage unavailable, the volume just won't be remembered
    }
    for (const [id, c] of this._conns) {
      if (c.playerId === playerId) this._applyVolume(id);
    }
  }

  _volumeFor(playerId) {
    const v = this.state.volumes[playerId];
    return v === undefined ? 1 : v / 100;
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  async _onMessage(msg) {
    if (msg.type === "error") {
      this._teardown(msg.message);
    } else if (msg.type === "welcome") {
      this.state.joined = true;
      this.state.phase = msg.phase || "day";
      this._serverPhase = this.state.phase;
      this.state.chats = msg.chats || [];
      const mine = this.chatOf(this._playerId);
      this._prevChat = mine ? { id: mine.id, members: [...mine.members] } : null;
      const hidden = !!(mine && (mine.hidden || []).includes(this._playerId));
      this._roomKey = mine ? `${mine.id}:${hidden}` : "";
      this._roomSelfMuted = hidden;
      this.state.invisible = hidden;
      this.state.busy = msg.busy || [];
      this.state.mutedPlayers = msg.mutedPlayers || [];
      this._applyLocked();
      this._setTimer(msg.timerLeft || 0);
      if (this.state.isHost) {
        // keep a mute the Storyteller set before the connection opened, or adopt the room's
        this.state.allMuted = this.state.allMuted || !!msg.allMuted;
        if (this.state.allMuted) this._send({ type: "mute-all", on: true });
      } else {
        this._applyAllMuted(msg.allMuted);
      }
      this.state.lineMuted = msg.lineMuted || [];
      this.state.urgent = !!msg.urgent;
      this.state.stDead = !!msg.stDead;
      this._setCohost(msg.cohost, true);
      // the newcomer starts the call with everyone already here
      for (const p of msg.peers) {
        const conn = this._makePeer(p.id, p);
        const offer = await conn.pc.createOffer();
        await conn.pc.setLocalDescription(offer);
        this._send({
          type: "signal",
          to: p.id,
          data: { description: conn.pc.localDescription }
        });
      }
    } else if (msg.type === "peer-joined") {
      this._names.set(msg.id, msg);
    } else if (msg.type === "mute-all") {
      this._applyAllMuted(msg.on, true);
    } else if (msg.type === "peer-mic") {
      this._patch(msg.id, { micOn: !!msg.on, roomMicOn: msg.room !== false });
      this._syncAudio(msg.id);
      this._refreshMuted();
    } else if (msg.type === "phase") {
      // the bell rings for everyone when day breaks and when night falls;
      // daybreak also starts the wake-up music, which stops when someone dies
      const changed = !!this._serverPhase && this._serverPhase !== msg.phase;
      const bell = msg.phase === "day" || msg.phase === "night";
      if (bell && changed) playSound("bell");
      if (changed && msg.phase === "day") startMusic();
      else if (changed) stopMusic();
      this._serverPhase = msg.phase;
      this.state.phase = msg.phase;
      this._setTimer(0);
    } else if (msg.type === "timer") {
      this._setTimer(msg.left || 0);
    } else if (msg.type === "bluffs") {
      if (this.onBluffs) this.onBluffs(msg.roles || []);
      this.state.bluffsPulse++;
    } else if (msg.type === "grimoire") {
      if (this.onGrimoire) this.onGrimoire(msg.players || []);
      this.state.grimoirePulse++;
    } else if (msg.type === "cohost") {
      this._setCohost(msg);
    } else if (msg.type === "st-dead") {
      // the Storytellers died: everyone hears it (and the wake-up music stops)
      if (msg.on && !this.state.stDead) playSound("death");
      this.state.stDead = !!msg.on;
    } else if (msg.type === "music-stop") {
      stopMusic();
    } else if (msg.type === "st-urgent") {
      this.state.urgent = !!msg.on;
      this._applyMic();
      this._syncAllAudio();
    } else if (msg.type === "st-line") {
      this._applyLine(msg.muted);
    } else if (msg.type === "st-sync") {
      if (this.state.isHost && this.onStSync) this.onStSync(msg.data || {});
    } else if (msg.type === "player-muted") {
      this._applyPlayerMuted(msg.playerId, !!msg.on);
    } else if (msg.type === "chats") {
      this.state.chats = msg.chats;
      this.state.busy = msg.busy || [];
      this._onChatsChanged();
    } else if (msg.type === "chat-request") {
      const known = this.state.incoming.some(r => r.id === msg.id);
      const req = { id: msg.id, kind: msg.kind, from: msg.from, chatId: msg.chatId, num: msg.num, hold: !!msg.hold, name: msg.name || "" };
      // a request already showing just changes in place (on hold / off hold)
      this.state.incoming = known
        ? this.state.incoming.map(r => (r.id === msg.id ? req : r))
        : [...this.state.incoming, req];
      if (!known) playSound("call");
    } else if (msg.type === "chat-cancel") {
      this.state.incoming = this.state.incoming.filter(r => r.id !== msg.id);
    } else if (msg.type === "chat-status") {
      const n = this.state.notice;
      if (msg.status === "closed") {
        // the request is gone: clear "sent" / "on hold", keep "accepted" etc.
        if (n && n.id === msg.id && (n.status === "sent" || n.status === "hold")) this._setNotice(null);
      } else {
        this._setNotice({ id: msg.id, status: msg.status, who: msg.who, num: msg.num });
      }
    } else if (msg.type === "lower-hand") {
      if (msg.playerId && msg.playerId === this._playerId && this.state.handUp) {
        this.setHand(false);
      }
    } else if (msg.type === "peer-hand") {
      this._patch(msg.id, { hand: !!msg.on });
      this._refreshHands();
    } else if (msg.type === "peer-renamed") {
      const known = this._names.get(msg.id);
      if (known) known.name = msg.name;
      const peer = this.state.peers.find(p => p.id === msg.id);
      if (peer) {
        peer.name = msg.name;
        if (peer.isHost) this.state.hostName = msg.name;
        else if (peer.playerId && peer.playerId === this.state.cohostPlayerId) {
          this.state.cohostName = msg.name;
        }
      }
    } else if (msg.type === "peer-left") {
      this._removePeer(msg.id);
    } else if (msg.type === "signal") {
      await this._onSignal(msg.from, msg.data);
    }
  }

  async _onSignal(from, data) {
    let conn = this._conns.get(from);
    try {
      if (data.description) {
        if (!conn) conn = this._makePeer(from, this._names.get(from) || {});
        await conn.pc.setRemoteDescription(data.description);
        if (data.description.type === "offer") {
          const answer = await conn.pc.createAnswer();
          await conn.pc.setLocalDescription(answer);
          this._send({
            type: "signal",
            to: from,
            data: { description: conn.pc.localDescription }
          });
        }
      } else if (data.candidate && conn) {
        await conn.pc.addIceCandidate(data.candidate);
      }
    } catch (e) {
      console.warn("voice signal error", e);
    }
  }

  _makePeer(id, info) {
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio();
    audio.autoplay = true;
    audio.volume = Math.min(1, this._volumeFor(info.playerId));
    const sender = pc.addTrack(this._track, this._stream);
    const conn = {
      pc,
      audio,
      sender,
      playerId: info.playerId || "",
      meter: null,
      lastLoud: 0,
      statDb: -100, // loudness (dB) from the WebRTC receiver stats, independent of the analyser
      isHost: !!info.isHost
    };
    audio.muted = this.state.allMuted && !info.isHost;
    if (info.isHost && info.playerId) this.state.hostPlayerId = info.playerId;
    if (info.isHost && info.name) this.state.hostName = info.name;
    pc.ontrack = e => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {}); // blocked until the first click, see _unlock
      if (this._ctx) conn.meter = this._makeMeter(e.streams[0]);
      // a boost set up for an older stream has to be rebuilt for this one
      if (conn.boost && conn.boost.stream !== e.streams[0]) this._dropBoost(conn);
      this._applyVolume(id);
    };
    pc.onicecandidate = e => {
      if (e.candidate) {
        this._send({
          type: "signal",
          to: id,
          data: { candidate: e.candidate }
        });
      }
    };
    pc.onconnectionstatechange = () =>
      this._patch(id, { status: pc.connectionState });
    this._conns.set(id, conn);
    this.state.peers = [
      ...this.state.peers,
      {
        id,
        name: info.name || "Player",
        playerId: info.playerId || "",
        isHost: !!info.isHost,
        micOn: info.micOn !== false,
        roomMicOn: info.roomMicOn !== false,
        hand: !!info.hand,
        hear: true,
        talk: true,
        speaking: false,
        status: "connecting",
        rtt: null,
        route: ""
      }
    ];
    this._refreshMuted();
    this._refreshHands();
    this._syncAudio(id);
    return conn;
  }

  _removePeer(id) {
    const c = this._conns.get(id);
    if (c) {
      this._dropBoost(c);
      c.pc.close();
      c.audio.srcObject = null;
      this._conns.delete(id);
      if (c.isHost && this.state.hostPlayerId === c.playerId) {
        this.state.hostPlayerId = "";
      }
    }
    this._names.delete(id);
    this.state.peers = this.state.peers.filter(p => p.id !== id);
    this._refreshMuted();
    this._refreshHands();
  }

  _patch(id, props) {
    const peer = this.state.peers.find(p => p.id === id);
    if (peer) Object.assign(peer, props);
  }

  _unlock() {
    if (this._ctx && this._ctx.state === "suspended") this._ctx.resume();
    for (const c of this._conns.values()) c.audio.play().catch(() => {});
    ["pointerdown", "keydown"].forEach(ev =>
      document.removeEventListener(ev, this._unlockHandler)
    );
  }

  // RNNoise only works at 48kHz, so ask for that
  _createContext(AudioCtx) {
    try {
      return new AudioCtx({ sampleRate: 48000 });
    } catch (e) {
      return new AudioCtx();
    }
  }

  // Turn RNNoise noise suppression on or off (always on from the UI).
  setRnnoise(on) {
    on = !!on;
    this.state.rnnoise = on;
    if (!this._ctx) return;
    if (this._pipeline) this._applyDenoiseMode();
    else if (on && this.state.rnnoiseStatus !== "loading") {
      this._initDenoise(this._gen);
    }
  }

  // Builds: mic -> RNNoise -> (mix) -> outgoing track, with a dry path for "off".
  async _initDenoise(gen) {
    const ctx = this._ctx;
    if (!this.state.rnnoise) {
      this.state.rnnoiseStatus = "off";
      return;
    }
    if (!ctx.audioWorklet || ctx.sampleRate !== 48000) {
      this.state.rnnoiseStatus = "unsupported";
      return;
    }
    this.state.rnnoiseStatus = "loading";
    try {
      const {
        loadRnnoise,
        RnnoiseWorkletNode
      } = await import("@sapphi-red/web-noise-suppressor");
      const wasmBinary = await loadRnnoise({
        url: RNNOISE_URL + "rnnoise.wasm",
        simdUrl: RNNOISE_URL + "rnnoise_simd.wasm"
      });
      await ctx.audioWorklet.addModule(RNNOISE_URL + "rnnoiseWorklet.js");
      if (gen !== this._gen || ctx !== this._ctx) return; // left meanwhile
      const node = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 2 });
      const source = ctx.createMediaStreamSource(this._stream);
      const wet = ctx.createGain();
      const dry = ctx.createGain();
      const mix = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(dry);
      dry.connect(mix);
      node.connect(wet);
      wet.connect(mix);
      // noise gate on the audio thread; if its file is missing we skip it
      let gate = null;
      try {
        await ctx.audioWorklet.addModule(RNNOISE_URL + "noiseGate.js");
        gate = new AudioWorkletNode(ctx, "botc-noise-gate");
      } catch (e) {
        console.warn("Noise gate unavailable", e);
      }
      if (gen !== this._gen || ctx !== this._ctx) return;
      const out = gate || mix;
      if (gate) mix.connect(gate);
      out.connect(dest);
      out.connect(analyser);
      this._pipeline = {
        source,
        node,
        wet,
        dry,
        mix,
        gate,
        dest,
        analyser,
        track: dest.stream.getAudioTracks()[0],
        connected: false,
        active: false
      };
      // the talking ring and mic meter should follow the cleaned-up audio
      this._selfMeter = { analyser, data: new Uint8Array(analyser.fftSize) };
      this._applyDenoiseMode();
      this._applyGate();
      this._activatePipeline();
    } catch (e) {
      console.warn("RNNoise failed to load, keeping the browser's own noise suppression", e);
      if (gen === this._gen) this.state.rnnoiseStatus = "error";
    }
  }

  _applyDenoiseMode() {
    const p = this._pipeline;
    if (!p) return;
    const on = this.state.rnnoise;
    p.wet.gain.value = on ? 1 : 0;
    p.dry.gain.value = on ? 0 : 1;
    // only run the neural net while it is in use
    if (on && !p.connected) {
      p.source.connect(p.node);
      p.connected = true;
    } else if (!on && p.connected) {
      p.source.disconnect(p.node);
      p.connected = false;
    }
    this.state.rnnoiseStatus = on ? (p.active ? "on" : "waiting") : "off";
  }

  // The browser's own filter also catches keyboard and mouse clicks, which
  // RNNoise tends to let through, so by default both run.
  _applyBrowserNs() {
    if (!this._rawTrack) return;
    this._rawTrack
      .applyConstraints({ noiseSuppression: this.state.browserNs })
      .catch(() => {});
  }

  setBrowserNs(on) {
    on = !!on;
    this.state.browserNs = on;
    this._applyBrowserNs();
  }

  // Noise gate: 0 = off, higher = stricter. Anything quieter than the
  // threshold is cut, so quiet noise between words disappears.
  setGate(level) {
    const v = Math.max(0, Math.min(100, Math.round(level) || 0));
    this.state.gate = v;
    try {
      localStorage.setItem(GATE_KEY, String(v));
    } catch (e) {
      // storage unavailable, the setting just won't be remembered
    }
    this._applyGate();
  }

  _applyGate() {
    const p = this._pipeline;
    if (!p || !p.gate) return;
    p.gate.parameters.get("threshold").value = gateDb(this.state.gate);
  }

  // Browsers keep the audio graph silent until the page has been clicked, so
  // peers keep hearing the plain mic until the graph is running, then we switch.
  _activatePipeline() {
    const p = this._pipeline;
    if (!p || p.active || !this._ctx || this._ctx.state !== "running") return;
    p.active = true;
    this._setOutgoing(p.track);
    this.state.rnnoiseStatus = this.state.rnnoise ? "on" : "off";
  }

  _setOutgoing(track) {
    if (!track || track === this._track) return;
    track.enabled = this._trackOn;
    if (this._rawTrack) this._rawTrack.enabled = this._trackOn;
    this._track = track;
    for (const [id, c] of this._conns) {
      const peer = this.state.peers.find(p => p.id === id);
      if (!peer || peer.talk) c.sender.replaceTrack(track).catch(() => {});
    }
  }

  _disposePipeline() {
    const p = this._pipeline;
    this._pipeline = null;
    if (!p) return;
    try {
      p.source.disconnect();
      p.node.disconnect();
      if (p.node.destroy) p.node.destroy();
    } catch (e) {
      // already gone
    }
  }

  _makeMeter(stream) {
    const analyser = this._ctx.createAnalyser();
    analyser.fftSize = 2048;
    this._ctx.createMediaStreamSource(stream).connect(analyser);
    return { analyser, data: new Uint8Array(analyser.fftSize) };
  }

  // Loudness of the last stretch of audio in dB (RMS, like the noise gate measures it).
  // Uses the full float samples, so quiet sounds don't round down to silence.
  _dbOf(meter) {
    if (!meter) return -100;
    const a = meter.analyser;
    if (!meter.fdata || meter.fdata.length !== a.fftSize) {
      meter.fdata = new Float32Array(a.fftSize);
    }
    a.getFloatTimeDomainData(meter.fdata);
    let sum = 0;
    for (const v of meter.fdata) sum += v * v;
    const rms = Math.sqrt(sum / meter.fdata.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
  }

  // what your own sound has to reach to be sent: the noise gate's threshold
  // (once the noise filter is running), and never below the talking floor
  _selfSpeakingDb() {
    const p = this._pipeline;
    const gated = p && p.active && p.gate && this.state.gate > 0;
    return Math.max(SPEAKING_DB, gated ? gateDb(this.state.gate) : -100);
  }

  _levelOf(meter) {
    if (!meter) return 0;
    meter.analyser.getByteTimeDomainData(meter.data);
    let peak = 0;
    for (const v of meter.data) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(100, Math.round((peak / 128) * 160));
  }

  // Runs every 100ms: updates your mic meter and works out who is talking.
  _tick() {
    const now = Date.now();
    const level = this._trackOn ? this._levelOf(this._selfMeter) : 0;
    if (level !== this.state.level) this.state.level = level;
    if (this._trackOn && this._dbOf(this._selfMeter) >= this._selfSpeakingDb()) {
      this._selfLoud = now;
    }

    // talking while nothing of yours is being sent anywhere
    let mutedTalking = false;
    if (!this._trackOn && this._probeMeter) {
      if (this._levelOf(this._probeMeter) >= MUTED_TALK_LEVEL) this._mutedLoud = now;
      mutedTalking = now - this._mutedLoud < SPEAKING_HOLD_MS;
    }
    if (mutedTalking !== this.state.mutedTalking) {
      this.state.mutedTalking = mutedTalking;
    }

    // the portrait ring is for the Town Square and rooms; the line button lights
    // whenever the Storytellers' line is carrying your voice (both can be lit)
    const speaking = [];
    const lineSpeaking = [];
    if (this._playerId && now - this._selfLoud < SPEAKING_HOLD_MS) {
      if (this.state.micOn) speaking.push(this._playerId);
      if (this._lineOn(this._playerId)) lineSpeaking.push(this._playerId);
    }
    for (const [id, c] of this._conns) {
      // Each peer is judged on its own, using whichever signal is louder, so any
      // number of people can be lit at once.
      // what arrives has already been through their noise gate, so any real sound counts
      const peerDb = Math.max(this._dbOf(c.meter), c.statDb);
      if (peerDb >= SPEAKING_DB) c.lastLoud = now;
      const isSpeaking = now - c.lastLoud < SPEAKING_HOLD_MS;
      this._patch(id, { speaking: isSpeaking });
      if (!isSpeaking || !c.playerId) continue;
      const peer = this.state.peers.find(p => p.id === id);
      const where =
        !this._forced(c) && this._audible(c) && this._contextMic(c, peer);
      if (where) speaking.push(c.playerId);
      if (this._onLine(c)) lineSpeaking.push(c.playerId);
    }
    const key = speaking.join(",") + "|" + lineSpeaking.join(",");
    if (key !== this._speakingKey) {
      this._speakingKey = key;
      this.state.speakingIds = speaking;
      this.state.lineSpeakingIds = lineSpeaking;
    }
  }

  // Reads each peer's incoming audio level from the connection stats. This keeps
  // working even when the browser gives the analyser silence for a remote stream.
  async _pollLevels() {
    if (this._pollingLevels) return;
    this._pollingLevels = true;
    try {
      await Promise.all(
        [...this._conns.values()].map(async c => {
          if (c.pc.connectionState !== "connected") {
            c.statDb = -100;
            return;
          }
          const stats = await c.pc.getStats();
          let level = 0;
          stats.forEach(r => {
            if (r.type === "inbound-rtp" && r.kind === "audio") {
              if (r.audioLevel != null) level = Math.max(level, r.audioLevel);
            }
          });
          c.statDb = level > 0 ? 20 * Math.log10(level) : -100;
        })
      );
    } catch (e) {
      // a connection closed mid-poll, ignore
    }
    this._pollingLevels = false;
  }

  async _pollStats() {
    for (const [id, { pc }] of this._conns) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      stats.forEach(r => {
        if (
          r.type === "candidate-pair" &&
          r.nominated &&
          r.state === "succeeded"
        ) {
          const local = stats.get(r.localCandidateId);
          this._patch(id, {
            rtt:
              r.currentRoundTripTime != null
                ? Math.round(r.currentRoundTripTime * 1000)
                : null,
            route:
              local && local.candidateType === "relay" ? "relay" : "direct"
          });
        }
      });
    }
  }

  _teardown(error) {
    this._gen++;
    clearTimeout(this._bellTimer);
    this._bellTimer = null;
    this._prevChat = null;
    this._serverPhase = "";
    this._selfMuted = false;
    clearInterval(this._tickTimer);
    clearInterval(this._statsTimer);
    clearInterval(this._levelTimer);
    this.state.hostPlayerId = "";
    this.state.isHost = false;
    this.state.isCoHost = false;
    this.state.cohostPlayerId = "";
    this.state.cohostName = "";
    this.state.lineMuted = [];
    this.state.lineAutoIds = [];
    this.state.urgent = false;
    this.state.stDead = false;
    stopMusic();
    this._trackOn = true;
    this._joinedAsHost = false;
    this.state.allMuted = false;
    if (this._unlockHandler) {
      ["pointerdown", "keydown"].forEach(ev =>
        document.removeEventListener(ev, this._unlockHandler)
      );
      this._unlockHandler = null;
    }
    const ws = this._ws;
    this._ws = null;
    if (ws) ws.close();
    for (const c of this._conns.values()) {
      this._dropBoost(c);
      c.pc.close();
      c.audio.srcObject = null;
    }
    this._conns.clear();
    this._names.clear();
    this._disposePipeline();
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    if (this._probeTrack) this._probeTrack.stop();
    this._probeTrack = this._probeMeter = null;
    this._mutedLoud = 0;
    this.state.mutedTalking = false;
    if (this._ctx) this._ctx.close();
    this._stream = this._track = this._rawTrack = null;
    this._ctx = this._selfMeter = null;
    this._playerId = "";
    this._speakingKey = "";
    this._busy = false;
    this.state.joined = false;
    this.state.level = 0;
    this.state.peers = [];
    this.state.speakingIds = [];
    this.state.lineSpeakingIds = [];
    this.state.mutedIds = [];
    this._mutedKey = "";
    this.state.handIds = [];
    this.state.handUp = false;
    this.state.phase = "day";
    this.state.timerActive = false;
    this.state.timerEnd = 0;
    this.state.chats = [];
    this.state.busy = [];
    this.state.mutedPlayers = [];
    this.state.lockedMute = false;
    this.state.invisible = false;
    this._roomSelfMuted = false;
    this._roomKey = "";
    this._micKey = "";
    this.state.roomMicOn = true;
    this.state.tsMicOn = true;
    this.state.tsSelfMuted = false;
    this.state.tsLocked = false;
    this.state.roomLocked = false;
    this.state.roomMutedIds = [];
    this.state.micLocked = false;
    this.state.incoming = [];
    this.state.notice = null;
    this._handKey = "";
    this.state.rnnoiseStatus = "off";
    this.state.error = error || "";
  }
}

export default new VoiceChat();
