// Voice signaling server for townsquare. Introduces players to each other; audio never passes through here.
// Run with: node voice-server.js   (uses the "ws" package townsquare already depends on)
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.VOICE_PORT || 8090;
const MAX_PLAYERS = 20;
const rooms = new Map(); // room -> Map(id -> { ws, name, playerId, isHost })
const mutedRooms = new Set(); // rooms where the Storyteller has muted everyone

// Per town: the phase, the chat timer and the private chat rooms.
const games = new Map(); // room -> { phase, timerEnd, timer, chats, reqs, seq }
const MAX_CHAT_MEMBERS = 8;
const REQUEST_TTL_MS = 45 * 1000;
const MAX_TIMER_MS = 60 * 60 * 1000;

function getGame(room) {
  if (!games.has(room)) {
    games.set(room, { phase: "day", timerEnd: 0, timer: null, chats: [], reqs: new Map(), seq: 0, muted: new Set() });
  }
  return games.get(room);
}
function chatActive(game) {
  return game.timerEnd > Date.now();
}
function timerLeft(game) {
  return chatActive(game) ? game.timerEnd - Date.now() : 0;
}
function chatOf(game, playerId) {
  return game.chats.find(c => c.members.includes(playerId));
}
function broadcast(room, obj) {
  const members = rooms.get(room);
  if (!members) return;
  const text = JSON.stringify(obj);
  for (const p of members.values()) p.ws.send(text);
}
function sendTo(room, playerId, obj) {
  const members = rooms.get(room);
  if (!members || !playerId) return;
  const text = JSON.stringify(obj);
  for (const p of members.values()) if (p.playerId === playerId) p.ws.send(text);
}
// What one person is allowed to know about the chats:
// - the Storyteller sees hidden members, players do not
// - a private Storyteller chat ("whisper") is only shown to the people in it
function chatsFor(game, member) {
  const out = [];
  for (const c of game.chats) {
    if (c.whisper) {
      if (c.members.includes(member.playerId)) {
        out.push({ id: c.id, num: 0, whisper: true, members: c.members, hidden: [], locked: c.forced.includes(member.playerId), muted: c.muted || [] });
      }
    } else if (member.isHost) {
      out.push({ id: c.id, num: c.num, whisper: false, members: c.members, hidden: c.hidden, muted: c.muted || [] });
    } else {
      // god: the Storyteller is in this room unseen, so its members can hear them
      const god = c.hidden.length > 0 && c.members.includes(member.playerId);
      out.push({ id: c.id, num: c.num, whisper: false, members: c.members.filter(m => !c.hidden.includes(m)), hidden: [], muted: (c.muted || []).filter(m => !c.hidden.includes(m)), god });
    }
  }
  return out;
}
// Players in a whisper can't be heard by anyone outside it, but nobody is told who they are talking to
function busyIds(game) {
  const ids = [];
  for (const c of game.chats) if (c.whisper) for (const m of c.members) if (!ids.includes(m)) ids.push(m);
  return ids;
}
// Requests for a chat with one person ("new", or "st" for the Storyteller) wait "on hold"
// while that person is in a chat, instead of being dropped
function holdable(req) {
  return req.type === "new" || req.type === "st";
}
function armExpiry(room, game, req) {
  clearTimeout(req.timer);
  req.timer = setTimeout(() => {
    if (!game.reqs.has(req.id)) return;
    dropRequest(room, game, req);
    sendTo(room, req.from, { type: "chat-status", id: req.id, status: "expired", who: req.to });
  }, REQUEST_TTL_MS);
}
function requestPrompt(game, req) {
  const chat = game.chats.find(c => c.id === req.chatId);
  return { type: "chat-request", id: req.id, kind: req.type, from: req.from, chatId: req.chatId, num: chat ? chat.num : 0, hold: !!req.hold };
}
// Puts requests on hold (no expiry) or takes them off hold (fresh expiry), and tells both sides
function refreshHolds(room, game) {
  for (const req of game.reqs.values()) {
    if (!holdable(req)) continue;
    const hold = !!chatOf(game, req.to);
    if (hold === !!req.hold) continue;
    req.hold = hold;
    if (hold) clearTimeout(req.timer);
    else armExpiry(room, game, req);
    sendTo(room, req.from, { type: "chat-status", id: req.id, status: hold ? "hold" : "sent", who: req.to, num: 0 });
    sendTo(room, req.to, requestPrompt(game, req));
  }
}
// busy for one person: whisper members, plus an unseen Storyteller sitting in a room you're not in
function busyFor(game, member) {
  const ids = busyIds(game);
  for (const c of game.chats) {
    if (c.members.includes(member.playerId)) continue;
    for (const h of c.hidden) if (!ids.includes(h)) ids.push(h);
  }
  return ids;
}
function broadcastChats(room) {
  const game = getGame(room);
  const members = rooms.get(room);
  if (!members) return;
  refreshHolds(room, game);
  for (const p of members.values()) {
    p.ws.send(JSON.stringify({ type: "chats", chats: chatsFor(game, p), busy: busyFor(game, p) }));
  }
}
function dropRequest(room, game, req, notifyCancel = true) {
  clearTimeout(req.timer);
  game.reqs.delete(req.id);
  if (!notifyCancel) return;
  // lets the requester clear a "sent" or "on hold" notice
  sendTo(room, req.from, { type: "chat-status", id: req.id, status: "closed", who: req.to, num: 0 });
  if (req.type === "join") {
    const chat = game.chats.find(c => c.id === req.chatId);
    if (chat) for (const m of chat.members) sendTo(room, m, { type: "chat-cancel", id: req.id });
  } else {
    sendTo(room, req.to, { type: "chat-cancel", id: req.id });
  }
}
// forget every pending request that involves one of these players
// (keepHeld: requests to them for a one-on-one chat go on hold instead)
function dropRequestsFor(room, game, playerIds, keepHeld = false) {
  for (const req of [...game.reqs.values()]) {
    if (playerIds.includes(req.from)) {
      dropRequest(room, game, req);
    } else if (req.to && playerIds.includes(req.to) && !(keepHeld && holdable(req))) {
      dropRequest(room, game, req);
    }
  }
}
// Rooms close with the chat timer, but private Storyteller chats carry on
function endChats(room, game) {
  for (const req of [...game.reqs.values()]) {
    if (req.type !== "st") dropRequest(room, game, req);
  }
  game.chats = game.chats.filter(c => c.whisper);
  broadcastChats(room);
}
function stopTimer(room, game) {
  clearTimeout(game.timer);
  game.timer = null;
  game.timerEnd = 0;
  broadcast(room, { type: "timer", left: 0 });
  endChats(room, game);
}
function setPhase(room, game, phase, reason) {
  game.phase = phase;
  if (game.timerEnd) stopTimer(room, game);
  else endChats(room, game);
  broadcast(room, { type: "phase", phase, reason: reason || "" });
}
function leaveChat(room, game, playerId) {
  const chat = chatOf(game, playerId);
  if (!chat) return;
  chat.members = chat.members.filter(m => m !== playerId);
  chat.hidden = chat.hidden.filter(m => m !== playerId);
  if (chat.muted) chat.muted = chat.muted.filter(m => m !== playerId);
  if (chat.forced) chat.forced = chat.forced.filter(m => m !== playerId);
  // a private chat needs at least two people who are not hidden
  if (chat.members.filter(m => !chat.hidden.includes(m)).length < 2) {
    game.chats = game.chats.filter(c => c !== chat);
    dropRequestsFor(room, game, []); // nothing to do, requests to this chat are dropped below
  }
  for (const req of [...game.reqs.values()]) {
    if ((req.type === "join" || req.type === "invite") && !game.chats.find(c => c.id === req.chatId)) dropRequest(room, game, req);
  }
  broadcastChats(room);
}
function lowestFreeNum(game) {
  let n = 1;
  while (game.chats.some(c => !c.whisper && c.num === n)) n++;
  return n;
}

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
      const peers = [...members].map(([pid, p]) => ({ id: pid, name: p.name, playerId: p.playerId, isHost: p.isHost, micOn: p.micOn !== false, roomMicOn: p.roomMicOn !== false, hand: !!p.hand }));
      members.set(id, { ws, name, playerId, isHost, micOn: true, roomMicOn: true, hand: false });
      rooms.set(room, members);
      const game = getGame(room);
      ws.send(JSON.stringify({
        type: "welcome",
        id,
        peers,
        allMuted: mutedRooms.has(room),
        phase: game.phase,
        timerLeft: timerLeft(game),
        chats: chatsFor(game, members.get(id)),
        busy: busyFor(game, members.get(id)),
        mutedPlayers: [...game.muted]
      }));
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
        // micOn: Town Square mute, roomMicOn: private chat mute (kept separately)
        me.micOn = !!msg.on;
        me.roomMicOn = msg.room !== false;
        for (const [pid, p] of members) {
          if (pid !== id) p.ws.send(JSON.stringify({ type: "peer-mic", id, on: me.micOn, room: me.roomMicOn }));
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

    if (msg.type === "phase" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost && ["day", "dusk", "night", "end"].includes(msg.phase)) {
        setPhase(room, getGame(room), msg.phase);
      }
    }

    if (msg.type === "timer-start" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      if (me && me.isHost && game.phase === "day") {
        const ms = Math.max(5000, Math.min(MAX_TIMER_MS, Math.round(Number(msg.seconds) * 1000) || 0));
        if (game.timerEnd) stopTimer(room, game);
        game.timerEnd = Date.now() + ms;
        const roomName = room;
        game.timer = setTimeout(() => {
          const g = games.get(roomName);
          if (!g) return;
          g.timer = null;
          g.timerEnd = 0;
          setPhase(roomName, g, "dusk", "timer");
        }, ms);
        broadcast(room, { type: "timer", left: ms });
      }
    }

    if (msg.type === "timer-stop" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      if (me && me.isHost && game.timerEnd) stopTimer(room, game);
    }

    if (msg.type === "chat-request" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      if (!me || !me.playerId || me.isHost) return;
      if (msg.kind !== "st" && !chatActive(game)) return;
      const from = me.playerId;
      const myChat = chatOf(game, from);
      let req = null;
      if (msg.kind === "st") {
        // ask the Storyteller for a private chat, in any phase
        const host = [...members.values()].find(p => p.isHost && p.playerId);
        if (!host || myChat) return;
        req = { type: "st", from, to: host.playerId, chatId: 0 };
      } else if (msg.kind === "new" || msg.kind === "invite") {
        const to = String(msg.to || "").slice(0, 40);
        const target = [...members.values()].find(p => p.playerId === to);
        if (!target || target.isHost || to === from) return;
        // a chat request to someone already chatting goes on hold; an invite needs them free
        if (msg.kind === "invite" && chatOf(game, to)) return;
        if (msg.kind === "new" && myChat) return;
        // only the Storyteller adds people to a private Storyteller chat
        if (msg.kind === "invite" && (!myChat || myChat.whisper || myChat.members.length >= MAX_CHAT_MEMBERS)) return;
        req = { type: msg.kind, from, to, chatId: myChat ? myChat.id : 0 };
      } else if (msg.kind === "join") {
        const chat = game.chats.find(c => c.id === msg.chatId && !c.whisper);
        if (!chat || myChat || chat.members.length >= MAX_CHAT_MEMBERS) return;
        req = { type: "join", from, to: "", chatId: chat.id };
      } else {
        return;
      }
      // one outgoing request at a time
      for (const old of [...game.reqs.values()]) {
        if (old.from === from) dropRequest(room, game, old);
      }
      req.id = ++game.seq;
      req.hold = holdable(req) && !!chatOf(game, req.to);
      // requests on hold wait until the requester cancels or the other person is free
      if (!req.hold) armExpiry(room, game, req);
      game.reqs.set(req.id, req);
      const chat = game.chats.find(c => c.id === req.chatId);
      const prompt = requestPrompt(game, req);
      if (req.type === "join") {
        for (const m of chat.members) sendTo(room, m, prompt);
      } else {
        sendTo(room, req.to, prompt);
      }
      sendTo(room, from, { type: "chat-status", id: req.id, status: req.hold ? "hold" : "sent", who: req.to, num: chat ? chat.num : 0 });
    }

    if (msg.type === "chat-cancel" && room) {
      // the requester gives up on a request (e.g. while on hold)
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      const req = game.reqs.get(Number(msg.id));
      if (me && req && req.from === me.playerId) dropRequest(room, game, req);
    }

    if (msg.type === "chat-respond" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      const req = game.reqs.get(Number(msg.id));
      if (!me || !req || !me.playerId) return;
      const chat = game.chats.find(c => c.id === req.chatId);
      const allowed = req.type === "join" ? !!chat && chat.members.includes(me.playerId) : req.to === me.playerId;
      if (!allowed) return;
      const answer = msg.answer;
      if (answer === "wait" && req.type === "join") {
        sendTo(room, req.from, { type: "chat-status", id: req.id, status: "wait", who: me.playerId, num: chat.num });
        return;
      }
      if (answer === "decline") {
        dropRequest(room, game, req);
        sendTo(room, req.from, { type: "chat-status", id: req.id, status: "declined", who: me.playerId, num: chat ? chat.num : 0 });
        return;
      }
      if (answer !== "accept") return;
      if (req.type !== "st" && !chatActive(game)) return;
      let joined = [];
      if (holdable(req)) {
        if (chatOf(game, req.from)) {
          dropRequest(room, game, req);
          return;
        }
        const current = chatOf(game, req.to);
        if (current) {
          // on hold: "Add to room" brings the requester into the chat the other person is in.
          // Only the Storyteller can add people to a private Storyteller chat.
          if (current.whisper && req.type !== "st") return;
          if (!current.whisper && !chatActive(game)) return;
          if (current.members.length >= MAX_CHAT_MEMBERS) return;
          current.members.push(req.from);
          joined = [req.from];
        } else if (req.type === "st") {
          game.chats.push({ id: ++game.seq, num: 0, members: [req.to, req.from], hidden: [], whisper: true, forced: [] });
          joined = [req.from, req.to];
        } else {
          game.chats.push({ id: ++game.seq, num: lowestFreeNum(game), members: [req.from, req.to], hidden: [], whisper: false });
          joined = [req.from, req.to];
        }
      } else {
        const target = req.type === "invite" ? req.to : req.from;
        if (!chat || chatOf(game, target) || chat.members.length >= MAX_CHAT_MEMBERS) {
          dropRequest(room, game, req);
          return;
        }
        chat.members.push(target);
        joined = [target];
      }
      sendTo(room, req.from, { type: "chat-status", id: req.id, status: "accepted", who: me.playerId, num: (game.chats.find(c => c.members.includes(req.from)) || {}).num || 0 });
      dropRequest(room, game, req);
      dropRequestsFor(room, game, joined, true);
      broadcastChats(room);
    }

    if (msg.type === "send-bluffs" && room) {
      // Storyteller: give the demon their bluffs
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost && Array.isArray(msg.roles)) {
        const roles = msg.roles.slice(0, 3).map(r => (r && typeof r === "object" ? r : null));
        sendTo(room, String(msg.to || "").slice(0, 40), { type: "bluffs", roles });
      }
    }

    if (msg.type === "send-grimoire" && room) {
      // Storyteller: show one player (the Spy) every seat's character and reminder tokens
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost && Array.isArray(msg.players)) {
        const players = msg.players.slice(0, 40).map(p => {
          if (!p || typeof p !== "object") return null;
          const role = p.role && typeof p.role === "object" ? p.role : null;
          const reminders = Array.isArray(p.reminders)
            ? p.reminders.slice(0, 30).filter(r => r && typeof r === "object")
            : [];
          return { role, reminders };
        });
        sendTo(room, String(msg.to || "").slice(0, 40), { type: "grimoire", players });
      }
    }

    if (msg.type === "mute-player" && room) {
      // Storyteller: mute one player, who can't unmute themselves until the Storyteller does
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost) {
        const game = getGame(room);
        const playerId = String(msg.playerId || "").slice(0, 40);
        if (!playerId) return;
        if (msg.on) game.muted.add(playerId);
        else game.muted.delete(playerId);
        broadcast(room, { type: "player-muted", playerId, on: !!msg.on });
      }
    }

    if (msg.type === "room-mute" && room) {
      // Storyteller: mute or unmute someone inside their private chat (separate from the Town Square)
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (!me || !me.isHost) return;
      const game = getGame(room);
      const playerId = String(msg.playerId || "").slice(0, 40);
      const chat = chatOf(game, playerId);
      if (!chat) return;
      const list = (chat.muted || []).filter(m => m !== playerId);
      if (msg.on) list.push(playerId);
      chat.muted = list;
      broadcastChats(room);
    }

    if (msg.type === "chat-visibility" && room) {
      // Storyteller: show yourself in the room you're in, or go unseen again
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (!me || !me.isHost || !me.playerId) return;
      const game = getGame(room);
      const chat = chatOf(game, me.playerId);
      if (!chat || chat.whisper) return;
      chat.hidden = chat.hidden.filter(m => m !== me.playerId);
      if (msg.hidden) {
        // a room needs two people who can see each other
        if (chat.members.filter(m => m !== me.playerId).length < 2) return broadcastChats(room);
        chat.hidden.push(me.playerId);
        if (chat.muted) chat.muted = chat.muted.filter(m => m !== me.playerId);
      }
      broadcastChats(room);
    }

    if (msg.type === "chat-join" && room) {
      // Storyteller: join a room, optionally hidden from the players
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      const chat = game.chats.find(c => c.id === Number(msg.chatId) && !c.whisper);
      if (!me || !me.isHost || !me.playerId || !chat || chat.members.includes(me.playerId)) return;
      if (chat.members.length >= MAX_CHAT_MEMBERS) return;
      leaveChat(room, game, me.playerId);
      const target = game.chats.find(c => c.id === chat.id);
      if (!target) return;
      target.members.push(me.playerId);
      if (msg.hidden) target.hidden.push(me.playerId);
      dropRequestsFor(room, game, [me.playerId], true);
      broadcastChats(room);
    }

    if (msg.type === "whisper-start" && room) {
      // Storyteller: open a private chat with a player, in any phase
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      if (!me || !me.isHost || !me.playerId) return;
      const to = String(msg.to || "").slice(0, 40);
      const target = [...members.values()].find(p => p.playerId === to && !p.isHost);
      if (!target) return;
      let chat = chatOf(game, me.playerId);
      if (chat && !chat.whisper) {
        leaveChat(room, game, me.playerId);
        chat = null;
      }
      const theirs = chatOf(game, to);
      if (theirs && theirs !== chat) leaveChat(room, game, to);
      if (!chat) {
        chat = { id: ++game.seq, num: 0, members: [me.playerId], hidden: [], whisper: true, forced: [] };
        game.chats.push(chat);
      }
      // a chat the Storyteller opens cannot be left by the player
      if (!chat.members.includes(to)) chat.members.push(to);
      if (!chat.forced.includes(to)) chat.forced.push(to);
      dropRequestsFor(room, game, [to], true);
      broadcastChats(room);
    }

    if (msg.type === "whisper-end" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      const game = getGame(room);
      if (!me || !me.isHost) return;
      const chat = chatOf(game, me.playerId);
      if (chat && chat.whisper) {
        game.chats = game.chats.filter(c => c !== chat);
        broadcastChats(room);
      }
    }

    if (msg.type === "chat-leave" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (!me || !me.playerId) return;
      const game = getGame(room);
      const chat = chatOf(game, me.playerId);
      // players cannot walk out of a private chat the Storyteller started
      if (chat && chat.whisper && !me.isHost && chat.forced.includes(me.playerId)) return;
      leaveChat(room, game, me.playerId);
    }

    if (msg.type === "lower-hand" && room) {
      const members = rooms.get(room);
      const me = members && members.get(id);
      if (me && me.isHost) {
        const playerId = String(msg.playerId || "").slice(0, 40);
        for (const p of members.values()) p.ws.send(JSON.stringify({ type: "lower-hand", playerId }));
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
    const gone = members.get(id);
    members.delete(id);
    for (const p of members.values()) p.ws.send(JSON.stringify({ type: "peer-left", id }));
    if (!members.size) {
      const game = games.get(room);
      if (game) {
        clearTimeout(game.timer);
        for (const req of game.reqs.values()) clearTimeout(req.timer);
      }
      games.delete(room);
      rooms.delete(room);
      mutedRooms.delete(room);
    } else if (gone && gone.playerId) {
      const game = getGame(room);
      dropRequestsFor(room, game, [gone.playerId]);
      leaveChat(room, game, gone.playerId);
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
