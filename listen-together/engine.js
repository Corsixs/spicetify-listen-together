// engine.js — Listen Together
// Se carga al arrancar Spotify (subfiles_extension): conexión, sincronización, sugerencias,
// menú contextual y la sesión guardada para volver a la sala al reabrir Spotify.
// La interfaz (index.js) lo usa a través de window.ListenTogether.
// Si se instaló una versión más nueva con el botón "Actualizar", se ejecuta esa en lugar de esta.
// Red de seguridad: si la descargada no arranca, se descarta y se vuelve a la instalada.
(function () {
  if (window.__LT_OVERRIDE_RUNNING) return; // este código ya es la versión descargada
  var BUILD = 8;
  var KEY = "listen-together:update";
  var BOOT = "listen-together:update-booting";
  try {
    var up = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!up) return;
    if (!(up.version > BUILD) || typeof up.engine !== "string") {
      // La instalada ya es igual o más nueva: la descargada sobra
      localStorage.removeItem(KEY);
      localStorage.removeItem(BOOT);
      return;
    }
    if (localStorage.getItem(BOOT) === String(up.version)) {
      // El arranque anterior con esta versión no terminó bien
      localStorage.removeItem(KEY);
      localStorage.removeItem(BOOT);
      console.warn("[Listen Together] la versión " + up.version + " falló al arrancar; se usa la instalada");
      return;
    }
    localStorage.setItem(BOOT, String(up.version));
    window.__LT_OVERRIDE_RUNNING = up.version;
    var s = document.createElement("script");
    s.textContent = up.engine + "\n//# sourceURL=listen-together-engine-v" + up.version + ".js";
    (document.head || document.documentElement).appendChild(s);
    if (window.__LT_OVERRIDE_STARTED) {
      window.__LT_BUILTIN_SKIPPED = true;
      // Vigilante: si con Spotify listo la descargada no llega a arrancar, se vuelve a la instalada ya
      var since = Date.now();
      (function watch() {
        if (window.ListenTogether) return;
        var S = window.Spicetify;
        var ready = S && S.Player && S.Player.addEventListener && S.Platform && S.CosmosAsync && window.Peer;
        if (!ready || Date.now() - since < 20000) {
          setTimeout(watch, 2000);
          return;
        }
        console.warn("[Listen Together] la versión " + up.version + " no arrancó; se usa la instalada");
        localStorage.removeItem(KEY);
        localStorage.removeItem(BOOT);
        window.__LT_OVERRIDE_RUNNING = 0;
        window.__LT_BUILTIN_SKIPPED = false;
        if (window.__LT_RUN_BUILTIN) window.__LT_RUN_BUILTIN();
      })();
    } else {
      // Ni siquiera empezó (error de sintaxis): se descarta y sigue la instalada
      window.__LT_OVERRIDE_RUNNING = 0;
      localStorage.removeItem(KEY);
      localStorage.removeItem(BOOT);
    }
  } catch (e) {
    window.__LT_OVERRIDE_RUNNING = 0;
    console.warn("[Listen Together] no se pudo cargar la actualización", e);
  }
})();

