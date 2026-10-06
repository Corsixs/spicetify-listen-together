// engine.js — Listen Together
// Se carga al arrancar Spotify (subfiles_extension): conexión, sincronización, sugerencias,
// menú contextual y la sesión guardada para volver a la sala al reabrir Spotify.
// La interfaz (index.js) lo usa a través de window.ListenTogether.
(function () {
"use strict";

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(8);
  window.crypto.getRandomValues(a);
  let out = "";
  for (let i = 0; i < a.length; i++) out += chars[a[i] % chars.length];
  return out;
}

let cachedProfile = null;

// Datos que llegan de otros peers: solo se aceptan URLs https y usuarios con caracteres seguros
function safeAvatar(url) {
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
}

function safeUser(u) {
  return typeof u === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(u) ? u : null;
}

function firstImage(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const img = list[0];
  return typeof img === "string" ? img : img && img.url;
}

// Nombre, foto y usuario del perfil de Spotify (con respaldo en la Web API)
function getSpotifyProfile() {
  if (cachedProfile) return Promise.resolve(cachedProfile);
  const prof = { name: null, avatar: null, user: null };
  return Promise.resolve()
    .then(function () {
      const api = Spicetify.Platform && Spicetify.Platform.UserAPI;
      return api && api.getUser ? api.getUser() : null;
    })
    .then(function (u) {
      if (!u) return;
      prof.name = u.displayName || u.username || null;
      prof.user = safeUser(u.username);
      prof.avatar = safeAvatar(u.avatarUrl || u.imageUrl || firstImage(u.images));
    })
    .catch(function () {})
    .then(function () {
      if (prof.name && prof.avatar && prof.user) return;
      return Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me").then(function (me) {
        if (!me) return;
        prof.name = prof.name || me.display_name || me.id || null;
        prof.user = prof.user || safeUser(me.id);
        prof.avatar = prof.avatar || safeAvatar(firstImage(me.images));
      });
    })
    .catch(function () {})
    .then(function () {
      if (!prof.user) prof.user = safeUser(Spicetify.Platform && Spicetify.Platform.username);
      if (!prof.name) prof.name = prof.user;
      if (prof.name) {
        prof.name = String(prof.name).trim();
        cachedProfile = prof;
      }
      return prof;
    });
}

const SUGGEST_TYPES = { track: "Canción", album: "Álbum", playlist: "Playlist" };
const SUGGEST_MAX = 50;
const SUGGEST_PER_PEER = 15;

// Acepta enlaces open.spotify.com y URIs spotify:tipo:id (canción, álbum o playlist)
function parseSpotifyRef(text) {
  const s = String(text || "").trim();
  let m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?(track|album|playlist)\/([A-Za-z0-9]{22})/i);
  if (!m) m = s.match(/^spotify:(?:user:[^:]+:)?(track|album|playlist):([A-Za-z0-9]{22})$/i);
  if (!m) return null;
  const type = m[1].toLowerCase();
  return { type: type, id: m[2], uri: "spotify:" + type + ":" + m[2] };
}

function clip(v, n) {
  return typeof v === "string" ? v.slice(0, n) : "";
}

// Todo lo que llega por la red se normaliza antes de guardarlo o mostrarlo
function cleanSuggestion(it) {
  if (!it) return null;
  const ref = parseSpotifyRef(it.uri);
  if (!ref) return null;
  return {
    uri: ref.uri,
    type: ref.type,
    name: clip(it.name, 140) || SUGGEST_TYPES[ref.type],
    sub: clip(it.sub, 140),
    art: safeAvatar(it.art)
  };
}

function race(promise, ms) {
  let id;
  return Promise.race([
    promise,
    new Promise(function (_, rej) { id = setTimeout(function () { rej(new Error("timeout")); }, ms); })
  ]).finally(function () { clearTimeout(id); });
}

function pickImage(sources) {
  if (!Array.isArray(sources) || !sources.length) return null;
  // La más pequeña que mida al menos 200px, o la primera
  const sorted = sources.slice().sort(function (a, b) { return (a.width || 0) - (b.width || 0); });
  const ok = sorted.find(function (s) { return (s.width || 0) >= 200; }) || sorted[sorted.length - 1];
  return ok && (ok.url || ok);
}

function gql(def, vars) {
  const G = Spicetify.GraphQL;
  if (!G || !G.Request || !G.Definitions || !G.Definitions[def]) return Promise.reject(new Error("no gql"));
  return race(G.Request(G.Definitions[def], vars), 5000);
}

