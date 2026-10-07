# Spotify Together Rework

App para [Spicetify](https://spicetify.app) que permite escuchar la misma música con amigos en tiempo real desde Spotify de escritorio. La conexión es directa entre computadoras (P2P, con [PeerJS](https://peerjs.com)), sin servidores propios.

> **Basada en [Listen Together](https://github.com/josehtz/spicetify-listen-together), de [josehtz](https://github.com/josehtz)** (licencia MIT). Este proyecto parte de su app y la amplía: los cambios están en [Cambios respecto al original](#cambios-respecto-al-original). Dentro de Spotify la app se sigue llamando **Listen Together**.

![Una sala: la canción actual, las sugerencias, quién está en la sala y el chat](assets/preview.png)

Incluye además un arreglo para la extensión **Cat-Jam Synced**, para que el gato vuelva a bailar al ritmo de la canción.

## Funciones

- **Salas con código** y contraseña opcional.
- **Sincronización** de canción, posición y pausa, con compensación de latencia.
- **Cualquiera puede pausar o reanudar**, y el chat avisa quién lo hizo. Cambiar o adelantar canciones es solo del anfitrión.
- **Chat** dentro de la sala.
- **Sugerencias:** los invitados proponen canciones, álbumes o playlists (con clic derecho → *Sugerir en Listen Together*, pegando un enlace o arrastrando). El anfitrión decide si las reproduce ahora o las añade a la cola, y puede limpiar la lista.
- **Perfiles:** foto y nombre de Spotify de cada persona; al hacer clic se abre su perfil.
- **Actualización con un clic** desde Spotify cuando hay una versión nueva en este repositorio.
- **Reanudación automática:** si se cierra Spotify estando en una sala, al volver a abrirlo se retoma la misma sala. Los invitados esperan hasta 3 minutos a que el anfitrión vuelva.
- El anfitrión puede expulsar a alguien o pasarle el control de la sala.

## Cambios respecto al original

La app de josehtz ya tenía las salas P2P con código, la sincronización de canción, posición y pausa, el chat, la contraseña opcional y los botones para expulsar y pasar el control. Esta versión añade:

- **La sala no se pierde al cambiar de pestaña.** La conexión vive en `engine.js`, que se carga al arrancar Spotify, e `index.js` solo dibuja la interfaz.
- **Perfiles de Spotify** en lugar de escribir un nombre: foto y nombre de cada persona, y su perfil al hacer clic.
- **Sincronización más precisa:** compensa la latencia, tolera hasta 1 s de desfase, detecta cuando el anfitrión adelanta la canción y no repite reproducciones.
- **Pausa compartida**, con aviso en el chat.
- **Sugerencias** de canciones, álbumes y playlists, con botones para reproducirlas, añadirlas a la cola o limpiar la lista.
- **Reanudación automática** al reabrir Spotify, sin participantes duplicados.
- **Actualización con un clic**, y aviso de *"Versión antigua de la app"* para quien no actualizó.
- Más comprobaciones de los mensajes que llegan por la red.

## Requisitos

- Spotify de escritorio con [Spicetify](https://spicetify.app/docs/getting-started) instalado.
- Todas las personas de la sala necesitan esta misma versión.

## Instalación

Las apps de Spicetify no se instalan desde el Marketplace (su botón abre este repositorio), así que se copian a mano.

### Spotify Together Rework

1. Pulsa `Win + R`, escribe `%APPDATA%\spicetify\CustomApps` y pulsa Enter.

   En macOS y Linux, `spicetify path userdata` muestra la carpeta de Spicetify; las apps van en su subcarpeta `CustomApps`.
2. Copia ahí la carpeta [`listen-together`](listen-together) de este repositorio. Si ya existía (una versión anterior o el Listen Together original), reemplázala entera.

   Debe quedar así: `CustomApps\listen-together\engine.js`, `index.js`, `manifest.json`, `peerjs.bundle.js` y `style.css`.
3. Abre una terminal y ejecuta:

   ```bash
   spicetify config custom_apps listen-together
   ```

   Este primer comando solo hace falta la primera vez.

   ```bash
   spicetify apply
   ```

4. En Spotify aparece **Listen Together**, con el icono de una nota musical.

### Arreglo del gato (opcional)

Spotify eliminó los datos de tempo que usaba **Cat-Jam Synced**, así que el gato bailaba siempre a la misma velocidad. Este arreglo obtiene el BPM de la API pública de Deezer.

1. Instala **Cat-Jam Synced** desde el Marketplace de Spicetify.
2. Copia [`extensions/audiodata-fix.js`](extensions/audiodata-fix.js) en `%APPDATA%\spicetify\Extensions` (en macOS y Linux, en la subcarpeta `Extensions` de `spicetify path userdata`).
3. Ejecuta:

   ```bash
   spicetify config extensions audiodata-fix.js
   ```

   ```bash
   spicetify apply
   ```

## Actualizar

**Desde Spotify (versión 7 o posterior):** cuando hay una versión nueva en este repositorio, Listen Together muestra el aviso *"Hay una versión nueva de Listen Together"*. Al pulsar **Actualizar**, descarga la versión nueva de este repositorio y recarga Spotify. Si estabas en una sala, vuelves a entrar automáticamente.

- Solo descarga de este repositorio, por HTTPS, y nunca sin que pulses el botón.
- Si la versión descargada falla al arrancar, se descarta sola y vuelve la que tenías instalada. Si falla la pantalla, aparece un botón *"Volver a la versión instalada"*.

**A mano:** reemplaza la carpeta `listen-together` con la nueva versión y ejecuta `spicetify apply`. También sirve si vienes de una versión anterior a la 7, que no tiene el botón.

Si alguien de la sala tiene una versión vieja, debajo de su nombre aparece *"Versión antigua de la app"*.

### Para quien mantiene el repositorio

Al publicar una versión nueva, sube el mismo número en los cuatro sitios: `var BUILD` y `const APP_VERSION` en `engine.js`, `const UI_BUILD` en `index.js`, y `version` en [`version.json`](version.json). El botón comprueba que los archivos descargados correspondan a ese número antes de instalarlos.

## Notas

- La conexión entre computadoras se establece a través del servidor público gratuito de PeerJS. Después, la sincronización y el chat viajan directamente de una computadora a otra. La música no se transmite: cada persona la escucha desde su propio Spotify.
- Algunas redes muy restrictivas (por ejemplo, ciertos datos móviles) pueden bloquear la conexión directa.
- La contraseña de la sala nunca se envía ni se guarda tal cual: solo se usa un código derivado de ella.

## Créditos

- [Listen Together](https://github.com/josehtz/spicetify-listen-together), de [josehtz](https://github.com/josehtz) (licencia MIT): la app original en la que se basa este proyecto.
- [PeerJS](https://github.com/peers/peerjs) (licencia MIT): ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [Cat-Jam Synced](https://github.com/BlafKing/spicetify-cat-jam-synced), de BlafKing. La idea de usar Deezer como fuente del BPM viene de una propuesta de la comunidad en ese repositorio.

## Licencia

[MIT](LICENSE). Incluye el aviso de copyright de josehtz, autor de Listen Together, y el de este rework. PeerJS se distribuye con su propia licencia MIT: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
