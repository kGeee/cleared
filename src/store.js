// Tiny JSON file store for OAuth tokens and seed state. Lives in ./data (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

function file(name) {
  return path.join(DATA_DIR, name + '.json');
}

export function load(name, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
}

export function update(name, patch) {
  const next = { ...load(name), ...patch };
  save(name, next);
  return next;
}

export function audit(entry) {
  fs.appendFileSync(path.join(DATA_DIR, 'audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}
