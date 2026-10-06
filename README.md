# Listen Together para Spicetify

App para [Spicetify](https://spicetify.app) que permite escuchar la misma música con amigos en tiempo real desde Spotify de escritorio. La conexión es directa entre computadoras (P2P, con [PeerJS](https://peerjs.com)), sin servidores propios.

Incluye además un arreglo para la extensión **Cat-Jam Synced**, para que el gato vuelva a bailar al ritmo de la canción.

## Funciones

- **Salas con código** y contraseña opcional.
- **Sincronización** de canción, posición y pausa, con compensación de latencia.
- **Cualquiera puede pausar o reanudar**, y el chat avisa quién lo hizo. Cambiar o adelantar canciones es solo del anfitrión.
- **Chat** dentro de la sala.
- **Sugerencias:** los invitados proponen canciones, álbumes o playlists (con clic derecho → *Sugerir en Listen Together*, pegando un enlace o arrastrando). El anfitrión decide si las reproduce ahora o las añade a la cola.
- **Perfiles:** foto y nombre de Spotify de cada persona; al hacer clic se abre su perfil.
- **Reanudación automática:** si se cierra Spotify estando en una sala, al volver a abrirlo se retoma la misma sala. Los invitados esperan hasta 3 minutos a que el anfitrión vuelva.
- El anfitrión puede expulsar a alguien o pasarle el control de la sala.

## Requisitos

- Spotify de escritorio con [Spicetify](https://spicetify.app/docs/getting-started) instalado.
- Todas las personas de la sala necesitan esta misma versión.

## Instalación

### Listen Together

1. Pulsa `Win + R`, escribe `%APPDATA%\spicetify\CustomApps` y pulsa Enter.
2. Copia ahí la carpeta [`listen-together`](listen-together) de este repositorio. Si ya existía una versión anterior, reemplázala entera.

   Debe quedar así: `CustomApps\listen-together\engine.js`, `index.js`, `manifest.json`, `peerjs.bundle.js` y `style.css`.
3. Abre una terminal y ejecuta:

   ```bash
   spicetify config custom_apps listen-together
   spicetify apply
   ```

   El primer comando solo hace falta la primera vez.

### Arreglo del gato (opcional)

Spotify eliminó los datos de tempo que usaba **Cat-Jam Synced**, así que el gato bailaba siempre a la misma velocidad. Este arreglo obtiene el BPM de la API pública de Deezer.

1. Instala **Cat-Jam Synced** desde el Marketplace de Spicetify.
2. Copia [`extensions/audiodata-fix.js`](extensions/audiodata-fix.js) en `%APPDATA%\spicetify\Extensions`.
3. Ejecuta:

   ```bash
   spicetify config extensions audiodata-fix.js
   spicetify apply
   ```

## Actualizar

Reemplaza la carpeta `listen-together` con la nueva versión y ejecuta `spicetify apply`. Si alguien de la sala tiene una versión vieja, debajo de su nombre aparece *"Versión antigua de la app"*.

## Notas

- La conexión entre computadoras se establece a través del servidor público gratuito de PeerJS. Después, la música y el chat viajan directamente de una computadora a otra.
- Algunas redes muy restrictivas (por ejemplo, ciertos datos móviles) pueden bloquear la conexión directa.
- La contraseña de la sala nunca se envía ni se guarda tal cual: solo se usa un código derivado de ella.

## Créditos

- [PeerJS](https://github.com/peers/peerjs) (licencia MIT): ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Cat-Jam Synced](https://github.com/BlafKing/spicetify-cat-jam-synced), de BlafKing. La idea de usar Deezer como fuente del BPM viene de una propuesta de la comunidad en ese repositorio.
