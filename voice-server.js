// Voice signaling server for townsquare. Introduces players to each other; audio never passes through here.
// Run with: node voice-server.js   (uses the "ws" package townsquare already depends on)
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.VOICE_PORT || 8090;
const MAX_PLAYERS = 20;
const rooms = new Map(); // room -> Map(id -> { ws, name, playerId, isHost })
const mutedRooms = new Set(); // rooms where the Storyteller has muted everyone

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("voice signaling ok");
});
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

wss.on("connection", ws => {
  let room = null;
  let id = null;
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (msg.type === "join" && !room) {
      const roomName = String(msg.room || "town").slice(0, 60);
      const name = String(msg.name || "Player").slice(0, 30);
      const playerId = String(msg.playerId || "").slice(0, 40);
      const members = rooms.get(roomName) || new Map();
      if (members.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: "error", message: "Voice room is full." }));
        return;
      }
      room = roomName;
      id = crypto.randomBytes(8).toString("hex");
      const isHost = !!msg.isHost;
      const peers = [...members].map(([pid, p]) => ({ id: pid, name: p.name, playerId: p.playerId, isHost: p.isHost, micOn: p.micOn !== false, hand: !!p.hand }));
      members.set(id, { ws, name, playerId, isHost, micOn: true, hand: false });
      rooms.set(room, members);
      ws.send(JSON.stringify({ type: "welcome", id, peers, allMuted: mutedRooms.has(room) }));
      for (const [pid, p] of members) {
        if (pid !== id) p.ws.send(JSON.stringify({ type: "peer-joined", id, name, playerId, isHost }));
      }
      console.log(`${name} joined voice room "${room}" (${members.size})`);
    }

    if (msg.type === "mute-all" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost) {
        const on = !!msg.on;
        if (on) mutedRooms.add(room);
        else mutedRooms.delete(room);
        for (const p of members.values()) p.ws.send(JSON.stringify({ type: "mute-all", on }));
      }
    }

    if (msg.type === "mic" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me) {
        me.micOn = !!msg.on;
        for (const [pid, p] of members) {
          if (pid !== id) p.ws.send(JSON.stringify({ type: "peer-mic", id, on: me.micOn }));
        }
      }
    }

    if (msg.type === "hand" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me) {
        me.hand = !!msg.on;
        for (const [pid, p] of members) {
          if (pid !== id) p.ws.send(JSON.stringify({ type: "peer-hand", id, on: me.hand }));
        }
      }
    }

    if (msg.type === "rename" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost) {
        me.name = String(msg.name || "Storyteller").slice(0, 30);
        for (const [pid, p] of members) {
          if (pid !== id) p.ws.send(JSON.stringify({ type: "peer-renamed", id, name: me.name }));
        }
      }
    }

    if (msg.type === "signal" && room) {
      const target = rooms.get(room) && rooms.get(room).get(msg.to);
      if (target) target.ws.send(JSON.stringify({ type: "signal", from: id, data: msg.data }));
    }
  });

  ws.on("close", () => {
    const members = room && rooms.get(room);
    if (!members) return;
    members.delete(id);
    for (const p of members.values()) p.ws.send(JSON.stringify({ type: "peer-left", id }));
    if (!members.size) {
      rooms.delete(room);
      mutedRooms.delete(room);
    }
  });
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, () => console.log(`Voice signaling on port ${PORT}`));
