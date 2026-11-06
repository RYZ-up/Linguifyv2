import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const banks = new Map();
export function getBank(direction) {
  if (!banks.has(direction)) {
    const name = direction === 'fr-en' ? 'questions-fr-en.json' : 'questions-en-fr.json';
    const data = JSON.parse(readFileSync(resolve('data', name), 'utf8'));
    const bank = new Map();
    for (const q of data) {
      if (!q.id || bank.has(q.id) || !q.en || !q.hint || !Array.isArray(q.answers) || !Number.isInteger(q.level)) throw new Error('Invalid private question bank');
      bank.set(q.id, q);
    }
    banks.set(direction, bank);
  }
  return banks.get(direction);
}