// Nombre, subtítulo y portada; prueba varias fuentes porque las APIs internas cambian entre versiones
function fetchItemMeta(uri) {
  const ref = parseSpotifyRef(uri);
  if (!ref) return Promise.resolve(null);
  const base = { uri: ref.uri, type: ref.type, name: null, sub: "", art: null };

  const tries = [];
  if (ref.type === "track") {
    tries.push(function () {
      return gql("getTrack", { uri: ref.uri }).then(function (r) {
        const t = r && r.data && r.data.trackUnion;
        if (!t || !t.name) return null;
        const artists = (t.firstArtist && t.firstArtist.items || []).concat(t.otherArtists && t.otherArtists.items || [])
          .map(function (a) { return a.profile && a.profile.name; }).filter(Boolean);
        return {
          name: t.name,
          sub: artists.join(", "),
          art: pickImage(t.albumOfTrack && t.albumOfTrack.coverArt && t.albumOfTrack.coverArt.sources)
        };
      });
    });
  } else if (ref.type === "album") {
    tries.push(function () {
      return gql("getAlbum", { uri: ref.uri, locale: "", offset: 0, limit: 1 }).then(function (r) {
        const a = r && r.data && r.data.albumUnion;
        if (!a || !a.name) return null;
        return {
          name: a.name,
          sub: (a.artists && a.artists.items || []).map(function (x) { return x.profile && x.profile.name; }).filter(Boolean).join(", "),
          art: pickImage(a.coverArt && a.coverArt.sources)
        };
      });
    });
  } else {
    tries.push(function () {
      const api = Spicetify.Platform && Spicetify.Platform.PlaylistAPI;
      if (!api || !api.getMetadata) return null;
      return race(api.getMetadata(ref.uri), 5000).then(function (p) {
        if (!p || !p.name) return null;
        return {
          name: p.name,
          sub: (p.owner && (p.owner.displayName || p.owner.username)) || "",
          art: pickImage(p.images)
        };
      });
    });
  }
  // Respaldo: Web API
  tries.push(function () {
    return race(Spicetify.CosmosAsync.get("https://api.spotify.com/v1/" + ref.type + "s/" + ref.id +
      (ref.type === "playlist" ? "?fields=name,images,owner(display_name)" : "")), 5000).then(function (d) {
      if (!d || !d.name) return null;
      const artists = (d.artists || []).map(function (a) { return a.name; }).join(", ");
      return {
        name: d.name,
        sub: ref.type === "playlist" ? (d.owner && d.owner.display_name) || "" : artists,
        art: pickImage(ref.type === "track" ? d.album && d.album.images : d.images)
      };
    });
  });

  let i = 0;
  function next() {
    if (i >= tries.length) return Promise.resolve(base);
    const f = tries[i++];
    return Promise.resolve().then(f).catch(function () { return null; }).then(function (r) {
      if (r && r.name) return Object.assign(base, r, { art: safeAvatar(r.art) });
      return next();
    });
  }
  return next();
}

const QUEUE_MAX = 100;

function isTrackUri(u) {
  return typeof u === "string" && /^spotify:track:[A-Za-z0-9]{22}$/.test(u);
}

function resolveTrackUris(uri) {
  const ref = parseSpotifyRef(uri);
  if (!ref) return Promise.resolve([]);
  if (ref.type === "track") return Promise.resolve([ref.uri]);
  if (ref.type === "album") {
    return gql("getAlbum", { uri: ref.uri, locale: "", offset: 0, limit: 50 }).then(function (r) {
      const a = r && r.data && r.data.albumUnion;
      const items = (a && ((a.tracksV2 && a.tracksV2.items) || (a.tracks && a.tracks.items))) || [];
      return items.map(function (it) { return it && it.track && it.track.uri; }).filter(isTrackUri);
    }).catch(function () {
      return race(Spicetify.CosmosAsync.get("https://api.spotify.com/v1/albums/" + ref.id + "/tracks?limit=50"), 5000)
        .then(function (r) { return ((r && r.items) || []).map(function (t) { return t.uri; }).filter(isTrackUri); });
    });
  }
  const api = Spicetify.Platform && Spicetify.Platform.PlaylistAPI;
  if (!api || !api.getContents) return Promise.resolve([]);
  return race(api.getContents(ref.uri, { limit: QUEUE_MAX }), 8000).then(function (r) {
    return ((r && r.items) || []).map(function (it) { return it && it.uri; }).filter(isTrackUri);
  });
}

function addUrisToQueue(uris) {
  const items = uris.slice(0, QUEUE_MAX).map(function (u) { return { uri: u, uid: null }; });
  const api = Spicetify.Platform && Spicetify.Platform.PlayerAPI;
  if (api && api.addToQueue) return Promise.resolve(api.addToQueue(items));
  if (Spicetify.addToQueue) return Promise.resolve(Spicetify.addToQueue(items));
  return Promise.reject(new Error("La cola no está disponible"));
}

function openProfile(user) {
  const u = safeUser(user);
  if (!u) return;
  try { Spicetify.Platform.History.push("/user/" + encodeURIComponent(u)); } catch (e) {}
}

function safeDuration() {
  try { return Spicetify.Player.getDuration() || 0; } catch (e) { return 0; }
}

function trackMeta() {
  try {
    const item = Spicetify.Player.data && Spicetify.Player.data.item;
    if (!item) return null;
    let art = null;
    if (item.images && item.images[0]) art = item.images[0].url;
    else if (item.album && item.album.images && item.album.images[0]) art = item.album.images[0].url;
    return {
      uri: item.uri,
      name: item.name,
      artists: (item.artists || []).map(function (a) { return a.name; }).join(", "),
      album: (item.album && item.album.name) || "",
      art: art,
      duration: item.duration_ms ||
        (item.duration && item.duration.milliseconds) ||
        Number(item.metadata && item.metadata.duration) ||
        safeDuration()
    };
  } catch (e) {
    return null;
  }
}

function playerState() {
  let pos = 0;
  let playing = false;
  try { pos = Spicetify.Player.getProgress(); } catch (e) {}
  try { playing = Spicetify.Player.isPlaying(); } catch (e) {}
  return { meta: trackMeta(), pos: pos, playing: playing, ts: Date.now() };
}

