// Genere data/questions-en-fr.json et data/questions-fr-en.json a partir des
// fichiers sources questions/levelN.txt (EN|FR_hint|extra...) et
// questions1/levelN.txt (FR|EN). Ces JSON sont PRIVES : inclus dans les
// fonctions serveur, jamais dans le dossier public de Netlify.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function parseEnFr(content) {
  return content.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split('|');
    return {
      en: parts[0].trim(),
      hint: parts[1].trim(),
      answers: parts.slice(2).map(a => a.trim()).filter(Boolean),
    };
  });
}

function parseFrEn(content) {
  return content.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const sep = line.indexOf('|');
    const fr = line.slice(0, sep).trim();
    const en = line.slice(sep + 1).trim();
    return { en: fr, hint: en, answers: [en] };
  });
}

/* Niveaux (contenu des sources d'origine levelN.txt) :
   1 = mots seuls (words-*.txt) ; 2 = phrases simples courtes (ancien 1 + ancien 2 de moins de 6 mots) ;
   3 = phrases simples longues (ancien 2 de 6 mots et plus) ; 4 = phrases complexes (ancien 3 et 4) ; 5 = les plus complexes (ancien 5).
   Les identifiants d'origine sont gardés : l'historique « déjà vu » des joueurs reste valable. */
const simple = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = s => (s.match(/[\p{L}']+/gu) || []).length;
function newLevel(old, en) {
  if (old === 1) return words(en) <= 2 ? 1 : 2;
  if (old === 2) return words(en) < 6 ? 2 : 3;
  if (old === 3 || old === 4) return 4;
  return 5;
}
function build(srcDir, parser, wordsFile, outFile) {
  const all = [];
  for (let level = 1; level <= 5; level++) {
    const content = fs.readFileSync(path.join(ROOT, srcDir, `level${level}.txt`), 'utf8');
    parser(content).forEach((q, i) => all.push({ id: `l${level}-${i}`, level: newLevel(level, q.en), ...q }));
  }
  const wordsPath = path.join(ROOT, 'questions', wordsFile);
  if (fs.existsSync(wordsPath)) parseEnFr(fs.readFileSync(wordsPath, 'utf8')).forEach((q, i) => all.push({ id: `w-${i}`, level: 1, ...q, answers: q.answers.length ? q.answers : [q.hint] }));
  // Niveau 1 : un mot identique dans les deux langues (table, train, six…) n'apprend rien et ferait valider la recopie.
  const same = q => [...q.answers, q.hint].some(a => simple(a) === simple(q.en));
  for (let i = all.length - 1; i >= 0; i--) if (all[i].level === 1 && same(all[i])) all.splice(i, 1);
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', outFile), JSON.stringify(all));
  const per = [1, 2, 3, 4, 5].map(l => all.filter(q => q.level === l).length).join(' / ');
  console.log(outFile, '->', all.length, 'phrases (niveaux 1 à 5 :', per + ')');
}

build('questions', parseEnFr, 'words-en-fr.txt', 'questions-en-fr.json');
build('questions1', parseFrEn, 'words-fr-en.txt', 'questions-fr-en.json');