(function ltMain() {
"use strict";
if (window.__LT_BUILTIN_SKIPPED && !ltMain.force) {
  // Ya corre la versión descargada; esta queda de reserva para el vigilante
  window.__LT_RUN_BUILTIN = function () {
    ltMain.force = true;
    ltMain();
  };
  return;
}
if (window.__LT_OVERRIDE_RUNNING) window.__LT_OVERRIDE_STARTED = true;

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

// ---------- Datos que llegan de otros peers ----------
// Nada de lo que llega por la red se guarda ni se muestra sin pasar por estas funciones

// Diccionario sin prototipo: un peer con ID "constructor" o "toString" no choca con nada
function dict() {
  return Object.create(null);
}

// Caracteres de control e invisibles, y los que invierten la dirección del texto (suplantación visual)
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

function cleanText(v, max) {
  return typeof v === "string" ? v.replace(UNSAFE_CHARS, "").trim().slice(0, max) : "";
}

function cleanName(v) {
  return cleanText(v, 40);
}

function cleanNumber(v, min, max) {
  return typeof v === "number" && isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}

// Solo imágenes de los servidores de Spotify y de las fotos de perfil de Facebook o Google.
// Una URL cualquiera dejaría que quien la pone vea la IP de todos los que cargan la imagen.
const IMAGE_HOSTS = /(^|\.)(scdn\.co|spotifycdn\.com|fbsbx\.com|fbcdn\.net|googleusercontent\.com)$/i;

function safeAvatar(url) {
  if (typeof url !== "string" || url.length > 600) return null;
  const img = url.match(/^spotify:image:([a-f0-9]{40})$/i);
  if (img) return "https://i.scdn.co/image/" + img[1].toLowerCase();
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.port || u.username || u.password || !IMAGE_HOSTS.test(u.hostname)) return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

function safeUser(u) {
  return typeof u === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(u) ? u : null;
}

// IDs de PeerJS: el de la sala ("l2g-CODIGO") o uno aleatorio
function cleanPeerId(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

// Los mensajes del protocolo son siempre texto JSON con un campo "t"
function parseMsg(raw, maxLen) {
  if (typeof raw !== "string" || raw.length > maxLen) return null;
  let m;
  try { m = JSON.parse(raw); } catch (e) { return null; }
  return m && typeof m === "object" && !Array.isArray(m) && typeof m.t === "string" ? m : null;
}

// Límite de mensajes por peer (cubo de fichas): ráfaga máxima y fichas que se recuperan por segundo
function allowRate(store, key, burst, perSec) {
  const now = Date.now();
  let b = store[key];
  if (!b) b = store[key] = { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + (now - b.at) / 1000 * perSec);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const MAX_PARTICIPANTS = 20;

function cleanParticipant(p) {
  if (!p || typeof p !== "object") return null;
  const id = cleanPeerId(p.id);
  if (!id) return null;
  return {
    id: id,
    name: cleanName(p.name) || "Invitado",
    avatar: safeAvatar(p.avatar),
    user: safeUser(p.user),
    ver: cleanNumber(p.ver, 0, 1000) || 0,
    isHost: p.isHost === true
  };
}

function cleanParticipants(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < MAX_PARTICIPANTS; i++) {
    const p = cleanParticipant(list[i]);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

function cleanChat(m) {
  if (!m || typeof m !== "object") return null;
  const ts = cleanNumber(m.ts, 0, 1e15) || Date.now();
  if (m.sys === true) {
    const sysText = cleanText(m.text, 300);
    return sysText ? { t: "chat", sys: true, text: sysText, ts: ts } : null;
  }
  const text = cleanText(m.text, 500);
  return text ? { t: "chat", from: cleanName(m.from) || "Alguien", text: text, ts: ts } : null;
}

function cleanChatLog(list, max) {
  return Array.isArray(list) ? list.map(cleanChat).filter(Boolean).slice(-max) : [];
}

// Solo se siguen canciones y episodios: ni anuncios, ni archivos locales, ni otras URIs
function cleanPlayableUri(u) {
  return typeof u === "string" && /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(u) ? u : null;
}

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function cleanMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  return {
    uri: cleanPlayableUri(meta.uri),
    name: cleanText(meta.name, 200),
    artists: cleanText(meta.artists, 300),
    album: cleanText(meta.album, 200),
    art: safeAvatar(meta.art),
    duration: cleanNumber(meta.duration, 0, MAX_DURATION_MS) || 0
  };
}

function cleanState(st) {
  if (!st || typeof st !== "object") return null;
  return {
    meta: cleanMeta(st.meta),
    pos: cleanNumber(st.pos, 0, MAX_DURATION_MS),
    playing: st.playing === true,
    ts: cleanNumber(st.ts, 0, 1e15) || 0
  };
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
        prof.name = cleanName(String(prof.name)) || prof.user;
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

// Todo lo que llega por la red se normaliza antes de guardarlo o mostrarlo
function cleanSuggestion(it) {
  if (!it || typeof it !== "object") return null;
  const ref = parseSpotifyRef(it.uri);
  if (!ref) return null;
  return {
    uri: ref.uri,
    type: ref.type,
    name: cleanText(it.name, 140) || SUGGEST_TYPES[ref.type],
    sub: cleanText(it.sub, 140),
    art: safeAvatar(it.art)
  };
}

// Sugerencia completa, tal como la reparte el anfitrión (con su ID y quién la propuso)
function cleanSuggestionEntry(it) {
  const base = cleanSuggestion(it);
  if (!base || typeof it.id !== "string" || !/^[A-Z0-9]{4,16}$/.test(it.id)) return null;
  base.id = it.id;
  base.byId = cleanPeerId(it.byId);
  base.by = cleanName(it.by) || "Alguien";
  return base;
}

function cleanSuggestionList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < SUGGEST_MAX; i++) {
    const it = cleanSuggestionEntry(list[i]);
    if (it && !seen.has(it.id)) {
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
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
const APP_VERSION = 8;

// Límites contra abusos de quien tenga el código de la sala
const MAX_PENDING = 10;            // conexiones que aún no se identificaron
const HELLO_TIMEOUT_MS = 15000;    // tiempo para identificarse antes de cerrar la conexión
const MAX_MSG_FROM_GUEST = 16 * 1024;
const MAX_MSG_FROM_HOST = 256 * 1024;
const PW_FAIL_MAX = 5;             // contraseñas fallidas por minuto (entre todos) antes de bloquear
const PW_LOCK_MS = 60 * 1000;
const SUGGEST_INFLIGHT_MAX = 5;    // sugerencias de un invitado que el anfitrión busca a la vez

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

// Actualizaciones: solo desde este repositorio y solo cuando el usuario pulsa "Actualizar"
const UPDATE_KEY = "listen-together:update";
const UPDATE_BOOT_KEY = "listen-together:update-booting";
const REPO_RAW = "https://raw.githubusercontent.com/Corsixs/spicetify-listen-together/main/";
const UPDATE_FILES = { engine: "listen-together/engine.js", ui: "listen-together/index.js", css: "listen-together/style.css" };
const UPDATE_MAX_BYTES = 1024 * 1024;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

// Clave pública con la que se firman las actualizaciones (tools/firmar-version.mjs). La privada no
// está en el repositorio: aunque alguien entrara a la cuenta de GitHub, sin ella no podría publicar
// una actualización que el botón acepte.
const UPDATE_PUBLIC_KEY = {
  kty: "EC",
  crv: "P-256",
  x: "sPIUw7d4cPQ-EOBIknzx5w7IFpRLCxykWcNyiVG7erU",
  y: "rPC11p5K8Ce0y1aCbiDLhYUQZjlZd-r1V1iv3Xxw-Uk"
};

function sha256Hex(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
    return Array.from(new Uint8Array(buf)).map(function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  });
}

function base64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Texto exacto que firma tools/firmar-version.mjs
function updatePayload(v) {
  return "listen-together-update\nversion:" + v.version + "\nnotes:" + encodeURIComponent(v.notes) +
    "\nengine:" + v.files.engine + "\nui:" + v.files.ui + "\ncss:" + v.files.css + "\n";
}

// true solo si version.json trae los SHA-256 de los archivos y una firma válida de todo
function verifyUpdate(v) {
  const hex = /^[0-9a-f]{64}$/;
  const f = v && v.files;
  if (!f || typeof f !== "object" || !hex.test(f.engine) || !hex.test(f.ui) || !hex.test(f.css) ||
      typeof v.notes !== "string" || typeof v.sig !== "string" || v.sig.length > 200) {
    return Promise.resolve(false);
  }
  return Promise.resolve()
    .then(function () {
      return crypto.subtle.importKey("jwk", UPDATE_PUBLIC_KEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    })
    .then(function (key) {
      return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64ToBytes(v.sig),
        new TextEncoder().encode(updatePayload(v)));
    })
    .catch(function () { return false; });
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
  connections: dict(),
  hostConn: null,
  participants: [],
  chatLog: [],
  suggestions: [],
  ready: false,
  applyingUntil: 0,
  pending: null,
  rtt: 0,
  localControlUntil: 0,
  lastSeen: dict(),
  peerCid: dict(),
  rate: dict(),
  unauth: new Set(),
  pwFails: [],
  pwLockUntil: 0,
  suggestInflight: dict(),
  redirects: 0,
  redirectAt: 0,
  creator: false,
  updateAvailable: null,
  updating: false,
  resuming: null,
  reconnecting: null,
  lastHostMsgAt: 0,
  persistTimer: null,
  localControlWant: null,
  controlActor: null,
  lastAnnounced: null,
  controlRate: dict(),
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

  // ---------- Actualizaciones ----------
  checkForUpdate: function () {
    const self = this;
    return Promise.resolve()
      .then(function () { return race(fetch(REPO_RAW + "version.json?t=" + Date.now(), { cache: "no-store" }), 10000); })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || typeof v.version !== "number" || !(v.version > APP_VERSION)) return;
        return verifyUpdate(v).then(function (ok) {
          if (!ok) {
            console.warn("[Listen Together] version.json no tiene una firma válida; se ignora la versión " + v.version);
            return;
          }
          self.updateAvailable = { version: v.version, notes: cleanText(v.notes, 200), files: v.files };
          self.emit("update");
        });
      })
      .catch(function () {});
  },

  installUpdate: function () {
    const up = this.updateAvailable;
    if (!up || this.updating) return Promise.resolve("No hay ninguna actualización disponible");
    const self = this;
    this.updating = true;
    this.emit("update");
    function get(path) {
      return Promise.resolve()
        .then(function () { return race(fetch(REPO_RAW + path + "?t=" + Date.now(), { cache: "no-store" }), 20000); })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (t) {
          if (!t || t.length > UPDATE_MAX_BYTES) throw new Error("tamaño inesperado");
          return t;
        });
    }
    return Promise.all([get(UPDATE_FILES.engine), get(UPDATE_FILES.ui), get(UPDATE_FILES.css)])
      .then(function (f) {
        // Cada archivo tiene que ser exactamente el que se firmó
        return Promise.all(f.map(sha256Hex)).then(function (h) {
          if (!up.files || h[0] !== up.files.engine || h[1] !== up.files.ui || h[2] !== up.files.css) {
            throw new Error("los archivos no coinciden con la versión firmada " + up.version);
          }
          return f;
        });
      })
      .then(function (f) {
        // Archivos completos y de la versión anunciada (evita instalar algo a medio subir)
        if (f[0].indexOf("const APP_VERSION = " + up.version + ";") < 0 || f[0].indexOf("window.ListenTogether = {") < 0) {
          throw new Error("engine.js no corresponde a la versión " + up.version);
        }
        if (f[1].indexOf("const UI_BUILD = " + up.version + ";") < 0 || f[1].indexOf("function render()") < 0) {
          throw new Error("index.js no corresponde a la versión " + up.version);
        }
        localStorage.setItem(UPDATE_KEY, JSON.stringify({
          version: up.version, engine: f[0], ui: f[1], css: f[2], installedAt: Date.now()
        }));
        localStorage.removeItem(UPDATE_BOOT_KEY);
        // Se guarda la sala para volver a ella tras recargar
        self.saveSession();
        setTimeout(function () { window.location.reload(); }, 300);
        return null;
      })
      .catch(function (e) {
        console.warn("[Listen Together] la actualización falló:", e);
        self.updating = false;
        self.emit("update");
        return "No se pudo actualizar. Inténtalo más tarde.";
      });
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

  // ¿Se puede añadir? Devuelve el motivo si no (cuenta también las que aún se están buscando)
  checkSuggestion: function (uri, byId) {
    if (this.suggestions.some(function (s) { return s.uri === uri; })) return "Eso ya está en las sugerencias";
    if (this.suggestions.length >= SUGGEST_MAX) return "La lista de sugerencias está llena";
    const mine = this.suggestions.filter(function (s) { return s.byId === byId; }).length + (this.suggestInflight[byId] || 0);
    if (mine >= SUGGEST_PER_PEER) return "Has alcanzado el máximo de sugerencias";
    return null;
  },

  // Sugerencia de un invitado: el anfitrión busca él mismo el nombre y la portada en Spotify.
  // Así lo que se ve en la lista es siempre lo que suena al reproducirla.
  hostSuggestFromGuest: function (conn, member, raw) {
    const self = this;
    const pid = conn.peer;
    const ref = parseSpotifyRef(raw && typeof raw === "object" ? raw.uri : null);
    if (!ref) {
      this.send(conn, { t: "info", msg: "Enlace no válido" });
      return;
    }
    if ((this.suggestInflight[pid] || 0) >= SUGGEST_INFLIGHT_MAX) {
      this.send(conn, { t: "info", msg: "Espera un momento antes de sugerir más" });
      return;
    }
    const pre = this.checkSuggestion(ref.uri, pid);
    if (pre) {
      this.send(conn, { t: "info", msg: pre });
      return;
    }
    this.suggestInflight[pid] = (this.suggestInflight[pid] || 0) + 1;
    fetchItemMeta(ref.uri).then(function (meta) {
      self.suggestInflight[pid] = Math.max(0, (self.suggestInflight[pid] || 1) - 1);
      // Mientras se buscaba pudo irse el invitado o cambiar el anfitrión
      if (!self.isHost || self.connections[pid] !== conn) return;
      const err = self.hostAddSuggestion(meta, pid, member.name);
      self.send(conn, { t: "info", msg: err || "Sugerencia enviada" });
    });
  },

  // Solo el anfitrión modifica la lista; devuelve un mensaje si se rechaza
  hostAddSuggestion: function (raw, byId, byName) {
    const it = cleanSuggestion(raw);
    if (!it) return "Enlace no válido";
    const err = this.checkSuggestion(it.uri, byId);
    if (err) return err;
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

  clearSuggestions: function () {
    if (!this.isHost || !this.suggestions.length) return;
    this.suggestions = [];
    this.broadcastSuggestions();
  },

  playSuggestion: function (id) {
    if (!this.isHost) return;
    const it = this.suggestions.find(function (s) { return s.id === id; });
    if (!it) {
      // La interfaz mostraba algo que ya no existe: se resincroniza
      this.emit("suggestions");
      return;
    }
    try { Spicetify.Player.playUri(it.uri); } catch (e) { console.error(e); }
    this.removeSuggestion(id);
    this.announce("▶ " + this.localName + " puso " + it.name + " (sugerida por " + it.by + ")");
  },

  // Añade la sugerencia (o todas las canciones del álbum/playlist) a la cola del anfitrión
  queueSuggestion: function (id) {
    if (!this.isHost) return Promise.resolve("Solo el anfitrión maneja la cola");
    const self = this;
    const it = this.suggestions.find(function (s) { return s.id === id; });
    if (!it) {
      this.emit("suggestions");
      return Promise.resolve("Esa sugerencia ya no existe");
    }
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
    this.connections = dict();
    this.lastSeen = dict();
    this.peerCid = dict();
    this.rate = dict();
    this.unauth = new Set();
    this.suggestInflight = dict();
    this.pwFails = [];
    this.pwLockUntil = 0;
    this.redirects = 0;
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
    this.roomName = cleanText(opts.roomName, 60) || "Sala";
    this.localName = cleanName(opts.displayName) || "Anfitrión";
    this.localAvatar = opts.avatar || null;
    this.localUser = opts.user || null;
    this.pwHash = opts.pwHash !== undefined ? opts.pwHash : (opts.password ? hashStr(opts.password) : null);
    this.isHost = true;
    this.creator = true;
    this.ready = false;
    this.lastRemoteMeta = null;
    this.connections = dict();
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
          self.chatLog = cleanChatLog(opts.restore.chat, 50);
          self.suggestions = cleanSuggestionList(opts.restore.suggestions);
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
    if (!/^[A-Z0-9]{4,16}$/.test(this.code)) return Promise.reject(new Error("El ID de la sala no es válido"));
    this.localName = cleanName(opts.displayName) || "Invitado";
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
      // Solo cuenta lo que llega por la conexión actual con el anfitrión
      if (self.hostConn !== conn) return;
      const m = parseMsg(raw, MAX_MSG_FROM_HOST);
      if (!m) return;
      self.lastHostMsgAt = Date.now();
      self.handleGuestMsg(conn, m);
    });
    conn.on("close", function () {
      if (self.hostConn !== conn) return;
      self.hostLost();
    });
  },

  handleIncoming: function (conn) {
    const self = this;
    // Conexiones que aún no se identificaron: pocas a la vez, y se cierran si no saludan a tiempo
    if (this.unauth.size >= MAX_PENDING) {
      try { conn.close(); } catch (e) {}
      return;
    }
    this.unauth.add(conn);
    const helloTimer = setTimeout(function () {
      if (!self.unauth.has(conn)) return;
      self.unauth.delete(conn);
      try { conn.close(); } catch (e) {}
    }, HELLO_TIMEOUT_MS);
    conn.on("open", function () {
      conn.on("data", function (raw) {
        const m = parseMsg(raw, MAX_MSG_FROM_GUEST);
        if (!m) return;
        if (self.connections[conn.peer] === conn) self.lastSeen[conn.peer] = Date.now();
        self.handleHostMsg(conn, m);
      });
      conn.on("close", function () {
        clearTimeout(helloTimer);
        self.unauth.delete(conn);
        if (self.connections[conn.peer] === conn) {
          delete self.connections[conn.peer];
          self.removeParticipant(conn.peer);
        }
      });
    });
  },

  // Rechaza a alguien. Con retry, quien estaba volviendo a la sala lo sigue intentando.
  deny: function (conn, msg, retry) {
    this.unauth.delete(conn);
    this.send(conn, retry ? { t: "deny", msg: msg, retry: true } : { t: "deny", msg: msg });
    setTimeout(function () { try { conn.close(); } catch (e) {} }, 300);
  },

  // Contraseñas: como mucho PW_FAIL_MAX fallos por minuto entre todos; después, un minuto de bloqueo
  notePwFailure: function () {
    const now = Date.now();
    this.pwFails = this.pwFails.filter(function (t) { return now - t < 60000; });
    this.pwFails.push(now);
    if (this.pwFails.length >= PW_FAIL_MAX) {
      this.pwLockUntil = now + PW_LOCK_MS;
      this.pwFails = [];
    }
  },

  handleHostMsg: function (conn, m) {
    const self = this;
    const pid = conn.peer;
    if (m.t === "hello") {
      if (!this.isHost) {
        if (allowRate(this.rate, pid + ":hello", 3, 0.2)) this.send(conn, { t: "redirect", hostId: this.hostId });
        return;
      }
      // Un solo saludo por conexión
      if (this.connections[pid] === conn) return;
      if (Date.now() < this.pwLockUntil) {
        this.deny(conn, "Demasiados intentos con contraseña incorrecta. Espera un minuto.", true);
        return;
      }
      if (this.pwHash && this.pwHash !== (typeof m.pwh === "string" ? m.pwh : null)) {
        this.notePwFailure();
        this.deny(conn, "Contraseña incorrecta");
        return;
      }
      // ¿Es alguien que vuelve con otra conexión (p. ej. reabrió Spotify)? Se reemplaza su entrada vieja
      const cid = typeof m.cid === "string" && /^[A-Z0-9]{16}$/.test(m.cid) ? m.cid : null;
      const user = safeUser(m.user);
      const stale = Object.keys(this.connections).concat(this.participants.map(function (p) { return p.id; }))
        .filter(function (id, i, arr) {
          if (id === pid || id === self.peer.id || arr.indexOf(id) !== i) return false;
          if (cid) return self.peerCid[id] === cid;
          // Respaldo para versiones sin cid: mismo usuario de Spotify y sin cid conocido
          const old = self.participants.find(function (p) { return p.id === id; });
          return !!(user && old && !self.peerCid[id] && old.user === user);
        });
      const known = this.participants.some(function (p) { return p.id === pid; });
      if (!stale.length && !known && this.participants.length >= MAX_PARTICIPANTS) {
        this.deny(conn, "La sala está llena", true);
        return;
      }
      stale.forEach(function (id) {
        self.suggestions.forEach(function (sg) { if (sg.byId === id) sg.byId = pid; });
        self.dropGuest(id);
      });
      this.unauth.delete(conn);
      this.connections[pid] = conn;
      this.lastSeen[pid] = Date.now();
      if (cid) this.peerCid[pid] = cid;
      if (!known) {
        this.participants.push({
          id: pid,
          name: cleanName(m.name) || "Invitado",
          avatar: safeAvatar(m.avatar),
          user: user,
          ver: cleanNumber(m.v, 0, 1000) || 0,
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
    // A partir de aquí solo se aceptan peers que pasaron el "hello" (y la contraseña),
    // por su conexión registrada y con un límite de mensajes por tipo
    if (!this.isHost || this.connections[pid] !== conn) return;
    const member = this.participants.find(function (p) { return p.id === pid; });
    if (!member) return;
    if (m.t === "ping") {
      if (allowRate(this.rate, pid + ":ping", 3, 1)) this.send(conn, { t: "pong", c: cleanNumber(m.c, 0, 1e15) });
      return;
    }
    if (m.t === "chat") {
      if (!allowRate(this.rate, pid + ":chat", 5, 1)) return;
      const text = cleanText(m.text, 500);
      if (!text) return;
      const msg = { t: "chat", from: member.name, text: text, ts: Date.now() };
      this.addChat(msg);
      this.sendAll(msg);
      return;
    }
    if (m.t === "suggest") {
      if (!allowRate(this.rate, pid + ":suggest", 10, 0.5)) {
        this.send(conn, { t: "info", msg: "Espera un momento antes de sugerir más" });
        return;
      }
      this.hostSuggestFromGuest(conn, member, m.item);
      return;
    }
    if (m.t === "control") {
      if (typeof m.playing !== "boolean") return;
      const now = Date.now();
      if (now - (this.controlRate[pid] || 0) < 600) return;
      this.controlRate[pid] = now;
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
    if (m.t === "unsuggest") {
      if (typeof m.id !== "string" || !allowRate(this.rate, pid + ":unsuggest", 10, 2)) return;
      const own = this.suggestions.some(function (s) { return s.id === m.id && s.byId === pid; });
      if (own) this.removeSuggestion(m.id);
      return;
    }
    if (m.t === "sync-req") {
      if (allowRate(this.rate, pid + ":sync", 3, 1)) this.send(conn, { t: "state", state: playerState() });
      return;
    }
    if (m.t === "leave") {
      delete this.connections[pid];
      this.removeParticipant(pid);
      try { conn.close(); } catch (e) {}
    }
  },

  handleGuestMsg: function (conn, m) {
    if (m.t === "welcome") {
      // El código es el de la sala a la que se entró: el anfitrión no lo cambia
      this.roomName = cleanText(m.roomName, 60) || "Sala";
      this.hostId = cleanPeerId(m.hostId) || conn.peer;
      this.participants = cleanParticipants(m.list);
      this.suggestions = cleanSuggestionList(m.suggestions);
      this.redirects = 0;
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
      if (typeof m.c !== "number") return;
      const sample = Date.now() - m.c;
      if (sample >= 0 && sample < 5000) {
        this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
      }
      return;
    }
    if (m.t === "suggestions") {
      this.suggestions = cleanSuggestionList(m.list);
      this.emit("suggestions");
      return;
    }
    if (m.t === "info") {
      const info = cleanText(m.msg, 120);
      if (info && allowRate(this.rate, "host:info", 5, 1)) Spicetify.showNotification(info);
      return;
    }
    if (m.t === "participants") {
      this.participants = cleanParticipants(m.list);
      this.emit("participants");
      return;
    }
    if (m.t === "chat") {
      const c = cleanChat(m);
      if (c && allowRate(this.rate, "host:chat", 30, 10)) this.addChat(c);
      return;
    }
    if (m.t === "redirect") {
      const target = cleanPeerId(m.hostId);
      if (!target || target === conn.peer || (this.peer && target === this.peer.id)) return;
      // Sin quedar rebotando entre peers: como mucho 5 redirecciones seguidas cada 30 s
      const now = Date.now();
      if (now - this.redirectAt > 30000) this.redirects = 0;
      this.redirectAt = now;
      if (++this.redirects > 5) return;
      this.connectTo(target);
      return;
    }
    if (m.t === "host-change") {
      const target = cleanPeerId(m.hostId);
      if (!target) return;
      if (this.peer && target === this.peer.id) {
        this.becomeHost(m.list);
      } else {
        this.hostId = target;
        this.connectTo(target);
      }
      return;
    }
    if (m.t === "deny") {
      const err = new Error(cleanText(m.msg, 120) || "Acceso denegado");
      // Con retry (sala llena o bloqueada un momento) se sigue intentando volver a la sala
      err.denied = m.retry !== true;
      if (!err.denied && (this.resuming || this.reconnecting)) return;
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

  applyState: function (raw) {
    const st = cleanState(raw);
    if (!st) return;
    this.lastRemoteMeta = st.meta;
    this.emit("state", st);
    // Anuncio, archivo local u otra cosa que no se puede seguir: se deja todo como está
    if (st.meta && !st.meta.uri) return;
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
    delete this.controlRate[pid];
    delete this.suggestInflight[pid];
    const rate = this.rate;
    Object.keys(rate).forEach(function (k) { if (k.indexOf(pid + ":") === 0) delete rate[k]; });
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
    this.connections = dict();
    this.connectTo(newHost);
  },

  becomeHost: function (list) {
    const self = this;
    this.isHost = true;
    this.ready = true;
    this.hostId = this.peer.id;
    this.connections = dict();
    // La lista viene del anfitrión anterior: se valida como cualquier otro dato de la red
    const src = cleanParticipants(list);
    if (!src.some(function (p) { return p.id === self.peer.id; })) {
      src.unshift({ id: this.peer.id, name: this.localName, avatar: this.localAvatar, user: this.localUser, ver: APP_VERSION, isHost: true });
    }
    this.participants = src.map(function (p) {
      p.isHost = p.id === self.peer.id;
      return p;
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

  sendChat: function (raw) {
    const text = cleanText(raw, 500);
    if (!text) return;
    if (this.isHost) {
      const full = { t: "chat", from: this.localName, text: text, ts: Date.now() };
      this.addChat(full);
      this.sendAll(full);
    } else {
      this.sendToHost({ t: "chat", name: this.localName, text: text });
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
    this.connections = dict();
    this.lastSeen = dict();
    this.peerCid = dict();
    this.rate = dict();
    this.unauth = new Set();
    this.suggestInflight = dict();
    this.ready = false;
    this.isHost = false;
    this.hostId = null;
    this.participants = [];
    this.chatLog = [];
    this.suggestions = [];
    this.controlActor = null;
    this.lastAnnounced = null;
    this.controlRate = dict();
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
    addPlayerHooks: addPlayerHooks,
    UPDATE_KEY: UPDATE_KEY,
    UPDATE_BOOT_KEY: UPDATE_BOOT_KEY
  };
  addPlayerHooks();
  registerContextMenu();
  Engine.resumeSession();
  // La versión descargada arrancó bien: se quita la marca de "arrancando"
  if (window.__LT_OVERRIDE_RUNNING) {
    try { localStorage.removeItem(UPDATE_BOOT_KEY); } catch (e) {}
  }
  setTimeout(function () { Engine.checkForUpdate(); }, 8000);
  setInterval(function () { Engine.checkForUpdate(); }, UPDATE_CHECK_MS);
}

init();
})();
