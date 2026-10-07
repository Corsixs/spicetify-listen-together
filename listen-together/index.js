"use strict";

const react = Spicetify.React;
const { useState, useEffect, useRef } = react;

// Debe coincidir con APP_VERSION de engine.js
const UI_BUILD = 9;
const UPDATE_KEY = "listen-together:update";
const UPDATE_BOOT_KEY = "listen-together:update-booting";

const STROKED = {
  headphones: [
    ["path", { d: "M3 18v-6a9 9 0 0 1 18 0v6" }],
    ["path", { d: "M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" }]
  ],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  arrowRight: [["path", { d: "M5 12h14M12 5l7 7-7 7" }]],
  arrowLeft: [["path", { d: "M19 12H5M12 19l-7-7 7-7" }]],
  x: [["path", { d: "M18 6L6 18M6 6l12 12" }]],
  copy: [
    ["rect", { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }],
    ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }]
  ],
  users: [
    ["path", { d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: 9, cy: 7, r: 4 }],
    ["path", { d: "M23 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }]
  ],
  crown: [
    ["path", { d: "M3 18l-1.5-9L7 12.5 12 5l5 7.5L22.5 9 21 18H3z" }],
    ["path", { d: "M3.5 21h17" }]
  ],
  message: [["path", { d: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" }]],
  send: [["path", { d: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" }]],
  music: [
    ["path", { d: "M9 18V5l12-2v13" }],
    ["circle", { cx: 6, cy: 18, r: 3 }],
    ["circle", { cx: 18, cy: 16, r: 3 }]
  ],
  check: [["path", { d: "M20 6L9 17l-5-5" }]],
  ban: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "M4.9 4.9l14.2 14.2" }]
  ],
  lock: [
    ["rect", { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }],
    ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }]
  ],
  list: [["path", { d: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" }]],
  queue: [["path", { d: "M3 6h13M3 12h9M3 18h9M18 11v8M14 15h8" }]]
};

const FILLED = {
  play: "M8 5v14l11-7z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z"
};

function icon(name, size) {
  const s = size || 18;
  return react.createElement("svg", {
    viewBox: "0 0 24 24",
    width: s,
    height: s,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "lt-ic",
    "aria-hidden": "true"
  }, STROKED[name].map(function (el, i) {
    return react.createElement(el[0], Object.assign({ key: i }, el[1]));
  }));
}

function iconFill(name, size) {
  const s = size || 18;
  return react.createElement("svg", {
    viewBox: "0 0 24 24",
    width: s,
    height: s,
    fill: "currentColor",
    className: "lt-ic",
    "aria-hidden": "true"
  }, react.createElement("path", { d: FILLED[name] }));
}

// La lógica vive en engine.js (cargado al arrancar Spotify); aquí solo la interfaz
let Engine, APP_VERSION, t, lang, hashStr, genCode, safeAvatar, safeUser, getSpotifyProfile, parseSpotifyRef, cleanSuggestion, fetchItemMeta, openProfile, trackMeta, playerState, fmt, suggestUris, addPlayerHooks;

function bindEngine() {
  const L = window.ListenTogether;
  if (!L) return false;
  ({ Engine, APP_VERSION, t, lang, hashStr, genCode, safeAvatar, safeUser, getSpotifyProfile, parseSpotifyRef, cleanSuggestion, fetchItemMeta, openProfile, trackMeta, playerState, fmt, suggestUris, addPlayerHooks } = L);
  return true;
}

// Lo que se ve antes de que engine.js esté listo; después todo usa t() del engine
const BOOT_TEXT = {
  es: {
    loading: "Cargando Listen Together…",
    override_failed: "La versión actualizada falló",
    override_failed_sub: "Puedes volver a la versión que tenías instalada.",
    revert: "Volver a la versión instalada"
  },
  en: {
    loading: "Loading Listen Together…",
    override_failed: "The updated version failed",
    override_failed_sub: "You can go back to the version you had installed.",
    revert: "Go back to the installed version"
  }
};

function bootText(key) {
  let loc = "";
  try {
    loc = (Spicetify.Locale && Spicetify.Locale.getLocale && Spicetify.Locale.getLocale()) || navigator.language || "";
  } catch (e) {}
  return BOOT_TEXT[/^es\b/i.test(String(loc)) ? "es" : "en"][key];
}

function Avatar(props) {
  const [broken, setBroken] = useState(false);
  const src = safeAvatar(props.src);
  const cls = "avatar" + (props.host ? " avatar-host" : "");
  if (src && !broken) {
    return react.createElement("img", {
      className: cls + " avatar-img",
      src: src,
      alt: "",
      referrerPolicy: "no-referrer",
      onError: function () { setBroken(true); }
    });
  }
  const ch = String(props.name || "?").charAt(0).toUpperCase();
  return react.createElement("div", { className: cls }, ch);
}

function App() {
  // Al cambiar de pestaña Spotify desmonta la app, pero el Engine sigue conectado:
  // si ya hay una sala activa, se restaura la vista a partir de él.
  const inRoom = !!(Engine.peer && (Engine.ready || Engine.reconnecting));
  const [view, setView] = useState(inRoom ? "room" : "lobby");
  const [tab, setTab] = useState("menu");
  const [pw, setPw] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(Engine.reconnecting ? t("waiting_host") : null);
  const [resuming, setResuming] = useState(Engine.resuming);
  const [update, setUpdate] = useState(Engine.updateAvailable);
  const [updating, setUpdating] = useState(Engine.updating);
  const [updateErr, setUpdateErr] = useState(null);
  const [isHost, setIsHost] = useState(inRoom && Engine.isHost);
  const [roomCode, setRoomCode] = useState(inRoom ? Engine.code : "");
  const [roomName, setRoomName] = useState(inRoom ? Engine.roomName : "");
  const [participants, setParticipants] = useState(inRoom ? Engine.participants.slice() : []);
  const [chat, setChat] = useState(inRoom ? Engine.chatLog.slice() : []);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState(inRoom ? Engine.suggestions.slice() : []);
  const [suggestInput, setSuggestInput] = useState("");
  const [suggestMsg, setSuggestMsg] = useState(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [track, setTrack] = useState(trackMeta);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(function () {
    addPlayerHooks();
    Engine.listeners = {};
    getSpotifyProfile();

    function goLobby() {
      Engine.leave();
      setView("lobby");
      setTab("menu");
      setChat([]);
      setParticipants([]);
      setSuggestions([]);
      setSuggestInput("");
      setRoomCode("");
      setNotice(null);
      setError(null);
      setIsHost(false);
    }

    Engine.on("participants", function () {
      setParticipants(Engine.participants.slice());
      setIsHost(Engine.isHost);
    });
    Engine.on("role", function () { setIsHost(Engine.isHost); });
    Engine.on("joined", function () {
      setRoomCode(Engine.code);
      setRoomName(Engine.roomName);
      setIsHost(Engine.isHost);
      setParticipants(Engine.participants.slice());
      setChat(Engine.chatLog.slice());
      setSuggestions(Engine.suggestions.slice());
      setError(null);
      setNotice(null);
      setView("room");
    });
    Engine.on("suggestions", function () {
      setSuggestions(Engine.suggestions.slice());
    });
    Engine.on("chat", function () {
      setChat(Engine.chatLog.slice());
    });
    Engine.on("error", function (msg) {
      setError(msg);
      setNotice(msg);
    });
    Engine.on("update", function () {
      setUpdate(Engine.updateAvailable);
      setUpdating(Engine.updating);
    });
    Engine.on("resume", function () {
      setResuming(Engine.resuming);
    });
    Engine.on("reconnecting", function () {
      setNotice(t("waiting_host"));
    });
    Engine.on("disconnected", function () {
      setNotice(t("host_gone"));
      setTimeout(goLobby, 2500);
    });
    Engine.on("kicked", function () {
      setNotice(t("kicked"));
      setTimeout(goLobby, 2500);
    });
    Engine.on("track", function () {
      setTrack(trackMeta());
      setPlaying(Spicetify.Player.isPlaying());
      setProgress(Spicetify.Player.getProgress());
    });

    const iv = setInterval(function () {
      const m = trackMeta();
      setTrack(function (prev) {
        if (!m && !prev) return prev;
        if (!m || !prev) return m;
        if (m.uri !== prev.uri || m.name !== prev.name) return m;
        return prev;
      });
      try {
        setProgress(Spicetify.Player.getProgress());
        setPlaying(Spicetify.Player.isPlaying());
      } catch (e) {}
    }, 500);

    return function () { clearInterval(iv); };
  }, []);

  useEffect(function () {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  function resetToLobby() {
    Engine.leave();
    setView("lobby");
    setTab("menu");
    setChat([]);
    setParticipants([]);
    setSuggestions([]);
    setSuggestInput("");
    setRoomCode("");
    setNotice(null);
    setError(null);
    setIsHost(false);
  }


  function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    getSpotifyProfile().then(function (prof) {
      const n = prof.name || t("default_host");
      return Engine.createRoom({
        roomName: t("room_of", { name: n }),
        displayName: n,
        avatar: prof.avatar,
        user: prof.user,
        password: pw.trim() || null
      });
    }).then(function (code) {
      setRoomCode(code);
      setRoomName(Engine.roomName);
      setIsHost(true);
      setParticipants(Engine.participants.slice());
      setSuggestions(Engine.suggestions.slice());
      setChat(Engine.chatLog.slice());
      setView("room");
    }).catch(function (err) {
      setError(err && err.message ? err.message : t("create_failed"));
    }).finally(function () { setLoading(false); });
  }

  function handleJoin(e) {
    e.preventDefault();
    if (!codeInput.trim()) {
      setError(t("enter_code"));
      return;
    }
    setError(null);
    setLoading(true);
    getSpotifyProfile().then(function (prof) {
      return Engine.joinRoom({
        code: codeInput,
        displayName: prof.name || t("default_guest"),
        avatar: prof.avatar,
        user: prof.user,
        password: pw.trim() || null
      });
    }).then(function () {
      setParticipants(Engine.participants.slice());
      setSuggestions(Engine.suggestions.slice());
      setChat(Engine.chatLog.slice());
      setView("room");
    }).catch(function (err) {
      setError(err && err.message ? err.message : t("join_failed"));
    }).finally(function () { setLoading(false); });
  }

  function copyInvite() {
    const text = t("invite", { code: roomCode });
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(function () { setCopied(false); }, 2000);
  }

  function togglePlay() {
    if (!isHost) {
      try { Engine.guestControl(!Spicetify.Player.isPlaying()); } catch (e) {}
      setTimeout(function () { setPlaying(Spicetify.Player.isPlaying()); }, 150);
      return;
    }
    try {
      if (Spicetify.Player.isPlaying()) Spicetify.Player.pause();
      else Spicetify.Player.play();
      setTimeout(function () { Engine.broadcastState(); }, 250);
    } catch (e) {}
  }

  function doSeek(v) {
    if (!isHost) return;
    try {
      Spicetify.Player.seek(v);
      setTimeout(function () { Engine.broadcastState(); }, 250);
    } catch (e) {}
  }

  function flashSuggestMsg(msg, isError) {
    setSuggestMsg({ text: msg, error: !!isError });
    setTimeout(function () { setSuggestMsg(null); }, 3500);
  }

  function addSuggestions(uris) {
    if (!uris.length) {
      flashSuggestMsg(t("paste_link"), true);
      return;
    }
    setSuggestBusy(true);
    suggestUris(uris).then(function (err) {
      if (err) flashSuggestMsg(err, true);
      else setSuggestInput("");
    }).finally(function () { setSuggestBusy(false); });
  }

  function submitSuggestion(e) {
    e.preventDefault();
    const uris = suggestInput.split(/\s+/).filter(function (tok) { return !!parseSpotifyRef(tok); });
    addSuggestions(uris);
  }

  function dropSuggestion(e) {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;
    const text = [dt.getData("text/uri-list"), dt.getData("text/plain")].join("\n");
    const seen = {};
    const uris = text.split(/\s+/).map(parseSpotifyRef).filter(function (r) {
      if (!r || seen[r.uri]) return false;
      seen[r.uri] = true;
      return true;
    }).map(function (r) { return r.uri; });
    addSuggestions(uris);
  }

  function sendChat(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    Engine.sendChat(chatInput);
    setChatInput("");
  }

  const updateBanner = update && react.createElement("div", { className: "lt-update" },
    react.createElement("span", { className: "lt-update-text" },
      updating
        ? t("downloading", { v: update.version })
        : t("update_available") + (update.notes && lang() === "es" ? ": " + update.notes : "")),
    !updating && react.createElement("button", {
      className: "lt-update-btn",
      onClick: function () {
        setUpdateErr(null);
        Engine.installUpdate().then(function (err) { if (err) setUpdateErr(err); });
      }
    }, t("update_btn")),
    updateErr && react.createElement("span", { className: "lt-update-err" }, updateErr));

  if (view === "lobby") {
    return react.createElement("div", { className: "lt-app" },
      updateBanner,
      react.createElement("div", { className: "lt-hero" },
        react.createElement("div", { className: "lt-logo" }, icon("headphones", 38)),
        react.createElement("h1", null, "Listen Together"),
        react.createElement("p", { className: "lt-sub" },
          t("lobby_sub")),
        resuming
          ? react.createElement("div", { className: "lt-card lt-resume" },
              react.createElement("div", { className: "lt-spinner" }),
              react.createElement("h2", null, t("returning")),
              react.createElement("p", { className: "lt-sub" },
                resuming.asHost
                  ? t("reopening", { code: resuming.code })
                  : t("connecting_to", { code: resuming.code })),
              react.createElement("button", {
                type: "button",
                className: "lt-btn lt-btn-ghost",
                onClick: function () { Engine.cancelResume(); }
              }, t("cancel")))
          : tab === "create" || tab === "join"
          ? react.createElement("form", {
              className: "lt-card lt-form",
              onSubmit: tab === "create" ? handleCreate : handleJoin
            },
              react.createElement("button", {
                type: "button",
                className: "lt-back",
                onClick: function () { setTab("menu"); setError(null); }
              }, icon("arrowLeft", 15), react.createElement("span", null, t("back"))),
              react.createElement("h2", null, tab === "create" ? t("create_room") : t("join_room")),
              tab === "join" && react.createElement("div", { className: "lt-field" },
                react.createElement("label", null, t("room_id")),
                react.createElement("input", {
                  type: "text",
                  value: codeInput,
                  onChange: function (e) { setCodeInput(e.target.value.toUpperCase()); },
                  placeholder: t("room_id_ph"),
                  autoFocus: true
                })),
              react.createElement("div", { className: "lt-field" },
                react.createElement("label", null,
                  t("password"),
                  tab === "create" ? t("optional") : ""),
                react.createElement("input", {
                  type: "password",
                  value: pw,
                  onChange: function (e) { setPw(e.target.value); },
                  placeholder: tab === "create" ? t("pw_ph_create") : t("pw_ph_join")
                })),
              error && react.createElement("div", { className: "lt-error" }, error),
              react.createElement("button", {
                type: "submit",
                className: "lt-btn lt-btn-primary",
                disabled: loading
              }, loading ? t("connecting") : tab === "create" ? t("create_room") : t("join"))
            )
          : react.createElement("div", { className: "lt-actions" },
              react.createElement("button", {
                className: "lt-btn lt-btn-primary lt-btn-big",
                onClick: function () { setTab("create"); setError(null); }
              }, icon("plus", 20), react.createElement("span", null, t("create_room"))),
              react.createElement("button", {
                className: "lt-btn lt-btn-ghost lt-btn-big",
                onClick: function () { setTab("join"); setError(null); }
              }, react.createElement("span", null, t("join_with_id")), icon("arrowRight", 20))
            ),
        error && tab === "menu" && react.createElement("div", { className: "lt-error" }, error)
      )
    );
  }

  const displayTrack = track || Engine.lastRemoteMeta;
  const dur = displayTrack ? displayTrack.duration : 0;
  const pct = dur > 0 ? Math.min(100, (progress / dur) * 100) : 0;

  const participantList = participants.length
    ? participants.map(function (p) {
        const isRoomHost = p.isHost || p.id === Engine.hostId;
        const isSelf = Engine.peer && p.id === Engine.peer.id;
        const user = safeUser(p.user);
        const outdated = !isSelf && !isRoomHost && (p.ver || 0) < APP_VERSION;
        return react.createElement("div", { key: p.id, className: "lt-p" },
          react.createElement("div", {
            className: "lt-p-link" + (user ? " is-clickable" : ""),
            title: user ? t("view_profile", { name: p.name }) : undefined,
            onClick: user ? function () { openProfile(user); } : undefined
          },
          react.createElement(Avatar, { name: p.name, src: p.avatar, host: isRoomHost }),
          react.createElement("div", { className: "lt-p-info" },
            react.createElement("span", { className: "lt-p-name" }, p.name),
            react.createElement("span", {
              className: "lt-p-status" + (isRoomHost ? " is-host" : outdated ? " is-old" : ""),
              title: outdated ? t("outdated_hint") : undefined
            }, isRoomHost ? t("host") : outdated ? t("outdated") : t("in_room")))),
          isHost && !isRoomHost && !isSelf &&
            react.createElement("div", { className: "lt-p-actions" },
              react.createElement("button", {
                className: "lt-icon-btn",
                title: t("kick"),
                onClick: function () { Engine.kick(p.id); }
              }, icon("ban", 14)),
              react.createElement("button", {
                className: "lt-icon-btn",
                title: t("make_host"),
                onClick: function () {
                  if (window.confirm(t("confirm_transfer", { name: p.name }))) {
                    Engine.transferHost(p.id);
                  }
                }
              }, icon("crown", 14)))
        );
      })
    : react.createElement("div", { className: "lt-empty" }, t("nobody_else"));

  const stage = react.createElement("div", { className: "lt-stage" },
    displayTrack
      ? react.createElement("div", { className: "lt-track" },
          displayTrack.art
            ? react.createElement("img", { className: "lt-art", src: displayTrack.art, alt: "" })
            : react.createElement("div", { className: "lt-art lt-art-ph" }, icon("music", 54)),
          react.createElement("div", { className: "lt-meta" },
            react.createElement("div", { className: "lt-track-name" }, displayTrack.name),
            react.createElement("div", { className: "lt-track-art" }, displayTrack.artists),
            displayTrack.album && react.createElement("div", { className: "lt-track-alb" }, displayTrack.album)))
      : react.createElement("div", { className: "lt-track lt-track-empty" },
          react.createElement("div", { className: "lt-art lt-art-ph" }, icon("music", 54)),
          react.createElement("div", { className: "lt-meta" },
            react.createElement("div", { className: "lt-track-name" }, t("nothing_playing")),
            react.createElement("div", { className: "lt-track-art" },
              isHost ? t("play_something") : t("waiting_for_host")))),
    react.createElement("div", { className: "lt-player" },
      react.createElement("div", { className: "lt-bar" },
        react.createElement("div", { className: "lt-bar-fill", style: { width: pct + "%" } }),
        react.createElement("input", {
          type: "range",
          min: 0,
          max: dur || 0,
          value: Math.min(progress, dur || 0),
          disabled: !isHost,
          onChange: function (e) { doSeek(Number(e.target.value)); },
          className: "lt-range"
        })),
      react.createElement("div", { className: "lt-time" },
        react.createElement("span", null, fmt(progress)),
        react.createElement("span", null, fmt(dur))),
      react.createElement("div", { className: "lt-controls" },
        react.createElement("button", {
          className: "lt-play",
          onClick: togglePlay,
          title: playing ? t("pause_all") : t("resume_all")
        }, iconFill(playing ? "pause" : "play", 24)),
        react.createElement("div", { className: "lt-host-hint" },
          isHost ? t("you_control") : t("guest_hint"))))
  );

  const myId = Engine.peer && Engine.peer.id;
  const suggestList = suggestions.length
    ? suggestions.map(function (it) {
        const canRemove = isHost || it.byId === myId;
        return react.createElement("div", { key: it.id, className: "lt-sg" },
          it.art
            ? react.createElement("img", {
                className: "lt-sg-art",
                src: safeAvatar(it.art),
                alt: "",
                referrerPolicy: "no-referrer"
              })
            : react.createElement("div", { className: "lt-sg-art lt-sg-ph" }, icon("music", 18)),
          react.createElement("div", { className: "lt-sg-info" },
            react.createElement("span", { className: "lt-sg-name", title: it.name }, it.name),
            react.createElement("span", { className: "lt-sg-sub" },
              t("type_" + it.type) + (it.sub ? " · " + it.sub : "")),
            react.createElement("span", { className: "lt-sg-by" }, t("suggested_by", { name: it.by }))),
          react.createElement("div", { className: "lt-sg-actions" },
            isHost && react.createElement("button", {
              className: "lt-sg-play",
              title: t("play_now"),
              onClick: function () { Engine.playSuggestion(it.id); }
            }, iconFill("play", 16)),
            isHost && react.createElement("button", {
              className: "lt-icon-btn lt-sg-queue",
              title: it.type === "track" ? t("add_queue") : t("add_queue_all"),
              onClick: function () {
                Engine.queueSuggestion(it.id).then(function (err) {
                  if (err) Spicetify.showNotification(err, true);
                  else Spicetify.showNotification(t("added_queue"));
                });
              }
            }, icon("queue", 15)),
            canRemove && react.createElement("button", {
              className: "lt-icon-btn",
              title: t("remove"),
              onClick: function () { Engine.removeSuggestion(it.id); }
            }, icon("x", 14))));
      })
    : react.createElement("div", { className: "lt-empty" }, t("suggest_empty"));

  // El anfitrión solo ve la lista (para ponerlas); sugerir es cosa de los invitados
  const suggestPanel = isHost
    ? suggestions.length > 0 && react.createElement("div", { className: "lt-panel lt-suggest" },
        react.createElement("div", { className: "lt-panel-h" },
          icon("list", 15),
          react.createElement("h3", null, t("suggestions")),
          react.createElement("span", { className: "lt-count" }, suggestions.length),
          react.createElement("button", {
            className: "lt-sg-clear",
            title: t("clear_all_title"),
            onClick: function () {
              const n = suggestions.length;
              if (window.confirm(n === 1 ? t("clear_one") : t("clear_many", { n: n }))) {
                Engine.clearSuggestions();
              }
            }
          }, t("clear"))),
        react.createElement("div", { className: "lt-sg-list" }, suggestList))
    : react.createElement("div", {
    className: "lt-panel lt-suggest" + (dragOver ? " is-drop" : ""),
    onDragOver: function (e) { e.preventDefault(); if (!dragOver) setDragOver(true); },
    onDragLeave: function (e) {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
    },
    onDrop: dropSuggestion
  },
    react.createElement("div", { className: "lt-panel-h" },
      icon("list", 15),
      react.createElement("h3", null, t("suggestions")),
      react.createElement("span", { className: "lt-count" }, suggestions.length)),
    react.createElement("form", { className: "lt-chat-in lt-sg-form", onSubmit: submitSuggestion },
      react.createElement("input", {
        type: "text",
        value: suggestInput,
        placeholder: t("suggest_ph"),
        onChange: function (e) { setSuggestInput(e.target.value); }
      }),
      react.createElement("button", {
        type: "submit",
        className: "lt-send",
        title: t("suggest_btn"),
        disabled: suggestBusy
      }, icon("plus", 16))),
    suggestMsg
      ? react.createElement("div", { className: "lt-sg-msg" + (suggestMsg.error ? " is-error" : "") }, suggestMsg.text)
      : react.createElement("div", { className: "lt-sg-hint" },
          t("suggest_hint")),
    react.createElement("div", { className: "lt-sg-list" }, suggestList)
  );

  const side = react.createElement("div", { className: "lt-side" },
    react.createElement("div", { className: "lt-panel" },
      react.createElement("div", { className: "lt-panel-h" },
        icon("users", 15),
        react.createElement("h3", null, t("in_room")),
        react.createElement("span", { className: "lt-count" }, participants.length)),
      react.createElement("div", { className: "lt-ps" }, participantList)),
    react.createElement("div", { className: "lt-panel lt-chat" + (chatOpen ? "" : " collapsed") },
      react.createElement("div", {
        className: "lt-panel-h lt-chat-toggle",
        onClick: function () { setChatOpen(!chatOpen); }
      },
        icon("message", 15),
        react.createElement("h3", null, t("chat"))),
      chatOpen && react.createElement("div", { className: "lt-chat-log" },
        chat.length === 0 && react.createElement("div", { className: "lt-empty" }, t("no_messages")),
        chat.map(function (m, i) {
          if (m.sys) return react.createElement("div", { key: i, className: "lt-msg-sys" }, String(m.text || ""));
          return react.createElement("div", { key: i, className: "lt-msg" },
            react.createElement("b", null, m.from),
            react.createElement("span", null, m.text));
        }),
        react.createElement("div", { ref: chatEndRef })),
      chatOpen && react.createElement("form", { className: "lt-chat-in", onSubmit: sendChat },
        react.createElement("input", {
          type: "text",
          value: chatInput,
          placeholder: t("message_ph"),
          onChange: function (e) { setChatInput(e.target.value); }
        }),
        react.createElement("button", { type: "submit", className: "lt-send", title: t("send") }, icon("send", 16)))
    )
  );

  return react.createElement("div", { className: "lt-app lt-room" },
    react.createElement("div", { className: "lt-topbar" },
      react.createElement("div", { className: "lt-room-title" },
        react.createElement("h2", null, roomName || t("room")),
        react.createElement("span", { className: "lt-live" },
          react.createElement("i", { className: "lt-dot" }),
          t("live"))),
      react.createElement("div", { className: "lt-top-actions" },
        react.createElement("button", { className: "lt-code-chip", onClick: copyInvite, title: t("copy_invite") },
          react.createElement("span", null, roomCode),
          copied ? icon("check", 15) : icon("copy", 15),
          react.createElement("b", null, copied ? t("copied") : t("copy"))),
        react.createElement("button", { className: "lt-icon-btn lt-leave", onClick: resetToLobby, title: t("leave") }, icon("x", 16)))),
    updateBanner,
    notice && react.createElement("div", { className: "lt-notice" }, notice),
    react.createElement("div", { className: "lt-room-grid" },
      react.createElement("div", { className: "lt-main" }, stage, suggestPanel),
      side)
  );
}

// Si algo de la pantalla falla, se avisa y se puede reintentar en lugar de que Spotify muestre
// su error genérico. La conexión con la sala vive en engine.js y no se pierde.
const AppBoundary = react.Component && class AppBoundary extends react.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e) {
    console.error("[Listen Together] error en la pantalla:", e);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const self = this;
    return react.createElement("div", { className: "lt-app" },
      react.createElement("div", { className: "lt-hero" },
        react.createElement("h2", null, t("ui_failed")),
        react.createElement("p", { className: "lt-sub" }, t("still_connected")),
        react.createElement("button", {
          className: "lt-btn lt-btn-primary",
          onClick: function () { self.setState({ failed: false }); }
        }, t("retry"))));
  }
};

// Si se abre la app antes de que engine.js termine de cargar, espera un momento
function Loader() {
  const [ready, setReady] = useState(bindEngine);
  useEffect(function () {
    if (ready) return;
    const iv = setInterval(function () {
      if (bindEngine()) {
        clearInterval(iv);
        setReady(true);
      }
    }, 300);
    return function () { clearInterval(iv); };
  }, [ready]);
  if (ready) {
    return AppBoundary
      ? react.createElement(AppBoundary, null, react.createElement(App))
      : react.createElement(App);
  }
  return react.createElement("div", { className: "lt-app" },
    react.createElement("div", { className: "lt-hero" },
      react.createElement("p", { className: "lt-sub" }, bootText("loading"))));
}

// ¿Hay una interfaz descargada (botón "Actualizar") que corresponda al motor que está corriendo?
function overrideRender() {
  if (typeof __LT_IS_OVERRIDE !== "undefined") return null; // esta ya es la descargada
  const v = window.__LT_OVERRIDE_RUNNING;
  if (!v || !(v > UI_BUILD)) return null;
  if (!window.__LT_UI) {
    let up = null;
    try { up = JSON.parse(localStorage.getItem(UPDATE_KEY) || "null"); } catch (e) {}
    if (!up || up.version !== v || typeof up.ui !== "string") return null;
    try {
      if (typeof up.css === "string" && !document.getElementById("lt-update-css")) {
        const st = document.createElement("style");
        st.id = "lt-update-css";
        st.textContent = up.css;
        document.head.appendChild(st);
      }
      const s = document.createElement("script");
      s.textContent = "(function () {\nconst __LT_IS_OVERRIDE = true;\n" + up.ui +
        "\nwindow.__LT_UI = { render: render };\n})();\n//# sourceURL=listen-together-ui-v" + v + ".js";
      document.head.appendChild(s);
    } catch (e) {
      return null;
    }
  }
  return window.__LT_UI ? window.__LT_UI.render : null;
}

function revertToInstalled() {
  try {
    localStorage.removeItem(UPDATE_KEY);
    localStorage.removeItem(UPDATE_BOOT_KEY);
  } catch (e) {}
  window.location.reload();
}

// Si la interfaz descargada falla, se ofrece volver a la instalada
const SafeOverride = react.Component && class SafeOverride extends react.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e) {
    console.error("[Listen Together] la versión actualizada falló:", e);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return react.createElement("div", { className: "lt-app" },
      react.createElement("div", { className: "lt-hero" },
        react.createElement("h2", null, bootText("override_failed")),
        react.createElement("p", { className: "lt-sub" }, bootText("override_failed_sub")),
        react.createElement("button", { className: "lt-btn lt-btn-primary", onClick: revertToInstalled },
          bootText("revert"))));
  }
};

function render() {
  const ov = overrideRender();
  if (ov) return SafeOverride ? react.createElement(SafeOverride, null, ov()) : ov();
  return react.createElement(Loader);
}
