#!/bin/sh
# Instalador de Spotify Together Rework (la app "Listen Together" de Spicetify) para macOS y Linux.
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Corsixs/spicetify-listen-together/main/install.sh | sh
#
# Descarga la carpeta listen-together de este repositorio, la copia en CustomApps de Spicetify,
# la activa y ejecuta "spicetify apply", que reinicia Spotify. Sirve tambien para actualizar.
set -e

REPO="Corsixs/spicetify-listen-together"
APP="listen-together"

echo "Spotify Together Rework - instalador"

if [ "$(id -u)" = "0" ]; then
  echo "Spicetify no funciona como root. Vuelve a ejecutar el comando sin sudo." >&2
  exit 1
fi

if command -v spicetify >/dev/null 2>&1; then
  SPICETIFY="spicetify"
elif [ -x "$HOME/.spicetify/spicetify" ]; then
  SPICETIFY="$HOME/.spicetify/spicetify"
else
  echo "No se encontro Spicetify. Instalalo primero: https://spicetify.app/docs/getting-started" >&2
  exit 1
fi

# Carpeta de datos de Spicetify, la que contiene CustomApps
USERDATA=$("$SPICETIFY" path userdata 2>/dev/null | tail -n 1 | tr -d '\r') || USERDATA=""
if [ -z "$USERDATA" ] || [ ! -d "$USERDATA" ]; then
  USERDATA="${XDG_CONFIG_HOME:-$HOME/.config}/spicetify"
fi
TARGET="$USERDATA/CustomApps/$APP"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Descargando la ultima version..."
# El archivo es una foto completa del repositorio: nunca mezcla archivos de dos versiones
curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" -o "$TMP/repo.tar.gz"
tar -xzf "$TMP/repo.tar.gz" -C "$TMP"
SOURCE=$(find "$TMP" -mindepth 2 -maxdepth 2 -type d -name "$APP" | head -n 1)
if [ -z "$SOURCE" ]; then
  echo "La descarga no contiene la carpeta $APP" >&2
  exit 1
fi

# Se reemplazan los archivos de la app; cualquier otro archivo de la carpeta se queda
mkdir -p "$TARGET"
cp -R "$SOURCE/." "$TARGET/"
echo "Copiado en $TARGET"

# Si ya estaba activada, Spicetify solo avisa y no cambia nada
"$SPICETIFY" config custom_apps "$APP"
echo "Aplicando con Spicetify. Spotify se va a reiniciar; si estabas en una sala, vuelves a entrar sola."
if ! "$SPICETIFY" apply; then
  echo "spicetify apply fallo. Lee el mensaje de arriba; si Spotify se actualizo hace poco, suele arreglarse con: spicetify restore backup apply" >&2
  exit 1
fi
echo "Listo. En Spotify, el boton pequeno con una nota musical junto a las flechas abre Listen Together."
