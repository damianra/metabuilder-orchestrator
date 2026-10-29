// Helpers compartidos por los `detect(dir)` de los stack defs —
// módulo hoja (solo node:*) para que tools/docker.js pueda importar
// los defs sin ciclo. `marker` acepta path exacto o RegExp sobre el
// readdir del dir (next.config.* no tiene nombre fijo).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const hasMarker = (dir, marker) =>
  marker instanceof RegExp
    ? existsSync(dir) && readdirSync(dir).some((f) => marker.test(f))
    : existsSync(join(dir, marker));

// deps + devDeps del package.json del dir ({} si no existe/es ilegible).
export const pkgDeps = (dir) => {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
};

// Valor de KEY=... en el .env del dir (null si falta).
export const envValue = (dir, key) => {
  try {
    return readFileSync(join(dir, '.env'), 'utf8').match(new RegExp(`^${key}=(\\w+)`, 'm'))?.[1] ?? null;
  } catch {
    return null;
  }
};

// Notas del AGENTS.md por backend stack ({{backendNotes}}) — express
// comparte el texto salvo la línea de capa de datos.
const EXPRESS_COMMON = `- **Backend**: cada \`server/routes/<name>.js\` que exporte un \`Router\` default se monta solo en \`/api/<name>\` — no tocar \`server/app.js\` ni \`server/db.js\`.
- **Imágenes**: \`POST /api/uploads\` con campo \`file\` (image/*, máx 5MB) → \`{ url: "/uploads/<file>" }\`. Guardar ese path en la entidad; el frontend lo consume tal cual (el proxy de Vite redirige \`/uploads\` al puerto 4000).
- **Secretos/config**: API keys y config sensible van en \`.env\` (gitignored), leídas via \`process.env.NOMBRE\` — \`server/index.js\` ya carga \`dotenv/config\`. Toda variable que la app use debe declararse en \`.env.example\` (commiteado, con valor placeholder o vacío) para que otro dev sepa qué configurar. Nunca hardcodear secretos ni commitear \`.env\`.
- **Docker**: \`Dockerfile\`, \`.dockerignore\` (y \`nginx.conf\` si aplica) los provee el orquestador — no modificarlos ni crear otros. El backend ya sirve \`dist/\` si existe, así que el contenedor fullstack corre solo \`node server/index.js\`.`;

export const AGENTS_NOTES_EXPRESS_SQL = `${EXPRESS_COMMON}
- **Capa de datos**: schema en \`server/schema.sql\` (idempotente), seed en \`server/seed-data.js\` (se inserta si la tabla está vacía); queries con \`q()\` prepared statements de \`server/db.js\` (despacha por \`DB_DRIVER\`).`;

export const AGENTS_NOTES_EXPRESS_MONGO = `${EXPRESS_COMMON}
- **Capa de datos**: document store — colecciones via \`col(name)\` de \`server/db.js\` (sin schema DDL ni prepared statements; ids \`ObjectId\`, seed si la colección está vacía).`;
