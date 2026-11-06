// Semaine du classement : du lundi 0 h au lundi suivant 0 h, heure de Paris (heure d'été comprise).
const DAY = 86400000;
function parisParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(x => [x.type, Number(x.value)]));
  return p;
}
// Décalage Paris − UTC à l'instant ms.
function offsetAt(ms) {
  const p = parisParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
export function weekInfo(now) {
  const p = parisParts(now);
  const dow = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
  const startLocal = Date.UTC(p.year, p.month - 1, p.day - dow), endLocal = startLocal + 7 * DAY;
  const start = startLocal - offsetAt(startLocal - offsetAt(now)), end = endLocal - offsetAt(endLocal - offsetAt(now));
  return { id: new Date(startLocal).toISOString().slice(0, 10), start, end, progress: Math.min(1, Math.max(0, (now - start) / (end - start))) };
}
export const previousWeekId = (now, back = 1) => weekInfo(weekInfo(now).start - 1 - (back - 1) * 7 * DAY).id;
if (typeof window !== 'undefined') window.weekInfo = weekInfo;
