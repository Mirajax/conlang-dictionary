'use strict';
var obsidian = require('obsidian');

// ─── Constants ───────────────────────────────────────────────────────────────
const VIEW_TYPE_CONLANG = 'conlang-dictionary-view';

const DEFAULT_SETTINGS = {
  enableHoverTranslation: true,
  dictionaryFolder: 'conlang-dictionaries',
  activeConlangs: [],
};

// ─── Utilities ───────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── CSV Parser (Vulgarlang + generic) ───────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

function parseVulgarlangCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_ ]/g, ''));
  const words = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (!vals.some(v => v.trim())) continue;
    const e = {
      id: genId(), spelling: '', pronunciation: '', pos: '',
      translation: '', definition: '', example: '', root: '',
      etymology: '', customFields: {}, createdAt: new Date().toISOString()
    };
    headers.forEach((h, idx) => {
      const v = (vals[idx] || '').trim();
      if (['word', 'spelling', 'form', 'conlang word', 'conlang'].includes(h)) e.spelling = v;
      else if (['ipa', 'pronunciation', 'phonetic', 'phonetics'].includes(h)) e.pronunciation = v;
      else if (['pos', 'part of speech', 'part_of_speech', 'type', 'category'].includes(h)) e.pos = v;
      else if (['definition', 'meaning', 'translation', 'gloss', 'english', 'english word'].includes(h)) e.translation = v;
      else if (['notes', 'note', 'example', 'usage', 'sentence'].includes(h)) e.example = v;
      else if (['root', 'stem', 'base', 'morpheme'].includes(h)) e.root = v;
      else if (['etymology', 'etym', 'origin', 'source'].includes(h)) e.etymology = v;
      else if (v) e.customFields[h] = v;
    });
    if (e.spelling) words.push(e);
  }
  return words;
}

function dictToCSV(dict) {
  const words = dict.words || [];
  if (!words.length) return '';
  const customKeys = [...new Set(words.flatMap(w => Object.keys(w.customFields || {})))];
  const cols = ['spelling','pronunciation','pos','translation','definition','example','root','etymology',...customKeys];
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const rows = [cols.join(',')];
  for (const w of words) {
    rows.push(cols.map(c => esc(c in w ? w[c] : (w.customFields||{})[c] ?? '')).join(','));
  }
  return rows.join('\n');
}

// ─── IPA Data ────────────────────────────────────────────────────────────────
// null = phonetically impossible cell (shaded)
const IPA_CONSONANTS = {
  cols: ['Bilabial','Labio-dental','Dental','Alveolar','Post-alv.','Palatal','Velar','Uvular','Pharyngeal','Glottal'],
  rows: [
    { name:'Plosive',          cells:[['p','b'], null,      null,      ['t','d'], null,      ['c','ɟ'], ['k','ɡ'], ['q','ɢ'], null,      ['ʔ','']] },
    { name:'Nasal',            cells:[['','m'],  ['','ɱ'],  null,      ['','n'],  null,      ['','ɲ'],  ['','ŋ'],  ['','ɴ'],  null,      null     ] },
    { name:'Trill',            cells:[['','ʙ'],  null,      null,      ['','r'],  null,      null,      null,      ['','ʀ'],  null,      null     ] },
    { name:'Tap / Flap',       cells:[null,      ['','ⱱ'],  null,      ['','ɾ'],  null,      null,      null,      null,      null,      null     ] },
    { name:'Fricative',        cells:[['ɸ','β'], ['f','v'], ['θ','ð'], ['s','z'], ['ʃ','ʒ'], ['ç','ʝ'], ['x','ɣ'], ['χ','ʁ'], ['ħ','ʕ'], ['h','ɦ']] },
    { name:'Lat. fricative',   cells:[null,      null,      null,      ['ɬ','ɮ'], null,      null,      null,      null,      null,      null     ] },
    { name:'Approximant',      cells:[null,      ['','ʋ'],  null,      ['','ɹ'],  null,      ['','j'],  ['','ɰ'],  null,      null,      null     ] },
    { name:'Lat. approximant', cells:[null,      null,      null,      ['','l'],  null,      ['','ʎ'],  ['','ʟ'],  null,      null,      null     ] },
  ]
};

const IPA_VOWELS = [
  { label:'Close',      syms:['i','y','','','ɨ','ʉ','','','ɯ','u'] },
  { label:'Near-close', syms:['','ɪ','ʏ','','','','ʊ',''] },
  { label:'Close-mid',  syms:['e','ø','','','ɘ','ɵ','','','ɤ','o'] },
  { label:'Mid',        syms:['','','','ə','',''] },
  { label:'Open-mid',   syms:['ɛ','œ','','','ɜ','ɞ','','','ʌ','ɔ'] },
  { label:'Near-open',  syms:['æ','','','ɐ',''] },
  { label:'Open',       syms:['a','ɶ','','','','','','','ɑ','ɒ'] },
];

const IPA_OTHER = {
  'Retroflex':      ['ʈ','ɖ','ɳ','ɽ','ɾ','ʂ','ʐ','ɻ','ɭ'],
  'Non-pulmonic':   ['ʘ','ǀ','ǃ','ǂ','ǁ','ɓ','ɗ','ʄ','ɠ','ʛ'],
  'Other':          ['ʍ','w','ɥ','ʜ','ʢ','ʡ','ɕ','ʑ','ɧ','ɺ','ʼ'],
  'Suprasegmental': ['ˈ','ˌ','ː','ˑ','|','‖','.','-','‿'],
  'Tones':          ['˥','˦','˧','˨','˩','↗','↘'],
  'Diacritics':     ['̥','̬','ʰ','̹','̜','̟','̠','̈',
                     '̽','̚','ʲ','ˠ','ˤ','̃','ⁿ','ˡ',
                     '̴','̝','̞','̩','̯','͡'],
};

// ─── Unicode Character Variants ───────────────────────────────────────────────
const CHAR_VARIANTS = {
  a:['à','á','â','ã','ä','å','æ','ā','ă','ą','ǎ','ǟ','ǡ','ǣ','ǻ','ȁ','ȃ','ȧ','ɐ','ɑ','ɒ','ḁ','ạ','ả','ấ','ầ','ẩ','ẫ','ậ','ắ','ằ','ẳ','ẵ','ặ','ₐ','ª'],
  b:['ƀ','ɓ','ƃ','ḃ','ḅ','ḇ'],
  c:['ç','ć','ĉ','č','ċ','ƈ','ɕ','ḉ'],
  d:['ð','ď','đ','ɗ','ḋ','ḍ','ḏ','ḑ','ḓ'],
  e:['è','é','ê','ë','ē','ĕ','ė','ę','ě','ȅ','ȇ','ȩ','ɛ','ɘ','ə','ɜ','ɝ','ɞ','ḕ','ḗ','ḙ','ḛ','ḝ','ẹ','ẻ','ẽ','ế','ề','ể','ễ','ệ','ₑ'],
  f:['ƒ','ḟ'],
  g:['ĝ','ğ','ġ','ģ','ǥ','ǧ','ǵ','ɠ','ɡ','ɢ','ḡ'],
  h:['ĥ','ħ','ȟ','ɦ','ɧ','ɥ','ħ','ḣ','ḥ','ḧ','ḩ','ḫ','ẖ','ⱨ'],
  i:['ì','í','î','ï','ĩ','ī','ĭ','į','ǐ','ȉ','ȋ','ɨ','ɪ','ḭ','ḯ','ỉ','ị'],
  j:['ĵ','ǰ','ɟ','ʝ'],
  k:['ķ','ǩ','ḱ','ḳ','ḵ','ⱪ'],
  l:['ĺ','ļ','ľ','ŀ','ł','ȴ','ɫ','ɬ','ɭ','ɮ','ʎ','ʟ','ḷ','ḹ','ḻ','ḽ','ⱡ'],
  m:['ɱ','ɯ','ɰ','ḿ','ṁ','ṃ'],
  n:['ñ','ń','ņ','ň','ŋ','ǹ','ȵ','ɲ','ɳ','ɴ','ṅ','ṇ','ṉ','ṋ'],
  o:['ò','ó','ô','õ','ö','ø','ō','ŏ','ő','ǒ','ǫ','ǭ','ȍ','ȏ','ȫ','ȭ','ȯ','ȱ','ɵ','ɶ','ṍ','ṏ','ṑ','ṓ','ọ','ỏ','ố','ồ','ổ','ỗ','ộ','ớ','ờ','ở','ỡ','ợ','°'],
  p:['ƥ','ṕ','ṗ'],
  q:['ʠ','ɋ'],
  r:['ŕ','ŗ','ř','ȑ','ȓ','ɹ','ɺ','ɻ','ɼ','ɽ','ɾ','ʀ','ʁ','ṙ','ṛ','ṝ','ṟ'],
  s:['ś','ŝ','ş','š','ș','ṡ','ṣ','ṥ','ṧ','ṩ'],
  t:['ţ','ť','ŧ','ț','ȶ','ṫ','ṭ','ṯ','ṱ','ẗ'],
  u:['ù','ú','û','ü','ũ','ū','ŭ','ů','ű','ų','ǔ','ǖ','ǘ','ǚ','ǜ','ȕ','ȗ','ʉ','ṳ','ṵ','ṷ','ṹ','ṻ','ụ','ủ','ứ','ừ','ử','ữ','ự'],
  v:['ʋ','ṽ','ṿ','ⱱ'],
  w:['ŵ','ẁ','ẃ','ẅ','ẇ','ẉ','ẘ'],
  x:['ẋ','ẍ'],
  y:['ý','ÿ','ŷ','ȳ','ɣ','ɤ','ɥ','ʏ','ẏ','ẙ','ỳ','ỵ','ỷ','ỹ'],
  z:['ź','ż','ž','ȥ','ɀ','ẑ','ẓ','ẕ','ⱬ'],
  A:['À','Á','Â','Ã','Ä','Å','Æ','Ā','Ă','Ą','Ǎ','Ǟ','Ǡ','Ǣ','Ǻ','Ȁ','Ȃ','Ȧ','Ḁ','Ạ','Ả','Ấ','Ầ','Ẩ','Ẫ','Ậ','Ắ','Ằ','Ẳ','Ẵ','Ặ'],
  B:['Ƀ','Ɓ','Ƃ','Ḃ','Ḅ','Ḇ'],
  C:['Ç','Ć','Ĉ','Č','Ċ','Ƈ','Ḉ'],
  D:['Ð','Ď','Đ','Ɗ','Ḋ','Ḍ','Ḏ','Ḑ','Ḓ'],
  E:['È','É','Ê','Ë','Ē','Ĕ','Ė','Ę','Ě','Ȅ','Ȇ','Ȩ','Ḕ','Ḗ','Ḙ','Ḛ','Ḝ','Ẹ','Ẻ','Ẽ','Ế','Ề','Ể','Ễ','Ệ'],
  F:['Ƒ','Ḟ'],
  G:['Ĝ','Ğ','Ġ','Ģ','Ǥ','Ǧ','Ǵ','Ɠ','Ḡ'],
  H:['Ĥ','Ħ','Ȟ','Ḣ','Ḥ','Ḧ','Ḩ','Ḫ'],
  I:['Ì','Í','Î','Ï','Ĩ','Ī','Ĭ','Į','Ǐ','Ȉ','Ȋ','Ḭ','Ḯ','Ỉ','Ị'],
  J:['Ĵ'],
  K:['Ķ','Ǩ','Ḱ','Ḳ','Ḵ','Ⱪ'],
  L:['Ĺ','Ļ','Ľ','Ŀ','Ł','Ḷ','Ḹ','Ḻ','Ḽ','Ⱡ'],
  M:['Ḿ','Ṁ','Ṃ'],
  N:['Ñ','Ń','Ņ','Ň','Ŋ','Ǹ','Ṅ','Ṇ','Ṉ','Ṋ'],
  O:['Ò','Ó','Ô','Õ','Ö','Ø','Ō','Ŏ','Ő','Ǒ','Ǫ','Ǭ','Ȍ','Ȏ','Ȫ','Ȭ','Ȯ','Ȱ','Ṍ','Ṏ','Ṑ','Ṓ','Ọ','Ỏ','Ố','Ồ','Ổ','Ỗ','Ộ','Ớ','Ờ','Ở','Ỡ','Ợ'],
  P:['Ƥ','Ṕ','Ṗ'],
  Q:[],
  R:['Ŕ','Ŗ','Ř','Ȑ','Ȓ','Ṙ','Ṛ','Ṝ','Ṟ'],
  S:['Ś','Ŝ','Ş','Š','Ș','Ṡ','Ṣ','Ṥ','Ṧ','Ṩ'],
  T:['Ţ','Ť','Ŧ','Ț','Ṫ','Ṭ','Ṯ','Ṱ'],
  U:['Ù','Ú','Û','Ü','Ũ','Ū','Ŭ','Ů','Ű','Ų','Ǔ','Ǖ','Ǘ','Ǚ','Ǜ','Ȕ','Ȗ','Ṳ','Ṵ','Ṷ','Ṹ','Ṻ','Ụ','Ủ','Ứ','Ừ','Ử','Ữ','Ự'],
  V:['Ṽ','Ṿ'],
  W:['Ŵ','Ẁ','Ẃ','Ẅ','Ẇ','Ẉ'],
  X:['Ẋ','Ẍ'],
  Y:['Ý','Ÿ','Ŷ','Ȳ','Ẏ','Ỳ','Ỵ','Ỷ','Ỹ'],
  Z:['Ź','Ż','Ž','Ȥ','Ẑ','Ẓ','Ẕ','Ⱬ'],
};

// Digraph / ligature lookups
const DIGRAPHS = {
  ae:['æ','Æ','ǣ','Ǣ'], oe:['œ','Œ'], ij:['ĳ','Ĳ'], th:['þ','Þ','ð','Ð'],
  ss:['ß','ẞ'], ng:['ŋ','Ŋ'], dz:['ʣ'], ts:['ʦ'], dʒ:['ʤ'], tʃ:['ʧ'],
  db:['ʣ'], ll:['ɫ'], ny:['ɲ'], sh:['ʃ'], zh:['ʒ'], ch:['ʧ','č','ĉ'],
};

// ─── Phonology Constants ─────────────────────────────────────────────────────
const DEFAULT_SPELLING = {
  'ʃ':'sh','ʒ':'zh','tʃ':'ch','dʒ':'j',
  'θ':'th','ð':'dh','ŋ':'ng','ɲ':'ny',
  'ʔ':"'",'j':'y','x':'kh','ɣ':'gh',
  'ç':'hy','χ':'kh','ʁ':'r','ħ':'hh',
  'ʕ':"'",'ɸ':'ph','β':'bh','ɬ':'lh',
  'ɹ':'r','ɾ':'r','ʋ':'v','ɻ':'r',
  'w':'w',
  'ɛ':'e','ɔ':'o','æ':'ae','ɑ':'a',
  'ɒ':'o','ə':'e','ɪ':'i','ʊ':'u',
  'ø':'ö','y':'ü','œ':'oe','ʌ':'u',
};

const LANGUAGE_PRESETS = {
  'Latin': {
    consonants: ['p','b','t','d','k','g','kʷ','gʷ','m','n','f','s','h','r','l','j','w'],
    vowels: ['a','e','i','o','u','aː','eː','iː','oː','uː'],
    syllableTemplates: ['CV','CVC','CCVC','VC'],
    onsetClusters: ['pl','bl','tr','dr','kr','gr','fl','kl','gl','sp','st','sk'],
    codaClusters: ['nt','nd','ns','rs','rn','rt','ks','kt','lk'],
  },
  'Japanese': {
    consonants: ['k','g','s','z','t','d','n','h','b','p','m','r','j','w'],
    vowels: ['a','i','u','e','o'],
    syllableTemplates: ['CV','V','CjV'],
    onsetClusters: [],
    codaClusters: ['n'],
  },
  'Arabic': {
    consonants: ['b','t','θ','d','ð','k','q','ʔ','f','s','z','ʃ','x','ɣ','ħ','ʕ','h','m','n','r','l','j','w'],
    vowels: ['a','i','u','aː','iː','uː'],
    syllableTemplates: ['CV','CVC','CVCC'],
    onsetClusters: [],
    codaClusters: ['nt','nd','rk','lk','ft'],
  },
  'Hawaiian': {
    consonants: ['p','k','ʔ','h','m','n','l','w'],
    vowels: ['a','e','i','o','u','aː','eː','iː','oː','uː'],
    syllableTemplates: ['CV','V'],
    onsetClusters: [],
    codaClusters: [],
  },
  'Finnish': {
    consonants: ['p','t','k','d','m','n','ŋ','s','h','r','l','j','v'],
    vowels: ['a','e','i','o','u','y','ä','ö'],
    syllableTemplates: ['CV','CVC','CVCC','VC'],
    onsetClusters: [],
    codaClusters: ['nt','ns','rs','rk','lk','mp','st','ts'],
    vowelHarmony: true,
    vowelGroups: [['a','o','u'], ['ä','ö','y']],
  },
};

function applyOrthography(ipa, orthoRules) {
  if (!orthoRules || !orthoRules.length) return ipa;
  const sorted = [...orthoRules].sort((a, b) => b.ipa.length - a.ipa.length);
  let result = ipa;
  for (const rule of sorted) {
    result = result.split(rule.ipa).join(rule.spelling);
  }
  return result;
}

// ─── Word Generator Engine ────────────────────────────────────────────────────
const NASALS     = new Set(['m','ɱ','n','ɳ','ɲ','ŋ','ɴ']);
const FRICATIVES = new Set(['ɸ','β','f','v','θ','ð','s','z','ʃ','ʒ','ʂ','ʐ','ç','ʝ','x','ɣ','χ','ʁ','ħ','ʕ','h','ɦ','ɬ','ɮ']);
const LIQUIDS    = new Set(['l','ɭ','ʎ','ʟ','r','ɹ','ɻ','ɾ','ɽ','ʀ','ʁ']);

function pickRandom(arr) {
  if (!arr || !arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTemplateWeight(template) {
  const len = template.replace(/[()]/g, '').length;
  switch(len) {
    case 1: return 3;
    case 2: return 5;
    case 3: return 3;
    case 4: return 1;
    default: return 1;
  }
}

function pickWeightedTemplate(templates) {
  const weighted = templates.map(t => ({ template: t, weight: getTemplateWeight(t) }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.template;
  }
  return templates[0];
}

function pickSyllableCount(min, max) {
  const weights = [];
  for (let n = min; n <= max; n++) weights.push(Math.pow(1/1.5, n));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return min + i;
  }
  return min;
}

function realizeSyllable(template, consonants, vowels, onsetClusters, codaClusters) {
  // 1. Resolve optionals
  let resolved = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '(' && template.indexOf(')', i) !== -1) {
      const close = template.indexOf(')', i);
      if (Math.random() < 0.5) resolved += template.slice(i + 1, close);
      i = close + 1;
    } else {
      resolved += template[i++];
    }
  }

  // 2. Find first V to split onset/nucleus/coda
  const firstV = resolved.indexOf('V');
  const lastV  = resolved.lastIndexOf('V');
  if (firstV === -1) {
    // no vowel at all — just resolve consonants
    return resolved.split('').map(ch => resolveSymbol(ch, consonants, vowels)).join('');
  }

  const onset = resolved.slice(0, firstV);
  const coda  = resolved.slice(lastV + 1);
  const mid   = resolved.slice(firstV, lastV + 1); // V + any inner C+V groups

  // 3. Resolve onset, handling CC clusters
  let result = '';
  result += resolveConsonantZone(onset, consonants, onsetClusters);

  // 4. Resolve V / inner segments
  for (let j = 0; j < mid.length; j++) {
    result += resolveSymbol(mid[j], consonants, vowels);
  }

  // 5. Resolve coda, handling CC clusters
  result += resolveConsonantZone(coda, consonants, codaClusters);

  return result;
}

function resolveConsonantZone(zone, consonants, clusters) {
  if (!zone) return '';
  // Replace pairs of C with a cluster when available
  if (clusters && clusters.length && zone.includes('CC')) {
    return zone.replace('CC', pickRandom(clusters));
  }
  return zone.split('').map(ch => resolveSymbol(ch, consonants, [])).join('');
}

function resolveSymbol(ch, consonants, vowels) {
  if (ch === 'V') return pickRandom(vowels) || '';
  if (ch === 'C') return pickRandom(consonants) || '';
  if (ch === 'N') {
    const nasals = consonants.filter(c => NASALS.has(c));
    return pickRandom(nasals.length ? nasals : consonants) || '';
  }
  if (ch === 'F') {
    const frics = consonants.filter(c => FRICATIVES.has(c));
    return pickRandom(frics.length ? frics : consonants) || '';
  }
  if (ch === 'L') {
    const liq = consonants.filter(c => LIQUIDS.has(c));
    return pickRandom(liq.length ? liq : consonants) || '';
  }
  return ch; // literal character
}

