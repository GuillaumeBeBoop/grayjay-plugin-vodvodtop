// Signe VodVodScript.js et met à jour VodVodConfig.json
// Usage : node sign.js
// Nécessite uniquement Node.js.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dir = __dirname;
const SCRIPT = path.join(dir, "VodVodScript.js");
const CONFIG = path.join(dir, "VodVodConfig.json");
// GARDEZ CE FICHIER SECRET ET SAUVEGARDEZ-LE : la même clé est nécessaire pour chaque mise à jour
const KEY = path.join(dir, "private-key.pem");

let privateKey;
if (fs.existsSync(KEY)) {
  privateKey = crypto.createPrivateKey(fs.readFileSync(KEY));
} else {
  console.log("Création de la clé privée " + KEY);
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  fs.writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }));
}

const signature = crypto.sign("sha512", fs.readFileSync(SCRIPT), privateKey).toString("base64");
const publicKey = crypto
  .createPublicKey(privateKey)
  .export({ type: "spki", format: "der" })
  .toString("base64");

const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
config.scriptSignature = signature;
config.scriptPublicKey = publicKey;
fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + "\n");

console.log("OK : VodVodConfig.json mis à jour.");
console.log("Ne modifiez plus VodVodScript.js sans re-signer (même d'un espace).");
