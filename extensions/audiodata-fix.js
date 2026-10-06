// audiodata-fix.js
// Spotify retiró el endpoint de audio-analysis, así que Spicetify.getAudioData() ya no
// devuelve nada y extensiones como Cat-Jam Synced bailan a velocidad fija.
// Esta extensión envuelve getAudioData(): si la original falla, obtiene el BPM de la
// API pública de Deezer (vía CosmosAsync, sin CORS) y devuelve { track: { tempo }, beats }.
(function audioDataFix() {
  "use strict";

  const TAG = "[AUDIODATA-FIX]";
  const CACHE_KEY = "audiodata-fix:bpm-cache";
  const CACHE_MAX = 300;
  const misses = new Set();
  const inflight = new Map();
  let originalDead = false;

  if (!window.Spicetify || !Spicetify.CosmosAsync || !Spicetify.getAudioData || !Spicetify.Player || !Spicetify.Player.data) {
    setTimeout(audioDataFix, 300);
    return;
  }
  if (Spicetify.getAudioData.__audiodataFix) return;

  function withTimeout(promise, ms) {
    let id;
    const t = new Promise(function (_, rej) { id = setTimeout(function () { rej(new Error("timeout")); }, ms); });
    return Promise.race([promise, t]).finally(function () { clearTimeout(id); });
  }

  function norm(v) {
    return String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  }

  function cleanTitle(t) {
    return String(t || "")
      .replace(/\s*[\[(].*?[\])]/g, "")
      .replace(/\s+-\s+.*(remaster|version|live|edit|mix).*$/i, "")
      .replace(/\s+(feat\.?|ft\.?|with)\s+.*/i, "")
      .trim();
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; }
  }

  function writeCache(id, bpm) {
    try {
      const c = readCache();
      c[id] = bpm;
      const keys = Object.keys(c);
      for (let i = 0; i < keys.length - CACHE_MAX; i++) delete c[keys[i]];
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  function currentItem(uri) {
    const item = Spicetify.Player.data && Spicetify.Player.data.item;
    if (!item) return null;
    if (uri && item.uri !== uri) return null;
    return item;
  }

  async function deezerBpm(item) {
    const md = item.metadata || {};
    const artist = md.artist_name || (item.artists && item.artists[0] && item.artists[0].name) || "";
    const title = cleanTitle(md.title || item.name || "");
    let match = null;

    if (md.isrc) {
      try {
        const r = await withTimeout(Spicetify.CosmosAsync.get("https://api.deezer.com/track/isrc:" + encodeURIComponent(md.isrc)), 4000);
        if (r && r.id) match = r;
      } catch (e) {}
    }

    if (!match) {
      if (!artist || !title) return null;
      const nt = norm(title);
      const na = norm(artist);
      const pick = function (res) {
        const list = ((res && res.data) || []).filter(function (t) {
          const da = norm(t.artist && t.artist.name);
          return da && (da.includes(na) || na.includes(da));
        });
        // Primero el título exacto (evita versiones en vivo/acústicas), luego parecidos
        return list.find(function (t) { return norm(t.title) === nt; }) ||
          list.find(function (t) { return norm(cleanTitle(t.title)) === nt; }) ||
          list.find(function (t) {
            const dt = norm(cleanTitle(t.title));
            return dt && (dt.includes(nt) || nt.includes(dt));
          }) || null;
      };
      const queries = [artist + " " + title, 'artist:"' + artist + '" track:"' + title + '"'];
      for (let i = 0; i < queries.length && !match; i++) {
        try {
          const res = await withTimeout(Spicetify.CosmosAsync.get("https://api.deezer.com/search?q=" + encodeURIComponent(queries[i])), 4000);
          match = pick(res);
        } catch (e) {}
      }
    }
    if (!match || !match.id) return null;

    // La búsqueda no trae bpm; el detalle de la pista sí
    const det = (match.bpm > 0) ? match
      : await withTimeout(Spicetify.CosmosAsync.get("https://api.deezer.com/track/" + match.id), 4000);
    let bpm = det && Number(det.bpm);
    if (!bpm || bpm <= 0) return null;

    // Pistas suaves (piano, baladas) suelen detectarse al doble del pulso que se siente
    if (bpm >= 110 && typeof det.gain === "number" && det.gain < -12) bpm = bpm / 2;
    return Math.round(bpm * 100) / 100;
  }

  function lookupBpm(item) {
    const id = item.uri;
    const cached = readCache()[id];
    if (cached) return Promise.resolve(cached);
    if (misses.has(id)) return Promise.resolve(null);
    if (inflight.has(id)) return inflight.get(id);
    const p = deezerBpm(item)
      .catch(function () { return null; })
      .then(function (bpm) {
        inflight.delete(id);
        if (bpm) writeCache(id, bpm);
        else misses.add(id);
        console.log(TAG, item.name, "→", bpm ? bpm + " BPM (Deezer)" : "sin BPM");
        return bpm;
      });
    inflight.set(id, p);
    return p;
  }

  // Imita la forma de la respuesta de audio-analysis que esperan las extensiones
  function buildAnalysis(bpm, durationMs) {
    const beat = 60 / bpm;
    const total = Math.max(1, (durationMs || 600000) / 1000);
    const beats = [];
    for (let t = 0; t < total; t += beat) {
      beats.push({ start: Math.round(t * 1000) / 1000, duration: beat, confidence: 0.5 });
    }
    return {
      track: { tempo: bpm, duration: total, tempo_confidence: 0.5 },
      beats: beats,
      bars: [],
      sections: [],
      segments: [],
      tatums: [],
      source: "deezer"
    };
  }

  function itemDuration(item) {
    if (item.duration && item.duration.milliseconds) return item.duration.milliseconds;
    if (item.metadata && item.metadata.duration) return Number(item.metadata.duration);
    try { return Spicetify.Player.getDuration(); } catch (e) { return 0; }
  }

  const original = Spicetify.getAudioData;

  async function patched(uri) {
    if (!originalDead) {
      try {
        const res = await withTimeout(original.apply(this, arguments), 4000);
        if (res && res.track) return res;
      } catch (e) {}
      // Si el endpoint original falla una vez no se reintenta en esta sesión
      originalDead = true;
      console.log(TAG, "getAudioData original no responde; usando Deezer");
    }
    const item = currentItem(uri);
    if (!item) throw new Error("audiodata-fix: solo disponible para la canción actual");
    const bpm = await lookupBpm(item);
    if (!bpm) throw new Error("audiodata-fix: BPM no encontrado");
    return buildAnalysis(bpm, itemDuration(item));
  }
  patched.__audiodataFix = true;
  Spicetify.getAudioData = patched;

  // Precarga el BPM en cuanto cambia la canción para que el gato no espere
  Spicetify.Player.addEventListener("songchange", function () {
    const item = currentItem();
    if (item) lookupBpm(item);
  });

  console.log(TAG, "activo");
})();
