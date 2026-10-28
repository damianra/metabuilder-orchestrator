import { MongoClient } from 'mongodb';
import { seedData } from './seed-data.js';

let client, db;

/**
 * Singleton MongoDB: conecta `MONGO_URI` (env), abre `MONGO_DB`
 * (default 'app') y corre el seed de las colecciones vacías.
 * Schemaless — si el dominio necesita validación, agregar
 * $jsonSchema por colección al crearlas (createCollection) en vez
 * de un schema.sql.
 *
 * Helpers: `col(name)` → Collection (find/insertOne/updateOne/
 * deleteOne del driver nativo); `seedIfEmpty(collection, docs)` →
 * inserta solo si la colección está vacía (idempotente).
 */
export async function openDb() {
  if (db) return db;
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGO_DB || 'app');
  for (const [name, docs] of Object.entries(seedData)) {
    await seedIfEmpty(db.collection(name), docs);
  }
  return db;
}

export async function col(name) {
  const d = await openDb();
  return d.collection(name);
}

// Inserta docs solo si la colección está vacía — devuelve si sembró.
export async function seedIfEmpty(collection, docs = []) {
  if (!docs.length) return false;
  if ((await collection.countDocuments()) > 0) return false;
  await collection.insertMany(docs);
  return true;
}

export function closeDb() {
  const c = client;
  client = null;
  db = null;
  return c?.close();
}
