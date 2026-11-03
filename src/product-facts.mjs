const LIST_PREFIX = /^(?:[-+*](?:\s+|$)|[•●▪]\s*|\d+\.(?:\s+|$)|\d+[)）、]\s*|[（(]\d+[）)]\s*)/u;
const DIGIT = /\p{Nd}/u;

/** Extract supplied facts without rewriting numbers, units, or qualifications. */
export function extractProductFacts(text) {
  let source;
  try {
    source = String(text ?? '').slice(0, 20000);
  } catch {
    return [];
  }
  const lines = source.split(/\r\n?|\n/u).map(line => line.trim());
  // An explicit list already supplies fact boundaries; its commas often attach
  // explanations. Plain prose retains the existing comma-separated convention.
  const hasList = lines.some(line => LIST_PREFIX.test(line));
  const facts = [];
  const addFact = value => {
    const fact = value.trim().replace(LIST_PREFIX, '').trim();
    if (fact) facts.push(fact);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(LIST_PREFIX, '').trim();
    let depth = 0;
    let start = 0;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '(' || character === '（') depth++;
      else if (character === ')' || character === '）') depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const comma = character === ',' || character === '，';
        const numericComma = comma && DIGIT.test(line[index - 1] ?? '') && DIGIT.test(line[index + 1] ?? '');
        if (character === ';' || character === '；' || (comma && !hasList && !numericComma)) {
          addFact(line.slice(start, index));
          start = index + 1;
        }
      }
    }
    addFact(line.slice(start));
  }
  return facts;
}
