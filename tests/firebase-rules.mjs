import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { getDoc, setDoc, doc } from 'firebase/firestore';
import { get, set, ref } from 'firebase/database';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const env = await initializeTestEnvironment({
  projectId: 'demo-linguify-security',
  firestore: { host: '127.0.0.1', port: 8180, rules: readFileSync('firebase-rules/firestore.rules', 'utf8') },
  database: { host: '127.0.0.1', port: 9100, rules: readFileSync('firebase-rules/realtime-database.json', 'utf8') }
});
try {
  const alice = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } });
  const bob = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'google.com' } });
  const guest = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } });
  const anonymous = env.unauthenticatedContext();
  await env.withSecurityRulesDisabled(async admin => {
    await set(ref(admin.database(), 'users/alice'), { secureGame: { total: 50, best: { score: 50 }, history: { s1: { score: 50 } } }, v2: { progress: { chapter: { passed: true } } }, settings: { mode: 'count', direction: 'fr-en', level: 1, count: 10, duration: 60 } });
    await setDoc(doc(admin.firestore(), 'questions/a'), { answers: ['private'] });
    await setDoc(doc(admin.firestore(), 'privateGameSessions/alice'), { ids: ['private'] });
  });
  let checks = 0;
  for (const context of [alice, bob, guest, anonymous]) {
    for (const path of ['questions/a', 'questions_fr_en/a', 'privateGameSessions/alice', 'privateGameQuotas/alice', 'users/alice']) {
      await assertFails(getDoc(doc(context.firestore(), path)));
      await assertFails(setDoc(doc(context.firestore(), path), { answers: ['forged'] }));
      checks += 2;
    }
    await assertFails(get(ref(context.database(), 'users'))); checks++;
    await assertFails(set(ref(context.database(), 'users/alice/secureGame'), { total: 99999 })); checks++;
    await assertFails(set(ref(context.database(), 'users/alice/best'), { score: 99999 })); checks++;
  }
  await assertSucceeds(get(ref(alice.database(), 'users/alice/secureGame'))); checks++;
  await assertFails(get(ref(bob.database(), 'users/alice/secureGame'))); checks++;
  await assertFails(get(ref(anonymous.database(), 'users/alice/secureGame'))); checks++;
  const settings = { mode: 'count', direction: 'fr-en', level: 1, count: 10, duration: 60, liveHints: false, soundVolume: 0.5 };
  await assertSucceeds(set(ref(alice.database(), 'users/alice/settings'), settings)); checks++;
  await assertFails(set(ref(bob.database(), 'users/alice/settings'), settings)); checks++;
  await assertFails(set(ref(guest.database(), 'users/guest/settings'), settings)); checks++;
  for (const bad of [{ level: 100 }, { count: 1.5 }, { duration: 999999 }, { unexpected: true }, { liveHints: 'yes' }, { themeColor: 'url(https://evil.example)' }]) {
    await assertFails(set(ref(alice.database(), 'users/alice/settings'), { ...settings, ...bad })); checks++;
  }
