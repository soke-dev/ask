/**
 * Cleans up a typed question before it is sent.
 *
 * This is a local, deterministic pass — not a model call. It does three
 * things, in order: corrects misspelt words, collapses accidental repeats,
 * and fixes casing and punctuation.
 *
 * Spelling correction is by edit distance against a frequency-ordered word
 * list, not by table lookup. A lookup table only ever fixes typos somebody
 * thought to enumerate; measuring distance fixes ones nobody predicted —
 * "halp" resolves to "help" without either word being paired up in advance.
 *
 * It deliberately will not rewrite or rephrase you. Turning "go check fuel"
 * into "Is there fuel available?" is a judgement about intent, and that
 * genuinely needs a model. To add one later, swap `tidyQuestion` for an async
 * call: the caller already treats it as a pure string-in / string-out step.
 */

/**
 * Frequency-ordered — earlier entries win ties, which is what makes "halp"
 * resolve to "help" rather than to the equally-close "half" or "hall".
 * Serves double duty: membership means a word is spelt correctly and must be
 * left alone, so proper nouns live here too.
 */
const RAW_VOCABULARY = `
the be to of and a in that have it for not on with as you do at this but his
by from they we say her she or an will my one all would there their what so
up out if about who get which go me when make can like time no just him know
take people into year your good some could them see other than then now look
only come its over think also back after use two how our work first well way
even new want because any give day most us is are was were has had does did
been am being he i we they me him us

help need know think see look go come get make take give find check ask tell
open close start stop wait show send buy sell pay walk drive call

very much many more less most least too enough almost really quite still yet
again ever never always often sometimes soon already here there where why how
what which who whom whose when while until before after during since always
each every both few several own same different next last other another
big small large little long short high low old new young fast slow early late
good bad better best worse worst right wrong true false real sure certain
easy hard heavy light clean dirty full empty open closed free busy quiet loud
hot cold warm cool dry wet cheap expensive rich poor safe dangerous
first second third fourth fifth half whole part piece side end start begin
one two three four five six seven eight nine ten eleven twelve twenty thirty
forty fifty hundred thousand million number amount total

say said tell told ask asked answer reply speak talk call called mean means
see saw look looking watch watched find found lose lost keep kept hold held
give gave take took get got put set let make made do does done go goes going
went gone come came coming leave left stay stayed wait waited move moved
buy bought sell sold pay paid cost spend spent send sent bring brought carry
eat ate drink drank cook cooked sleep slept walk walked run ran drive drove
ride rode stand stood sit sat live lived work worked play played help helped
check checked confirm confirmed verify verified show showed prove proof
open opened close closed start started stop stopped finish finished
know knew think thought believe want wanted need needed like liked love
try tried use used seem seems happen happened change changed
read write wrote hear heard feel felt understand remember forget
allow allowed close near reach reached return returned meet met

man woman boy girl child children people person family friend name
place area street road bridge junction corner bus stop park station mainland
house home shop store market mall office bank school church mosque hospital
restaurant hotel garage station city town village state country
day night morning afternoon evening today tomorrow yesterday week month year
hour minute second time date moment while
money cash price cost naira change balance fee charge payment
water food drink bread rice beans yam meat fish chicken egg milk sugar salt
oil pepper tomato onion plantain fruit vegetable soup stew snack
car bus taxi bike truck van motor engine tyre fuel petrol diesel gas
phone number message call light power electricity generator network
queue line crowd traffic jam delay accident flood rain sun weather
photo picture video camera proof evidence report answer question
security guard police officer driver seller trader customer worker
size bag bottle plate cup litre kilo bunch gallon pack piece
`;

/** Names and local words that must never be "corrected" into something else. */
const PROTECTED = `
nnpc ikeja lagos lekki surulere apapa yaba ikoyi oyingbo abuja ibadan benin
kano harcourt mainland island victoria airport ring oshodi alaba computer
bole suya jollof amala eba garri egusi akara puff plantain pepper
naira nimc nin usdc base cass republic slot shoprite
`
  .trim()
  .split(/\s+/);

/** Fixes edit distance alone cannot reach: shorthand and multi-edit slips. */
const CORRECTIONS: Record<string, string> = {
  u: 'you',
  ur: 'your',
  r: 'are',
  plz: 'please',
  pls: 'please',
  thx: 'thanks',
  abt: 'about',
  rn: 'right now',
  tmrw: 'tomorrow',
  asap: 'as soon as possible',
  alot: 'a lot',
  definately: 'definitely',
  tommorow: 'tomorrow',
  resturant: 'restaurant',
  restraunt: 'restaurant',
  avaliable: 'available',
  aviable: 'available',
};