function fmt(ms) {
  const m = Math.floor((ms || 0) / 60000);
  const s = Math.floor(((ms || 0) % 60000) / 1000);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// Desfase tolerado antes de corregir la posición del invitado
const DRIFT_MS = 1000;
// Se envía en el "hello" para detectar invitados con una versión vieja de la app
const APP_VERSION = 6;

// La sala se guarda para retomarla al reabrir Spotify
const SESSION_KEY = "listen-together:session";
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;
// Tiempo máximo esperando a que la sala (o el anfitrión) vuelva
const RESUME_MS = 3 * 60 * 1000;
const RETRY_MS = 5000;
// Sin mensajes del anfitrión durante este tiempo se da la conexión por muerta
const HOST_SILENCE_MS = 9000;
// Lo mismo al revés: el anfitrión quita a quien deja de mandar pings (cierre brusco de Spotify)
const GUEST_SILENCE_MS = 9000;
const CID_KEY = "listen-together:cid";

// Identificador fijo de esta instalación: permite reconocer a alguien que vuelve a entrar
function getClientId() {
  try {
    let cid = localStorage.getItem(CID_KEY);
    if (!/^[A-Z0-9]{16}$/.test(cid || "")) {
      cid = genCode() + genCode();
      localStorage.setItem(CID_KEY, cid);
    }
    return cid;
  } catch (e) {
    return genCode() + genCode();
  }
}

const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" }
];

