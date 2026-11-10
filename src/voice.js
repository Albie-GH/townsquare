import Vue from "vue";

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add a TURN server here if some players connect but can't hear each other:
    // { urls: "turn:HOST:3478", username: "user", credential: "pass" }
  ]
};

const SPEAKING_LEVEL = 12; // mic level (0-100) above which someone counts as talking
const SPEAKING_HOLD_MS = 350; // keep the ring lit briefly so it doesn't flicker
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

const RNNOISE_KEY = "botcRnnoise";
const RNNOISE_URL = (process.env.BASE_URL || "/") + "rnnoise/";

function loadRnnoisePref() {
  try {
    return localStorage.getItem(RNNOISE_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

const GATE_KEY = "botcNoiseGate";
const DEFAULT_GATE = 80; // noise gate strength until the player picks their own
const BROWSER_NS_KEY = "botcBrowserNs";

function loadGatePref() {
  try {
    const saved = localStorage.getItem(GATE_KEY);
    return saved === null ? DEFAULT_GATE : parseInt(saved, 10) || 0;
  } catch (e) {
    return DEFAULT_GATE;
  }
}

function loadBrowserNsPref() {
  try {
    return localStorage.getItem(BROWSER_NS_KEY) !== "off";
  } catch (e) {
    return true;
  }
}

// gate strength 0-100 -> threshold in dB (0 = off, 100 = -25dB)
function gateDb(level) {
  return level <= 0 ? -100 : -70 + level * 0.45;
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
      volumes: loadVolumes(), // playerId -> 0-100, how loud you hear each player
      hostPlayerId: "", // playerId of the storyteller in the voice room, if known
      hostName: loadHostName(), // the Storyteller's chosen name ("Storyteller" = none)
      isHost: false, // this client is the Storyteller
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
      lockedMute: false, // the Storyteller has muted you personally
      incoming: [], // requests waiting for your answer
      notice: null, // latest status of a request you made
      rnnoise: loadRnnoisePref(), // RNNoise noise suppression switched on
      rnnoiseStatus: "off", // off | loading | waiting | on | unsupported | error
      browserNs: loadBrowserNsPref(), // also use the browser's own noise filter
      gate: loadGatePref() // noise gate strength 0-100, 0 = off
    });
    this._mutedKey = "";
    this._handKey = "";
    this._noticeTimer = null;
    this._invisible = false;
    this._micBefore = true;
    this._wasWhisper = false;
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

  toggleMic() {
    if (!this._track) return;
    // players can't unmute themselves while the Storyteller has everyone muted
    if (this.state.isHost && this.state.invisible) return;
    if (!this.state.isHost && this.state.lockedMute) return;
    if (this.state.allMuted && !this.state.isHost && !this._inWhisper()) return;
    this._setMic(!this._track.enabled);
  }

  // Turns your mic on or off, tells everyone else, and refreshes the muted list.
  _setMic(on) {
    if (!this._track) return;
    this._track.enabled = on;
    if (this._rawTrack) this._rawTrack.enabled = on;
    this.state.micOn = on;
    this._send({ type: "mic", on });
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

  // Changes your own mic without telling anyone (used for private chats, so
  // other players can't tell who the Storyteller has pulled aside).
  _setMicQuiet(on) {
    if (!this._track) return;
    this._track.enabled = on;
    if (this._rawTrack) this._rawTrack.enabled = on;
    this.state.micOn = on;
    this._refreshMuted();
  }

  _inWhisper() {
    const mine = this.chatOf(this._playerId);
    return !!(mine && mine.whisper);
  }

  // the people you can see a mute-all exemption for: nobody, unless you share a private Storyteller chat
  _sameWhisper(c) {
    const mine = this.chatOf(this._playerId);
    const theirs = this.chatOf(c.playerId);
    return !!(mine && mine.whisper && theirs && theirs.id === mine.id);
  }

  _forced(c) {
    if (c.isHost) return false;
    return (
      this.state.mutedPlayers.includes(c.playerId) ||
      (this.state.allMuted && !this._sameWhisper(c))
    );
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
    if (!this._track || this.state.isHost) return;
    if (locked) this._setMic(false);
    else if (!this.state.allMuted) this._setMic(true);
    else this._setMicQuiet(this._inWhisper());
  }

  // Runs whenever the list of chats changes.
  _onChatsChanged() {
    const mine = this.chatOf(this._playerId);
    if (this.state.isHost) {
      // coming out of a private chat: mute so nothing slips out to the table
      const inWhisper = !!(mine && mine.whisper);
      if (this._wasWhisper && !inWhisper && !this.state.invisible) {
        this._setMic(false);
      }
      this._wasWhisper = inWhisper;
      const hidden = !!(mine && mine.hidden && mine.hidden.includes(this._playerId));
      if (hidden && !this._invisible) {
        this._invisible = true;
        this._micBefore = this.state.micOn;
        this._setMicQuiet(false);
      } else if (!hidden && this._invisible) {
        this._invisible = false;
        this._setMicQuiet(this._micBefore);
      }
      this.state.invisible = hidden;
    } else if (this.state.allMuted && this._track) {
      // while everyone is muted, only people in a Storyteller chat can talk
      this._setMicQuiet(!!(mine && mine.whisper) && !this.state.lockedMute);
    }
    this._syncAllAudio();
    this._refreshMuted();
  }

  // Storyteller only
  joinChat(chatId, hidden) {
    if (!this.state.isHost) return;
    this._send({ type: "chat-join", chatId, hidden: !!hidden });
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
  requestStoryteller() {
    this._send({ type: "chat-request", kind: "st" });
  }

  // Works out which playerIds are muted, for the muted icon by each nameplate.
  _refreshMuted() {
    const muted = [];
    if (this._playerId && !this.state.micOn) muted.push(this._playerId);
    for (const [id, c] of this._conns) {
      if (!c.playerId) continue;
      const peer = this.state.peers.find(p => p.id === id);
      const selfMuted = peer && peer.micOn === false;
      if (selfMuted || this._forced(c)) muted.push(c.playerId);
    }
    const key = muted.join(",");
    if (key !== this._mutedKey) {
      this._mutedKey = key;
      this.state.mutedIds = muted;
    }
  }

  // Storyteller only: change the name shown on the Storyteller token for everyone.
  setHostName(name) {
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
    this._applyAllMuted(on);
    this._send({ type: "mute-all", on: !!on });
  }

  muteAll() {
    this.setAllMuted(true);
  }

  unmuteAll() {
    this.setAllMuted(false);
  }

  _applyAllMuted(on) {
    on = !!on;
    this.state.allMuted = on;
    // players' mics follow the Storyteller's toggle; the Storyteller is exempt
    if (!this.state.isHost && this._track) {
      if (this.state.lockedMute) this._setMic(false);
      else if (on && this._inWhisper()) this._setMicQuiet(true);
      else this._setMic(!on);
    }
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
    c.audio.muted =
      !hear || this._forced(c) || !this._audible(c);
  }

  // Private chats: inside a chat you only hear the people in it, and outside
  // of one you only hear people who are not in a chat.
  _audible(c) {
    const mine = this.chatOf(this._playerId);
    const theirs = this.chatOf(c.playerId);
    if (mine) return !!theirs && theirs.id === mine.id;
    if (theirs) return false;
    return !this.state.busy.includes(c.playerId);
  }

  chatOf(playerId) {
    if (!playerId) return null;
    return this.state.chats.find(c => c.members.includes(playerId)) || null;
  }

  _syncAllAudio() {
    for (const id of this._conns.keys()) this._syncAudio(id);
  }

  // ---- phase, chat timer and private chats ----

  // Storyteller only: day, dusk or night. Ends the chat timer and any private chats.
  setPhase(phase) {
    if (!this.state.isHost || !["day", "dusk", "night"].includes(phase)) return;
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
    if (notice) {
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

  // How loud one player is for you only (0-100). Saved per player in this browser.
  setVolume(playerId, percent) {
    if (!playerId) return;
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    this.state.volumes = { ...this.state.volumes, [playerId]: v };
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.state.volumes));
    } catch (e) {
      // storage unavailable, the volume just won't be remembered
    }
    for (const c of this._conns.values()) {
      if (c.playerId === playerId) c.audio.volume = v / 100;
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
      this.state.chats = msg.chats || [];
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
      this._applyAllMuted(msg.on);
    } else if (msg.type === "peer-mic") {
      this._patch(msg.id, { micOn: !!msg.on });
      this._refreshMuted();
    } else if (msg.type === "phase") {
      this.state.phase = msg.phase;
      this._setTimer(0);
    } else if (msg.type === "timer") {
      this._setTimer(msg.left || 0);
    } else if (msg.type === "player-muted") {
      this._applyPlayerMuted(msg.playerId, !!msg.on);
    } else if (msg.type === "chats") {
      this.state.chats = msg.chats;
      this.state.busy = msg.busy || [];
      this._onChatsChanged();
    } else if (msg.type === "chat-request") {
      this.state.incoming = [
        ...this.state.incoming.filter(r => r.id !== msg.id),
        { id: msg.id, kind: msg.kind, from: msg.from, chatId: msg.chatId, num: msg.num }
      ];
    } else if (msg.type === "chat-cancel") {
      this.state.incoming = this.state.incoming.filter(r => r.id !== msg.id);
    } else if (msg.type === "chat-status") {
      this._setNotice({ id: msg.id, status: msg.status, who: msg.who, num: msg.num });
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
    audio.volume = this._volumeFor(info.playerId);
    const sender = pc.addTrack(this._track, this._stream);
    const conn = {
      pc,
      audio,
      sender,
      playerId: info.playerId || "",
      meter: null,
      lastLoud: 0,
      statLevel: 0, // 0-100 from the WebRTC receiver stats, independent of the analyser
      isHost: !!info.isHost
    };
    audio.muted = this.state.allMuted && !info.isHost;
    if (info.isHost && info.playerId) this.state.hostPlayerId = info.playerId;
    if (info.isHost && info.name) this.state.hostName = info.name;
    pc.ontrack = e => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {}); // blocked until the first click, see _unlock
      if (this._ctx) conn.meter = this._makeMeter(e.streams[0]);
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

  // Turn RNNoise noise suppression on or off. Remembered in this browser.
  setRnnoise(on) {
    on = !!on;
    this.state.rnnoise = on;
    try {
      localStorage.setItem(RNNOISE_KEY, on ? "on" : "off");
    } catch (e) {
      // storage unavailable, the choice just won't be remembered
    }
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
      analyser.fftSize = 512;
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
    try {
      localStorage.setItem(BROWSER_NS_KEY, on ? "on" : "off");
    } catch (e) {
      // storage unavailable, the choice just won't be remembered
    }
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
    track.enabled = this.state.micOn;
    if (this._rawTrack) this._rawTrack.enabled = this.state.micOn;
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
    analyser.fftSize = 512;
    this._ctx.createMediaStreamSource(stream).connect(analyser);
    return { analyser, data: new Uint8Array(analyser.fftSize) };
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
    const level = this.state.micOn ? this._levelOf(this._selfMeter) : 0;
    if (level !== this.state.level) this.state.level = level;
    if (this.state.micOn && level >= SPEAKING_LEVEL) this._selfLoud = now;

    const speaking = [];
    if (this._playerId && now - this._selfLoud < SPEAKING_HOLD_MS) {
      speaking.push(this._playerId);
    }
    for (const [id, c] of this._conns) {
      // Each peer is judged on its own, using whichever signal is louder, so any
      // number of people can be lit at once.
      const peerLevel = Math.max(this._levelOf(c.meter), c.statLevel);
      if (peerLevel >= SPEAKING_LEVEL) c.lastLoud = now;
      const isSpeaking = now - c.lastLoud < SPEAKING_HOLD_MS;
      this._patch(id, { speaking: isSpeaking });
      if (isSpeaking && c.playerId && this._audible(c)) speaking.push(c.playerId);
    }
    const key = speaking.join(",");
    if (key !== this._speakingKey) {
      this._speakingKey = key;
      this.state.speakingIds = speaking;
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
            c.statLevel = 0;
            return;
          }
          const stats = await c.pc.getStats();
          let level = 0;
          stats.forEach(r => {
            if (r.type === "inbound-rtp" && r.kind === "audio") {
              if (r.audioLevel != null) level = Math.max(level, r.audioLevel);
            }
          });
          c.statLevel = Math.min(100, Math.round(level * 400));
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
    clearInterval(this._tickTimer);
    clearInterval(this._statsTimer);
    clearInterval(this._levelTimer);
    this.state.hostPlayerId = "";
    this.state.isHost = false;
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
    for (const { pc, audio } of this._conns.values()) {
      pc.close();
      audio.srcObject = null;
    }
    this._conns.clear();
    this._names.clear();
    this._disposePipeline();
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
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
    this._invisible = false;
    this._wasWhisper = false;
    this.state.incoming = [];
    this.state.notice = null;
    this._handKey = "";
    this.state.rnnoiseStatus = "off";
    this.state.error = error || "";
  }
}

export default new VoiceChat();
