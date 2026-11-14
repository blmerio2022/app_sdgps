// Réécrit src/app/core/version/build-version.ts depuis build-info/version.json (build Docker).
// Sans fichier de version, laisse la valeur `dev` : le build ne doit jamais échouer pour ça.
const fs = require('fs');
const path = require('path');

const source = process.argv[2] || path.join(__dirname, '..', '..', 'build-info', 'version.json');
const cible = path.join(__dirname, '..', 'src', 'app', 'core', 'version', 'build-version.ts');

if (!fs.existsSync(source)) {
  console.log(`inject-version : ${source} absent, version « dev » conservée`);
  process.exit(0);
}
const info = JSON.parse(fs.readFileSync(source, 'utf8'));
const valeur = { version: String(info.version || 'dev'), commit: String(info.commit || '') };
fs.writeFileSync(cible, `// Généré par scripts/inject-version.js — ne pas modifier.\nexport const BUILD_VERSION = ${JSON.stringify(valeur)};\n`);
console.log(`inject-version : ${valeur.version} (${valeur.commit})`);