const Engine = {
  peer: null,
  isHost: false,
  hostId: null,
  code: null,
  roomName: "",
  localName: "",
  localAvatar: null,
  localUser: null,
  pwHash: null,
  connections: {},
  hostConn: null,
  participants: [],
  chatLog: [],
  suggestions: [],
  ready: false,
  applyingUntil: 0,
  pending: null,
  rtt: 0,
  localControlUntil: 0,
  lastSeen: {},
  peerCid: {},
  creator: false,
  resuming: null,
  reconnecting: null,
  lastHostMsgAt: 0,
  persistTimer: null,
  localControlWant: null,
  controlActor: null,
  lastAnnounced: null,
  controlRate: {},
  lastRemoteMeta: null,
  heartbeat: null,
  listeners: {},
  joinRes: null,
  joinRej: null,

  on: function (evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
  },

  emit: function (evt, data) {
    (this.listeners[evt] || []).forEach(function (f) {
      try { f(data); } catch (e) { console.error(e); }
    });
    if (evt === "participants" || evt === "suggestions" || evt === "chat" || evt === "joined" || evt === "role") {
      this.schedulePersist();
    }
  },

  // ---------- Sesión guardada ----------
  schedulePersist: function () {
    const self = this;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(function () {
      self.persistTimer = null;
      self.saveSession();
    }, 400);
  },

  saveSession: function () {
    if (!this.ready || !this.code) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        code: this.code,
        roomName: this.roomName,
        pwHash: this.pwHash,
        creator: this.creator,
        isHost: this.isHost,
        suggestions: this.isHost ? this.suggestions : [],
        chat: this.chatLog.slice(-50),
        savedAt: Date.now()
      }));
    } catch (e) {}
  },

  loadSession: function () {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (!s || !/^[A-Z0-9]{4,16}$/.test(s.code || "")) return null;
      if (!s.savedAt || Date.now() - s.savedAt > SESSION_MAX_AGE) return null;
      return s;
    } catch (e) {
      return null;
    }
  },

  clearSession: function () {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  },

  // Al arrancar Spotify: vuelve a la sala guardada (como anfitrión o invitado)
  resumeSession: function () {
    const s = this.loadSession();
    if (!s || this.ready || this.resuming) return;
    const self = this;
    const asHost = !!(s.creator && s.isHost);
    this.resuming = { code: s.code, asHost: asHost, until: Date.now() + RESUME_MS };
    this.emit("resume");
    getSpotifyProfile().then(function (prof) {
      function attempt() {
        if (!self.resuming) return;
        if (Date.now() > self.resuming.until) {
          self.resuming = null;
          self.resetPeer();
          self.clearSession();
          self.emit("resume");
          self.emit("error", "No se pudo volver a la sala " + s.code);
          return;
        }
        const p = asHost
          ? self.createRoom({
              code: s.code,
              pwHash: s.pwHash || null,
              roomName: s.roomName,
              displayName: prof.name || "Anfitrión",
              avatar: prof.avatar,
              user: prof.user,
              restore: s
            })
          : self.joinRoom({
              code: s.code,
              pwHash: s.pwHash || null,
              displayName: prof.name || "Invitado",
              avatar: prof.avatar,
              user: prof.user
            });
        p.then(function () {
          if (!self.resuming) return;
          self.resuming = null;
          self.emit("resume");
          if (asHost) self.emit("joined");
        }).catch(function (err) {
          if (!self.resuming) return;
          self.resetPeer();
          self.ready = false;
          if (err && err.denied) {
            self.resuming = null;
            self.clearSession();
            self.emit("resume");
            self.emit("error", err.message);
            return;
          }
          setTimeout(attempt, RETRY_MS);
        });
      }
      attempt();
    });
  },

  cancelResume: function () {
    if (!this.resuming) return;
    this.resuming = null;
    this.resetPeer();
    this.ready = false;
    this.clearSession();
    this.emit("resume");
  },

  // Invitado: el anfitrión se fue (cerró Spotify, se cayó la red…); se espera a que vuelva
  startReconnect: function () {
    if (this.reconnecting || !this.code) return;
    const self = this;
    this.reconnecting = { until: Date.now() + RESUME_MS };
    this.emit("reconnecting");
    function attempt() {
      if (!self.reconnecting) return;
      if (self.ready) {
        self.reconnecting = null;
        return;
      }
      if (Date.now() > self.reconnecting.until || !self.peer || self.peer.destroyed) {
        self.reconnecting = null;
        self.emit("disconnected");
        return;
      }
      if (self.peer.disconnected) {
        try { self.peer.reconnect(); } catch (e) {}
      } else {
        self.connectTo("l2g-" + self.code);
      }
      setTimeout(attempt, RETRY_MS);
    }
    setTimeout(attempt, 1500);
  },

  hostLost: function () {
    const old = this.hostConn;
    this.hostConn = null;
    if (old) {
      try { old.close(); } catch (e) {}
    }
    if (this.ready) {
      this.ready = false;
      this.startReconnect();
    }
  },

  send: function (conn, msg) {
    try {
      if (conn && conn.open) conn.send(JSON.stringify(msg));
    } catch (e) {}
  },

  sendAll: function (msg) {
    const data = JSON.stringify(msg);
    for (const pid in this.connections) {
      try {
        if (this.connections[pid].open) this.connections[pid].send(data);
      } catch (e) {}
    }
  },

  sendToHost: function (msg) {
    this.send(this.hostConn, msg);
  },

  // El historial vive en el Engine para sobrevivir al desmontaje de la vista
  addChat: function (msg) {
    this.chatLog = this.chatLog.concat([msg]).slice(-200);
    this.emit("chat", msg);
  },

  broadcastSuggestions: function () {
    this.sendAll({ t: "suggestions", list: this.suggestions });
    this.emit("suggestions");
  },

  // Solo el anfitrión modifica la lista; devuelve un mensaje si se rechaza
  hostAddSuggestion: function (raw, byId, byName) {
    const it = cleanSuggestion(raw);
    if (!it) return "Enlace no válido";
    if (this.suggestions.some(function (s) { return s.uri === it.uri; })) return "Eso ya está en las sugerencias";
    if (this.suggestions.length >= SUGGEST_MAX) return "La lista de sugerencias está llena";
    const mine = this.suggestions.filter(function (s) { return s.byId === byId; }).length;
    if (mine >= SUGGEST_PER_PEER) return "Has alcanzado el máximo de sugerencias";
    it.id = genCode();
    it.byId = byId;
    it.by = byName || "Alguien";
    this.suggestions = this.suggestions.concat([it]);
    this.broadcastSuggestions();
    return null;
  },

  suggest: function (raw) {
    if (!this.ready) return "No estás en una sala";
    if (this.isHost) return "El anfitrión no sugiere: pon la música directamente";
    this.sendToHost({ t: "suggest", item: raw });
    return null;
  },

  removeSuggestion: function (id) {
    if (!this.isHost) {
      this.sendToHost({ t: "unsuggest", id: id });
      return;
    }
    this.suggestions = this.suggestions.filter(function (s) { return s.id !== id; });
    this.broadcastSuggestions();
  },

  playSuggestion: function (id) {
    if (!this.isHost) return;
    const it = this.suggestions.find(function (s) { return s.id === id; });
    if (!it) return;
    try { Spicetify.Player.playUri(it.uri); } catch (e) { console.error(e); }
    this.removeSuggestion(id);
    this.announce("▶ " + this.localName + " puso " + it.name + " (sugerida por " + it.by + ")");
  },

  // Añade la sugerencia (o todas las canciones del álbum/playlist) a la cola del anfitrión
  queueSuggestion: function (id) {
    if (!this.isHost) return Promise.resolve("Solo el anfitrión maneja la cola");
    const self = this;
    const it = this.suggestions.find(function (s) { return s.id === id; });
    if (!it) return Promise.resolve(null);
    return resolveTrackUris(it.uri).then(function (uris) {
      if (!uris.length) throw new Error("vacío");
      return addUrisToQueue(uris).then(function () {
        self.removeSuggestion(id);
        const extra = uris.length > 1 ? " (" + uris.length + " canciones)" : "";
        self.announce("➕ " + self.localName + " añadió " + it.name + extra + " a la cola");
        return null;
      });
    }).catch(function () {
      return "No se pudo añadir a la cola";
    });
  },

  // Cierra cualquier conexión previa antes de crear/unirse a otra sala
  resetPeer: function () {
    this.stopHeartbeat();
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null;
    this.hostConn = null;
    this.connections = {};
    this.lastSeen = {};
    this.peerCid = {};
    this.chatLog = [];
    this.suggestions = [];
  },

  makePeer: function (id) {
    if (!window.Peer) throw new Error("PeerJS no disponible");
    return new window.Peer(id, { debug: 0, config: { iceServers: ICE } });
  },

  attach: function (peer) {
    const self = this;
    peer.on("error", function (err) {
      let msg = "Error de conexión P2P";
      if (err.type === "peer-unavailable") msg = "No existe ninguna sala con ese ID";
      else if (err.type === "network" || err.type === "server-error") msg = "Sin conexión con el servicio de señalización";
      else if (err.type === "unavailable-id") msg = "ID de sala en uso, intenta crearla otra vez";
      if (!self.resuming && !self.reconnecting) self.emit("error", msg);
      if (self.joinRej) {
        const r = self.joinRej;
        self.joinRej = null;
        r(new Error(msg));
      }
    });
  },

  startHeartbeat: function () {
    const self = this;
    this.stopHeartbeat();
    this.heartbeat = setInterval(function () {
      if (!self.ready) return;
      if (self.isHost) {
        self.dropSilentGuests();
        self.broadcastState();
        return;
      }
      if (self.lastHostMsgAt && Date.now() - self.lastHostMsgAt > HOST_SILENCE_MS) {
        self.hostLost();
        return;
      }
      self.sendToHost({ t: "ping", c: Date.now() });
    }, 2000);
  },

  stopHeartbeat: function () {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  },

  broadcastState: function () {
    if (!this.isHost) return;
    this.sendAll({ t: "state", state: playerState() });
  },

  broadcastParticipants: function () {
    this.sendAll({ t: "participants", list: this.participants });
    this.emit("participants");
  },

  createRoom: function (opts) {
    const self = this;
    this.resetPeer();
    this.code = opts.code || genCode();
    this.roomName = opts.roomName || "Sala";
    this.localName = opts.displayName || "Anfitrión";
    this.localAvatar = opts.avatar || null;
    this.localUser = opts.user || null;
    this.pwHash = opts.pwHash !== undefined ? opts.pwHash : (opts.password ? hashStr(opts.password) : null);
    this.isHost = true;
    this.creator = true;
    this.ready = false;
    this.lastRemoteMeta = null;
    this.connections = {};
    this.participants = [];

    return new Promise(function (res, rej) {
      let peer;
      try {
        peer = self.makePeer("l2g-" + self.code);
      } catch (e) {
        rej(e);
        return;
      }
      self.peer = peer;
      peer.on("open", function (id) {
        self.hostId = id;
        try { self.lastAnnounced = Spicetify.Player.isPlaying(); } catch (e) {}
        self.participants = [{ id: id, name: self.localName, avatar: self.localAvatar, user: self.localUser, ver: APP_VERSION, isHost: true }];
        if (opts.restore) {
          self.chatLog = (opts.restore.chat || []).filter(function (m) { return m && typeof m.text === "string"; }).slice(-50);
          self.suggestions = (opts.restore.suggestions || []).filter(function (it) { return it && it.id && cleanSuggestion(it); });
        }
        self.ready = true;
        self.attach(peer);
        peer.on("connection", function (conn) { self.handleIncoming(conn); });
        self.startHeartbeat();
        self.broadcastState();
        self.emit("participants");
        res(self.code);
      });
      peer.on("error", rej);
    });
  },

  joinRoom: function (opts) {
    const self = this;
    this.resetPeer();
    this.code = String(opts.code || "").trim().toUpperCase();
    this.localName = opts.displayName || "Invitado";
    this.localAvatar = opts.avatar || null;
    this.localUser = opts.user || null;
    this.pwHash = opts.pwHash !== undefined ? opts.pwHash : (opts.password ? hashStr(opts.password) : null);
    this.isHost = false;
    this.creator = false;
    this.ready = false;
    this.lastRemoteMeta = null;

    return new Promise(function (res, rej) {
      self.joinRes = res;
      self.joinRej = rej;
      let peer;
      try {
        peer = self.makePeer(undefined);
      } catch (e) {
        rej(e);
        return;
      }
      self.peer = peer;
      peer.on("open", function () {
        self.attach(peer);
        peer.on("connection", function (conn) { self.handleIncoming(conn); });
        self.startHeartbeat();
        self.connectTo("l2g-" + self.code);
      });
      peer.on("error", function (err) {
        if (self.joinRej) {
          const r = self.joinRej;
          self.joinRej = null;
          r(err);
        }
      });
      setTimeout(function () {
        if (self.joinRej) {
          const r = self.joinRej;
          self.joinRej = null;
          r(new Error("Tiempo agotado. Comprueba que la sala exista y esté abierta."));
        }
      }, 12000);
    });
  },

  connectTo: function (hostId) {
    const self = this;
    const old = this.hostConn;
    this.hostConn = null;
    this.rtt = 0;
    this.lastHostMsgAt = Date.now();
    if (old) {
      try { old.close(); } catch (e) {}
    }
    const conn = this.peer.connect(hostId, { reliable: true });
    this.hostConn = conn;
    conn.on("open", function () {
      self.send(conn, { t: "hello", v: APP_VERSION, cid: getClientId(), name: self.localName, avatar: self.localAvatar, user: self.localUser, pwh: self.pwHash, code: self.code });
    });
    conn.on("data", function (raw) {
      let m;
      try { m = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return; }
      if (self.hostConn === conn) self.lastHostMsgAt = Date.now();
      self.handleGuestMsg(conn, m);
    });
    conn.on("close", function () {
      if (self.hostConn !== conn) return;
      self.hostLost();
    });
  },

  handleIncoming: function (conn) {
    const self = this;
    conn.on("open", function () {
      conn.on("data", function (raw) {
        let m;
        try { m = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return; }
        if (self.connections[conn.peer] === conn) self.lastSeen[conn.peer] = Date.now();
        self.handleHostMsg(conn, m);
      });
      conn.on("close", function () {
        if (self.connections[conn.peer] === conn) {
          delete self.connections[conn.peer];
          self.removeParticipant(conn.peer);
        }
      });
    });
  },

  handleHostMsg: function (conn, m) {
    const self = this;
    if (m.t === "hello") {
      if (!this.isHost) {
        this.send(conn, { t: "redirect", hostId: this.hostId });
        return;
      }
      if (this.pwHash && this.pwHash !== m.pwh) {
        this.send(conn, { t: "deny", msg: "Contraseña incorrecta" });
        setTimeout(function () { try { conn.close(); } catch (e) {} }, 300);
        return;
      }
      // ¿Es alguien que vuelve con otra conexión (p. ej. reabrió Spotify)? Se reemplaza su entrada vieja
      const cid = typeof m.cid === "string" && /^[A-Z0-9]{16}$/.test(m.cid) ? m.cid : null;
      const user = safeUser(m.user);
      const stale = Object.keys(this.connections).concat(this.participants.map(function (p) { return p.id; }))
        .filter(function (pid, i, arr) {
          if (pid === conn.peer || pid === self.peer.id || arr.indexOf(pid) !== i) return false;
          if (cid) return self.peerCid[pid] === cid;
          // Respaldo para versiones sin cid: mismo usuario de Spotify y sin cid conocido
          const old = self.participants.find(function (p) { return p.id === pid; });
          return !!(user && old && !self.peerCid[pid] && old.user === user);
        });
      stale.forEach(function (pid) {
        self.suggestions.forEach(function (sg) { if (sg.byId === pid) sg.byId = conn.peer; });
        self.dropGuest(pid);
      });
      this.connections[conn.peer] = conn;
      this.lastSeen[conn.peer] = Date.now();
      if (cid) this.peerCid[conn.peer] = cid;
      const exists = this.participants.some(function (p) { return p.id === conn.peer; });
      if (!exists) {
        this.participants.push({
          id: conn.peer,
          name: m.name || "Invitado",
          avatar: safeAvatar(m.avatar),
          user: safeUser(m.user),
          ver: typeof m.v === "number" ? m.v : 0,
          isHost: false
        });
      }
      this.participants.forEach(function (p) { p.isHost = p.id === self.peer.id; });
      this.send(conn, {
        t: "welcome",
        code: this.code,
        roomName: this.roomName,
        hostId: this.hostId,
        list: this.participants,
        suggestions: this.suggestions,
        state: playerState()
      });
      this.broadcastParticipants();
      return;
    }
    // A partir de aquí solo se aceptan peers que pasaron el "hello" (y la contraseña)
    const member = this.connections[conn.peer] && this.participants.find(function (p) { return p.id === conn.peer; });
    if (m.t === "chat" && this.isHost) {
      if (!member || typeof m.text !== "string" || !m.text.trim()) return;
      const msg = { t: "chat", from: member.name, text: m.text.trim().slice(0, 500), ts: Date.now() };
      this.addChat(msg);
      this.sendAll(msg);
      return;
    }
    if (m.t === "suggest" && this.isHost) {
      if (!member) return;
      const err = this.hostAddSuggestion(m.item, conn.peer, member.name);
      this.send(conn, { t: "info", msg: err || "Sugerencia enviada" });
      return;
    }
    if (m.t === "control" && this.isHost) {
      if (!member || typeof m.playing !== "boolean") return;
      const now = Date.now();
      if (now - (this.controlRate[conn.peer] || 0) < 600) return;
      this.controlRate[conn.peer] = now;
      let cur = null;
      try { cur = Spicetify.Player.isPlaying(); } catch (e) {}
      if (cur === m.playing) {
        this.send(conn, { t: "state", state: playerState() });
        return;
      }
      this.controlActor = { name: member.name, until: now + 2000 };
      try {
        if (m.playing) Spicetify.Player.play();
        else Spicetify.Player.pause();
      } catch (e) {}
      return;
    }
    if (m.t === "unsuggest" && this.isHost) {
      if (!member) return;
      const own = this.suggestions.some(function (s) { return s.id === m.id && s.byId === conn.peer; });
      if (own) this.removeSuggestion(m.id);
      return;
    }
    if (m.t === "ping") {
      this.send(conn, { t: "pong", c: m.c });
      return;
    }
    if (m.t === "sync-req") {
      if (!member) return;
      this.send(conn, { t: "state", state: playerState() });
      return;
    }
    if (m.t === "leave") {
      delete this.connections[conn.peer];
      this.removeParticipant(conn.peer);
      try { conn.close(); } catch (e) {}
    }
  },

  handleGuestMsg: function (conn, m) {
    if (m.t === "welcome") {
      this.code = m.code;
      this.roomName = m.roomName;
      this.hostId = m.hostId;
      this.participants = m.list || [];
      this.suggestions = (m.suggestions || []).filter(cleanSuggestion);
      this.ready = true;
      this.reconnecting = null;
      this.lastHostMsgAt = Date.now();
      if (this.joinRes) {
        const r = this.joinRes;
        this.joinRes = null;
        this.joinRej = null;
        r(this.code);
      }
      this.emit("joined");
      this.emit("participants");
      this.emit("suggestions");
      if (m.state) this.applyState(m.state);
      return;
    }
    if (m.t === "state") {
      this.applyState(m.state);
      return;
    }
    if (m.t === "pong") {
      const sample = Date.now() - m.c;
      if (sample >= 0 && sample < 5000) {
        this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
      }
      return;
    }
    if (m.t === "suggestions") {
      this.suggestions = (m.list || []).filter(cleanSuggestion);
      this.emit("suggestions");
      return;
    }
    if (m.t === "info") {
      if (typeof m.msg === "string") Spicetify.showNotification(m.msg.slice(0, 120));
      return;
    }
    if (m.t === "participants") {
      this.participants = m.list || [];
      this.emit("participants");
      return;
    }
    if (m.t === "chat") {
      this.addChat(m);
      return;
    }
    if (m.t === "redirect") {
      if (m.hostId && m.hostId !== conn.peer) this.connectTo(m.hostId);
      return;
    }
    if (m.t === "host-change") {
      if (m.hostId && this.peer && m.hostId === this.peer.id) {
        this.becomeHost(m.list);
      } else if (m.hostId) {
        this.hostId = m.hostId;
        this.connectTo(m.hostId);
      }
      return;
    }
    if (m.t === "deny") {
      const err = new Error(typeof m.msg === "string" ? m.msg.slice(0, 120) : "Acceso denegado");
      err.denied = true;
      if (this.joinRej) {
        const r = this.joinRej;
        this.joinRej = null;
        this.joinRes = null;
        r(err);
      }
      if (this.reconnecting) {
        this.reconnecting = null;
        this.emit("disconnected");
      }
      if (!this.resuming) this.emit("error", err.message);
      return;
    }
    if (m.t === "kick") {
      this.emit("kicked");
      this.leave();
    }
  },

  applyState: function (st) {
    if (!st) return;
    this.lastRemoteMeta = st.meta || null;
    this.emit("state", st);
    try {
      // Lo que tarda el mensaje en llegar: el anfitrión ya va un poco más adelante
      const target = typeof st.pos === "number"
        ? st.pos + (st.playing ? this.rtt / 2 : 0)
        : null;
      const cur = trackMeta();
      if (st.meta && (!cur || cur.uri !== st.meta.uri)) {
        const pend = this.pending;
        const loading = pend && pend.uri === st.meta.uri && Date.now() < pend.until;
        this.pending = {
          uri: st.meta.uri,
          pos: target,
          playing: st.playing,
          at: Date.now(),
          until: loading ? pend.until : Date.now() + 8000
        };
        // Si la canción ya se está cargando no se vuelve a pedir (reiniciaría la carga)
        if (!loading) {
          this.applyingUntil = Date.now() + 5000;
          Spicetify.Player.playUri(st.meta.uri);
        }
        return;
      }
      this.pending = null;
      const pos = Spicetify.Player.getProgress();
      if (target !== null && Math.abs(pos - target) > DRIFT_MS) {
        this.applyingUntil = Date.now() + 1500;
        Spicetify.Player.seek(target);
      }
      if (Date.now() < this.localControlUntil && st.playing === this.localControlWant) {
        this.localControlUntil = 0;
      }
      const p = Spicetify.Player.isPlaying();
      if (st.playing !== p && Date.now() >= this.localControlUntil) {
        this.applyingUntil = Date.now() + 1500;
        if (st.playing) Spicetify.Player.play();
        else Spicetify.Player.pause();
      }
    } catch (e) { console.error(e); }
  },

  dropGuest: function (pid) {
    const c = this.connections[pid];
    delete this.connections[pid];
    delete this.lastSeen[pid];
    delete this.peerCid[pid];
    if (c) {
      try { c.close(); } catch (e) {}
    }
    this.removeParticipant(pid);
  },

  dropSilentGuests: function () {
    const now = Date.now();
    const self = this;
    Object.keys(this.connections).forEach(function (pid) {
      const p = self.participants.find(function (x) { return x.id === pid; });
      // Las versiones sin "v" quizá no mandan pings: no se les aplica
      if (!p || !(p.ver >= 3)) return;
      const seen = self.lastSeen[pid];
      if (seen && now - seen > GUEST_SILENCE_MS) self.dropGuest(pid);
    });
  },

  removeParticipant: function (pid) {
    if (!this.isHost) return;
    this.participants = this.participants.filter(function (p) { return p.id !== pid; });
    this.broadcastParticipants();
  },

  kick: function (pid) {
    if (!this.isHost || !this.peer || pid === this.peer.id) return;
    const c = this.connections[pid];
    if (c) {
      this.send(c, { t: "kick" });
      setTimeout(function () { try { c.close(); } catch (e) {} }, 250);
      delete this.connections[pid];
    }
    this.removeParticipant(pid);
  },

  transferHost: function (pid) {
    if (!this.isHost || !this.connections[pid]) return;
    const self = this;
    const newHost = pid;
    this.isHost = false;
    this.hostId = newHost;
    const newList = this.participants.map(function (p) {
      return { id: p.id, name: p.name, avatar: p.avatar, user: p.user, ver: p.ver, isHost: p.id === newHost };
    });
    this.sendAll({ t: "host-change", hostId: newHost, list: newList });
    this.participants = newList;
    this.emit("participants");
    this.emit("role");
    Object.keys(this.connections).forEach(function (k) {
      try { self.connections[k].close(); } catch (e) {}
    });
    this.connections = {};
    this.connectTo(newHost);
  },

  becomeHost: function (list) {
    const self = this;
    this.isHost = true;
    this.ready = true;
    this.hostId = this.peer.id;
    this.connections = {};
    const src = (list && list.length)
      ? list
      : [{ id: this.peer.id, name: this.localName, avatar: this.localAvatar, user: this.localUser, ver: APP_VERSION, isHost: true }];
    this.participants = src.map(function (p) {
      return { id: p.id, name: p.name, avatar: p.avatar, user: p.user, ver: p.ver, isHost: p.id === self.peer.id };
    });
    try { this.lastAnnounced = Spicetify.Player.isPlaying(); } catch (e) {}
    this.startHeartbeat();
    this.broadcastParticipants();
    this.broadcastState();
    this.emit("role");
  },

  // Mensaje de sistema en el chat (solo lo genera el anfitrión)
  announce: function (text) {
    const msg = { t: "chat", sys: true, text: text, ts: Date.now() };
    this.addChat(msg);
    this.sendAll(msg);
  },

  // El anfitrión anuncia pausas/reanudaciones reales, con el nombre de quien las hizo
  hostPlayPauseChanged: function () {
    let playing;
    try { playing = Spicetify.Player.isPlaying(); } catch (e) { return; }
    const actor = this.controlActor && Date.now() < this.controlActor.until
      ? this.controlActor.name
      : this.localName;
    this.controlActor = null;
    if (this.lastAnnounced !== null && playing !== this.lastAnnounced) {
      this.announce((playing ? "▶ " : "⏸ ") + actor + (playing ? " reanudó la canción" : " pausó la canción"));
    }
    this.lastAnnounced = playing;
  },

  // Invitado: pausa/reanuda localmente y se lo pide al anfitrión para todos
  guestControl: function (playing) {
    if (this.isHost || !this.ready) return;
    this.localControlUntil = Date.now() + 2000;
    this.localControlWant = playing;
    this.applyingUntil = Date.now() + 1500;
    try {
      if (playing) Spicetify.Player.play();
      else Spicetify.Player.pause();
    } catch (e) {}
    this.sendToHost({ t: "control", playing: playing });
  },

  sendChat: function (text) {
    if (!text || !text.trim()) return;
    if (this.isHost) {
      const full = { t: "chat", from: this.localName, text: text.trim(), ts: Date.now() };
      this.addChat(full);
      this.sendAll(full);
    } else {
      this.sendToHost({ t: "chat", name: this.localName, text: text.trim() });
    }
  },

  leave: function () {
    this.resuming = null;
    this.reconnecting = null;
    this.clearSession();
    this.stopHeartbeat();
    if (this.hostConn) {
      try { this.hostConn.send(JSON.stringify({ t: "leave" })); } catch (e) {}
    }
    for (const k in this.connections) {
      try { this.connections[k].close(); } catch (e) {}
    }
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null;
    this.hostConn = null;
    this.connections = {};
    this.lastSeen = {};
    this.peerCid = {};
    this.ready = false;
    this.isHost = false;
    this.hostId = null;
    this.participants = [];
    this.chatLog = [];
    this.suggestions = [];
    this.controlActor = null;
    this.lastAnnounced = null;
    this.controlRate = {};
    this.localControlUntil = 0;
    this.lastRemoteMeta = null;
    this.pending = null;
    this.emit("left");
  }
};

