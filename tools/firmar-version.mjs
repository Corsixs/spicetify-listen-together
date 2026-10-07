// Firma una versión nueva para el botón "Actualizar" de la app: escribe version.json con los
// SHA-256 de engine.js, index.js y style.css y una firma ECDSA P-256 de todo eso.
// La app solo instala actualizaciones con una firma válida de esta clave.
//
// Uso, desde la raíz del repositorio:
//   node tools/firmar-version.mjs --generar-clave          (solo la primera vez)
//   node tools/firmar-version.mjs "Notas de la versión"
//
// La clave privada vive fuera del repositorio, en %USERPROFILE%\.spotify-together\clave-actualizaciones.pem
// (o en la ruta de la variable LT_SIGNING_KEY). Nunca se sube a GitHub: si se pierde, las
// actualizaciones por el botón dejan de ser posibles y hay que reinstalar con el instalador.
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = process.env.LT_SIGNING_KEY || join(homedir(), ".spotify-together", "clave-actualizaciones.pem");
const FILES = { engine: "listen-together/engine.js", ui: "listen-together/index.js", css: "listen-together/style.css" };

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (process.argv[2] === "--generar-clave") {
  if (existsSync(keyPath)) fail("Ya existe una clave en " + keyPath + " y no se sobrescribe.");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  const jwk = publicKey.export({ format: "jwk" });
  console.log("Clave privada guardada en " + keyPath + ". Haz una copia de seguridad y no la subas a GitHub.");
  console.log("Clave pública para UPDATE_PUBLIC_KEY en engine.js:");
  console.log(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }));
  process.exit(0);
}

const notes = (process.argv[2] || "").trim();
if (!notes) fail('Uso: node tools/firmar-version.mjs "Notas de la versión"');
if (!existsSync(keyPath)) fail("No está la clave privada en " + keyPath);

// Lo mismo que sirve GitHub y lee la app: UTF-8 sin BOM y saltos de línea LF
function read(rel) {
  return readFileSync(join(root, rel), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

const engine = read(FILES.engine);
const ui = read(FILES.ui);
const css = read(FILES.css);

function num(src, re) {
  const m = src.match(re);
  return m ? Number(m[1]) : null;
}
const version = num(engine, /const APP_VERSION = (\d+);/);
const build = num(engine, /var BUILD = (\d+);/);
const uiBuild = num(ui, /const UI_BUILD = (\d+);/);
if (!version || version !== build || version !== uiBuild) {
  fail(`Los números de versión no coinciden: APP_VERSION=${version}, BUILD=${build}, UI_BUILD=${uiBuild}`);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
const files = { engine: sha256(engine), ui: sha256(ui), css: sha256(css) };

// Debe ser idéntico a updatePayload() de engine.js
const payload = "listen-together-update\nversion:" + version + "\nnotes:" + encodeURIComponent(notes) +
  "\nengine:" + files.engine + "\nui:" + files.ui + "\ncss:" + files.css + "\n";

const key = createPrivateKey(readFileSync(keyPath));
const sig = sign("sha256", Buffer.from(payload, "utf8"), { key: key, dsaEncoding: "ieee-p1363" }).toString("base64");

writeFileSync(join(root, "version.json"), JSON.stringify({ version: version, notes: notes, files: files, sig: sig }, null, 2) + "\n");
console.log("version.json firmado para la versión " + version + ".");