function generateWord(phonology, orthoRules, options = {}) {
  const { minSyllables = 1, maxSyllables = 4 } = options;
  const syllableCount = pickSyllableCount(minSyllables, maxSyllables);

  let vowelPool = phonology.vowels;
  if (phonology.vowelHarmony && phonology.vowelGroups && phonology.vowelGroups.length) {
    const group = pickRandom(phonology.vowelGroups);
    vowelPool = group.filter(v => phonology.vowels.includes(v));
    if (!vowelPool.length) vowelPool = phonology.vowels;
  }

  const syllables = [];
  for (let i = 0; i < syllableCount; i++) {
    const template = pickWeightedTemplate(phonology.syllableTemplates);
    syllables.push(realizeSyllable(template, phonology.consonants, vowelPool, phonology.onsetClusters || [], phonology.codaClusters || []));
  }

  const ipa = syllables.join('');
  const spelling = applyOrthography(ipa, orthoRules);
  return { ipa, spelling };
}

function generateUniqueWords(phonology, orthoRules, count, existingWords, options) {
  const existingSpellings = new Set(existingWords.map(w => w.spelling.toLowerCase()));
  const existingIPA = new Set(existingWords.map(w => (w.pronunciation || '').toLowerCase()).filter(Boolean));
  const results = [];
  let attempts = 0;
  const maxAttempts = count * 20;

  while (results.length < count && attempts < maxAttempts) {
    attempts++;
    const word = generateWord(phonology, orthoRules, options);
    if (!word.ipa) continue;
    const spLower  = word.spelling.toLowerCase();
    const ipaLower = word.ipa.toLowerCase();
    if (existingSpellings.has(spLower) || existingIPA.has(ipaLower)) continue;
    if (results.some(r => r.spelling.toLowerCase() === spLower)) continue;
    existingSpellings.add(spLower);
    existingIPA.add(ipaLower);
    results.push(word);
  }

  return { words: results, exhausted: results.length < count };
}