// Obtiene los datos de cada URI y la propone a la sala; devuelve el primer error, si lo hay
function suggestUris(uris) {
  const refs = (uris || []).map(parseSpotifyRef).filter(Boolean);
  if (!refs.length) return Promise.resolve("Solo se pueden sugerir canciones, álbumes o playlists");
  if (!Engine.ready) return Promise.resolve("No estás en una sala");
  return Promise.all(refs.slice(0, 10).map(function (r) { return fetchItemMeta(r.uri); }))
    .then(function (items) {
      let err = null;
      items.forEach(function (it) {
        const e = it && Engine.suggest(it);
        if (e && !err) err = e;
      });
      return err;
    });
}

function registerContextMenu() {
  if (!Spicetify.ContextMenu || window.__ltSuggestMenu) return;
  window.__ltSuggestMenu = true;
  new Spicetify.ContextMenu.Item(
    "Sugerir en Listen Together",
    function (uris) {
      suggestUris(uris).then(function (err) {
        // El invitado recibe la confirmación del anfitrión; aquí solo se avisa de errores o del anfitrión
        if (err) Spicetify.showNotification(err, true);
      });
    },
    function (uris) {
      return Engine.ready && !Engine.isHost && uris.length > 0 &&
        uris.every(function (u) { return !!parseSpotifyRef(u); });
    }
  ).register();
}

