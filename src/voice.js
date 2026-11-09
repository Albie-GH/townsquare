import Vue from "vue";

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add a TURN server here if some players connect but can't hear each other:
    // { urls: "turn:HOST:3478", username: "user", credential: "pass" }
  ]
};

class VoiceChat {
  constructor() {
    // reactive state, bound by Menu.vue
    this.state = Vue.observable({
      joined: false,
      micOn: true,
      level: 0,
      error: "",
      peers: [] // { id, name, playerId, hear, talk, status, rtt, route }
    });
    this._busy = false;
    this._ws = null;
    this._stream = null;
    this._track = null;
    this._conns = new Map(); // id -> { pc, audio, sender }
    this._names = new Map(); // id -> { name, playerId } from peer-joined
    this._ctx = null;
    this._meterTimer = null;
    this._statsTimer = null;
  }

  async join(room, name, playerId) {
    if (this._ws || this._busy) return;
    this._busy = true;
    this.state.error = "";
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      this._busy = false;
      this.state.error = "Microphone blocked. Allow mic access (needs HTTPS or localhost).";
      return;
    }
    this._track = this._stream.getAudioTracks()[0];
    this.state.micOn = true;
    this._startMeter();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/voice`);
    this._ws = ws;
    this._busy = false;
    ws.onopen = () => this._send({ type: "join", room: String(room), name, playerId });
    ws.onmessage = e => this._onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this._ws === ws) this._teardown("Voice server disconnected.");
    };
    this._statsTimer = setInterval(() => this._pollStats(), 3000);
  }

  leave() {
    this._teardown("");
  }

  toggleMic() {
    if (!this._track) return;
    this._track.enabled = !this._track.enabled;
    this.state.micOn = this._track.enabled;
  }

  // "Hear" mutes a player locally; "Talk" stops sending your mic to them (whispering).
  setHear(id, on) {
    const c = this._conns.get(id);
    if (c) c.audio.muted = !on;
    this._patch(id, { hear: on });
  }

  setTalk(id, on) {
    const c = this._conns.get(id);
    if (c) c.sender.replaceTrack(on ? this._track : null);
    this._patch(id, { talk: on });
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj));
  }

  async _onMessage(msg) {
    if (msg.type === "error") {
      this._teardown(msg.message);
    } else if (msg.type === "welcome") {
      this.state.joined = true;
      // the newcomer starts the call with everyone already here
      for (const p of msg.peers) {
        const conn = this._makePeer(p.id, p);
        const offer = await conn.pc.createOffer();
        await conn.pc.setLocalDescription(offer);
        this._send({ type: "signal", to: p.id, data: { description: conn.pc.localDescription } });
      }
    } else if (msg.type === "peer-joined") {
      this._names.set(msg.id, msg);
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
          this._send({ type: "signal", to: from, data: { description: conn.pc.localDescription } });
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
    const sender = pc.addTrack(this._track, this._stream);
    pc.ontrack = e => {
      audio.srcObject = e.streams[0];
    };
    pc.onicecandidate = e => {
      if (e.candidate) this._send({ type: "signal", to: id, data: { candidate: e.candidate } });
    };
    pc.onconnectionstatechange = () => this._patch(id, { status: pc.connectionState });
    const conn = { pc, audio, sender };
    this._conns.set(id, conn);
    this.state.peers = [
      ...this.state.peers,
      {
        id,
        name: info.name || "Player",
        playerId: info.playerId || "",
        hear: true,
        talk: true,
        status: "connecting",
        rtt: null,
        route: ""
      }
    ];
    return conn;
  }

  _removePeer(id) {
    const c = this._conns.get(id);
    if (c) {
      c.pc.close();
      c.audio.srcObject = null;
      this._conns.delete(id);
    }
    this._names.delete(id);
    this.state.peers = this.state.peers.filter(p => p.id !== id);
  }

  _patch(id, props) {
    const peer = this.state.peers.find(p => p.id === id);
    if (peer) Object.assign(peer, props);
  }

  async _pollStats() {
    for (const [id, { pc }] of this._conns) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      stats.forEach(r => {
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
          const local = stats.get(r.localCandidateId);
          this._patch(id, {
            rtt: r.currentRoundTripTime != null ? Math.round(r.currentRoundTripTime * 1000) : null,
            route: local && local.candidateType === "relay" ? "relay" : "direct"
          });
        }
      });
    }
  }

  _startMeter() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this._ctx = new AudioCtx();
    const analyser = this._ctx.createAnalyser();
    analyser.fftSize = 512;
    this._ctx.createMediaStreamSource(this._stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    this._meterTimer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      const level = Math.min(100, Math.round((peak / 128) * 160));
      if (level !== this.state.level) this.state.level = level;
    }, 100);
  }

  _teardown(error) {
    clearInterval(this._meterTimer);
    clearInterval(this._statsTimer);
    const ws = this._ws;
    this._ws = null;
    if (ws) ws.close();
    for (const { pc, audio } of this._conns.values()) {
      pc.close();
      audio.srcObject = null;
    }
    this._conns.clear();
    this._names.clear();
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    if (this._ctx) this._ctx.close();
    this._stream = this._track = this._ctx = null;
    this._busy = false;
    this.state.joined = false;
    this.state.level = 0;
    this.state.peers = [];
    this.state.error = error || "";
  }
}

export default new VoiceChat();