/**
 * De-duplicated, first occurrence winning — the list is hand-ordered by
 * frequency and a word's index *is* its rank, so a repeat later in the text
 * must not be allowed to displace it.
 */
const VOCABULARY = Array.from(new Set(RAW_VOCABULARY.trim().split(/\s+/)));

const KNOWN = new Set([...VOCABULARY, ...PROTECTED]);

/** Openers that mean the sentence should end in a question mark. */
const QUESTION_OPENERS = new Set([
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will',
  'would', 'should', 'has', 'have', 'how', 'what', 'when', 'where', 'which',
  'who', 'why', 'any', 'anyone', 'anybody',
]);

/**
 * True when `a` becomes `b` in one insert, delete, substitute, or swap of
 * adjacent characters. Cheaper and stricter than a full distance matrix,
 * and one edit is the right threshold — two lets confident nonsense through.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diffs.push(i);
        if (diffs.length > 2) return false;
      }
    }
    if (diffs.length === 1) return true;
    if (diffs.length === 2) {
      const [i, j] = diffs;
      return j === i + 1 && a[i] === b[j] && a[j] === b[i];
    }
    return false;
  }

  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}

/**
 * Nearest correctly-spelt word, or null to leave the token untouched.
 *
 * The list is ordered by frequency, so the first match found is by definition
 * the most common one and the scan can stop there.
 */
function nearestWord(lower: string): string | null {
  // A word cut short is one of the most common phone typos and is far more
  // certain than any other single edit, so it is settled first: "bridg" is
  // "bridge", never the equally-close "bring".
  for (const candidate of VOCABULARY) {
    if (candidate.length === lower.length + 1 && candidate.startsWith(lower)) {
      return candidate;
    }
  }

  for (const candidate of VOCABULARY) {
    if (Math.abs(candidate.length - lower.length) > 1) continue;
    // On a short word, dropping a letter is a far more likely slip than
    // adding one, so never "correct" it into something even shorter —
    // that is how "wat" ends up as "at" instead of "what".
    if (lower.length <= 4 && candidate.length < lower.length) continue;
    if (withinOneEdit(lower, candidate)) return candidate;
  }

  return null;
}

/** Splits a token into its leading word and any trailing punctuation. */
function splitTrailing(token: string): [string, string] {
  const match = token.match(/^([\p{L}\p{N}']+)([^\p{L}\p{N}']*)$/u);
  return match ? [match[1], match[2]] : [token, ''];
}

function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function correctToken(word: string, isFirst: boolean): string {
  const lower = word.toLowerCase();

  const direct = CORRECTIONS[lower];
  if (direct) return matchCase(word, direct);

  if (KNOWN.has(lower)) return word;
  if (/\d/.test(word)) return word;
  // NNPC, NIN — an acronym is not a misspelling.
  if (word.length > 1 && word === word.toUpperCase()) return word;
  // A capital mid-sentence is usually a name we have never heard of.
  if (!isFirst && word[0] === word[0].toUpperCase()) return word;
  if (lower.length < 3) return word;

  const nearest = nearestWord(lower);
  return nearest ? matchCase(word, nearest) : word;
}

export function tidyQuestion(input: string): string {
  const collapsed = input.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  // Collapse stutters *before* correcting. "Halp Halp" is one repeated word
  // whichever way it is spelt, and de-duplicating first also means the
  // survivor is judged in its real position in the sentence.
  const deduped = collapsed
    .split(' ')
    .filter((token, i, all) => i === 0 || token.toLowerCase() !== all[i - 1].toLowerCase());

  const corrected = deduped.map((token, i) => {
    const [word, trailing] = splitTrailing(token);
    if (!word) return token;
    return correctToken(word, i === 0) + trailing;
  });

  const joined = corrected
    .join(' ')
    .replace(/\s+([?!.,])/g, '$1')
    .replace(/([?!.])\1+/g, '$1');

  const sentenceCased = joined[0].toUpperCase() + joined.slice(1);

  const firstWord = sentenceCased.split(' ')[0].toLowerCase().replace(/[^\p{L}]/gu, '');
  const endsWithPunctuation = /[?!.]$/.test(sentenceCased);

  if (!endsWithPunctuation && QUESTION_OPENERS.has(firstWord)) {
    return `${sentenceCased}?`;
  }

  return sentenceCased;
}