let playerHooksAdded = false;

function addPlayerHooks() {
  if (playerHooksAdded) return;
  playerHooksAdded = true;
  Spicetify.Player.addEventListener("songchange", function () {
    const applying = Date.now() < Engine.applyingUntil;
    const pend = Engine.pending;
    const cur = trackMeta();
    if (pend && cur && cur.uri === pend.uri && Date.now() < pend.until) {
      Engine.pending = null;
      Engine.applyingUntil = Date.now() + 1500;
      try {
        if (typeof pend.pos === "number") {
          Spicetify.Player.seek(pend.pos + (pend.playing ? Date.now() - pend.at : 0));
        }
        if (pend.playing === false) Spicetify.Player.pause();
        else Spicetify.Player.play();
      } catch (e) {}
    }
    if (Engine.isHost && Engine.ready) Engine.broadcastState();
    else if (!Engine.isHost && Engine.ready && !applying) Engine.sendToHost({ t: "sync-req" });
    Engine.emit("track");
  });
  let lastProg = null;
  Spicetify.Player.addEventListener("onprogress", function () {
    if (!Engine.isHost || !Engine.ready) { lastProg = null; return; }
    const now = Date.now();
    let pos = 0;
    let playing = false;
    try {
      pos = Spicetify.Player.getProgress();
      playing = Spicetify.Player.isPlaying();
    } catch (e) { return; }
    if (lastProg) {
      const expected = lastProg.pos + (lastProg.playing ? now - lastProg.t : 0);
      if (Math.abs(pos - expected) > 2000) Engine.broadcastState();
    }
    lastProg = { pos: pos, t: now, playing: playing };
  });
  Spicetify.Player.addEventListener("onplaypause", function () {
    const applying = Date.now() < Engine.applyingUntil;
    if (Engine.isHost && Engine.ready) {
      Engine.hostPlayPauseChanged();
      Engine.broadcastState();
    } else if (!Engine.isHost && Engine.ready && !applying) {
      // Pausa/reanudación hecha por el invitado (barra de Spotify, teclas multimedia…)
      const cur = trackMeta();
      const host = Engine.lastRemoteMeta;
      if (cur && host && cur.uri === host.uri) {
        const want = Spicetify.Player.isPlaying();
        Engine.localControlUntil = Date.now() + 2000;
        Engine.localControlWant = want;
        Engine.sendToHost({ t: "control", playing: want });
      } else {
        Engine.sendToHost({ t: "sync-req" });
      }
    }
    Engine.emit("track");
  });
}

function init() {
  if (!window.Spicetify || !Spicetify.Player || !Spicetify.Player.addEventListener ||
      !Spicetify.Platform || !Spicetify.CosmosAsync || !window.Peer) {
    setTimeout(init, 300);
    return;
  }
  if (window.ListenTogether) return;
  window.ListenTogether = {
    Engine: Engine,
    APP_VERSION: APP_VERSION,
    SUGGEST_TYPES: SUGGEST_TYPES,
    hashStr: hashStr,
    genCode: genCode,
    safeAvatar: safeAvatar,
    safeUser: safeUser,
    getSpotifyProfile: getSpotifyProfile,
    parseSpotifyRef: parseSpotifyRef,
    cleanSuggestion: cleanSuggestion,
    fetchItemMeta: fetchItemMeta,
    openProfile: openProfile,
    trackMeta: trackMeta,
    playerState: playerState,
    fmt: fmt,
    suggestUris: suggestUris,
    addPlayerHooks: addPlayerHooks
  };
  addPlayerHooks();
  registerContextMenu();
  Engine.resumeSession();
}

init();
})();
