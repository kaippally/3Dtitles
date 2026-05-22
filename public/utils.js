/**
 * Shared utility functions for 3D Titles
 */

function convertUnicodeToCustomASCII(unicodeText) {
  if (!unicodeText) return '';

  let text = unicodeText;

  // --- STEP 1: Unicode Normalization ---
  const normalizations = [
    ['ൺ', 'ണ്‍'],
    ['ൻ', 'ന്‍'],
    ['ർ', 'ര്‍'],
    ['ൽ', 'ല്‍'],
    ['ൾ', 'ള്‍'],
    ['ൿ', 'ക്‍'],

    // 2. Your existing standard ligatures/conjunct normalizations
    ['ൻറ', 'ന്റ'], ['ന്‍പ', 'മ്പ'], ['ററ', 'റ്റ'], ['റ്‍', 'ർ'],
    ['െെ', 'ൈ'], ['ാെ', 'ൊ'], ['ാേ', 'ോ'],
    ['ൌ', 'ൌ'], ['ൗെ', 'ൌ'], ['എെ', 'ഐ'], ['ഇൗ', 'ഈ'], ['ഉൗ', 'ഊ'], ['ഒൗ', 'ഔ']];
  normalizations.forEach(([from, to]) => {
    text = text.replace(new RegExp(from, 'g'), to);
  });

  if (text.normalize) {
    text = text.normalize('NFC');
  }

  // --- STEP 2: Pre-Vowels & Split Vowels (Left-Swings) ---
  const complexReplacements = [
    { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{|\[)ൊ/g, replace: 'æ$1Þ' },
    { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{|\[)ോ/g, replace: 'ç$1Þ' },
    { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{|\[)ൌ/g, replace: 'æ$1ì' },
    { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{|\[)െ/g, replace: 'æ$1' },
    { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{|\[)േ/g, replace: 'ç$1' },
    { pattern: /([ക-ഹ]|A|B|C|E|F|G|H|I|J|K|L|M|N|O|P|T|U|a|f|g|i|j|m|o|p|q|r|s|t|u|v|w|x|y|z|\{|\[)ൈ/g, replace: 'è$1' },
  ];
  complexReplacements.forEach(cfg => { text = text.replace(cfg.pattern, cfg.replace); });

  // --- STEP 3: Contextual Anusvaram Rule (The Fix) ---
  // Look for any Malayalam consonant followed directly by 'ം' and swap them to prevent deletion
  text = text.replace(/([ള])ം/g, '{\u0D02'); // Explicitly preserve 'ള' as '{' before converting 'ം'

  // --- STEP 4: Core Dictionary Mapping ---
  const dictionary = [
    ['ശ്ശ', '€'], ['ശ്ശം', 'Û'], ['വ്വ', 'Œ'], ['ച്ച', '‚'], ['ല്ല', 'ˆ'], ['്ല', 'ï'],
    ['ക്ക', 'A'], ['ങ്ങ', 'B'], ['ങ്ക', 'C'], ['ഞ്ഞ', 'E'], ['ഞ്ച', 'F'], ['ട്ട', 'G'],
    ['ണ്ണ', 'H'], ['ണ്ട', 'I'], ['ത്ത', 'J'], ['ന്ന', 'K'], ['ന്ത', 'L'], ['പ്പ', 'M'],
    ['മ്മ', 'N'], ['മ്പ', 'O'], ['ഗ്ഗ', 'P'], ['സ്സ', 'T'], ['ള്ള', 'U'], ['ര്‍', 'V'],
    ['ല്‍', 'W'], ['ന്‍', 'X'], ['ണ്‍', 'Y'], ['ള്‍', 'Z'], ['ന്റ', 'a'], ['്വ', 'b'],
    ['്യ', 'c'], ['്ര', 'd'], ['ക്ഷ', 'f'], ['ദ്ദ', 'g'], ['ദ്ധ', 'i'], ['ത്ഥ', 'j'],
    ['ണ്ഡ', 'm'], ['ഗ്ന', 'o'], ['ണ്മ', 'p'], ['ത്ഭ', 'q'], ['r', 'r'], ['ന്ഥ', 's'],
    ['ന്ധ', 't'], ['ഗ്മ', 'u'], ['ത്മ', 'v'], ['ന്ദ', 'w'], ['റ്റ', 'x'], ['ത്ന', 'y'],
    ['nm', 'z'], ['ള', '{'], ['മ്ല', '|'], ['ഖ', '~'], ['്', '¡'], ['ം', '¢'],
    ['ഃ', '£'], ['അ', '¥'], ['സ്ല', 'Š'], ['ഇ', '§'], ['ഉ', '©'], ['ഊ', 'ª'],
    ['ഋ', '«'], ['എ', '®'], ['ഏ', '¯'], ['ഐ', '°'], ['ഗ്ല', '±'], ['ഒ', '²'],
    ['ഓ', '³'], ['ക', 'µ'], ['ഖ', '¶'], ['ഗ', '·'], ['ങ', '¹'], ['ച', 'º'],
    ['ഛ', '»'], ['ട', '¿'], ['ഠ', 'À'], ['ഡ', 'Á'], ['ഢ', 'Â'], ['ണ', 'Ã'],
    ['ത', 'Ä'], ['ഥ', 'Å'], ['ദ', 'Æ'], ['ധ', 'Ç'], ['ന', 'È'], ['പ', 'É'],
    ['ഫ', 'Ë'], ['ബ', 'Ì'], ['ഭ', 'Í'], ['മ', 'Î'], ['യ', 'Ï'], ['ക്ല', 'Ð'],
    ['വ', 'Õ'], ['ശ', 'Ö'], ['×', 'ഷ'], ['ഷ', '×'], ['സ', 'Ø'], ['ഹ', 'Ù'],
    ['റ്റ', 'Ú'], ['ല', 'Ü'], ['ഴ', 'Ý'], ['റ', 'ù'], ['ആ', '¦'], ['ജ', '¼'],
    ['ഞ', '¾'],
    ['ാ', 'Þ'], ['ി', 'ß'], ['ീ', 'à'], ['ു', 'á'], ['ൂ', 'â'], ['ൃ', 'ã'],
    ['്', 'í'], ['ി', 'ò'], ['ു', 'ó'], ['ൂ', 'ô'], ['ര', 'ø']
  ];

  dictionary.forEach(([unicodeChar, asciiChar]) => {
    text = text.replace(new RegExp(unicodeChar, 'g'), asciiChar);

  });

  return text;
}

const gFontCache = {};

function loadFontShared(fontLoaderInstance, fontId, cb) {
  const url = fontId === 'helvetiker'
    ? '/vendor/fonts/helvetiker_regular.typeface.json'
    : '/fonts/' + fontId + '_typeface.json';

  if (gFontCache[url]) {
    cb(gFontCache[url]);
    return;
  }
  fontLoaderInstance.load(url, function (f) {
    gFontCache[url] = f;
    cb(f);
  }, undefined, function (e) {
    console.error('Shared FontLoader Error loading font:', fontId, e);
    cb(null);
  });
}

function getRenderingText(track) {
  let text = track.text || ' ';
  if (track.font && track.font.toLowerCase().includes('manorama')) {
    return convertUnicodeToCustomASCII(text);
  }
  return text;
}

function getTextGeometryOptions(track, font) {
  return {
    font: font,
    size: track.size * 0.65,
    height: track.depth * 0.65,
    curveSegments: 8,
    bevelEnabled: track.bevel,
    bevelThickness: 0.02,
    bevelSize: 0.015,
    bevelSegments: 3,
  };
}