function insertAtCursor(inputEl, text) {
  const s = inputEl.selectionStart ?? inputEl.value.length;
  const e = inputEl.selectionEnd   ?? inputEl.value.length;
  inputEl.value = inputEl.value.slice(0, s) + text + inputEl.value.slice(e);
  inputEl.selectionStart = inputEl.selectionEnd = s + text.length;
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// ─── IPA Chart Modal ──────────────────────────────────────────────────────────
class IPAChartModal extends obsidian.Modal {
  constructor(app, textComponent) {
    super(app);
    this.tc = textComponent;
  }

  _ins(sym) {
    insertAtCursor(this.tc.inputEl, sym);
    this.tc.onChange(this.tc.inputEl.value);
    this.tc.inputEl.focus();
  }

  _symBtn(parent, sym, cls = '') {
    if (!sym) return;
    const isCombining = sym.codePointAt(0) >= 0x0300 && sym.codePointAt(0) <= 0x036F;
    const display = isCombining ? '◌' + sym : sym;
    const btn = parent.createEl('button', { cls: 'conlang-sym-btn' + (cls ? ' ' + cls : '') });
    btn.textContent = display;
    btn.title = `${sym}  U+${sym.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`;
    btn.addEventListener('click', () => this._ins(sym));
    return btn;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.width = '95vw';
    modalEl.style.maxWidth = '870px';
    contentEl.empty();
    contentEl.addClass('conlang-ipa-modal');

    const hdr = contentEl.createDiv('conlang-ipa-hdr');
    hdr.createEl('h2', { text: 'IPA Chart' });
    hdr.createEl('p',  { text: 'Click any symbol to insert it at the cursor. Modal stays open.', cls: 'conlang-hint' });

    // ── Consonants ──
    contentEl.createEl('h3', { text: 'Consonants (Pulmonic)' });
    const tableWrap = contentEl.createDiv('conlang-ctable-wrap');
    const table = tableWrap.createEl('table', { cls: 'conlang-ctable' });

    const thead = table.createEl('thead').createEl('tr');
    thead.createEl('th');
    IPA_CONSONANTS.cols.forEach(c => thead.createEl('th', { text: c }));

    const tbody = table.createEl('tbody');
    IPA_CONSONANTS.rows.forEach(({ name, cells }) => {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: name, cls: 'conlang-row-lbl' });
      cells.forEach(cell => {
        const td = tr.createEl('td', { cls: 'conlang-ccell' });
        if (cell === null) { td.addClass('conlang-ccell-imp'); return; }
        const [vl, vd] = cell;
        if (vl) this._symBtn(td, vl, 'conlang-sym-vl');
        else if (vd) td.createEl('span', { cls: 'conlang-sym-ph' });
        if (vd) this._symBtn(td, vd, 'conlang-sym-vd');
      });
    });

    // ── Vowels ──
    contentEl.createEl('h3', { text: 'Vowels' });
    const vWrap = contentEl.createDiv('conlang-vowel-grid');
    const frontBackHdr = vWrap.createDiv('conlang-vowel-axis');
    frontBackHdr.createEl('span');
    ['Front','Central','Back'].forEach(t => frontBackHdr.createEl('span', { text: t, cls: 'conlang-vowel-col-lbl' }));

    IPA_VOWELS.forEach(({ label, syms }) => {
      const row = vWrap.createDiv('conlang-vowel-row');
      row.createEl('span', { text: label, cls: 'conlang-vowel-lbl' });
      const cells = row.createDiv('conlang-vowel-syms');
      syms.forEach(s => {
        if (!s) cells.createEl('span', { cls: 'conlang-sym-ph' });
        else this._symBtn(cells, s);
      });
    });

    // ── Other sections ──
    const othersWrap = contentEl.createDiv('conlang-ipa-others');
    Object.entries(IPA_OTHER).forEach(([section, syms]) => {
      const sec = othersWrap.createDiv('conlang-ipa-sec');
      sec.createEl('h4', { text: section });
      const grid = sec.createDiv('conlang-sym-grid');
      syms.forEach(s => this._symBtn(grid, s));
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ─── IPA Picker Modal (Phonology inventory selection) ────────────────────────
class IPAPickerModal extends obsidian.Modal {
  constructor(app, currentConsonants, currentVowels, onSelect) {
    super(app);
    this.selC = new Set(currentConsonants);
    this.selV = new Set(currentVowels);
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.maxWidth = '900px';
    contentEl.empty();
    contentEl.createEl('h2', { text: 'IPA Phoneme Picker' });
    contentEl.createEl('p', { text: 'Click phonemes to add/remove them from your inventory.', cls: 'conlang-hint' });

    // ── Consonants ──
    contentEl.createEl('h3', { text: 'Consonants' });
    const table = contentEl.createEl('table', { cls: 'conlang-ortho-table' });
    const thead = table.createEl('thead').createEl('tr');
    thead.createEl('th', { text: '' });
    IPA_CONSONANTS.cols.forEach(c => thead.createEl('th', { text: c, cls: 'conlang-ipa-hdr' }));

    const tbody = table.createEl('tbody');
    IPA_CONSONANTS.rows.forEach(({ name, cells }) => {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: name, cls: 'conlang-ipa-hdr' });
      cells.forEach(cell => {
        const td = tr.createEl('td');
        if (cell === null) { td.style.background = 'var(--background-modifier-border)'; return; }
        const [vl, vd] = cell;
        [vl, vd].forEach(sym => {
          if (!sym) return;
          const btn = td.createEl('span', { text: sym, cls: 'conlang-ipa-cell' + (this.selC.has(sym) ? ' is-selected' : '') });
          btn.addEventListener('click', () => {
            if (this.selC.has(sym)) this.selC.delete(sym); else this.selC.add(sym);
            btn.toggleClass('is-selected', this.selC.has(sym));
            this._notify();
          });
        });
      });
    });

    // ── Retroflex & Other ──
    Object.entries(IPA_OTHER).slice(0, 1).forEach(([section, syms]) => {
      const row = contentEl.createDiv({ cls: 'conlang-phon-section' });
      row.createEl('strong', { text: section + ': ' });
      syms.forEach(sym => {
        const btn = row.createEl('span', { text: sym, cls: 'conlang-ipa-cell' + (this.selC.has(sym) ? ' is-selected' : '') });
        btn.addEventListener('click', () => {
          if (this.selC.has(sym)) this.selC.delete(sym); else this.selC.add(sym);
          btn.toggleClass('is-selected', this.selC.has(sym));
          this._notify();
        });
      });
    });

    // ── Vowels ──
    contentEl.createEl('h3', { text: 'Vowels' });
    const vWrap = contentEl.createDiv('conlang-ipa-grid');
    const vHdr = vWrap.createDiv('conlang-vowel-axis');
    vHdr.createEl('span');
    ['Front', 'Central', 'Back'].forEach(t => vHdr.createEl('span', { text: t, cls: 'conlang-vowel-col-lbl' }));
    IPA_VOWELS.forEach(({ label, syms }) => {
      const row = vWrap.createDiv('conlang-vowel-row');
      row.createEl('span', { text: label, cls: 'conlang-vowel-lbl' });
      const cells = row.createDiv('conlang-vowel-syms');
      syms.forEach(sym => {
        if (!sym) { cells.createEl('span', { cls: 'conlang-sym-ph' }); return; }
        const btn = cells.createEl('span', { text: sym, cls: 'conlang-ipa-cell' + (this.selV.has(sym) ? ' is-selected' : '') });
        btn.addEventListener('click', () => {
          if (this.selV.has(sym)) this.selV.delete(sym); else this.selV.add(sym);
          btn.toggleClass('is-selected', this.selV.has(sym));
          this._notify();
        });
      });
    });

    contentEl.createEl('button', { text: 'Done', cls: 'mod-cta' }).addEventListener('click', () => this.close());
  }

  _notify() {
    this.onSelect([...this.selC], [...this.selV]);
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Spelling Picker Modal ────────────────────────────────────────────────────
class SpellingPickerModal extends obsidian.Modal {
  constructor(app, textComponent) {
    super(app);
    this.tc = textComponent;
  }

  _ins(ch) {
    insertAtCursor(this.tc.inputEl, ch);
    this.tc.onChange(this.tc.inputEl.value);
    this.tc.inputEl.focus();
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.maxWidth = '560px';
    contentEl.empty();
    contentEl.addClass('conlang-spell-modal');
    contentEl.createEl('h2', { text: 'Character Picker' });
    contentEl.createEl('p', { text: 'Type a letter to see Unicode variants, or click a base letter below.', cls: 'conlang-hint' });

    const si = contentEl.createEl('input', {
      type: 'text', placeholder: 'Type a letter (a, e, n, o, ae, th…)',
      cls: 'conlang-spell-search'
    });

    const resultsEl = contentEl.createDiv('conlang-spell-results');

    // Base letter browser
    const browseWrap = contentEl.createDiv('conlang-spell-browse');
    Object.keys(CHAR_VARIANTS).forEach(k => {
      const b = browseWrap.createEl('button', { text: k, cls: 'conlang-base-btn' });
      b.addEventListener('click', () => { si.value = k; si.dispatchEvent(new Event('input')); });
    });

    const render = (q) => {
      resultsEl.empty();
      if (!q.trim()) return;
      q = q.trim();

      let variants = CHAR_VARIANTS[q] || CHAR_VARIANTS[q.toLowerCase()] || [];
      if (!variants.length && DIGRAPHS[q.toLowerCase()]) variants = DIGRAPHS[q.toLowerCase()];
      if (!variants.length) {
        // Substring search
        for (const [k, vs] of Object.entries(CHAR_VARIANTS)) {
          if (k.toLowerCase().startsWith(q.toLowerCase())) variants = [...variants, ...vs];
        }
      }
      // Dedupe
      variants = [...new Set(variants)].filter(Boolean);

      if (!variants.length) {
        resultsEl.createEl('p', { text: 'No variants found. Try a single letter or digraph (ae, th, ng…).', cls: 'conlang-muted' });
        return;
      }

      const lbl = resultsEl.createEl('p', { cls: 'conlang-spell-group-lbl' });
      lbl.textContent = `${variants.length} variant${variants.length > 1 ? 's' : ''} for "${q}"`;

      const grid = resultsEl.createDiv('conlang-sym-grid conlang-spell-grid');
      variants.forEach(ch => {
        const b = grid.createEl('button', { cls: 'conlang-sym-btn conlang-spell-btn' });
        b.textContent = ch;
        b.title = `${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`;
        b.addEventListener('click', () => {
          this._ins(ch);
          b.classList.add('conlang-sym-flash');
          setTimeout(() => b.classList.remove('conlang-sym-flash'), 350);
        });
      });
    };

    si.addEventListener('input', () => render(si.value));

    // Pre-fill from what's at cursor
    const el = this.tc.inputEl;
    const pos = el.selectionStart;
    if (pos > 0) {
      const ch = el.value[pos - 1];
      if (/[a-zA-Z]/.test(ch)) { si.value = ch; render(ch); }
    }

    si.focus();
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Conlanger's Thesaurus (based on Fiat Lingua fl-000024-01) ───────────────
const THESAURUS = [
  { cat:'Pronouns & Deixis', entries:['I / me','you (sg)','he / him','she / her','it','we (incl.)','we (excl.)','you (pl)','they / them','this','that','here','there','who','what','which','some','all / every','none','each','other / another','self','same','different'] },
  { cat:'Numbers & Quantity', entries:['zero','one','two','three','four','five','six','seven','eight','nine','ten','twenty','hundred','thousand','many / much','few / little','more','less','enough','half','first','last','count / number'] },
  { cat:'Universe & Elements', entries:['sky / heaven','sun','moon','star','cloud','rain','snow','ice','wind','storm','thunder','lightning','fire','flame','smoke','ash','earth / soil','dust / sand','stone / rock','metal','air','water','heat','cold','steam','mist / fog','light (natural)','darkness'] },
  { cat:'Terrain & Place', entries:['world','land / ground','mountain','valley','plain / field','forest','desert','swamp','river','lake','sea / ocean','island','shore / coast','wave','cave','cliff','road / path','bridge','north','south','east','west','depth','height','distance','surface','place / location'] },
  { cat:'Time', entries:['time','moment','duration','beginning','end','day','night','morning','afternoon','evening','week','month','year','century','season','spring','summer','autumn','winter','now / present','past','future','today','yesterday','tomorrow','always','never','soon','old (age)','young','new','ancient'] },
  { cat:'The Body', entries:['body','head','face','forehead','cheek','jaw','hair','eye','ear','nose','mouth','lip','tooth','tongue','throat','neck','shoulder','arm','elbow','wrist','hand','finger','thumb','nail','chest','breast','belly','back','spine','hip','leg','thigh','knee','ankle','foot','toe','heel','skin','flesh','bone','blood','vein','heart','lung','liver','brain','muscle','fat'] },
  { cat:'Life & Health', entries:['life','death','birth','grow','age / grow old','breathe','sleep','wake','rest','eat','drink','hunger','thirst','health','illness','pain','wound','fever','bleed','cough','sneeze','sweat','heal / cure','medicine','poison','strong','weak','alive','dead','tired'] },
  { cat:'People & Society', entries:['person','man','woman','child','baby','adult','elder','mother','father','son','daughter','brother','sister','husband','wife','grandfather','grandmother','uncle','aunt','cousin','family','ancestor','descendant','king / ruler','queen','chief','slave / servant','soldier','priest','merchant','farmer','friend','enemy','stranger','neighbor','people / folk','clan / tribe','nation'] },
  { cat:'Animals', entries:['animal','bird','fish','insect','worm','snake','dog','cat','horse','cow','ox / bull','sheep','goat','pig','rabbit','deer','wolf','fox','bear','lion','eagle','frog','mouse / rat','bee','ant','fly','spider','crab','feather','claw','wing','tail','horn','hoof','scale','egg','nest','herd / flock','wild','tame','hunt','prey'] },
  { cat:'Plants & Agriculture', entries:['plant','tree','bush / shrub','grass','flower','fruit','seed','berry','root','leaf','branch','bark','wood','thorn','vine','moss','mushroom','wheat / grain','rice','corn','oat','barley','bean','apple','grape','herb / spice','farm / field','garden','harvest','cultivate','soil'] },
  { cat:'Food & Drink', entries:['food','meal','bread','meat','fish (food)','egg (food)','vegetable','fruit (food)','milk','cheese','butter','fat / grease','oil','wine','beer / ale','salt','sugar / honey','spice','soup / broth','raw','cooked','boiled','roasted','fried','sweet','sour','bitter','salty','spicy','cook','chew','swallow','taste'] },
  { cat:'Shelter & Home', entries:['house / home','building','room','door','window','wall','roof','floor','bed','hearth','chair','table','shelf','village','town / city','castle','temple / shrine','road / street','bridge','tower','market','fence','gate','key','lock','live / dwell','build'] },
  { cat:'Clothing & Objects', entries:['clothes','shirt / tunic','pants','dress / robe','coat / cloak','hat','shoe / boot','belt','cloth / fabric','thread','needle','knife','axe','sword','spear','bow','arrow','shield','hammer','rope','net','pot / vessel','cup / bowl','bag','basket','wheel','boat / ship','cart','plow','lamp / torch','coin / money','tool','weapon'] },
  { cat:'Movement & Position', entries:['go / travel','come / arrive','walk','run','fly','swim','crawl','climb','jump','fall','rise','descend','sit','stand','lie down','kneel','carry','throw','give','take','put / place','push','pull','lift','drag','open','close','turn','stop','start','lead','follow','chase','escape','return','cross','up','down','near','far','inside','outside','between','around','middle'] },
  { cat:'Perception & Mind', entries:['see / look','hear','feel / touch','smell (sense)','taste (sense)','know','think','understand','remember','forget','learn','teach','believe','doubt','dream','imagine','want / desire','need','wish / hope','like / love','hate','fear','happy / joy','sad','angry','surprised','confused','decide','plan','choose','judge','mind','thought / idea','memory','emotion','consciousness'] },
  { cat:'Speech & Language', entries:['speak / talk','say / utter','tell','ask','answer','call / name (v)','shout','whisper','sing','laugh','cry / weep','greet','thank','curse','promise','lie / deceive','praise','word','name (n)','language','story / tale','news','letter / message','sign / symbol','write','read','song','prayer'] },
  { cat:'Society & Abstract', entries:['rule / govern','law / custom','right (entitlement)','duty','war / battle','peace','trade','gift','work / labor','play / game','help / aid','fight','win','lose','kill','steal','punish','reward','right / correct','wrong','true','false','good','evil','fair / just','free','captive','power','honor','shame','sacred','magic','god / deity','spirit / ghost','soul','ritual','fate / destiny','luck'] },
  { cat:'Colors & Properties', entries:['red','orange','yellow','green','blue','purple','pink','white','black','gray','brown','golden','light (color)','dark (color)','bright','dull','big / large','small','long','short','tall / high','wide','narrow','thick','thin','heavy','light (weight)','fast','slow','hard','soft','sharp','blunt','hot','cold','wet','dry','clean','dirty','beautiful','ugly','full','empty','round','flat','straight','curved','loud','quiet','smooth','rough'] },
];

// ─── Advanced Modals ──────────────────────────────────────────────────────────

class ThesaurusImportModal extends obsidian.Modal {
  constructor(app, dict, onSave) {
    super(app); this.dict = dict; this.onSave = onSave;
    this.selected = new Set();
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.maxWidth = '640px';
    contentEl.empty(); contentEl.addClass('conlang-thes-modal');
    contentEl.createEl('h2', { text:"Import from Conlanger's Thesaurus" });
    contentEl.createEl('p', { text:'Each concept creates a blank entry. Fill in your conwords after import.', cls:'conlang-hint' });
    const fullThes=getFullThesaurus(this.dict);
    const existing = new Set(this.dict.words.map(w=>(w.thesaurusEntry||'').toLowerCase()).filter(Boolean));
    fullThes.forEach(c=>c.entries.forEach(en=>{ if(!existing.has(en.toLowerCase())) this.selected.add(en); }));
    const selBar = contentEl.createDiv('conlang-thes-selbar');
    selBar.createEl('button',{text:'Select All'}).addEventListener('click',()=>{ fullThes.forEach(c=>c.entries.forEach(e=>this.selected.add(e))); rerender(); });
    selBar.createEl('button',{text:'Clear All'}).addEventListener('click',()=>{ this.selected.clear(); rerender(); });
    const countEl = selBar.createEl('span',{cls:'conlang-thes-count'});
    const body = contentEl.createDiv('conlang-thes-body');
    const catEls = [];
    fullThes.forEach(({cat,entries})=>{
      const sec = body.createDiv('conlang-thes-sec');
      const hdr = sec.createDiv('conlang-thes-hdr');
      const catCb = hdr.createEl('input',{type:'checkbox'});
      hdr.createEl('span',{text:`${cat} (${entries.length})`,cls:'conlang-thes-cat'});
      const grid = sec.createDiv('conlang-thes-grid');
      const entryEls = entries.map(e=>{
        const lbl = grid.createEl('label',{cls:'conlang-thes-lbl'+(existing.has(e.toLowerCase())?' conlang-thes-exists':'')});
        const cb = lbl.createEl('input',{type:'checkbox'}); cb.checked=this.selected.has(e);
        if(existing.has(e.toLowerCase())) cb.disabled=true;
        lbl.appendText(e);
        cb.addEventListener('change',()=>{ cb.checked?this.selected.add(e):this.selected.delete(e); sync(); });
        return {cb,e};
      });
      const sync=()=>{ catCb.checked=entries.filter(e=>!existing.has(e.toLowerCase())).every(e=>this.selected.has(e)); countEl.textContent=`${this.selected.size} selected`; };
      catCb.checked=entries.filter(e=>!existing.has(e.toLowerCase())).every(e=>this.selected.has(e));
      catCb.addEventListener('change',()=>{ entryEls.forEach(({cb,e})=>{ if(!cb.disabled){cb.checked=catCb.checked; catCb.checked?this.selected.add(e):this.selected.delete(e);} }); sync(); });
      catEls.push({catCb,entryEls,sync});
    });
    const rerender=()=>catEls.forEach(({catCb,entryEls,sync})=>{ entryEls.forEach(({cb,e})=>{ if(!cb.disabled) cb.checked=this.selected.has(e); }); sync(); });
    countEl.textContent=`${this.selected.size} selected`;
    const btnRow=contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button',{text:'Import',cls:'mod-cta'}).addEventListener('click',()=>{ if(!this.selected.size){new obsidian.Notice('Nothing selected');return;} this.onSave([...this.selected]); this.close(); });
    btnRow.createEl('button',{text:'Cancel'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

class DictSettingsModal extends obsidian.Modal {
  constructor(app, dict, allNames, onSave) {
    super(app);
    this.data = { parentDictionary:dict.parentDictionary||null, useCases:dict.useCases||false,
      cases:[...(dict.cases||[])], numbers:[...(dict.numbers||['sg','pl'])],
      useGenders:dict.useGenders||false, genders:[...(dict.genders||[])] };
    this.allNames = allNames.filter(n=>n!==dict.name); this.onSave = onSave;
  }
  onOpen() {
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='520px';
    contentEl.empty(); contentEl.createEl('h2',{text:'Dictionary Settings'});
    contentEl.createEl('h3',{text:'Etymology Link'});
    new obsidian.Setting(contentEl).setName('Parent Dictionary').setDesc('The ancestor language this derives from.')
      .addDropdown(d=>{ d.addOption('','— None —'); this.allNames.forEach(n=>d.addOption(n,n)); d.setValue(this.data.parentDictionary||''); d.onChange(v=>this.data.parentDictionary=v||null); });
    contentEl.createEl('h3',{text:'Nominal Cases'});
    new obsidian.Setting(contentEl).setName('Enable Declension').addToggle(t=>t.setValue(this.data.useCases).onChange(v=>{this.data.useCases=v;caseWrap.style.display=v?'block':'none';}));
    const caseWrap=contentEl.createDiv(); caseWrap.style.display=this.data.useCases?'block':'none';
    new obsidian.Setting(caseWrap).setName('Cases').setDesc('Comma-separated, e.g. NOM,ACC,GEN,DAT,ABL')
      .addText(t=>t.setValue(this.data.cases.join(',')).onChange(v=>this.data.cases=v.split(',').map(s=>s.trim()).filter(Boolean)));
    new obsidian.Setting(caseWrap).setName('Numbers').setDesc('Comma-separated, e.g. sg,pl or sg,du,pl')
      .addText(t=>t.setValue(this.data.numbers.join(',')).onChange(v=>this.data.numbers=v.split(',').map(s=>s.trim()).filter(Boolean)));
    const PRESETS={'Latin':{c:'NOM,VOC,ACC,GEN,DAT,ABL',n:'sg,pl'},'Ancient Greek':{c:'NOM,VOC,ACC,GEN,DAT',n:'sg,du,pl'},'German':{c:'NOM,ACC,DAT,GEN',n:'sg,pl'},'Finnish':{c:'NOM,ACC,GEN,PAR,INE,ELA,ILL,ADE,ABL,ALL,ESS,TRA',n:'sg,pl'},'Old French':{c:'NOM,OBL',n:'sg,pl'},'Russian':{c:'NOM,ACC,GEN,DAT,INS,PRE',n:'sg,pl'}};
    const pw=caseWrap.createDiv('conlang-preset-wrap'); pw.createEl('span',{text:'Presets: ',cls:'conlang-muted'});
    Object.entries(PRESETS).forEach(([lang,{c,n}])=>{
      pw.createEl('button',{text:lang,cls:'conlang-preset-btn'}).addEventListener('click',()=>{
        this.data.cases=c.split(','); this.data.numbers=n.split(','); this.onOpen();
      });
    });
    contentEl.createEl('h3',{text:'Gender System'});
    new obsidian.Setting(contentEl).setName('Enable Genders').setDesc('Track grammatical gender on each word.')
      .addToggle(t=>t.setValue(this.data.useGenders).onChange(v=>{this.data.useGenders=v;genderWrap.style.display=v?'block':'none';}));
    const genderWrap=contentEl.createDiv(); genderWrap.style.display=this.data.useGenders?'block':'none';
    new obsidian.Setting(genderWrap).setName('Genders').setDesc('Comma-separated, e.g. m,f or m,f,n')
      .addText(t=>t.setValue(this.data.genders.join(',')).onChange(v=>this.data.genders=v.split(',').map(s=>s.trim()).filter(Boolean)));
    const GPRESETS={'French':'m,f','Latin':'m,f,n','German':'m,f,n','Russian':'m,f,n','Old Norse':'m,f,n','Hebrew':'m,f','Arabic':'m,f'};
    const gw=genderWrap.createDiv('conlang-preset-wrap'); gw.createEl('span',{text:'Presets: ',cls:'conlang-muted'});
    Object.entries(GPRESETS).forEach(([lang,g])=>{
      gw.createEl('button',{text:lang,cls:'conlang-preset-btn'}).addEventListener('click',()=>{ this.data.genders=g.split(','); this.data.useGenders=true; this.onOpen(); });
    });
    const btnRow=contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button',{text:'Save',cls:'mod-cta'}).addEventListener('click',()=>{this.onSave(this.data);this.close();});
    btnRow.createEl('button',{text:'Cancel'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

class ParadigmManagerModal extends obsidian.Modal {
  constructor(app, dict, onSave) {
    super(app); this.dict=dict; this.paradigms=JSON.parse(JSON.stringify(dict.paradigms||[])); this.onSave=onSave;
  }
  onOpen(){
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='600px';
    contentEl.empty(); contentEl.createEl('h2',{text:'Paradigm Manager'});
    contentEl.createEl('p',{text:'Define conjugation (verbs) and declension (nouns/adj) paradigms.',cls:'conlang-hint'});
    const listEl=contentEl.createDiv('conlang-para-list');
    const redraw=()=>{
      listEl.empty();
      if(!this.paradigms.length) listEl.createEl('p',{text:'No paradigms yet.',cls:'conlang-muted'});
      this.paradigms.forEach((p,i)=>{
        const row=listEl.createDiv('conlang-para-row');
        row.createEl('span',{text:`[${p.type}] ${p.name}`,cls:'conlang-para-name'});
        row.createEl('span',{text:`${(p.slots||[]).length} slots`,cls:'conlang-muted'});
        const ac=row.createEl('span',{cls:'conlang-row-acts'});
        ac.createEl('button',{text:'✎',cls:'conlang-icon-btn'}).addEventListener('click',()=>this._editP(p,redraw));
        ac.createEl('button',{text:'✕',cls:'conlang-icon-btn conlang-del-btn'}).addEventListener('click',()=>{if(confirm(`Delete "${p.name}"?`)){this.paradigms.splice(i,1);redraw();}});
      });
    };
    redraw();
    const addWrap=contentEl.createDiv('conlang-para-addwrap');
    const TPLS={
      '6-form verb':{type:'conjugation',slots:[{key:'1sg',label:'1sg'},{key:'2sg',label:'2sg'},{key:'3sg',label:'3sg'},{key:'1pl',label:'1pl'},{key:'2pl',label:'2pl'},{key:'3pl',label:'3pl'}]},
      'Pres+Past verb':{type:'conjugation',slots:['prs.1sg','prs.2sg','prs.3sg','prs.1pl','prs.2pl','prs.3pl','pst.1sg','pst.2sg','pst.3sg','pst.1pl','pst.2pl','pst.3pl'].map(k=>({key:k,label:k}))},
      'Inf+Participles':{type:'conjugation',slots:[{key:'inf',label:'Infinitive'},{key:'prs.ptcp',label:'Pres.Ptcp'},{key:'pst.ptcp',label:'Past.Ptcp'},{key:'imp',label:'Imperative'}]},
    };
    Object.entries(TPLS).forEach(([name,tpl])=>{
      addWrap.createEl('button',{text:`+ ${name}`,cls:'conlang-icon-btn'}).addEventListener('click',()=>{
        this.paradigms.push({id:genId(),name,type:tpl.type,slots:tpl.slots.map(s=>({...s}))});
        redraw();
      });
    });
    addWrap.createEl('button',{text:'+ Custom',cls:'mod-cta'}).addEventListener('click',()=>{
      const p={id:genId(),name:'New Paradigm',type:'conjugation',slots:[]}; this.paradigms.push(p); this._editP(p,redraw);
    });
    const btnRow=contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button',{text:'Save',cls:'mod-cta'}).addEventListener('click',()=>{this.onSave(this.paradigms);this.close();});
    btnRow.createEl('button',{text:'Cancel'}).addEventListener('click',()=>this.close());
  }
  _editP(p,refresh){
    const m=new obsidian.Modal(this.app);
    m.onOpen=()=>{
      const {contentEl,modalEl}=m; modalEl.style.maxWidth='480px'; contentEl.empty();
      contentEl.createEl('h2',{text:`Edit: ${p.name}`});
      new obsidian.Setting(contentEl).setName('Name').addText(t=>t.setValue(p.name).onChange(v=>p.name=v));
      new obsidian.Setting(contentEl).setName('Type').addDropdown(d=>{d.addOption('conjugation','Conjugation (verbs)');d.addOption('declension','Declension (nouns/adj)');d.setValue(p.type);d.onChange(v=>p.type=v);});
      contentEl.createEl('h3',{text:'Slots'});
      const sl=contentEl.createDiv('conlang-slots-list');
      const rs=()=>{ sl.empty(); (p.slots||[]).forEach((s,i)=>{
        const row=sl.createDiv('conlang-slot-row');
        const ki=row.createEl('input',{type:'text',value:s.key,placeholder:'key',cls:'conlang-slot-key'});
        const li=row.createEl('input',{type:'text',value:s.label||s.key,placeholder:'label',cls:'conlang-slot-lbl'});
        row.createEl('button',{text:'×',cls:'conlang-icon-btn conlang-del-btn'}).addEventListener('click',()=>{p.slots.splice(i,1);rs();});
        ki.addEventListener('change',()=>s.key=ki.value); li.addEventListener('change',()=>s.label=li.value);
      }); };
      rs();
      contentEl.createEl('button',{text:'+ Add Slot'}).addEventListener('click',()=>{p.slots.push({key:`slot${p.slots.length+1}`,label:`Slot ${p.slots.length+1}`});rs();});
      contentEl.createDiv('conlang-modal-buttons').createEl('button',{text:'Done',cls:'mod-cta'}).addEventListener('click',()=>{m.close();refresh();});
    };
    m.onClose=()=>m.contentEl.empty(); m.open();
  }
  onClose(){this.contentEl.empty();}
}

class ConjugationFormModal extends obsidian.Modal {
  constructor(app, word, paradigms, onSave) {
    super(app); this.word=word; this.paradigms=paradigms.filter(p=>p.type==='conjugation');
    this.forms=JSON.parse(JSON.stringify(word.conjugationForms||{})); this.onSave=onSave;
  }
  onOpen(){
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='560px';
    contentEl.empty(); contentEl.createEl('h2',{text:`Conjugation: ${this.word.spelling||'(new)'}`});
    if(!this.paradigms.length){contentEl.createEl('p',{text:'No conjugation paradigms. Create one in the Paradigms tab.',cls:'conlang-muted'});contentEl.createDiv('conlang-modal-buttons').createEl('button',{text:'Close',cls:'mod-cta'}).addEventListener('click',()=>this.close());return;}
    const sel=contentEl.createEl('select',{cls:'conlang-conj-sel'});
    this.paradigms.forEach(p=>sel.createEl('option',{text:p.name,value:p.id}));
    const area=contentEl.createDiv('conlang-conj-area');
    const draw=()=>{
      area.empty(); const p=this.paradigms.find(x=>x.id===sel.value); if(!p)return;
      if(!this.forms[p.id]) this.forms[p.id]={};
      const grid=area.createDiv('conlang-conj-grid');
      (p.slots||[]).forEach(slot=>{
        const row=grid.createDiv('conlang-conj-row');
        row.createEl('label',{text:slot.label||slot.key,cls:'conlang-conj-lbl'});
        const inp=row.createEl('input',{type:'text',value:this.forms[p.id][slot.key]||'',placeholder:this.word.spelling||'',cls:'conlang-conj-input'});
        inp.addEventListener('input',()=>this.forms[p.id][slot.key]=inp.value);
      });
    };
    draw(); sel.addEventListener('change',draw);
    const btnRow=contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button',{text:'Copy as Markdown',cls:'conlang-copy-md-btn'}).addEventListener('click',()=>{
      const p=this.paradigms.find(x=>x.id===sel.value);
      if(!p){new obsidian.Notice('Select a paradigm first');return;}
      const md=conjToMarkdown({...this.word,conjugationForms:{[p.id]:this.forms[p.id]||{}}},this.paradigms);
      navigator.clipboard.writeText(md); new obsidian.Notice('Copied conjugation as Markdown!');
    });
    btnRow.createEl('button',{text:'Save',cls:'mod-cta'}).addEventListener('click',()=>{this.onSave(this.forms);this.close();});
    btnRow.createEl('button',{text:'Cancel'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

class DeclensionFormModal extends obsidian.Modal {
  constructor(app, word, dict, onSave) {
    super(app); this.word=word; this.cases=dict.cases||[]; this.numbers=dict.numbers||['sg','pl'];
    this.forms={...(word.declensionForms||{})}; this.onSave=onSave;
  }
  onOpen(){
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='560px';
    contentEl.empty(); contentEl.createEl('h2',{text:`Declension: ${this.word.spelling||'(new)'}`});
    if(!this.cases.length){contentEl.createEl('p',{text:'No cases defined. Use ⚙ → Dictionary Settings.',cls:'conlang-muted'});contentEl.createDiv('conlang-modal-buttons').createEl('button',{text:'Close',cls:'mod-cta'}).addEventListener('click',()=>this.close());return;}
    const table=contentEl.createEl('table',{cls:'conlang-decl-table'});
    const hr=table.createEl('thead').createEl('tr'); hr.createEl('th');
    this.numbers.forEach(n=>hr.createEl('th',{text:n.toUpperCase()}));
    const tbody=table.createEl('tbody');
    this.cases.forEach(c=>{
      const tr=tbody.createEl('tr'); tr.createEl('td',{text:c,cls:'conlang-decl-lbl'});
      this.numbers.forEach(n=>{
        const key=`${c.toLowerCase()}-${n}`;
        const inp=tr.createEl('td').createEl('input',{type:'text',value:this.forms[key]||'',placeholder:`${c}.${n}`,cls:'conlang-decl-inp'});
        inp.addEventListener('input',()=>this.forms[key]=inp.value);
      });
    });
    const btnRow=contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button',{text:'Copy as Markdown',cls:'conlang-copy-md-btn'}).addEventListener('click',()=>{
      navigator.clipboard.writeText(declToMarkdown({...this.word,declensionForms:this.forms},{cases:this.cases,numbers:this.numbers}));
      new obsidian.Notice('Copied declension as Markdown!');
    });
    btnRow.createEl('button',{text:'Save',cls:'mod-cta'}).addEventListener('click',()=>{this.onSave(this.forms);this.close();});
    btnRow.createEl('button',{text:'Cancel'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

class AncestryModal extends obsidian.Modal {
  constructor(app, word, dict, storage){ super(app); this.word=word; this.dict=dict; this.storage=storage; }
  onOpen(){
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='500px';
    contentEl.empty(); contentEl.createEl('h2',{text:`Ancestry: ${this.word.spelling}`});
    const chain=contentEl.createDiv('conlang-anc-chain');
    chain.createEl('p',{text:'Loading…',cls:'conlang-muted'});
    this._build(chain);
  }
  async _build(chain){
    chain.empty();
    const nodes=[{word:this.word,dict:this.dict}];
    let cd=this.dict,cw=this.word;
    for(let i=0;i<10;i++){
      if(!cd.parentDictionary||!cw.ancestorWordId) break;
      const pd=await this.storage.load(cd.parentDictionary); if(!pd) break;
      const pw=pd.words.find(w=>w.id===cw.ancestorWordId); if(!pw) break;
      nodes.push({word:pw,dict:pd}); cd=pd; cw=pw;
    }
    if(nodes.length===1&&!this.dict.parentDictionary){chain.createEl('p',{text:'No parent dictionary linked. Use ⚙ → Dictionary Settings.',cls:'conlang-muted'});}
    else if(nodes.length===1){chain.createEl('p',{text:'No ancestor word linked. Edit the word and set "Ancestor Word ID".',cls:'conlang-muted'});}
    else{
      [...nodes].reverse().forEach(({word:w,dict:d},i,arr)=>{
        const node=chain.createDiv('conlang-anc-node');
        node.createEl('span',{text:d.language||d.name,cls:'conlang-anc-dict'});
        const wEl=node.createEl('span',{cls:'conlang-anc-word'});
        wEl.createEl('strong',{text:w.spelling});
        if(w.pronunciation) wEl.appendText(` [${w.pronunciation}]`);
        if(w.translation) wEl.appendText(` "${w.translation}"`);
        if(i<arr.length-1) chain.createEl('div',{text:'↓',cls:'conlang-anc-arrow'});
      });
    }
    contentEl.createDiv('conlang-modal-buttons').createEl('button',{text:'Close',cls:'mod-cta'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

// ─── Helpers: Markdown Export & Thesaurus ─────────────────────────────────────
function conjToMarkdown(word, paradigms) {
  const lines=[`## Conjugation: ${word.spelling||'(word)'}`];
  const cps=(paradigms||[]).filter(p=>p.type==='conjugation');
  Object.entries(word.conjugationForms||{}).forEach(([pid,forms])=>{
    const p=cps.find(x=>x.id===pid); if(!p) return;
    if(!(p.slots||[]).some(s=>forms[s.key])) return;
    lines.push(`\n### ${p.name}`);
    lines.push('| Form | Value |'); lines.push('|------|-------|');
    (p.slots||[]).forEach(s=>{ if(forms[s.key]) lines.push(`| ${s.label||s.key} | ${forms[s.key]} |`); });
  });
  return lines.join('\n');
}

function declToMarkdown(word, dict) {
  const cases=dict.cases||[], nums=dict.numbers||['sg','pl'];
  const lines=[`## Declension: ${word.spelling||'(word)'}`];
  if(!cases.length){lines.push('*(No cases defined)*');return lines.join('\n');}
  lines.push('| | '+nums.map(n=>n.toUpperCase()).join(' | ')+' |');
  lines.push('|---|'+nums.map(()=>'---').join('|')+'|');
  cases.forEach(c=>{
    const cells=nums.map(n=>(word.declensionForms||{})[`${c.toLowerCase()}-${n}`]||'—');
    lines.push(`| **${c}** | ${cells.join(' | ')} |`);
  });
  return lines.join('\n');
}

function getFullThesaurus(dict) {
  const custom=(dict&&dict.customThesaurus)||[];
  const base=THESAURUS.map(cat=>{
    const cc=custom.find(c=>c.cat===cat.cat);
    return cc?{cat:cat.cat,entries:[...cat.entries,...(cc.entries||[])]}:cat;
  });
  const newCats=custom.filter(c=>!THESAURUS.some(t=>t.cat===c.cat));
  return [...base,...newCats];
}

// ─── Word Detail Modal (read-only, opened from embed clicks) ──────────────────
class WordDetailModal extends obsidian.Modal {
  constructor(app, word, dict) { super(app); this.word=word; this.dict=dict; }
  onOpen() {
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='560px';
    contentEl.empty(); contentEl.addClass('conlang-modal');
    const w=this.word, d=this.dict;
    const titleEl=contentEl.createDiv('conlang-detail-title');
    titleEl.createEl('span',{text:w.spelling,cls:'conlang-det-spelling'});
    if(w.pronunciation) titleEl.createEl('span',{text:` [${w.pronunciation}]`,cls:'conlang-det-ipa'});
    if(w.pos) titleEl.createEl('span',{text:w.pos,cls:'conlang-det-pos-badge'});
    if(w.gender) titleEl.createEl('span',{text:w.gender,cls:'conlang-gender-badge'});
    const add=(label,val)=>{ if(!val)return; const p=contentEl.createEl('p',{cls:'conlang-det-field'}); p.createEl('strong',{text:label+': '}); p.appendText(val); };
    add('Translation',w.translation); add('Definition',w.definition);
    add('Example',w.example); add('Root',w.root); add('Etymology',w.etymology);
    if(w.thesaurusCategory) add('Category',`${w.thesaurusCategory}${w.thesaurusEntry?' › '+w.thesaurusEntry:''}`);
    if(w.ancestorWordId) add('Ancestor ID',w.ancestorWordId);
    Object.entries(w.customFields||{}).forEach(([k,v])=>add(k,v));
    const paradigms=(d&&d.paradigms)||[];
    Object.entries(w.conjugationForms||{}).forEach(([pid,forms])=>{
      const p=paradigms.find(x=>x.id===pid); if(!p||!Object.values(forms).some(Boolean)) return;
      const sec=contentEl.createDiv('conlang-det-sec');
      const sh=sec.createDiv('conlang-det-sechdr');
      sh.createEl('strong',{text:`Conjugation — ${p.name}`});
      sh.createEl('button',{text:'Copy MD',cls:'conlang-copy-md-btn'}).addEventListener('click',()=>{ navigator.clipboard.writeText(conjToMarkdown(w,paradigms)); new obsidian.Notice('Copied!'); });
      const tbl=sec.createEl('table',{cls:'conlang-mini-table'});
      (p.slots||[]).forEach(s=>{if(!forms[s.key])return;const tr=tbl.createEl('tr');tr.createEl('td',{text:s.label||s.key,cls:'conlang-mini-lbl'});tr.createEl('td',{text:forms[s.key]});});
    });
    if(d&&Object.keys(w.declensionForms||{}).length){
      const cases=d.cases||[], nums=d.numbers||['sg','pl'];
      const sec=contentEl.createDiv('conlang-det-sec');
      const sh=sec.createDiv('conlang-det-sechdr');
      sh.createEl('strong',{text:'Declension'});
      sh.createEl('button',{text:'Copy MD',cls:'conlang-copy-md-btn'}).addEventListener('click',()=>{ navigator.clipboard.writeText(declToMarkdown(w,d)); new obsidian.Notice('Copied!'); });
      const tbl=sec.createEl('table',{cls:'conlang-mini-table conlang-decl-mini'});
      const hr=tbl.createEl('tr'); hr.createEl('th');
      nums.forEach(n=>hr.createEl('th',{text:n.toUpperCase()}));
      cases.forEach(c=>{const tr=tbl.createEl('tr');tr.createEl('td',{text:c,cls:'conlang-mini-lbl'});nums.forEach(n=>{const k=`${c.toLowerCase()}-${n}`;tr.createEl('td',{text:(w.declensionForms||{})[k]||'—'});});});
    }
    contentEl.createDiv('conlang-modal-buttons').createEl('button',{text:'Close',cls:'mod-cta'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

// ─── Thesaurus Editor Modal ───────────────────────────────────────────────────
class ThesaurusEditorModal extends obsidian.Modal {
  constructor(app, dict, onSave) { super(app); this.dict=dict; this.onSave=onSave; this.custom=JSON.parse(JSON.stringify(dict.customThesaurus||[])); }
  onOpen() {
    const {contentEl,modalEl}=this; modalEl.style.maxWidth='640px';
    contentEl.empty(); contentEl.createEl('h2',{text:'Customize Thesaurus'});
    contentEl.createEl('p',{text:'🔒 Built-in categories: you can add entries. ✦ Custom categories: fully editable.',cls:'conlang-hint'});
    const body=contentEl.createDiv('conlang-thes-editor-body');
    const redraw=()=>{
      body.empty();
      THESAURUS.forEach(baseCat=>{
        const cc=this.custom.find(c=>c.cat===baseCat.cat);
        const extras=(cc&&cc.entries)||[];
        const sec=body.createDiv('conlang-thes-ed-sec');
        const hdr=sec.createDiv('conlang-thes-ed-hdr');
        hdr.createEl('span',{text:'🔒 '+baseCat.cat,cls:'conlang-thes-ed-catname'});
        hdr.createEl('span',{text:`${baseCat.entries.length} built-in${extras.length?' + '+extras.length+' custom':''}`,cls:'conlang-muted'});
        if(extras.length){
          const extEl=sec.createDiv('conlang-thes-ed-extras');
          extras.forEach((e,ei)=>{
            const row=extEl.createDiv('conlang-thes-ed-entry');
            row.createEl('span',{text:e});
            row.createEl('button',{text:'×',cls:'conlang-icon-btn conlang-del-btn'}).addEventListener('click',()=>{ cc.entries.splice(ei,1); if(!cc.entries.length) this.custom=this.custom.filter(c=>c.cat!==baseCat.cat); redraw(); });
          });
        }
        const ar=sec.createDiv('conlang-thes-ed-addrow');
        const inp=ar.createEl('input',{type:'text',placeholder:'Add entry…',cls:'conlang-thes-ed-inp'});
        ar.createEl('button',{text:'Add',cls:'conlang-icon-btn'}).addEventListener('click',()=>{ const v=inp.value.trim(); if(!v)return; let c=this.custom.find(x=>x.cat===baseCat.cat); if(!c){c={cat:baseCat.cat,entries:[]};this.custom.push(c);} if(!c.entries.includes(v)) c.entries.push(v); inp.value=''; redraw(); });
      });
      this.custom.filter(c=>!THESAURUS.some(t=>t.cat===c.cat)).forEach(cat=>{
        const sec=body.createDiv('conlang-thes-ed-sec conlang-thes-ed-custom');
        const hdr=sec.createDiv('conlang-thes-ed-hdr');
        hdr.createEl('span',{text:'✦ ',cls:'conlang-thes-ed-custom-icon'});
        const ni=hdr.createEl('input',{type:'text',value:cat.cat,cls:'conlang-thes-ed-catinp'});
        ni.addEventListener('change',()=>cat.cat=ni.value.trim()||cat.cat);
        hdr.createEl('span',{text:cat.entries.length+' entries',cls:'conlang-muted'});
        hdr.createEl('button',{text:'Delete cat',cls:'conlang-icon-btn conlang-del-btn'}).addEventListener('click',()=>{ if(confirm(`Delete "${cat.cat}"?`)){this.custom=this.custom.filter(c=>c.cat!==cat.cat);redraw();} });
        const ee=sec.createDiv('conlang-thes-ed-extras');
        cat.entries.forEach((e,ei)=>{ const row=ee.createDiv('conlang-thes-ed-entry'); row.createEl('span',{text:e}); row.createEl('button',{text:'×',cls:'conlang-icon-btn conlang-del-btn'}).addEventListener('click',()=>{cat.entries.splice(ei,1);redraw();}); });
        const ar=sec.createDiv('conlang-thes-ed-addrow');
        const inp=ar.createEl('input',{type:'text',placeholder:'Add entry…',cls:'conlang-thes-ed-inp'});
        ar.createEl('button',{text:'Add',cls:'conlang-icon-btn'}).addEventListener('click',()=>{ const v=inp.value.trim(); if(!v)return; if(!cat.entries.includes(v)) cat.entries.push(v); inp.value=''; redraw(); });
      });
      const nr=body.createDiv('conlang-thes-ed-newcat');
      const ni=nr.createEl('input',{type:'text',placeholder:'New category name…',cls:'conlang-thes-ed-inp'});
      nr.createEl('button',{text:'+ New Category',cls:'mod-cta'}).addEventListener('click',()=>{ const v=ni.value.trim(); if(!v)return; if(THESAURUS.some(t=>t.cat===v)||this.custom.some(c=>c.cat===v)){new obsidian.Notice('Already exists');return;} this.custom.push({cat:v,entries:[]}); ni.value=''; redraw(); });
    };
    redraw();
    const btnRow=contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button',{text:'Save',cls:'mod-cta'}).addEventListener('click',()=>{this.onSave(this.custom);this.close();});
    btnRow.createEl('button',{text:'Cancel'}).addEventListener('click',()=>this.close());
  }
  onClose(){this.contentEl.empty();}
}

// ─── Storage ─────────────────────────────────────────────────────────────────
class DictionaryStorage {
  constructor(app, folder) {
    this.app = app;
    this.folder = folder;
    this._cache = {};
  }

  async ensureFolder() {
    if (!await this.app.vault.adapter.exists(this.folder))
      await this.app.vault.createFolder(this.folder);
  }

  _path(name) { return `${this.folder}/${name}.json`; }

  async list() {
    await this.ensureFolder();
    const { files } = await this.app.vault.adapter.list(this.folder);
    return (files || [])
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(this.folder + '/', '').replace('.json', ''));
  }

  async load(name) {
    try {
      const raw = await this.app.vault.adapter.read(this._path(name));
      this._cache[name] = JSON.parse(raw);
      return this._cache[name];
    } catch { return null; }
  }

  async save(dict) {
    await this.ensureFolder();
    dict.updatedAt = new Date().toISOString();
    this._cache[dict.name] = dict;
    await this.app.vault.adapter.write(this._path(dict.name), JSON.stringify(dict, null, 2));
  }

  async create(name, language) {
    const dict = {
      name, language: language || name,
      words: [], roots: [],
      soundChanges: [], paradigms: [],
      cases: [], numbers: ['sg','pl'],
      useCases: false, parentDictionary: null,
      useGenders: false, genders: [],
      customThesaurus: [],
      phonology: {
        consonants: [],
        vowels: [],
        syllableTemplates: [],
        onsetClusters: [],
        codaClusters: [],
        vowelHarmony: false,
        vowelGroups: [],
        phonotacticNotes: ''
      },
      orthography: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.save(dict);
    return dict;
  }

  async loadAll() {
    const names = await this.list();
    const out = {};
    for (const n of names) out[n] = await this.load(n);
    return out;
  }
}

// ─── Word Modal ───────────────────────────────────────────────────────────────
class WordModal extends obsidian.Modal {
  constructor(app, word, onSave) {
    super(app);
    this.word = word
      ? { ...word, customFields: { ...(word.customFields || {}) } }
      : { id: genId(), spelling:'', pronunciation:'', pos:'', translation:'',
          definition:'', example:'', root:'', etymology:'', gender:'',
          thesaurusCategory:'', thesaurusEntry:'', ancestorWordId:null,
          conjugationForms:{}, declensionForms:{},
          customFields:{}, createdAt: new Date().toISOString() };
    this.onSave = onSave;
    this.isEdit = !!word;
    this.dict = word?._dict || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('conlang-modal');
    contentEl.createEl('h2', { text: this.isEdit ? 'Edit Word' : 'Add Word' });

    const FIELDS = [
      ['spelling',      'Spelling *',              'e.g. valaris'],
      ['pronunciation', 'Pronunciation / IPA',     'e.g. /vaˈlaɾis/'],
      ['pos',           'Part of Speech',           'noun · verb · adj · adv …'],
      ['translation',   'Translation / Gloss',      'e.g. star'],
      ['definition',    'Extended Definition',      'Longer description …'],
      ['example',       'Example Sentence',         'e.g. Valaris enim nora.'],
      ['root',          'Root / Morpheme',          'e.g. val-'],
      ['etymology',     'Etymology',                'e.g. From Proto-X *walar'],
    ];

    FIELDS.forEach(([key, label, ph]) => {
      const setting = new obsidian.Setting(contentEl).setName(label).addText(t => {
        t.setPlaceholder(ph).setValue(this.word[key] || '');
        t.onChange(v => this.word[key] = v);
        if (key === 'spelling')      { this._spellInput = t; t.inputEl.style.fontWeight = '700'; }
        if (key === 'pronunciation')  { this._pronInput  = t; }
      });
      // Badge: Spelling character picker
      if (key === 'spelling') {
        const ctrl = setting.settingEl.querySelector('.setting-item-control');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = 'Abc±'; btn.title = 'Character Picker';
        btn.className = 'conlang-badge-btn';
        btn.addEventListener('click', () => new SpellingPickerModal(this.app, this._spellInput).open());
        ctrl.appendChild(btn);
      }
      // Badge: IPA Chart
      if (key === 'pronunciation') {
        const ctrl = setting.settingEl.querySelector('.setting-item-control');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = 'IPA'; btn.title = 'Open IPA Chart';
        btn.className = 'conlang-badge-btn conlang-ipa-badge';
        btn.addEventListener('click', () => new IPAChartModal(this.app, this._pronInput).open());
        ctrl.appendChild(btn);
      }
    });

    // ── Gender ──
    if (this.dict && this.dict.useGenders && (this.dict.genders||[]).length) {
      new obsidian.Setting(contentEl).setName('Gender').addDropdown(d=>{
        d.addOption('','— None —'); (this.dict.genders||[]).forEach(g=>d.addOption(g,g));
        d.setValue(this.word.gender||''); d.onChange(v=>this.word.gender=v);
      });
    }

    // ── Thesaurus Category ──
    const fullThes=getFullThesaurus(this.dict||{});
    const cats = fullThes.map(c=>c.cat);
    const catSetting = new obsidian.Setting(contentEl).setName('Thesaurus Category').addDropdown(d=>{
      d.addOption('','— None —'); cats.forEach(c=>d.addOption(c,c));
      d.setValue(this.word.thesaurusCategory||''); d.onChange(v=>{ this.word.thesaurusCategory=v; updateEntries(); });
    });
    const entrySetting = new obsidian.Setting(contentEl).setName('Thesaurus Entry').addDropdown(d=>{
      d.addOption('','— None —');
      const cat=fullThes.find(c=>c.cat===this.word.thesaurusCategory);
      (cat?cat.entries:[]).forEach(e=>d.addOption(e,e));
      d.setValue(this.word.thesaurusEntry||''); d.onChange(v=>this.word.thesaurusEntry=v);
    });
    const updateEntries=()=>{
      const sel=entrySetting.settingEl.querySelector('select');
      if(!sel)return; sel.innerHTML='<option value="">— None —</option>';
      const cat=fullThes.find(c=>c.cat===this.word.thesaurusCategory);
      (cat?cat.entries:[]).forEach(e=>{ const o=document.createElement('option'); o.value=o.textContent=e; if(e===this.word.thesaurusEntry)o.selected=true; sel.appendChild(o); });
    };

    // ── Ancestor Word (if parent dict linked) ──
    if (this.dict && this.dict.parentDictionary) {
      new obsidian.Setting(contentEl).setName('Ancestor Word ID').setDesc(`ID of this word's ancestor in "${this.dict.parentDictionary}" (copy from that word's detail view)`)
        .addText(t=>t.setValue(this.word.ancestorWordId||'').onChange(v=>this.word.ancestorWordId=v||null));
    }

    // ── Custom fields ──
    contentEl.createEl('h3', { text: 'Custom Fields', cls: 'conlang-cf-heading' });
    const cfWrap = contentEl.createDiv('conlang-cf-wrap');
    const renderCF = () => {
      cfWrap.empty();
      Object.entries(this.word.customFields).forEach(([k, v]) => {
        const row = cfWrap.createDiv('conlang-cf-row');
        const ki = row.createEl('input', { type:'text', placeholder:'Field name', value:k, cls:'conlang-cf-key' });
        const vi = row.createEl('input', { type:'text', placeholder:'Value', value:v, cls:'conlang-cf-val' });
        const del = row.createEl('button', { text:'×', cls:'conlang-cf-del' });
        ki.addEventListener('change', () => {
          delete this.word.customFields[k]; this.word.customFields[ki.value] = vi.value;
        });
        vi.addEventListener('change', () => { this.word.customFields[k] = vi.value; });
        del.addEventListener('click', () => { delete this.word.customFields[k]; renderCF(); });
      });
    };
    renderCF();
    const addCFBtn = contentEl.createEl('button', { text:'+ Add Custom Field', cls:'conlang-cf-add' });
    addCFBtn.addEventListener('click', () => {
      this.word.customFields[`field_${genId()}`] = '';
      renderCF();
    });

    // ── Buttons ──
    const btnRow = contentEl.createDiv('conlang-modal-buttons');
    const saveBtn = btnRow.createEl('button', { text:'Save', cls:'mod-cta' });
    saveBtn.addEventListener('click', () => {
      if (!this.word.spelling.trim()) { new obsidian.Notice('Spelling is required'); return; }
      // Clean up empty custom fields
      Object.keys(this.word.customFields).forEach(k => {
        if (!k.trim()) delete this.word.customFields[k];
      });
      this.onSave(this.word);
      this.close();
    });
    btnRow.createEl('button', { text:'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Root Modal ───────────────────────────────────────────────────────────────
class RootModal extends obsidian.Modal {
  constructor(app, root, onSave) {
    super(app);
    this.root = root ? { ...root } : { id:genId(), root:'', meaning:'', etymology:'', createdAt:new Date().toISOString() };
    this.onSave = onSave;
    this.isEdit = !!root;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.isEdit ? 'Edit Root' : 'Add Root' });
    [
      ['root',      'Root / Morpheme *', 'e.g. val-'],
      ['meaning',   'Meaning',           'e.g. light, radiance'],
      ['etymology', 'Etymology',         'e.g. Proto-X *walar'],
    ].forEach(([k, label, ph]) => {
      new obsidian.Setting(contentEl).setName(label).addText(t =>
        t.setPlaceholder(ph).setValue(this.root[k] || '').onChange(v => this.root[k] = v));
    });
    const btnRow = contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button', { text:'Save', cls:'mod-cta' }).addEventListener('click', () => {
      if (!this.root.root.trim()) { new obsidian.Notice('Root is required'); return; }
      this.onSave(this.root); this.close();
    });
    btnRow.createEl('button', { text:'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Create Dictionary Modal ──────────────────────────────────────────────────
class CreateDictModal extends obsidian.Modal {
  constructor(app, onSave) {
    super(app);
    this.data = { name:'', language:'' };
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text:'Create Conlang Dictionary' });
    new obsidian.Setting(contentEl)
      .setName('ID (file name)')
      .setDesc('No spaces. Used as the JSON filename.')
      .addText(t => t.setPlaceholder('e.g. Valyrian').onChange(v => {
        this.data.name = v.replace(/\s+/g,'-');
        if (!this.data.language) this.data.language = v;
      }));
    new obsidian.Setting(contentEl)
      .setName('Display Name')
      .addText(t => t.setPlaceholder('e.g. High Valyrian').onChange(v => this.data.language = v));
    const btnRow = contentEl.createDiv('conlang-modal-buttons');
    btnRow.createEl('button', { text:'Create', cls:'mod-cta' }).addEventListener('click', () => {
      if (!this.data.name) { new obsidian.Notice('Name required'); return; }
      this.onSave(this.data); this.close();
    });
    btnRow.createEl('button', { text:'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Word Generator Modal ─────────────────────────────────────────────────────
class WordGeneratorModal extends obsidian.Modal {
  constructor(app, dict, onGenerate) {
    super(app);
    this.dict = dict;
    this.onGenerate = onGenerate;
    this.count = 20;
    this.minSyll = 1;
    this.maxSyll = 3;
    this.assignPOS = '';
    this.assignThesaurus = false;
    this.preview = [];
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.width = '680px';
    modalEl.style.maxWidth = '95vw';
    contentEl.empty();
    contentEl.addClass('conlang-modal');
    contentEl.createEl('h2', { text: 'Generate Words' });

    // ── Parameters ──
    const params = contentEl.createDiv('conlang-gen-params');

    const row = (label) => {
      const s = new obsidian.Setting(params).setName(label);
      s.settingEl.style.borderBottom = 'none';
      s.settingEl.style.padding = '4px 0';
      return s;
    };

    row('Number of words').addText(t => {
      t.inputEl.type = 'number'; t.inputEl.min = '1'; t.inputEl.max = '500';
      t.setValue(String(this.count));
      t.onChange(v => this.count = Math.min(500, Math.max(1, parseInt(v) || 1)));
    });

    let maxSyllInput;
    row('Min syllables').addText(t => {
      t.inputEl.type = 'number'; t.inputEl.min = '1'; t.inputEl.max = '8';
      t.setValue(String(this.minSyll));
      t.onChange(v => { this.minSyll = Math.min(8, Math.max(1, parseInt(v) || 1)); });
    });
    row('Max syllables').addText(t => {
      t.inputEl.type = 'number'; t.inputEl.min = '1'; t.inputEl.max = '8';
      t.setValue(String(this.maxSyll));
      maxSyllInput = t.inputEl;
      t.onChange(v => { this.maxSyll = Math.min(8, Math.max(1, parseInt(v) || 1)); });
    });

    const POS_OPTIONS = ['','noun','verb','adjective','adverb','pronoun','preposition','conjunction','interjection','determiner','particle','other'];
    row('Part of Speech').addDropdown(d => {
      POS_OPTIONS.forEach(p => d.addOption(p, p || '(any)'));
      d.setValue(this.assignPOS);
      d.onChange(v => this.assignPOS = v);
    });

    row('Auto-assign thesaurus').addToggle(t => {
      t.setValue(this.assignThesaurus);
      t.onChange(v => this.assignThesaurus = v);
    });

    // ── Action buttons (top) ──
    const topBtns = contentEl.createDiv('conlang-gen-actions');
    const previewBtn = topBtns.createEl('button', { text: 'Preview' });
    const genBtn = topBtns.createEl('button', { text: 'Generate & Add', cls: 'mod-cta' });

    // ── Counter ──
    const counter = contentEl.createDiv('conlang-gen-count');
    counter.textContent = '';

    // ── Preview table ──
    const previewWrap = contentEl.createDiv('conlang-gen-preview');
    const table = previewWrap.createEl('table', { cls: 'conlang-gen-table' });
    const thead = table.createEl('thead').createEl('tr');
    ['✓','Spelling','IPA','POS','Translation'].forEach(h => thead.createEl('th', { text: h }));
    const tbody = table.createEl('tbody');

    const updateCounter = () => {
      const checked = this.preview.filter(w => w._checked).length;
      counter.textContent = `${checked} / ${this.preview.length} words selected`;
    };

    const renderPreview = () => {
      tbody.empty();
      this.preview.forEach((word, idx) => {
        const tr = tbody.createEl('tr');

        // Checkbox
        const chk = tr.createEl('td').createEl('input', { type: 'checkbox' });
        chk.checked = word._checked !== false;
        word._checked = chk.checked;
        chk.addEventListener('change', () => { word._checked = chk.checked; updateCounter(); });

        // Spelling (editable)
        const spInp = tr.createEl('td').createEl('input', { type: 'text', value: word.spelling });
        spInp.className = 'conlang-gen-table input[type="text"]';
        spInp.style.cssText = 'border:none;background:transparent;width:100%;font-size:13px;color:var(--text-normal);';
        spInp.addEventListener('input', () => { word.spelling = spInp.value; });

        // IPA (read-only)
        tr.createEl('td', { text: word.ipa });

        // POS
        const posInp = tr.createEl('td').createEl('input', { type: 'text', value: word.pos || '' });
        posInp.style.cssText = 'border:none;background:transparent;width:100%;font-size:13px;color:var(--text-normal);';
        posInp.addEventListener('input', () => { word.pos = posInp.value; });

        // Translation
        tr.createEl('td', { text: word.translation || '' });
      });
      updateCounter();
    };

    const runGenerate = () => {
      if (this.minSyll > this.maxSyll) this.maxSyll = this.minSyll;
      const phon = this.dict.phonology || {};
      const ortho = this.dict.orthography || [];
      const options = { minSyllables: this.minSyll, maxSyllables: this.maxSyll };
      const { words, exhausted } = generateUniqueWords(phon, ortho, this.count, this.dict.words || [], options);

      // Optionally assign thesaurus entries
      if (this.assignThesaurus) {
        const fullThes = getFullThesaurus(this.dict);
        const usedEntries = new Set((this.dict.words || []).map(w => (w.thesaurusEntry || '').toLowerCase()).filter(Boolean));
        const available = [];
        for (const cat of fullThes) {
          for (const entry of cat.entries) {
            if (!usedEntries.has(entry.toLowerCase())) available.push({ cat: cat.cat, entry });
          }
        }
        // Shuffle
        for (let i = available.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [available[i], available[j]] = [available[j], available[i]];
        }
        words.forEach((w, i) => {
          if (i < available.length) {
            w.translation = available[i].entry;
            w.thesaurusCategory = available[i].cat;
            w.thesaurusEntry = available[i].entry;
          }
        });
      }

      this.preview = words.map(w => ({
        ...w,
        pos: this.assignPOS || '',
        _checked: true,
        thesaurusCategory: w.thesaurusCategory || '',
        thesaurusEntry: w.thesaurusEntry || '',
        translation: w.translation || '',
      }));

      renderPreview();

      if (exhausted) {
        new obsidian.Notice(`Generated ${words.length}/${this.count} words. Phonology may be too restrictive for more unique words.`);
      }
    };

    previewBtn.addEventListener('click', () => runGenerate());

    genBtn.addEventListener('click', () => {
      const selected = this.preview.filter(w => w._checked !== false);
      if (!selected.length) { new obsidian.Notice('No words selected.'); return; }
      const wordObjs = selected.map(w => ({
        id: genId(),
        spelling: w.spelling,
        pronunciation: w.ipa,
        pos: w.pos || '',
        translation: w.translation || '',
        definition: '',
        example: '',
        root: '',
        etymology: 'Generated',
        gender: '',
        thesaurusCategory: w.thesaurusCategory || '',
        thesaurusEntry: w.thesaurusEntry || '',
        ancestorWordId: null,
        conjugationForms: {},
        declensionForms: {},
        customFields: {},
        createdAt: new Date().toISOString(),
      }));
      this.onGenerate(wordObjs);
      this.close();
    });

    // Regenerate button (below table)
    const regenBtn = contentEl.createEl('button', { text: 'Regenerate' });
    regenBtn.style.marginTop = '8px';
    regenBtn.addEventListener('click', () => runGenerate());

    // Auto-preview on open if phonology is ready
    const phon = this.dict.phonology || {};
    if (phon.consonants && phon.consonants.length && phon.vowels && phon.vowels.length && phon.syllableTemplates && phon.syllableTemplates.length) {
      runGenerate();
    }
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Dictionary Sidebar View ──────────────────────────────────────────────────
class DictionaryView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.dictName = null;
    this.dict = null;
    this.tab = 'words';
    this.q = '';
    this.posFilter = '';
    this.catFilter = '';
    this.genderFilter = '';
    this.sortField = 'spelling';
    this.sortDir = 1;
  }

  getViewType()    { return VIEW_TYPE_CONLANG; }
  getDisplayText() { return 'Conlang Dictionary'; }
  getIcon()        { return 'book'; }

  async onOpen()  { await this.render(); }
  async onClose() {}

  get pane() { return this.containerEl.children[1]; }

  async render() {
    const pane = this.pane;
    pane.empty();
    pane.addClass('conlang-pane');

    const names = await this.plugin.storage.list();

    // ── Empty state ──
    if (!names.length) {
      const empty = pane.createDiv('conlang-empty-state');
      empty.createEl('p', { text: 'No dictionaries yet.' });
      empty.createEl('button', { text:'+ Create Dictionary', cls:'mod-cta' })
        .addEventListener('click', () => this.doCreateDict());
      return;
    }

    if (!this.dictName || !names.includes(this.dictName)) this.dictName = names[0];
    if (!this.dict || this.dict.name !== this.dictName)
      this.dict = await this.plugin.storage.load(this.dictName);

    // ── Top bar ──
    const topBar = pane.createDiv('conlang-topbar');
    const sel = topBar.createEl('select', { cls:'conlang-select' });
    names.forEach(n => {
      const o = sel.createEl('option', { text:n, value:n });
      if (n === this.dictName) o.selected = true;
    });
    sel.addEventListener('change', async () => {
      this.dictName = sel.value; this.dict = null; this.q = ''; this.posFilter = ''; this.catFilter = ''; this.genderFilter = '';
      await this.render();
    });

    const acts = topBar.createDiv('conlang-actions');
    this._iconBtn(acts, '+', 'New Dictionary', () => this.doCreateDict());
    this._iconBtn(acts, '⬆', 'Import CSV (Vulgarlang)', () => this.doImport());
    this._iconBtn(acts, '⬇', 'Export CSV', () => this.doExport());
    this._iconBtn(acts, '{ }', 'Copy embed code', () => this.doCopyEmbed());
    this._iconBtn(acts, '⚙', 'Rename / Delete', (e) => this.doDictMenu(e));

    // ── Tabs ──
    const tabBar = pane.createDiv('conlang-tabs');
    const TABS = [
      ['words',    `Words (${this.dict.words.length})`],
      ['roots',    `Roots (${this.dict.roots.length})`],
      ['phonology','Phonology'],
      ['sounds',   `Sounds (${(this.dict.soundChanges||[]).length})`],
      ['paradigms',`Paradigms (${(this.dict.paradigms||[]).length})`],
    ];
    TABS.forEach(([t,label]) => {
      const btn = tabBar.createEl('button', { text:label, cls:'conlang-tab'+(this.tab===t?' is-active':'') });
      btn.addEventListener('click', () => { this.tab=t; this.render(); });
    });

    // ── Search bar ──
    const sb = pane.createDiv('conlang-searchbar');
    const si = sb.createEl('input', { type:'text', placeholder:'Search…', cls:'conlang-search-input' });
    si.value = this.q;
    si.addEventListener('input', () => { this.q = si.value; this.refreshList(); });

    if (this.tab === 'words') {
      const poses = [...new Set((this.dict.words||[]).map(w=>w.pos).filter(Boolean))].sort();
      if (poses.length) {
        const ps = sb.createEl('select', { cls:'conlang-pos-select' });
        ps.createEl('option', { text:'All POS', value:'' });
        poses.forEach(p => {
          const o = ps.createEl('option', { text:p, value:p });
          if (p === this.posFilter) o.selected = true;
        });
        ps.addEventListener('change', () => { this.posFilter = ps.value; this.refreshList(); });
      }
      const thCats = [...new Set((this.dict.words||[]).map(w=>w.thesaurusCategory).filter(Boolean))].sort();
      if (thCats.length) {
        const cs = sb.createEl('select', { cls:'conlang-pos-select' });
        cs.createEl('option', { text:'All categories', value:'' });
        thCats.forEach(c => { const o=cs.createEl('option',{text:c,value:c}); if(c===this.catFilter)o.selected=true; });
        cs.addEventListener('change', () => { this.catFilter=cs.value; this.refreshList(); });
      }
      if (this.dict.useGenders && (this.dict.genders||[]).length) {
        const gs = sb.createEl('select', { cls:'conlang-pos-select' });
        gs.createEl('option', { text:'All genders', value:'' });
        this.dict.genders.forEach(g => { const o=gs.createEl('option',{text:g,value:g}); if(g===this.genderFilter)o.selected=true; });
        gs.addEventListener('change', () => { this.genderFilter=gs.value; this.refreshList(); });
      }
    }

    if (this.tab === 'words') {
      sb.createEl('button', { text:'+ Word', cls:'mod-cta conlang-add-btn' }).addEventListener('click', ()=>this.doAddWord());
    } else if (this.tab === 'roots') {
      sb.createEl('button', { text:'+ Root', cls:'mod-cta conlang-add-btn' }).addEventListener('click', ()=>this.doAddRoot());
    }

    // ── List ──
    this._listEl = pane.createDiv('conlang-list');
    this.refreshList();
  }

  refreshList() {
    if (!this._listEl) return;
    this._listEl.empty();
    if (this.tab==='words') this._renderWords(this._listEl);
    else if (this.tab==='roots') this._renderRoots(this._listEl);
    else if (this.tab==='phonology') this._renderPhonology(this._listEl);
    else if (this.tab==='sounds') this._renderSounds(this._listEl);
    else if (this.tab==='paradigms') this._renderParadigms(this._listEl);
  }

  _renderWords(el) {
    let words = [...(this.dict.words||[])];
    const q = this.q.trim().toLowerCase();
    if (q) words = words.filter(w =>
      [w.spelling, w.translation, w.definition, w.pronunciation, w.pos]
        .some(s => s && s.toLowerCase().includes(q)));
    if (this.posFilter) words = words.filter(w => w.pos === this.posFilter);
    if (this.catFilter) words = words.filter(w => w.thesaurusCategory === this.catFilter);
    if (this.genderFilter) words = words.filter(w => w.gender === this.genderFilter);
    words.sort((a,b) => {
      const va=(a[this.sortField]||'').toLowerCase(), vb=(b[this.sortField]||'').toLowerCase();
      return va<vb ? -this.sortDir : va>vb ? this.sortDir : 0;
    });

    if (!words.length) { el.createEl('p', { text:'No entries found.', cls:'conlang-empty-msg' }); return; }

    // Header row
    const hdr = el.createDiv('conlang-list-header');
    [['spelling','Spelling'],['pronunciation','IPA'],['pos','POS'],['translation','Translation']].forEach(([f,lbl]) => {
      const s = hdr.createEl('span', {
        text: lbl + (this.sortField===f ? (this.sortDir>0?' ↑':' ↓') : ''),
        cls:'conlang-col-hdr'
      });
      s.addEventListener('click', () => {
        if (this.sortField===f) this.sortDir*=-1; else { this.sortField=f; this.sortDir=1; }
        this.refreshList();
      });
    });

    words.forEach(w => {
      const row = el.createDiv('conlang-word-row');
      row.createEl('span', { text:w.spelling,             cls:'conlang-cell conlang-spelling' });
      row.createEl('span', { text:w.pronunciation||'—',   cls:'conlang-cell conlang-ipa' });
      const posCell = row.createEl('span', { cls:'conlang-cell conlang-pos' });
      posCell.appendText(w.pos||'—');
      if (w.gender) posCell.createEl('span', { text:w.gender, cls:'conlang-gender-badge' });
      row.createEl('span', { text:w.translation||w.definition||'—', cls:'conlang-cell conlang-trans' });
      const ac = row.createEl('span', { cls:'conlang-row-acts' });
      this._iconBtn(ac,'✎','Edit',  e => { e.stopPropagation(); this.doEditWord(w); });
      const paradigms = this.dict.paradigms||[];
      if (paradigms.some(p=>p.type==='conjugation') && /^v(erb)?$/i.test(w.pos||''))
        this._iconBtn(ac,'⊞','Conjugation', e=>{ e.stopPropagation(); this.doConjugation(w); });
      if ((this.dict.useCases) && (this.dict.cases||[]).length)
        this._iconBtn(ac,'⊟','Declension', e=>{ e.stopPropagation(); this.doDeclension(w); });
      if (this.dict.parentDictionary)
        this._iconBtn(ac,'⊕','View Ancestry', e=>{ e.stopPropagation(); new AncestryModal(this.app,w,this.dict,this.plugin.storage).open(); });
      this._iconBtn(ac,'✕','Delete',e => { e.stopPropagation(); this.doDeleteWord(w); }, 'conlang-del-btn');

      row.addEventListener('click', () => this._toggleDetail(row, w));
    });
  }

  _toggleDetail(row, w) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('conlang-detail')) { next.remove(); return; }
    const d = document.createElement('div');
    d.className = 'conlang-detail';
    const add = (label, val) => {
      if (!val) return;
      const p = d.createEl('p');
      p.createEl('strong', { text: label + ': ' });
      p.appendText(val);
    };
    add('Definition', w.definition); add('Example', w.example);
    add('Root', w.root); add('Etymology', w.etymology);
    if (w.gender) add('Gender', w.gender);
    if (w.thesaurusCategory) add('Category', `${w.thesaurusCategory}${w.thesaurusEntry?' › '+w.thesaurusEntry:''}`);
    if (w.ancestorWordId) add('Ancestor ID', w.ancestorWordId);
    Object.entries(w.customFields||{}).forEach(([k,v]) => add(k, v));
    // Conjugation tables
    const paradigms = this.dict.paradigms||[];
    Object.entries(w.conjugationForms||{}).forEach(([pid,forms])=>{
      const p=paradigms.find(x=>x.id===pid); if(!p||!Object.values(forms).some(Boolean)) return;
      const sh=d.createDiv('conlang-det-sechdr');
      sh.createEl('strong',{text:`Conjugation — ${p.name}`});
      sh.createEl('button',{text:'Copy MD',cls:'conlang-copy-md-btn'}).addEventListener('click',e=>{e.stopPropagation();navigator.clipboard.writeText(conjToMarkdown(w,paradigms));new obsidian.Notice('Copied!');});
      const tbl=d.createEl('table',{cls:'conlang-mini-table'});
      (p.slots||[]).forEach(s=>{if(!forms[s.key])return;const tr=tbl.createEl('tr');tr.createEl('td',{text:s.label||s.key,cls:'conlang-mini-lbl'});tr.createEl('td',{text:forms[s.key]});});
    });
    // Declension table
    if(Object.keys(w.declensionForms||{}).length){
      const cases=this.dict.cases||[]; const nums=this.dict.numbers||['sg','pl'];
      const sh=d.createDiv('conlang-det-sechdr');
      sh.createEl('strong',{text:'Declension'});
      sh.createEl('button',{text:'Copy MD',cls:'conlang-copy-md-btn'}).addEventListener('click',e=>{e.stopPropagation();navigator.clipboard.writeText(declToMarkdown(w,this.dict));new obsidian.Notice('Copied!');});
      const tbl=d.createEl('table',{cls:'conlang-mini-table conlang-decl-mini'});
      const hr=tbl.createEl('tr'); hr.createEl('th');
      nums.forEach(n=>hr.createEl('th',{text:n.toUpperCase()}));
      cases.forEach(c=>{const tr=tbl.createEl('tr');tr.createEl('td',{text:c,cls:'conlang-mini-lbl'});nums.forEach(n=>{const k=`${c.toLowerCase()}-${n}`;tr.createEl('td',{text:(w.declensionForms||{})[k]||'—'});});});
    }
    if (!d.children.length) d.createEl('p', { text:'No additional info.', cls:'conlang-muted' });
    row.insertAdjacentElement('afterend', d);
  }

  _renderRoots(el) {
    let roots = [...(this.dict.roots||[])];
    const q = this.q.trim().toLowerCase();
    if (q) roots = roots.filter(r =>
      r.root.toLowerCase().includes(q) || (r.meaning||'').toLowerCase().includes(q));
    roots.sort((a,b) => a.root.localeCompare(b.root));

    if (!roots.length) { el.createEl('p', { text:'No roots found.', cls:'conlang-empty-msg' }); return; }

    const hdr = el.createDiv('conlang-list-header conlang-roots-header');
    ['Root','Meaning','Etymology'].forEach(t => hdr.createEl('span', { text:t, cls:'conlang-col-hdr' }));

    roots.forEach(r => {
      const row = el.createDiv('conlang-root-row');
      row.createEl('span', { text:r.root,          cls:'conlang-cell conlang-spelling' });
      row.createEl('span', { text:r.meaning||'—',  cls:'conlang-cell conlang-trans' });
      row.createEl('span', { text:r.etymology||'—',cls:'conlang-cell conlang-ipa' });
      const ac = row.createEl('span', { cls:'conlang-row-acts' });
      this._iconBtn(ac,'✎','Edit',  e=>{e.stopPropagation();this.doEditRoot(r);});
      this._iconBtn(ac,'✕','Delete',e=>{e.stopPropagation();this.doDeleteRoot(r);},'conlang-del-btn');
    });
  }

  // ── Sound Changes Tab ──
  _renderSounds(el) {
    const sc = this.dict.soundChanges = this.dict.soundChanges||[];
    const addBtn = el.createEl('button',{text:'+ New Rule Set',cls:'mod-cta conlang-sc-add'});
    if(!sc.length) el.createEl('p',{text:'No sound change rule sets yet. Create one to model diachronic evolution.',cls:'conlang-empty-msg'});
    sc.forEach((rs,rsi)=>{
      const sec=el.createDiv('conlang-sc-sec');
      const hdr=sec.createDiv('conlang-sc-hdr');
      hdr.createEl('span',{text:rs.name||'Rule Set',cls:'conlang-sc-name'});
      const ac=hdr.createDiv('conlang-sc-acts');
      this._iconBtn(ac,'▶','Preview result on all words',async()=>this._previewSC(rs));
      this._iconBtn(ac,'⎘','Apply → New Child Dictionary',async()=>this._applySC(rs));
      this._iconBtn(ac,'✕','Delete',()=>{if(confirm(`Delete "${rs.name}"?`)){sc.splice(rsi,1);this.plugin.storage.save(this.dict);this.render();}}, 'conlang-del-btn');
      const nameInp=sec.createEl('input',{type:'text',value:rs.name,placeholder:'Rule set name',cls:'conlang-sc-nameinp'});
      nameInp.addEventListener('change',()=>{rs.name=nameInp.value;this.plugin.storage.save(this.dict);});
      // Rules list
      rs.rules=rs.rules||[];
      const rulesEl=sec.createDiv('conlang-sc-rules');
      const drawRules=()=>{
        rulesEl.empty();
        const hrow=rulesEl.createDiv('conlang-sc-rulehdr');
        ['From','To','Environment','Description',''].forEach(h=>hrow.createEl('span',{text:h}));
        rs.rules.forEach((rule,ri)=>{
          const row=rulesEl.createDiv('conlang-sc-rule');
          const mk=(key,ph)=>{const i=row.createEl('input',{type:'text',value:rule[key]||'',placeholder:ph,cls:'conlang-sc-inp'});i.addEventListener('change',()=>{rule[key]=i.value;this.plugin.storage.save(this.dict);});return i;};
          mk('from','e.g. a'); mk('to','e.g. e'); mk('env','e.g. _i or #_'); mk('desc','description');
          row.createEl('button',{text:'×',cls:'conlang-icon-btn conlang-del-btn'}).addEventListener('click',()=>{rs.rules.splice(ri,1);this.plugin.storage.save(this.dict);drawRules();});
        });
        rulesEl.createEl('button',{text:'+ Add Rule',cls:'conlang-sc-addrule'}).addEventListener('click',()=>{rs.rules.push({id:genId(),from:'',to:'',env:'',desc:''});this.plugin.storage.save(this.dict);drawRules();});
      };
      drawRules();
    });
    addBtn.addEventListener('click',()=>{sc.push({id:genId(),name:'New Rule Set',rules:[]});this.plugin.storage.save(this.dict);this.render();});
  }

  _applyRule(word, rule) {
    const {from,to,env}=rule;
    if(!from) return word;
    try {
      const phon = this.dict.phonology || {};
      const vowels = (phon.vowels && phon.vowels.length)
        ? phon.vowels.map(v => v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')
        : 'aeiouáéíóúàèìòùäëïöüâêîôûæœ';
      const V = `(?:${vowels})`;
      const C = `(?:(?!${vowels})[^\\s])`;
      const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      let pre='',post='';
      if(env){
        const parts=env.split('_');
        pre=(parts[0]||'').replace('#','^(?:^|\\b)').replace(/V/g,V).replace(/C/g,C);
        post=(parts[1]||'').replace('#','(?:\\b|$)').replace(/V/g,V).replace(/C/g,C);
      }
      const pat=new RegExp(`(${pre})(${esc(from)})(${post})`, 'gi');
      return word.replace(pat,`$1${to}$3`);
    } catch { return word; }
  }

  async _previewSC(rs) {
    const words=this.dict.words.slice(0,50);
    const rows=words.map(w=>{
      let s=w.spelling;
      (rs.rules||[]).forEach(r=>{s=this._applyRule(s,r);});
      return `${w.spelling} → ${s}${w.translation?` (${w.translation})`:''}`;
    }).join('\n');
    new obsidian.Notice(`Preview (first 50):\n${rows}`, 8000);
  }

  async _applySC(rs) {
    const childName=`${this.dictName}-evolved`;
    const names=await this.plugin.storage.list();
    if(names.includes(childName)){new obsidian.Notice(`"${childName}" already exists.`);return;}
    const child=await this.plugin.storage.create(childName,`${this.dict.language||this.dictName} (evolved)`);
    child.parentDictionary=this.dictName;
    child.words=this.dict.words.map(w=>{
      let s=w.spelling;
      (rs.rules||[]).forEach(r=>{s=this._applyRule(s,r);});
      return {...w,id:genId(),spelling:s,ancestorWordId:w.id,conjugationForms:{},declensionForms:{},createdAt:new Date().toISOString()};
    });
    child.paradigms=JSON.parse(JSON.stringify(this.dict.paradigms||[]));
    child.cases=[...this.dict.cases]; child.numbers=[...this.dict.numbers]; child.useCases=this.dict.useCases;
    await this.plugin.storage.save(child);
    this.dictName=childName; this.dict=null;
    await this.render();
    new obsidian.Notice(`Created "${childName}" with ${child.words.length} evolved words.`);
  }

  // ── Paradigms Tab ──
  _renderParadigms(el) {
    const paradigms=this.dict.paradigms||[];
    el.createEl('p',{text:`${paradigms.length} paradigm(s) defined. Use them to conjugate verbs and decline nouns.`,cls:'conlang-hint'});
    el.createEl('button',{text:'Manage Paradigms',cls:'mod-cta'}).addEventListener('click',()=>{
      new ParadigmManagerModal(this.app,this.dict,async ps=>{
        this.dict.paradigms=ps; await this.plugin.storage.save(this.dict); this.render();
      }).open();
    });
    if(!paradigms.length) return;
    paradigms.forEach(p=>{
      const sec=el.createDiv('conlang-para-sec');
      sec.createEl('strong',{text:`[${p.type}] ${p.name}`});
      sec.createEl('span',{text:' — '+(p.slots||[]).map(s=>s.label||s.key).join(' · '),cls:'conlang-muted'});
    });
  }

  // ── Phonology Tab ──
  _renderPhonology(el) {
    const phon = this.dict.phonology = this.dict.phonology || {};
    phon.consonants    = phon.consonants    || [];
    phon.vowels        = phon.vowels        || [];
    phon.syllableTemplates = phon.syllableTemplates || [];
    phon.onsetClusters = phon.onsetClusters || [];
    phon.codaClusters  = phon.codaClusters  || [];
    if (phon.vowelHarmony === undefined) phon.vowelHarmony = false;
    phon.vowelGroups   = phon.vowelGroups   || [];
    if (phon.phonotacticNotes === undefined) phon.phonotacticNotes = '';
    this.dict.orthography = this.dict.orthography || [];
    const ortho = this.dict.orthography;
    const save = () => this.plugin.storage.save(this.dict);

    // ── Presets ──
    const presetSec = el.createDiv('conlang-phon-section');
    presetSec.createEl('h3', { text: 'Load Language Preset' });
    const presetRow = presetSec.createDiv();
    Object.keys(LANGUAGE_PRESETS).forEach(lang => {
      presetRow.createEl('button', { text: lang, cls: 'conlang-phon-preset-btn' }).addEventListener('click', async () => {
        const p = LANGUAGE_PRESETS[lang];
        phon.consonants = [...p.consonants];
        phon.vowels = [...p.vowels];
        phon.syllableTemplates = [...p.syllableTemplates];
        phon.onsetClusters = [...(p.onsetClusters || [])];
        phon.codaClusters = [...(p.codaClusters || [])];
        phon.vowelHarmony = p.vowelHarmony || false;
        phon.vowelGroups = p.vowelGroups ? p.vowelGroups.map(g => [...g]) : [];
        await save();
        this.refreshList();
      });
    });

    // ── Section A: Consonants ──
    const secA = el.createDiv('conlang-phon-section');
    secA.createEl('h3', { text: 'Consonants' });
    const cntRow = secA.createDiv();
    const cInp = cntRow.createEl('input', { type: 'text', cls: 'conlang-phon-input', placeholder: 'p b t d k g m n ŋ f v s z ʃ h l r j w' });
    cInp.value = phon.consonants.join(' ');
    const cCount = cntRow.createEl('div', { cls: 'conlang-phon-count', text: `${phon.consonants.length} consonants` });
    cInp.addEventListener('input', async () => {
      phon.consonants = cInp.value.split(/\s+/).filter(Boolean);
      cCount.textContent = `${phon.consonants.length} consonants`;
      await save();
    });
    secA.createEl('button', { text: 'IPA Picker', cls: 'conlang-phon-preset-btn' }).addEventListener('click', () => {
      new IPAPickerModal(this.app, phon.consonants, phon.vowels, async (newC, newV) => {
        phon.consonants = newC; phon.vowels = newV;
        cInp.value = newC.join(' ');
        cCount.textContent = `${newC.length} consonants`;
        vInp.value = newV.join(' ');
        vCount.textContent = `${newV.length} vowels`;
        await save();
      }).open();
    });

    // ── Section B: Vowels ──
    const secB = el.createDiv('conlang-phon-section');
    secB.createEl('h3', { text: 'Vowels' });
    const vRow = secB.createDiv();
    const vInp = vRow.createEl('input', { type: 'text', cls: 'conlang-phon-input', placeholder: 'a e i o u' });
    vInp.value = phon.vowels.join(' ');
    const vCount = vRow.createEl('div', { cls: 'conlang-phon-count', text: `${phon.vowels.length} vowels` });
    vInp.addEventListener('input', async () => {
      phon.vowels = vInp.value.split(/\s+/).filter(Boolean);
      vCount.textContent = `${phon.vowels.length} vowels`;
      await save();
    });
    const harmonyRow = secB.createDiv();
    const harmonyChk = harmonyRow.createEl('input', { type: 'checkbox' });
    harmonyChk.checked = phon.vowelHarmony;
    harmonyRow.createEl('label', { text: ' Vowel harmony' });
    harmonyChk.addEventListener('change', async () => {
      phon.vowelHarmony = harmonyChk.checked;
      secC.style.display = phon.vowelHarmony ? 'block' : 'none';
      await save();
    });

    // ── Section C: Vowel Groups ──
    const secC = el.createDiv('conlang-phon-section');
    secC.style.display = phon.vowelHarmony ? 'block' : 'none';
    secC.createEl('h3', { text: 'Vowel Groups' });
    const drawGroups = () => {
      secC.querySelectorAll('.conlang-phon-vgroup').forEach(n => n.remove());
      phon.vowelGroups.forEach((grp, gi) => {
        const row = secC.createDiv('conlang-phon-vgroup');
        const inp = row.createEl('input', { type: 'text', cls: 'conlang-phon-input', value: grp.join(' '), placeholder: 'a o u' });
        inp.style.width = '200px';
        inp.addEventListener('input', async () => { phon.vowelGroups[gi] = inp.value.split(/\s+/).filter(Boolean); await save(); });
        row.createEl('button', { text: '×', cls: 'conlang-icon-btn conlang-del-btn' }).addEventListener('click', async () => {
          phon.vowelGroups.splice(gi, 1); await save(); drawGroups();
        });
      });
    };
    drawGroups();
    secC.createEl('button', { text: '+ Add group' }).addEventListener('click', async () => {
      phon.vowelGroups.push([]); await save(); drawGroups();
    });

    // ── Section D: Syllable Structure ──
    const secD = el.createDiv('conlang-phon-section');
    secD.createEl('h3', { text: 'Syllable Structure' });
    const tplWrap = secD.createDiv('conlang-phon-templates');
    const drawTemplates = () => {
      tplWrap.empty();
      phon.syllableTemplates.forEach((tpl, ti) => {
        const chip = tplWrap.createDiv('conlang-phon-tpl');
        chip.createEl('span', { text: tpl });
        chip.createEl('button', { text: '×', cls: 'conlang-icon-btn' }).addEventListener('click', async () => {
          phon.syllableTemplates.splice(ti, 1); await save(); drawTemplates();
        });
      });
    };
    drawTemplates();
    const tplRow = secD.createDiv();
    const tplInp = tplRow.createEl('input', { type: 'text', placeholder: 'e.g. CV or CVC', cls: 'conlang-sc-inp' });
    tplInp.style.width = '120px';
    tplRow.createEl('button', { text: '+ Add' }).addEventListener('click', async () => {
      const v = tplInp.value.trim();
      if (v) { phon.syllableTemplates.push(v); tplInp.value = ''; await save(); drawTemplates(); }
    });
    secD.createEl('h4', { text: 'Onset clusters' });
    const onsetInp = secD.createEl('input', { type: 'text', cls: 'conlang-phon-input', placeholder: 'pl bl tr dr kr' });
    onsetInp.value = phon.onsetClusters.join(' ');
    onsetInp.addEventListener('input', async () => { phon.onsetClusters = onsetInp.value.split(/\s+/).filter(Boolean); await save(); });
    secD.createEl('h4', { text: 'Coda clusters' });
    const codaInp = secD.createEl('input', { type: 'text', cls: 'conlang-phon-input', placeholder: 'nt nd mp rk' });
    codaInp.value = phon.codaClusters.join(' ');
    codaInp.addEventListener('input', async () => { phon.codaClusters = codaInp.value.split(/\s+/).filter(Boolean); await save(); });

    // ── Section E: Orthography ──
    const secE = el.createDiv('conlang-phon-section');
    secE.createEl('h3', { text: 'Spelling Rules (IPA → Latin)' });
    secE.createEl('p', { text: 'Rules are applied longest-first. Phonemes without rules keep their IPA form.', cls: 'conlang-phon-count' });
    const orthoTable = secE.createEl('table', { cls: 'conlang-ortho-table' });
    const orthoHdr = orthoTable.createEl('thead').createEl('tr');
    ['IPA', 'Spelling', ''].forEach(h => orthoHdr.createEl('th', { text: h }));
    const orthoBody = orthoTable.createEl('tbody');
    const drawOrtho = () => {
      orthoBody.empty();
      ortho.forEach((rule, ri) => {
        const tr = orthoBody.createEl('tr');
        const ipaInp = tr.createEl('td').createEl('input', { type: 'text', value: rule.ipa, cls: 'conlang-sc-inp' });
        ipaInp.addEventListener('change', async () => { ortho[ri].ipa = ipaInp.value; await save(); });
        const spInp = tr.createEl('td').createEl('input', { type: 'text', value: rule.spelling, cls: 'conlang-sc-inp' });
        spInp.addEventListener('change', async () => { ortho[ri].spelling = spInp.value; await save(); });
        tr.createEl('td').createEl('button', { text: '×', cls: 'conlang-icon-btn conlang-del-btn' }).addEventListener('click', async () => {
          ortho.splice(ri, 1); await save(); drawOrtho();
        });
      });
    };
    drawOrtho();
    const orthoActRow = secE.createDiv();
    orthoActRow.createEl('button', { text: '+ Add rule' }).addEventListener('click', async () => {
      ortho.push({ ipa: '', spelling: '' }); await save(); drawOrtho();
    });
    orthoActRow.createEl('button', { text: 'Auto-fill from phonemes', cls: 'conlang-phon-preset-btn' }).addEventListener('click', async () => {
      const allPhonemes = [...phon.consonants, ...phon.vowels];
      const existing = new Set(ortho.map(r => r.ipa));
      allPhonemes.forEach(p => {
        if (!existing.has(p) && DEFAULT_SPELLING[p]) {
          ortho.push({ ipa: p, spelling: DEFAULT_SPELLING[p] });
          existing.add(p);
        }
      });
      await save(); drawOrtho();
    });

    // ── Section F: Phonotactic Notes ──
    const secF = el.createDiv('conlang-phon-section');
    secF.createEl('h3', { text: 'Phonotactic Notes' });
    const notesInp = secF.createEl('textarea', { cls: 'conlang-phon-input', placeholder: 'e.g. No /ŋ/ in word-initial position' });
    notesInp.rows = 4;
    notesInp.value = phon.phonotacticNotes || '';
    notesInp.addEventListener('input', async () => { phon.phonotacticNotes = notesInp.value; await save(); });

    // ── Section G: Word Generator ──
    const secG = el.createDiv('conlang-phon-section');
    secG.createEl('h3', { text: 'Word Generator' });
    secG.createEl('p', { text: 'Generate random words using the phonology defined above.', cls: 'conlang-phon-count' });
    const genBtn = secG.createEl('button', { text: 'Generate Words…', cls: 'mod-cta' });
    const phonReady = phon.consonants.length && phon.vowels.length && phon.syllableTemplates.length;
    if (!phonReady) {
      genBtn.disabled = true;
      genBtn.title = 'Define at least consonants, vowels, and one syllable template first.';
    }
    genBtn.addEventListener('click', () => {
      if (!phon.consonants.length || !phon.vowels.length || !phon.syllableTemplates.length) {
        new obsidian.Notice('Define at least consonants, vowels, and one syllable template before generating.');
        return;
      }
      new WordGeneratorModal(this.app, this.dict, async (words) => {
        words.forEach(w => this.dict.words.push(w));
        await this.plugin.storage.save(this.dict);
        this.plugin.rebuildHoverIndex();
        this.tab = 'words';
        this.render();
        new obsidian.Notice(`Generated ${words.length} word${words.length === 1 ? '' : 's'}.`);
      }).open();
    });
  }

  // ── Conjugation / Declension actions ──
  doConjugation(word) {
    new ConjugationFormModal(this.app, word, this.dict.paradigms||[], async forms=>{
      const i=this.dict.words.findIndex(w=>w.id===word.id);
      if(i>=0){this.dict.words[i].conjugationForms=forms;await this.plugin.storage.save(this.dict);this.render();}
    }).open();
  }

  doDeclension(word) {
    new DeclensionFormModal(this.app, word, this.dict, async forms=>{
      const i=this.dict.words.findIndex(w=>w.id===word.id);
      if(i>=0){this.dict.words[i].declensionForms=forms;await this.plugin.storage.save(this.dict);this.render();}
    }).open();
  }

  _iconBtn(parent, text, title, onClick, extraCls='') {
    const b = parent.createEl('button', { text, title, cls:'conlang-icon-btn '+(extraCls||'') });
    b.addEventListener('click', onClick);
    return b;
  }

  // ── Actions ──
  doAddWord() {
    const stub = { _dict: this.dict };
    new WordModal(this.app, stub, async w => {
      delete w._dict; this.dict.words.push(w);
      await this.plugin.storage.save(this.dict);
      this.plugin.rebuildHoverIndex(); this.render();
    }).open();
  }

  doEditWord(word) {
    const w2 = { ...word, _dict: this.dict };
    new WordModal(this.app, w2, async updated => {
      delete updated._dict;
      const i = this.dict.words.findIndex(w=>w.id===word.id);
      if (i>=0) this.dict.words[i] = updated;
      await this.plugin.storage.save(this.dict);
      this.plugin.rebuildHoverIndex(); this.render();
    }).open();
  }

  async doDeleteWord(word) {
    if (!confirm(`Delete "${word.spelling}"?`)) return;
    this.dict.words = this.dict.words.filter(w=>w.id!==word.id);
    await this.plugin.storage.save(this.dict);
    this.plugin.rebuildHoverIndex();
    this.render();
  }

  doAddRoot() {
    new RootModal(this.app, null, async r => {
      this.dict.roots.push(r);
      await this.plugin.storage.save(this.dict);
      this.render();
    }).open();
  }

  doEditRoot(root) {
    new RootModal(this.app, root, async updated => {
      const i = this.dict.roots.findIndex(r=>r.id===root.id);
      if (i>=0) this.dict.roots[i] = updated;
      await this.plugin.storage.save(this.dict);
      this.render();
    }).open();
  }

  async doDeleteRoot(root) {
    if (!confirm(`Delete root "${root.root}"?`)) return;
    this.dict.roots = this.dict.roots.filter(r=>r.id!==root.id);
    await this.plugin.storage.save(this.dict);
    this.render();
  }

  doCreateDict() {
    new CreateDictModal(this.app, async data => {
      await this.plugin.storage.create(data.name, data.language);
      this.dictName = data.name; this.dict = null;
      await this.render();
    }).open();
  }

  doImport() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv,text/csv';
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      const text = await file.text();
      const words = parseVulgarlangCSV(text);
      if (!words.length) { new obsidian.Notice('No words found in CSV.'); return; }
      const existing = new Set(this.dict.words.map(w=>w.spelling.toLowerCase()));
      const fresh = words.filter(w=>!existing.has(w.spelling.toLowerCase()));
      this.dict.words.push(...fresh);
      await this.plugin.storage.save(this.dict);
      this.plugin.rebuildHoverIndex();
      await this.render();
      new obsidian.Notice(`Imported ${fresh.length} words. (${words.length-fresh.length} duplicates skipped)`);
    });
    input.click();
  }

  doExport() {
    const csv = dictToCSV(this.dict);
    if (!csv) { new obsidian.Notice('Nothing to export.'); return; }
    const blob = new Blob([csv], { type:'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${this.dict.name}-dictionary.csv`; a.click();
    URL.revokeObjectURL(url);
    new obsidian.Notice(`Exported ${this.dict.words.length} words.`);
  }

  doCopyEmbed() {
    const code = `\`\`\`conlang-dict\nconlang: ${this.dictName}\nview: table\n\`\`\``;
    navigator.clipboard.writeText(code);
    new obsidian.Notice('Embed code copied!');
  }

  async doDictMenu(mouseEvent) {
    const names = await this.plugin.storage.list();
    const m = new obsidian.Menu();
    m.addItem(i=>i.setTitle('Rename display name…').setIcon('pencil').onClick(()=>{
      const n=prompt('New display name:',this.dict.language||this.dict.name);
      if(n){this.dict.language=n;this.plugin.storage.save(this.dict);this.render();}
    }));
    m.addItem(i=>i.setTitle('Dictionary Settings…').setIcon('settings').onClick(async()=>{
      const allNames=await this.plugin.storage.list();
      new DictSettingsModal(this.app,this.dict,allNames,async data=>{
        Object.assign(this.dict,data); await this.plugin.storage.save(this.dict); this.render();
      }).open();
    }));
    m.addSeparator();
    m.addItem(i=>i.setTitle("Import from Conlanger's Thesaurus…").setIcon('book-open').onClick(()=>{
      new ThesaurusImportModal(this.app,this.dict,async entries=>{
        const existing=new Set(this.dict.words.map(w=>(w.thesaurusEntry||'').toLowerCase()));
        let added=0;
        entries.forEach(e=>{
          if(existing.has(e.toLowerCase()))return;
          const cat=getFullThesaurus(this.dict).find(c=>c.entries.includes(e));
          this.dict.words.push({id:genId(),spelling:'',pronunciation:'',pos:'',translation:e,
            definition:'',example:'',root:'',etymology:'',
            thesaurusCategory:cat?cat.cat:'',thesaurusEntry:e,
            ancestorWordId:null,conjugationForms:{},declensionForms:{},customFields:{},
            createdAt:new Date().toISOString()});
          added++;
        });
        await this.plugin.storage.save(this.dict);
        this.plugin.rebuildHoverIndex();
        await this.render();
        new obsidian.Notice(`Added ${added} thesaurus entries.`);
      }).open();
    }));
    m.addItem(i=>i.setTitle('Manage Paradigms…').setIcon('list').onClick(()=>{
      new ParadigmManagerModal(this.app,this.dict,async ps=>{
        this.dict.paradigms=ps;await this.plugin.storage.save(this.dict);this.render();
      }).open();
    }));
    m.addItem(i=>i.setTitle('Customize Thesaurus…').setIcon('book').onClick(()=>{
      new ThesaurusEditorModal(this.app,this.dict,async custom=>{
        this.dict.customThesaurus=custom; await this.plugin.storage.save(this.dict); this.render();
      }).open();
    }));
    m.addSeparator();
    m.addItem(i=>i.setTitle('Delete dictionary…').setIcon('trash').onClick(async()=>{
      if(!confirm(`Permanently delete "${this.dictName}"?`))return;
      await this.plugin.storage.app.vault.adapter.remove(this.plugin.storage._path(this.dictName));
      this.dictName=null;this.dict=null;await this.render();
    }));
    m.showAtMouseEvent(mouseEvent);
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
class ConlangSettingsTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  async display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text:'Conlang Dictionary' });

    new obsidian.Setting(containerEl)
      .setName('Enable Hover Translation')
      .setDesc('Underline conlang words in notes and show a tooltip on hover.')
      .addToggle(t => t.setValue(this.plugin.settings.enableHoverTranslation).onChange(async v => {
        this.plugin.settings.enableHoverTranslation = v; await this.plugin.saveSettings();
      }));

    new obsidian.Setting(containerEl)
      .setName('Dictionary Folder')
      .setDesc('Vault folder where .json dictionaries are stored.')
      .addText(t => t.setValue(this.plugin.settings.dictionaryFolder).onChange(async v => {
        this.plugin.settings.dictionaryFolder = v.trim() || 'conlang-dictionaries';
        await this.plugin.saveSettings();
      }));

    containerEl.createEl('h3', { text:'Active Conlangs for Hover Translation' });
    containerEl.createEl('p', { text:'Only checked languages will be scanned in reading view.', cls:'setting-item-description' });

    const names = await this.plugin.storage.list();
    if (!names.length) { containerEl.createEl('p', { text:'No dictionaries found.', cls:'setting-item-description' }); return; }

    names.forEach(name => {
      new obsidian.Setting(containerEl).setName(name).addToggle(t =>
        t.setValue(this.plugin.settings.activeConlangs.includes(name)).onChange(async v => {
          if (v) this.plugin.settings.activeConlangs.push(name);
          else this.plugin.settings.activeConlangs = this.plugin.settings.activeConlangs.filter(n=>n!==name);
          await this.plugin.saveSettings();
          await this.plugin.rebuildHoverIndex();
        }));
    });
  }
}

// ─── Main Plugin ──────────────────────────────────────────────────────────────
class ConlangDictionaryPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.storage = new DictionaryStorage(this.app, this.settings.dictionaryFolder);
    this.hoverIndex = {};

    this.registerView(VIEW_TYPE_CONLANG, leaf => new DictionaryView(leaf, this));

    this.registerMarkdownCodeBlockProcessor('conlang-dict', (src, el, ctx) =>
      this.renderEmbedBlock(src, el, ctx));

    this.addCommand({ id:'open-conlang-dict', name:'Open Dictionary',
      callback: () => this.openView() });
    this.addCommand({ id:'conlang-add-word', name:'Add Word to Current Dictionary',
      callback: () => this.quickAddWord() });

    this.addRibbonIcon('book', 'Conlang Dictionary', () => this.openView());
    this.addSettingTab(new ConlangSettingsTab(this.app, this));

    // Hover post-processor
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (this.settings.enableHoverTranslation) this._applyHover(el);
    });

    // Tooltip container
    this._tooltip = null;

    await this.rebuildHoverIndex();
    this._injectCSS();
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CONLANG);
    document.getElementById('conlang-dict-css')?.remove();
    this._tooltip?.remove();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() { await this.saveData(this.settings); }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CONLANG);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_CONLANG, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async quickAddWord() {
    const names = await this.storage.list();
    if (!names.length) { new obsidian.Notice('No dictionaries. Create one first.'); return; }
    const dict = await this.storage.load(names[0]);
    new WordModal(this.app, null, async w => {
      dict.words.push(w);
      await this.storage.save(dict);
      this.rebuildHoverIndex();
      new obsidian.Notice(`"${w.spelling}" added to ${dict.name}`);
    }).open();
  }

  async rebuildHoverIndex() {
    this.hoverIndex = {};
    const active = this.settings.activeConlangs;
    const names = active.length ? active : await this.storage.list();
    for (const n of names) {
      const d = await this.storage.load(n);
      if (d) (d.words||[]).forEach(w => {
        if (w.spelling) this.hoverIndex[w.spelling.toLowerCase()] = {
          spelling:w.spelling, pronunciation:w.pronunciation, pos:w.pos,
          translation:w.translation||w.definition, example:w.example, dict:n
        };
      });
    }
  }

  _applyHover(el) {
    const idx = this.hoverIndex;
    if (!Object.keys(idx).length) return;

    const sortedKeys = Object.keys(idx).sort((a,b)=>b.length-a.length);
    const pattern = sortedKeys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    if (!pattern) return;
    const regex = new RegExp(`(?<![\\w])(${pattern})(?![\\w])`, 'gi');

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (['CODE','PRE','A','H1','H2','H3','H4','H5','H6'].includes(p.tagName))
          return NodeFilter.FILTER_REJECT;
        if (p.closest('code, pre, .conlang-hover-word')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(tn => {
      const text = tn.textContent;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = regex.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const entry = idx[m[0].toLowerCase()];
        const span = document.createElement('span');
        span.className = 'conlang-hover-word';
        span.textContent = m[0];
        span.addEventListener('mouseenter', e => this._showTip(e, entry));
        span.addEventListener('mouseleave', () => this._hideTip());
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  _showTip(e, entry) {
    this._hideTip();
    const tip = document.createElement('div');
    tip.id = 'conlang-tooltip'; tip.className = 'conlang-tooltip';

    const h = tip.createEl ? tip.createEl('div',{cls:'ct-spelling',text:entry.spelling})
                            : Object.assign(document.createElement('div'),{className:'ct-spelling',textContent:entry.spelling});
    if (!tip.createEl) tip.appendChild(h);

    const mk = (cls, text) => {
      if (!text) return;
      const d = document.createElement('div');
      d.className = cls; d.textContent = text;
      tip.appendChild(d);
    };
    mk('ct-spelling',  entry.spelling);
    mk('ct-ipa',       entry.pronunciation);
    mk('ct-pos',       entry.pos);
    mk('ct-trans',     entry.translation);
    mk('ct-example',   entry.example ? `"${entry.example}"` : '');

    // clear the first duplicate we accidentally created above
    tip.removeChild(tip.firstChild);

    document.body.appendChild(tip);
    this._tooltip = tip;

    const r = e.target.getBoundingClientRect();
    tip.style.left = r.left + 'px';
    tip.style.top  = (r.bottom + 6) + 'px';
    const tr = tip.getBoundingClientRect();
    if (tr.right > window.innerWidth - 8) tip.style.left = (window.innerWidth - tr.width - 8) + 'px';
    if (tr.bottom > window.innerHeight - 8) tip.style.top = (r.top - tr.height - 6) + 'px';
  }

  _hideTip() { this._tooltip?.remove(); this._tooltip = null; }

  // ─── Embed code block ──────────────────────────────────────────────────────
  async renderEmbedBlock(src, el, ctx) {
    const opts = {};
    src.split('\n').forEach(line => {
      const ci = line.indexOf(':');
      if (ci < 0) return;
      opts[line.slice(0,ci).trim()] = line.slice(ci+1).trim();
    });

    const name = opts.conlang;
    if (!name) { el.createEl('p',{text:'conlang-dict: missing `conlang: <name>`',cls:'conlang-error'}); return; }

    const dict = await this.storage.load(name);
    if (!dict) { el.createEl('p',{text:`Dictionary "${name}" not found.`,cls:'conlang-error'}); return; }

    let words = [...(dict.words||[])];

    // Static filters from block options
    if (opts.pos) words = words.filter(w=>(w.pos||'').toLowerCase()===opts.pos.toLowerCase());
    if (opts.cat) words = words.filter(w=>(w.thesaurusCategory||'').toLowerCase()===opts.cat.toLowerCase());
    if (opts.gender) words = words.filter(w=>(w.gender||'').toLowerCase()===opts.gender.toLowerCase());
    if (opts.root) words = words.filter(w=>(w.root||'').toLowerCase().includes(opts.root.toLowerCase()));
    if (opts.paradigm) {
      const paradigms=dict.paradigms||[];
      words=words.filter(w=>Object.keys(w.conjugationForms||{}).some(pid=>{ const p=paradigms.find(x=>x.id===pid); return p&&p.name.toLowerCase().includes(opts.paradigm.toLowerCase()); }));
    }
    if (opts.filter) {
      const [fk,...fvParts]=opts.filter.split('=');
      const fv=fvParts.join('=').trim().toLowerCase();
      words=words.filter(w=>String(w[fk.trim()]||'').toLowerCase()===fv);
    }

    // Sort
    const sortField=opts.sort||'spelling';
    words.sort((a,b)=>(a[sortField]||'').localeCompare(b[sortField]||''));
    if (opts.limit) words=words.slice(0,parseInt(opts.limit)||words.length);

    // Columns
    const COL_LABELS={spelling:'Spelling',pronunciation:'IPA',pos:'POS',translation:'Translation',definition:'Definition',example:'Example',root:'Root',etymology:'Etymology',gender:'Gender',thesaurusCategory:'Category',thesaurusEntry:'Entry'};
    const defaultCols=['spelling','pronunciation','pos','translation','definition'];
    const activeCols=opts.cols?opts.cols.split(',').map(c=>c.trim()).filter(c=>c in COL_LABELS):defaultCols;

    el.addClass('conlang-embed');

    // Header
    const hdr=el.createDiv('ce-header');
    hdr.createEl('span',{text:dict.language||dict.name,cls:'ce-title'});
    const countEl=hdr.createEl('span',{text:`${words.length} entries`,cls:'ce-count'});

    // Filter bar
    const filterBar=el.createDiv('ce-filterbar');
    const si=filterBar.createEl('input',{type:'text',placeholder:'Search…',cls:'ce-search-inline'});

    const allPoses=[...new Set(words.map(w=>w.pos).filter(Boolean))].sort();
    const allCats=[...new Set(words.map(w=>w.thesaurusCategory).filter(Boolean))].sort();
    const allGenders=(dict.useGenders&&dict.genders&&dict.genders.length)?dict.genders:[...new Set(words.map(w=>w.gender).filter(Boolean))].sort();

    let uiPos='',uiCat='',uiGender='';
    if(allPoses.length>1){ const ps=filterBar.createEl('select',{cls:'ce-filter-sel'}); ps.createEl('option',{text:'All POS',value:''}); allPoses.forEach(p=>ps.createEl('option',{text:p,value:p})); ps.addEventListener('change',()=>{uiPos=ps.value;redraw();}); }
    if(allCats.length>1){ const cs=filterBar.createEl('select',{cls:'ce-filter-sel'}); cs.createEl('option',{text:'All categories',value:''}); allCats.forEach(c=>cs.createEl('option',{text:c,value:c})); cs.addEventListener('change',()=>{uiCat=cs.value;redraw();}); }
    if(allGenders.length>0){ const gs=filterBar.createEl('select',{cls:'ce-filter-sel'}); gs.createEl('option',{text:'All genders',value:''}); allGenders.forEach(g=>gs.createEl('option',{text:g,value:g})); gs.addEventListener('change',()=>{uiGender=gs.value;redraw();}); }

    const tableWrap=el.createDiv('ce-table-wrap');

    const redraw=()=>{
      tableWrap.empty();
      let list=words;
      const sq=si.value.trim().toLowerCase();
      if(sq) list=list.filter(w=>(w.spelling||'').toLowerCase().includes(sq)||(w.translation||'').toLowerCase().includes(sq)||(w.definition||'').toLowerCase().includes(sq)||(w.pronunciation||'').toLowerCase().includes(sq));
      if(uiPos) list=list.filter(w=>w.pos===uiPos);
      if(uiCat) list=list.filter(w=>w.thesaurusCategory===uiCat);
      if(uiGender) list=list.filter(w=>w.gender===uiGender);
      countEl.textContent=`${list.length} entries`;
      if(!list.length){tableWrap.createEl('p',{text:'No entries.',cls:'conlang-empty-msg'});return;}
      const table=tableWrap.createEl('table',{cls:'conlang-table'});
      const tr=table.createEl('thead').createEl('tr');
      activeCols.forEach(c=>tr.createEl('th',{text:COL_LABELS[c]||c}));
      const tbody=table.createEl('tbody');
      list.forEach(w=>{
        const row=tbody.createEl('tr',{cls:'ce-clickable-row'});
        activeCols.forEach(c=>{
          const td=row.createEl('td');
          if(c==='spelling') td.createEl('span',{text:w.spelling||'',cls:'conlang-spelling'});
          else if(c==='pronunciation') td.createEl('span',{text:w.pronunciation||'',cls:'conlang-ipa'});
          else if(c==='pos') td.createEl('span',{text:w.pos||'',cls:'conlang-pos'});
          else if(c==='gender'&&w.gender) td.createEl('span',{text:w.gender,cls:'conlang-gender-badge'});
          else td.textContent=w[c]||'';
        });
        row.addEventListener('click',()=>new WordDetailModal(this.app,w,dict).open());
      });
    };

    redraw();
    si.addEventListener('input',()=>redraw());
  }

  // ─── CSS ──────────────────────────────────────────────────────────────────
  _injectCSS() {
    document.getElementById('conlang-dict-css')?.remove();
    const s = document.createElement('style');
    s.id = 'conlang-dict-css';
    s.textContent = `
/* ── Pane layout ── */
.conlang-pane { display:flex; flex-direction:column; height:100%; overflow-x:clip; overflow-y:hidden; min-height:0; font-size:13px; }
.conlang-topbar { display:flex; align-items:center; gap:4px; padding:5px 6px;
  border-bottom:1px solid var(--background-modifier-border); flex-wrap:wrap; }
.conlang-select { flex:1; min-width:80px; }
.conlang-actions { display:flex; gap:2px; flex-shrink:0; }

/* ── Buttons ── */
.conlang-icon-btn { padding:2px 5px; font-size:11px; cursor:pointer; border-radius:4px;
  background:var(--background-modifier-hover); border:1px solid var(--background-modifier-border);
  color:var(--text-muted); line-height:1.4; white-space:nowrap; }
.conlang-icon-btn:hover { background:var(--interactive-hover); color:var(--text-normal); }
.conlang-del-btn:hover  { background:var(--background-modifier-error); color:var(--text-error); }

/* ── Tabs ── */
.conlang-tabs { display:flex; padding:0 4px; border-bottom:1px solid var(--background-modifier-border);
  flex-wrap:nowrap; overflow-x:auto; }
.conlang-tab  { padding:6px 8px; background:none; border:none; border-bottom:2px solid transparent;
  cursor:pointer; color:var(--text-muted); font-size:12px; flex-shrink:0; white-space:nowrap; }
.conlang-tab.is-active { color:var(--text-accent); border-bottom-color:var(--text-accent); font-weight:600; }

/* ── Search bar ── */
.conlang-searchbar { display:flex; gap:4px; padding:4px 6px; align-items:center;
  border-bottom:1px solid var(--background-modifier-border); flex-wrap:wrap; }
.conlang-search-input { flex:1; min-width:80px; padding:3px 7px; border:1px solid var(--background-modifier-border);
  border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:12px; }
.conlang-pos-select { padding:2px 4px; font-size:11px; border-radius:4px; flex-shrink:0;
  border:1px solid var(--background-modifier-border); background:var(--background-primary);
  color:var(--text-normal); max-width:110px; }
.conlang-add-btn { font-size:12px; padding:3px 7px; white-space:nowrap; flex-shrink:0; }

/* ── List ── */
.conlang-list { flex:1; overflow-y:auto; }
.conlang-list-header { display:grid; grid-template-columns:1.6fr 1fr 0.7fr 2fr;
  padding:3px 8px; background:var(--background-secondary); font-size:11px;
  border-bottom:1px solid var(--background-modifier-border); position:sticky; top:0; z-index:1; }
.conlang-roots-header { grid-template-columns:1fr 2fr 2fr !important; }
.conlang-col-hdr { font-weight:600; color:var(--text-muted); cursor:pointer; user-select:none;
  text-transform:uppercase; letter-spacing:.4px; }
.conlang-col-hdr:hover { color:var(--text-normal); }

.conlang-word-row { display:grid; grid-template-columns:1.6fr 1fr 0.7fr 2fr;
  padding:5px 8px; border-bottom:1px solid var(--background-modifier-border);
  align-items:center; cursor:pointer; position:relative; }
.conlang-root-row { display:grid; grid-template-columns:1fr 2fr 2fr;
  padding:5px 8px; border-bottom:1px solid var(--background-modifier-border);
  align-items:center; cursor:pointer; position:relative; }
.conlang-word-row:hover, .conlang-root-row:hover { background:var(--background-modifier-hover); }

.conlang-cell   { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:6px; }
.conlang-spelling { font-weight:700; color:var(--text-accent); }
.conlang-ipa      { font-style:italic; color:var(--text-muted); font-size:12px; }
.conlang-pos      { font-size:11px; text-transform:uppercase; color:var(--text-muted); }
.conlang-trans    { color:var(--text-normal); }
.conlang-row-acts { position:absolute; right:6px; top:50%; transform:translateY(-50%);
  display:flex; gap:3px; opacity:0; pointer-events:none; transition:opacity .12s;
  background:var(--background-primary); padding:2px 4px; border-radius:4px;
  box-shadow:-16px 0 12px var(--background-primary); }
.conlang-word-row:hover .conlang-row-acts,
.conlang-root-row:hover .conlang-row-acts { opacity:1; pointer-events:auto; }

/* ── Detail expand ── */
.conlang-detail { padding:8px 16px 10px; background:var(--background-secondary);
  border-bottom:1px solid var(--background-modifier-border); font-size:13px; }
.conlang-detail p { margin:3px 0; color:var(--text-muted); }
.conlang-detail strong { color:var(--text-normal); }
.conlang-muted { color:var(--text-faint) !important; }

/* ── Empty / error ── */
.conlang-empty-state { padding:40px; text-align:center; color:var(--text-muted); }
.conlang-empty-msg   { text-align:center; color:var(--text-muted); padding:20px; }
.conlang-error { color:var(--text-error); padding:8px; }

/* ── Modals ── */
.conlang-modal-buttons { display:flex; gap:8px; justify-content:flex-end; margin-top:14px;
  padding-top:12px; border-top:1px solid var(--background-modifier-border); }
.conlang-cf-heading { margin:12px 0 4px; font-size:13px; }
.conlang-cf-wrap    { margin-bottom:6px; }
.conlang-cf-row     { display:flex; gap:6px; align-items:center; margin-bottom:5px; }
.conlang-cf-key     { width:130px; padding:4px 6px; border:1px solid var(--background-modifier-border);
  border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:12px; }
.conlang-cf-val     { flex:1; padding:4px 6px; border:1px solid var(--background-modifier-border);
  border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:12px; }
.conlang-cf-del     { padding:2px 6px; background:none; border:1px solid var(--background-modifier-border);
  border-radius:4px; cursor:pointer; color:var(--text-muted); font-size:13px; }
.conlang-cf-del:hover { background:var(--background-modifier-error); color:var(--text-error); }
.conlang-cf-add     { font-size:12px; margin-top:4px; }

/* ── Hover tooltip ── */
.conlang-hover-word { border-bottom:1px dotted var(--text-accent); cursor:help; }
.conlang-tooltip    { position:fixed; z-index:9999; padding:8px 12px; max-width:280px;
  background:var(--background-primary); border:1px solid var(--background-modifier-border);
  border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.35); pointer-events:none; }
.ct-spelling { font-weight:700; font-size:15px; color:var(--text-accent); }
.ct-ipa      { font-style:italic; color:var(--text-muted); font-size:12px; margin-top:1px; }
.ct-pos      { font-size:11px; text-transform:uppercase; color:var(--text-faint); letter-spacing:.4px; }
.ct-trans    { font-size:14px; margin-top:5px; color:var(--text-normal); font-weight:500; }
.ct-example  { font-style:italic; font-size:12px; color:var(--text-muted); margin-top:4px;
  border-top:1px solid var(--background-modifier-border); padding-top:4px; }

/* ── Embed block ── */
.conlang-embed { border:1px solid var(--background-modifier-border); border-radius:8px;
  overflow:hidden; margin:6px 0; }
.ce-header  { display:flex; justify-content:space-between; align-items:center;
  padding:7px 12px; background:var(--background-secondary);
  border-bottom:1px solid var(--background-modifier-border); }
.ce-title   { font-weight:700; font-size:14px; }
.ce-count   { font-size:12px; color:var(--text-muted); }
.ce-search  { width:100%; padding:5px 10px; border:none;
  border-bottom:1px solid var(--background-modifier-border);
  background:var(--background-primary); color:var(--text-normal); font-size:13px;
  outline:none; }
.ce-table-wrap { overflow-x:auto; }
.conlang-table { width:100%; border-collapse:collapse; font-size:13px; }
.conlang-table th { padding:5px 10px; background:var(--background-secondary); text-align:left;
  font-size:11px; text-transform:uppercase; color:var(--text-muted);
  border-bottom:1px solid var(--background-modifier-border); }
.conlang-table td { padding:5px 10px; border-bottom:1px solid var(--background-modifier-border); }
.conlang-table tr:last-child td { border-bottom:none; }
.conlang-table tr:hover td { background:var(--background-modifier-hover); }

/* ── Badge buttons in Word Modal ── */
.conlang-badge-btn { margin-left:6px; padding:2px 7px; font-size:11px; font-weight:600;
  cursor:pointer; border-radius:4px; border:1px solid var(--background-modifier-border);
  background:var(--background-secondary); color:var(--text-muted);
  vertical-align:middle; letter-spacing:.3px; }
.conlang-badge-btn:hover { background:var(--background-modifier-active-hover); color:var(--text-normal); }
.conlang-ipa-badge { color:var(--text-accent); border-color:var(--text-accent); }
.conlang-ipa-badge:hover { background:var(--text-accent); color:var(--background-primary); }

/* ── IPA Chart Modal ── */
.conlang-ipa-modal { padding-bottom:16px; }
.conlang-ipa-hdr  { margin-bottom:4px; }
.conlang-ipa-hdr h2 { margin:0 0 2px; }
.conlang-hint     { color:var(--text-muted); font-size:12px; margin:0 0 10px; }
.conlang-ipa-modal h3 { margin:14px 0 6px; font-size:13px; text-transform:uppercase;
  letter-spacing:.6px; color:var(--text-muted); }
.conlang-ipa-modal h4 { margin:8px 0 4px; font-size:12px; color:var(--text-muted);
  text-transform:uppercase; letter-spacing:.4px; }

/* Consonant table */
.conlang-ctable-wrap { overflow-x:auto; margin-bottom:4px; }
.conlang-ctable  { border-collapse:collapse; font-size:12px; white-space:nowrap; }
.conlang-ctable th { padding:3px 6px; background:var(--background-secondary); font-size:10px;
  text-transform:uppercase; color:var(--text-muted); border:1px solid var(--background-modifier-border);
  text-align:center; letter-spacing:.3px; }
.conlang-row-lbl { padding:3px 8px; font-size:11px; color:var(--text-muted); white-space:nowrap;
  border:1px solid var(--background-modifier-border); background:var(--background-secondary);
  font-weight:600; }
.conlang-ccell   { border:1px solid var(--background-modifier-border); padding:1px 3px;
  min-width:46px; text-align:center; }
.conlang-ccell-imp { background:repeating-linear-gradient(135deg,
    var(--background-secondary) 0px, var(--background-secondary) 4px,
    var(--background-modifier-border) 4px, var(--background-modifier-border) 5px);
  border:1px solid var(--background-modifier-border); min-width:46px; }

/* Symbol buttons (shared) */
.conlang-sym-btn { display:inline-flex; align-items:center; justify-content:center;
  min-width:26px; height:26px; padding:0 4px; font-size:15px; cursor:pointer;
  border:1px solid var(--background-modifier-border); border-radius:4px;
  background:var(--background-primary); color:var(--text-normal);
  margin:1px; font-family:inherit; transition:background .1s,transform .1s; }
.conlang-sym-btn:hover { background:var(--text-accent); color:var(--background-primary);
  transform:scale(1.15); z-index:1; position:relative; }
.conlang-sym-vl { margin-right:1px; }
.conlang-sym-vd { margin-left:1px; }
.conlang-sym-ph { display:inline-block; min-width:26px; height:26px; margin:1px; }

/* Vowel grid */
.conlang-vowel-grid { display:flex; flex-direction:column; gap:3px; margin-bottom:8px; }
.conlang-vowel-axis { display:flex; gap:4px; padding-left:90px; }
.conlang-vowel-col-lbl { flex:1; text-align:center; font-size:11px; color:var(--text-muted);
  text-transform:uppercase; }
.conlang-vowel-row  { display:flex; align-items:center; gap:4px; }
.conlang-vowel-lbl  { width:82px; text-align:right; font-size:11px; color:var(--text-muted);
  padding-right:6px; white-space:nowrap; }
.conlang-vowel-syms { display:flex; gap:2px; flex-wrap:wrap; }

/* Other sections */
.conlang-ipa-others { display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; }
.conlang-ipa-sec    { min-width:140px; }
.conlang-sym-grid   { display:flex; flex-wrap:wrap; gap:2px; }

/* ── Spelling Picker Modal ── */
.conlang-spell-modal h2 { margin-bottom:4px; }
.conlang-spell-search { width:100%; padding:7px 10px; font-size:14px; border-radius:6px;
  border:1px solid var(--background-modifier-border); background:var(--background-primary);
  color:var(--text-normal); margin:8px 0; }
.conlang-spell-results { min-height:60px; margin:6px 0; }
.conlang-spell-group-lbl { font-size:12px; color:var(--text-muted); margin:4px 0 6px; }
.conlang-spell-grid { gap:4px !important; }
.conlang-spell-btn  { font-size:17px !important; min-width:32px !important; height:32px !important; }
.conlang-sym-flash  { background:var(--text-accent) !important; color:var(--background-primary) !important; }
.conlang-spell-browse { display:flex; flex-wrap:wrap; gap:3px; padding-top:8px;
  border-top:1px solid var(--background-modifier-border); margin-top:8px; }
.conlang-base-btn { padding:2px 7px; font-size:13px; border-radius:4px; cursor:pointer;
  background:var(--background-secondary); border:1px solid var(--background-modifier-border);
  color:var(--text-normal); font-weight:600; }
.conlang-base-btn:hover { background:var(--interactive-hover); }

/* ── Thesaurus Modal ── */
.conlang-thes-modal h2 { margin-bottom:4px; }
.conlang-thes-selbar  { display:flex; align-items:center; gap:8px; margin:6px 0; flex-wrap:wrap; }
.conlang-thes-count   { color:var(--text-accent); font-size:12px; }
.conlang-thes-body    { max-height:55vh; overflow-y:auto; border:1px solid var(--background-modifier-border); border-radius:6px; padding:4px; }
.conlang-thes-sec     { margin-bottom:8px; }
.conlang-thes-hdr     { display:flex; align-items:center; gap:6px; padding:4px 6px; background:var(--background-secondary); border-radius:4px; cursor:pointer; }
.conlang-thes-cat     { font-weight:600; font-size:13px; }
.conlang-thes-grid    { display:flex; flex-wrap:wrap; gap:4px; padding:4px 6px 6px; }
.conlang-thes-lbl     { display:inline-flex; align-items:center; gap:4px; padding:2px 6px; font-size:12px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; }
.conlang-thes-lbl:hover { background:var(--background-modifier-hover); }
.conlang-thes-exists  { opacity:.4; cursor:default; }

/* ── Dict Settings Modal ── */
.conlang-preset-wrap { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:6px 0 10px; }
.conlang-preset-btn  { padding:2px 8px; font-size:11px; border-radius:4px; cursor:pointer;
  background:var(--background-secondary); border:1px solid var(--background-modifier-border); }
.conlang-preset-btn:hover { background:var(--interactive-hover); }

/* ── Paradigm Manager ── */
.conlang-para-list    { margin-bottom:10px; }
.conlang-para-row     { display:flex; align-items:center; gap:8px; padding:5px 6px;
  border-bottom:1px solid var(--background-modifier-border); }
.conlang-para-name    { flex:1; font-weight:600; font-size:13px; }
.conlang-para-addwrap { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
.conlang-para-sec     { padding:5px 8px; border-bottom:1px solid var(--background-modifier-border); font-size:13px; }
.conlang-slots-list   { margin:6px 0; }
.conlang-slot-row     { display:flex; gap:6px; align-items:center; margin-bottom:4px; }
.conlang-slot-key     { width:100px; padding:3px 6px; border:1px solid var(--background-modifier-border); border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:12px; }
.conlang-slot-lbl     { flex:1; padding:3px 6px; border:1px solid var(--background-modifier-border); border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:12px; }

/* ── Conjugation ── */
.conlang-conj-sel   { width:100%; padding:5px 8px; margin-bottom:10px; border-radius:4px;
  border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); }
.conlang-conj-area  { margin-bottom:8px; }
.conlang-conj-grid  { display:grid; grid-template-columns:1fr 1fr; gap:4px; }
.conlang-conj-row   { display:contents; }
.conlang-conj-lbl   { padding:4px 6px; font-size:12px; color:var(--text-muted); font-weight:600; align-self:center; }
.conlang-conj-input { padding:4px 8px; border:1px solid var(--background-modifier-border); border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:13px; }

/* ── Declension ── */
.conlang-decl-table { border-collapse:collapse; width:100%; font-size:13px; margin-bottom:10px; }
.conlang-decl-table th { padding:4px 8px; background:var(--background-secondary); text-align:center;
  border:1px solid var(--background-modifier-border); font-size:11px; text-transform:uppercase; }
.conlang-decl-lbl   { padding:4px 8px; font-weight:600; color:var(--text-muted); border:1px solid var(--background-modifier-border); white-space:nowrap; }
.conlang-decl-inp   { width:100%; padding:3px 6px; border:1px solid var(--background-modifier-border); border-radius:3px; background:var(--background-primary); color:var(--text-normal); font-size:13px; }
.conlang-decl-table td { border:1px solid var(--background-modifier-border); padding:2px 4px; }

/* ── Mini tables in detail ── */
.conlang-mini-table { border-collapse:collapse; font-size:12px; margin:4px 0; }
.conlang-mini-table td,.conlang-mini-table th { border:1px solid var(--background-modifier-border); padding:2px 6px; }
.conlang-mini-lbl   { font-weight:600; color:var(--text-muted); white-space:nowrap; }
.conlang-decl-mini th,.conlang-decl-mini td { text-align:center; min-width:60px; }

/* ── Ancestry ── */
.conlang-anc-chain { padding:8px 0; }
.conlang-anc-node  { display:flex; align-items:center; gap:8px; padding:6px 8px;
  border:1px solid var(--background-modifier-border); border-radius:6px; margin-bottom:2px;
  background:var(--background-secondary); }
.conlang-anc-dict  { font-size:11px; text-transform:uppercase; color:var(--text-muted); min-width:80px; }
.conlang-anc-word  { font-size:14px; }
.conlang-anc-arrow { font-size:18px; color:var(--text-accent); padding:4px 0; text-align:center; }

/* ── Sound Changes Tab ── */
.conlang-sc-add    { margin:8px; }
.conlang-sc-sec    { border:1px solid var(--background-modifier-border); border-radius:6px;
  margin:6px 8px; overflow:hidden; }
.conlang-sc-hdr    { display:flex; align-items:center; justify-content:space-between;
  padding:6px 10px; background:var(--background-secondary);
  border-bottom:1px solid var(--background-modifier-border); }
.conlang-sc-name   { font-weight:700; font-size:13px; }
.conlang-sc-acts   { display:flex; gap:4px; }
.conlang-sc-nameinp { width:100%; padding:5px 10px; border:none;
  border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary);
  color:var(--text-normal); font-size:13px; outline:none; }
.conlang-sc-rules  { padding:4px; }
.conlang-sc-rulehdr{ display:grid; grid-template-columns:1fr 1fr 1fr 2fr 30px;
  gap:4px; padding:3px 4px; font-size:10px; text-transform:uppercase;
  color:var(--text-muted); font-weight:600; }
.conlang-sc-rule   { display:grid; grid-template-columns:1fr 1fr 1fr 2fr 30px;
  gap:4px; padding:2px 4px; border-bottom:1px solid var(--background-modifier-border); }
.conlang-sc-inp    { padding:3px 6px; border:1px solid var(--background-modifier-border);
  border-radius:3px; background:var(--background-primary); color:var(--text-normal); font-size:12px; width:100%; }
.conlang-sc-addrule { margin:6px; font-size:12px; }

/* ── Gender badge ── */
.conlang-gender-badge { display:inline-block; margin-left:5px; padding:1px 5px; font-size:10px;
  font-weight:700; text-transform:uppercase; letter-spacing:.4px;
  background:var(--color-purple); color:#fff; border-radius:3px; vertical-align:middle; }

/* ── Copy MD button ── */
.conlang-copy-md-btn { padding:2px 8px; font-size:11px; cursor:pointer; border-radius:4px;
  border:1px solid var(--background-modifier-border); background:var(--background-secondary);
  color:var(--text-accent); font-weight:600; margin-left:8px; }
.conlang-copy-md-btn:hover { background:var(--text-accent); color:var(--background-primary); }

/* ── Detail section header (with Copy MD) ── */
.conlang-det-sechdr { display:flex; align-items:center; gap:4px; margin:6px 0 3px; }
.conlang-det-sec { margin-top:8px; }

/* ── Word Detail Modal ── */
.conlang-detail-title { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;
  margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--background-modifier-border); }
.conlang-det-spelling { font-size:22px; font-weight:800; color:var(--text-accent); }
.conlang-det-ipa { font-style:italic; color:var(--text-muted); font-size:15px; }
.conlang-det-pos-badge { padding:2px 6px; font-size:11px; font-weight:700; text-transform:uppercase;
  letter-spacing:.4px; background:var(--background-secondary); color:var(--text-muted);
  border-radius:4px; border:1px solid var(--background-modifier-border); }
.conlang-det-field { margin:4px 0; font-size:13px; color:var(--text-muted); }
.conlang-det-field strong { color:var(--text-normal); }

/* ── Thesaurus Editor Modal ── */
.conlang-thes-editor-body { max-height:60vh; overflow-y:auto; border:1px solid var(--background-modifier-border);
  border-radius:6px; padding:6px; margin:8px 0; }
.conlang-thes-ed-sec { border:1px solid var(--background-modifier-border); border-radius:5px;
  margin-bottom:8px; overflow:hidden; }
.conlang-thes-ed-sec.conlang-thes-ed-custom { border-color:var(--color-blue); }
.conlang-thes-ed-hdr { display:flex; align-items:center; gap:6px; padding:5px 8px;
  background:var(--background-secondary); flex-wrap:wrap; }
.conlang-thes-ed-catname { font-weight:600; font-size:13px; flex:1; }
.conlang-thes-ed-catinp { font-weight:600; font-size:13px; flex:1; padding:2px 5px;
  border:1px solid var(--background-modifier-border); border-radius:3px;
  background:var(--background-primary); color:var(--text-normal); }
.conlang-thes-ed-custom-icon { color:var(--color-blue); font-size:14px; }
.conlang-thes-ed-extras { display:flex; flex-wrap:wrap; gap:4px; padding:4px 8px; }
.conlang-thes-ed-entry { display:inline-flex; align-items:center; gap:3px; padding:2px 6px;
  background:var(--background-modifier-hover); border-radius:4px; font-size:12px;
  border:1px solid var(--background-modifier-border); }
.conlang-thes-ed-addrow { display:flex; gap:6px; padding:4px 8px 6px; }
.conlang-thes-ed-inp { flex:1; padding:4px 7px; border:1px solid var(--background-modifier-border);
  border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:12px; }
.conlang-thes-ed-newcat { display:flex; gap:8px; padding:8px 6px 4px;
  border-top:1px solid var(--background-modifier-border); margin-top:4px; }

/* ── Enhanced embed block ── */
.ce-filterbar { display:flex; gap:6px; padding:5px 8px; flex-wrap:wrap; align-items:center;
  border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary); }
.ce-search-inline { flex:1; min-width:120px; padding:4px 8px; border:1px solid var(--background-modifier-border);
  border-radius:4px; background:var(--background-primary); color:var(--text-normal); font-size:13px; outline:none; }
.ce-filter-sel { padding:3px 6px; font-size:12px; border-radius:4px;
  border:1px solid var(--background-modifier-border); background:var(--background-primary);
  color:var(--text-normal); }
.ce-clickable-row { cursor:pointer; }
.ce-clickable-row:hover td { background:var(--background-modifier-hover); }

/* ── Phonology tab ── */
.conlang-phon-section { margin-bottom:20px; }
.conlang-phon-section h3 { margin:0 0 8px; font-size:14px; font-weight:600; }
.conlang-phon-section h4 { margin:8px 0 4px; font-size:12px; font-weight:600; color:var(--text-muted); }
.conlang-phon-input { width:100%; font-family:'Noto Sans',sans-serif; font-size:15px; padding:6px 8px;
  border:1px solid var(--background-modifier-border); border-radius:4px;
  background:var(--background-primary); color:var(--text-normal); }
.conlang-phon-count { font-size:12px; color:var(--text-muted); margin-top:4px; }
.conlang-phon-templates { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.conlang-phon-tpl { display:flex; align-items:center; gap:4px; background:var(--background-modifier-form-field);
  border-radius:4px; padding:2px 6px; font-family:monospace; border:1px solid var(--background-modifier-border); }
.conlang-phon-tpl button { background:none; border:none; cursor:pointer; color:var(--text-muted); }
.conlang-phon-preset-btn { margin:0 6px 4px 0; padding:3px 10px; font-size:12px; border-radius:4px; cursor:pointer;
  background:var(--background-secondary); border:1px solid var(--background-modifier-border); color:var(--text-normal); }
.conlang-phon-preset-btn:hover { background:var(--interactive-hover); }
.conlang-phon-vgroup { display:flex; align-items:center; gap:6px; margin-bottom:4px; }

/* ── IPA Picker modal ── */
.conlang-ipa-cell { display:inline-block; text-align:center; padding:3px 5px; cursor:pointer;
  border-radius:3px; min-width:24px; font-size:14px; }
.conlang-ipa-cell:hover { background:var(--background-modifier-hover); }
.conlang-ipa-cell.is-selected { background:var(--interactive-accent); color:var(--text-on-accent); }
.conlang-ipa-hdr { font-weight:600; font-size:11px; color:var(--text-muted); text-align:center; padding:3px; }

/* ── Orthography table ── */
.conlang-ortho-table { width:100%; border-collapse:collapse; margin-bottom:8px; }
.conlang-ortho-table th { text-align:left; font-size:12px; color:var(--text-muted); padding:4px; }
.conlang-ortho-table td { padding:2px 4px; }
.conlang-ortho-table input { width:80px; }

/* ── Word Generator modal ── */
.conlang-gen-params { margin-bottom:16px; }
.conlang-gen-params .setting-item { border-bottom:none; padding:4px 0; }
.conlang-gen-preview { max-height:400px; overflow-y:auto; border:1px solid var(--background-modifier-border); border-radius:6px; }
.conlang-gen-table { width:100%; border-collapse:collapse; font-size:13px; }
.conlang-gen-table th { position:sticky; top:0; background:var(--background-secondary); padding:6px 8px; text-align:left; font-size:11px; color:var(--text-muted); text-transform:uppercase; }
.conlang-gen-table td { padding:4px 8px; border-bottom:1px solid var(--background-modifier-border); }
.conlang-gen-table tr:hover td { background:var(--background-modifier-hover); }
.conlang-gen-table input[type="text"] { border:none; background:transparent; width:100%; font-size:13px; color:var(--text-normal); }
.conlang-gen-table input[type="text"]:focus { outline:1px solid var(--interactive-accent); border-radius:2px; }
.conlang-gen-count { font-size:12px; color:var(--text-muted); margin:8px 0; }
.conlang-gen-actions { display:flex; gap:8px; margin-top:12px; }
`;


    document.head.appendChild(s);
  }
}

module.exports = ConlangDictionaryPlugin;
