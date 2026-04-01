import type { SubtitleGuidelines } from "./subtitle-guidelines.js";

interface Token {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
}

interface Word {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
}

interface SubtitleSegment {
  index: number;
  start_ms: number;
  end_ms: number;
  lines: string[];
}

// ===== Word sets (all languages combined) =====

const CONJUNCTIONS = new Set([
  // Slovenian
  "in", "ali", "ter", "da", "ki", "ko", "če", "ker", "pa", "saj", "torej",
  "ampak", "vendar", "kadar", "čeprav", "dokler",
  // English
  "and", "but", "or", "that", "which", "when", "if", "because", "so", "then",
  "while", "although", "unless", "until", "where", "yet", "nor",
]);

const PREPOSITIONS = new Set([
  // Slovenian
  "v", "na", "s", "z", "k", "ob", "po", "za", "pri", "o", "iz", "med",
  "nad", "pod", "pred", "čez",
  // English
  "in", "on", "at", "to", "of", "for", "by", "with", "from", "the", "a", "an",
  "into", "onto", "upon", "about", "through",
]);

const AUXILIARIES = new Set([
  // Slovenian
  "sem", "si", "je", "smo", "ste", "so",
  "bi", "bo", "bom", "boš", "bodo", "bomo", "boste",
  "nisem", "nisi", "ni", "nismo", "niste", "niso",
  // English
  "is", "am", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "do", "does", "did",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
]);

const UNSTRANDABLE = new Set([
  // Slovenian
  "tudi", "še", "pa", "že", "le", "ne", "ni", "no", "ta", "to",
  "tako", "kar", "pol",
  // English
  "also", "still", "not", "very", "too", "just", "only", "even",
  "this", "these", "those",
]);

// ===== Merge sub-word tokens into words =====

function mergeTokensToWords(tokens: Token[]): Word[] {
  const words: Word[] = [];
  let current: Word | null = null;

  for (const t of tokens) {
    if (!current || t.text.startsWith(" ")) {
      if (current) words.push(current);
      current = {
        text: t.text.startsWith(" ") ? t.text.slice(1) : t.text,
        start_ms: t.start_ms,
        end_ms: t.end_ms,
        speaker: t.speaker,
      };
    } else {
      current.text += t.text;
      current.end_ms = t.end_ms;
    }
  }
  if (current && current.text) words.push(current);
  return words;
}

// ===== Abbreviation & date detection =====

const ABBREVIATIONS = new Set([
  // Titles
  "dr.", "prof.", "mr.", "mrs.", "ms.", "sr.", "jr.", "st.",
  "mag.", "ing.", "dipl.", "doc.", "phd.", "ddr.",
  // Common abbreviations
  "oz.", "npr.", "tj.", "itd.", "idr.", "sv.", "gl.",
  "etc.", "vs.", "vol.", "dept.", "corp.", "inc.", "ltd.",
  "approx.", "avg.", "dept.", "est.", "govt.", "max.", "min.",
  "no.", "tel.", "temp.",
]);

function isAbbreviation(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (ABBREVIATIONS.has(t)) return true;
  // Single letter + period (initials like "J." or "A.")
  if (/^[a-zA-ZčšžČŠŽ]\.$/.test(t)) return true;
  return false;
}

function isDateOrNumber(text: string): boolean {
  const t = text.trim();
  // Date patterns: "15.", "15.3.", "15.3.2025", "3.2025"
  // Also ordinal numbers in Slovenian/German: "1.", "2.", "33."
  if (/^\d+\.$/.test(t)) return true;
  if (/^\d+\.\d+\.?$/.test(t)) return true;
  if (/^\d+\.\d+\.\d+\.?$/.test(t)) return true;
  return false;
}

// ===== Punctuation helpers =====

function endsWithSentencePunc(text: string): boolean {
  const t = text.trim();
  if (!/[.!?]$/.test(t)) return false;
  // Period specifically needs extra checks — ! and ? are always sentence-ending
  if (t.endsWith("!") || t.endsWith("?")) return true;
  // Not a sentence end if it's an abbreviation or date/number
  if (isAbbreviation(t)) return false;
  if (isDateOrNumber(t)) return false;
  // Ellipsis-like patterns (already handled by …, but just in case)
  if (t.endsWith("...")) return true;
  return true;
}

function endsWithAnyPunc(text: string): boolean {
  const t = text.trim();
  if (!/[.!?,;:…]$/.test(t)) return false;
  // Don't treat abbreviations or dates as punctuated words
  if (t.endsWith(".") && (isAbbreviation(t) || isDateOrNumber(t))) return false;
  return true;
}

function wordHasPunc(word: string): boolean {
  return /[.!?,;:…]/.test(word);
}

function bareWord(word: string): string {
  return word.replace(/[.!?,;:…"""'']/g, "").toLowerCase();
}

// ===== Calculate text length for a range of words =====

function textLength(words: Word[], from: number, to: number): number {
  let len = 0;
  for (let i = from; i < to; i++) {
    if (i > from) len++; // space
    len += words[i].text.length;
  }
  return len;
}

// ===== STEP 1: Split words into speaker blocks =====

interface SpeakerBlock {
  speaker: string | undefined;
  words: Word[];
  start_ms: number;
  end_ms: number;
}

function splitBySpeaker(words: Word[]): SpeakerBlock[] {
  if (words.length === 0) return [];
  const blocks: SpeakerBlock[] = [];
  let cur: SpeakerBlock = {
    speaker: words[0].speaker,
    words: [words[0]],
    start_ms: words[0].start_ms,
    end_ms: words[0].end_ms,
  };

  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w.speaker !== cur.speaker) {
      blocks.push(cur);
      cur = { speaker: w.speaker, words: [w], start_ms: w.start_ms, end_ms: w.end_ms };
    } else {
      cur.words.push(w);
      cur.end_ms = w.end_ms;
    }
  }
  blocks.push(cur);
  return blocks;
}

// ===== STEP 2: Segment a single speaker's words into subtitles =====

function segmentSpeakerBlock(words: Word[], g: SubtitleGuidelines): Word[][] {
  const subtitles: Word[][] = [];
  let i = 0;

  while (i < words.length) {
    let end = i;

    while (end < words.length) {
      const nextEnd = end + 1;
      const charLen = textLength(words, i, nextEnd);
      const duration = words[nextEnd - 1].end_ms - words[i].start_ms;

      // Hard limits
      if (charLen > g.maxTotalChars && end > i) break;
      if (duration > g.maxDurationMs && end > i) break;

      end = nextEnd;

      const lastWord = words[end - 1];

      // Sentence end — strong break point
      if (endsWithSentencePunc(lastWord.text)) {
        if (end >= words.length) break; // last word, done

        const nextWord = words[end];
        const nextBare = bareWord(nextWord.text);
        const nextStartsUpper = nextWord.text[0] === nextWord.text[0].toUpperCase() && nextWord.text[0] !== nextWord.text[0].toLowerCase();

        // ALWAYS break if next word starts a new sentence (uppercase)
        // or is a conjunction
        if (nextStartsUpper || CONJUNCTIONS.has(nextBare)) break;

        // Only absorb remainder if it's very short and fits
        if (charLen > 15) {
          const remainingLen = textLength(words, end, words.length);
          const nextCharLen = textLength(words, i, end + 1);
          if (remainingLen < 15 && nextCharLen <= g.maxTotalChars) {
            continue; // absorb short remainder
          }
          break;
        }
      }

      // Pause gap — but only if remainder wouldn't be too short
      if (end < words.length) {
        const gap = words[end].start_ms - lastWord.end_ms;
        if (gap > g.pauseThresholdMs && charLen > 10) {
          // Check if next word is a tiny sentence-ending fragment (e.g. "ja." after "istočasno,")
          // that just completes the current clause — absorb it instead of orphaning it
          const peekWord = words[end];
          const peekLen = peekWord.text.length;
          const absorbedLen = textLength(words, i, end + 1);
          if (peekLen <= 5 && endsWithSentencePunc(peekWord.text) && absorbedLen <= g.maxTotalChars) {
            continue; // absorb tiny sentence-ending word
          }

          const remainingLen = textLength(words, end, words.length);
          // Don't break if remainder is too short and would fit
          if (remainingLen < 15 && charLen + 1 + remainingLen <= g.maxTotalChars) {
            continue; // absorb the short remainder
          }
          break;
        }
      }
    }

    // Refine the break point
    end = refineBreakPoint(words, i, end, g);
    if (end <= i) end = i + 1;

    subtitles.push(words.slice(i, end));
    i = end;
  }

  // Post-process 1: split any subtitle that has "sentence. NewSentence" pattern
  let processed: Word[][] = [];
  for (const sub of subtitles) {
    const splitAt = findSentenceBoundarySplit(sub);
    if (splitAt > 0 && splitAt < sub.length) {
      processed.push(sub.slice(0, splitAt));
      processed.push(sub.slice(splitAt));
    } else {
      processed.push(sub);
    }
  }

  // Post-process 2: merge tiny subtitles (< 15 chars) forward into next
  // Never merge backward across sentence boundaries
  const merged: Word[][] = [];
  for (let j = 0; j < processed.length; j++) {
    let sub = processed[j];
    let len = textLength(sub, 0, sub.length);

    // If tiny and ends with sentence punctuation (e.g. "ja."), prefer merging
    // backward — it completes the previous sentence, not starts a new one
    if (len < 15 && merged.length > 0) {
      const lastWord = sub[sub.length - 1];
      const prevLastWord = merged[merged.length - 1][merged[merged.length - 1].length - 1];
      // Merge backward if: this fragment ends the previous sentence
      // (previous ends with comma/no sentence punc, this fragment ends with sentence punc)
      if (endsWithSentencePunc(lastWord.text) && !endsWithSentencePunc(prevLastWord.text)) {
        const prev = merged[merged.length - 1];
        const combinedLen = textLength(prev, 0, prev.length) + 1 + len;
        if (combinedLen <= g.maxTotalChars) {
          merged[merged.length - 1] = [...prev, ...sub];
          continue;
        }
      }
    }

    // If tiny, try to merge forward (chain until big enough)
    // But NEVER merge forward across a sentence boundary
    while (len < 15 && j + 1 < processed.length) {
      const lastWordOfSub = sub[sub.length - 1];
      // Don't merge forward if current subtitle ends a sentence —
      // the next subtitle is a new thought
      if (endsWithSentencePunc(lastWordOfSub.text)) break;

      const next = processed[j + 1];
      const combinedLen = len + 1 + textLength(next, 0, next.length);
      if (combinedLen <= g.maxTotalChars) {
        sub = [...sub, ...next];
        len = combinedLen;
        j++;
      } else {
        break;
      }
    }

    // If still tiny, try merging with previous (only if no sentence boundary)
    if (len < 15 && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevLastWord = prev[prev.length - 1].text;
      if (!endsWithSentencePunc(prevLastWord)) {
        const combinedLen = textLength(prev, 0, prev.length) + 1 + len;
        if (combinedLen <= g.maxTotalChars) {
          merged[merged.length - 1] = [...prev, ...sub];
          continue;
        }
      }
    }

    merged.push(sub);
  }

  return merged;
}

// Find a point where a sentence ends and the next word starts with uppercase
// Returns the index to split at (the uppercase word starts the new subtitle)
function findSentenceBoundarySplit(words: Word[]): number {
  for (let i = 0; i < words.length - 1; i++) {
    if (endsWithSentencePunc(words[i].text)) {
      const next = words[i + 1];
      const startsUpper = next.text[0] === next.text[0].toUpperCase() &&
        next.text[0] !== next.text[0].toLowerCase();
      if (startsUpper) {
        // Only split if the first half is reasonable size (> 5 chars)
        // Second half can be tiny — it'll merge forward into the next subtitle
        const firstLen = textLength(words, 0, i + 1);
        if (firstLen >= 2) {
          return i + 1;
        }
      }
    }
  }
  return -1;
}

// ===== STEP 3: Main segmentation — speaker-first approach =====

function segmentWords(words: Word[], g: SubtitleGuidelines): SubtitleSegment[] {
  const speakerBlocks = splitBySpeaker(words);
  const segments: SubtitleSegment[] = [];

  for (let b = 0; b < speakerBlocks.length; b++) {
    const block = speakerBlocks[b];
    const nextBlock = speakerBlocks[b + 1];

    // Check if this block and the next are both very short
    // and can be combined (e.g. "A tako? -Ja.")
    if (nextBlock && g.maxSpeakerChangesPerSubtitle >= 1) {
      const thisLen = textLength(block.words, 0, block.words.length);
      const nextLen = textLength(nextBlock.words, 0, nextBlock.words.length);
      const lastNextWord = nextBlock.words[nextBlock.words.length - 1];
      const nextEndsClean = endsWithSentencePunc(lastNextWord.text) || endsWithAnyPunc(lastNextWord.text);

      if (thisLen <= 20 && nextLen <= 20 && thisLen + nextLen + 1 <= g.maxTotalChars && nextEndsClean) {
        // Combine into one subtitle with speaker marker
        const seg = buildCombinedSegment(block, nextBlock, g, segments.length + 1);
        if (segments.length > 0) {
          enforceGap(segments[segments.length - 1], seg, g);
        }
        segments.push(seg);
        b++; // skip the next block
        continue;
      }
    }

    // Segment this speaker's words into subtitles
    const subs = segmentSpeakerBlock(block.words, g);
    for (const subWords of subs) {
      const seg = buildSegment(subWords, 0, subWords.length, g, segments.length + 1);
      if (segments.length > 0) {
        enforceGap(segments[segments.length - 1], seg, g);
      }
      segments.push(seg);
    }
  }

  // Post-process: CPS validation
  for (const seg of segments) {
    const totalChars = seg.lines.reduce((sum, l) => sum + l.length, 0);
    const durationS = (seg.end_ms - seg.start_ms) / 1000;
    if (durationS > 0 && totalChars / durationS > g.maxCps) {
      const needed = Math.ceil((totalChars / g.maxCps) * 1000);
      seg.end_ms = seg.start_ms + needed;
    }
  }

  // Fix overlaps after CPS extension
  for (let j = 0; j < segments.length - 1; j++) {
    if (segments[j].end_ms > segments[j + 1].start_ms - g.minGapMs) {
      segments[j].end_ms = segments[j + 1].start_ms - g.minGapMs;
    }
  }

  return segments;
}

function enforceGap(prev: SubtitleSegment, next: SubtitleSegment, g: SubtitleGuidelines) {
  if (next.start_ms - prev.end_ms < g.minGapMs) {
    prev.end_ms = next.start_ms - g.minGapMs;
  }
}

function buildCombinedSegment(
  block1: SpeakerBlock,
  block2: SpeakerBlock,
  g: SubtitleGuidelines,
  index: number
): SubtitleSegment {
  const line1 = block1.words.map((w) => w.text).join(" ");
  const prefix = g.speakerMarkFirstSpeaker ? g.speakerMarkChar : "";
  const line2 = g.speakerMarkChar + block2.words.map((w) => w.text).join(" ");

  return {
    index,
    start_ms: block1.words[0].start_ms,
    end_ms: block2.words[block2.words.length - 1].end_ms,
    lines: [prefix ? prefix + line1 : line1, line2],
  };
}

// ===== Refine break point to respect linguistic rules =====

function isStrandable(word: string, hasPunc: boolean): boolean {
  if (hasPunc) return true; // word with punctuation is a valid ending
  const bare = bareWord(word);
  if (CONJUNCTIONS.has(bare)) return false;
  if (PREPOSITIONS.has(bare)) return false;
  if (AUXILIARIES.has(bare)) return false;
  if (UNSTRANDABLE.has(bare)) return false;
  return true;
}

function refineBreakPoint(words: Word[], start: number, end: number, g: SubtitleGuidelines): number {
  if (end <= start + 1) return end;

  // Keep pulling back while the last word is not a valid ending
  let refined = end;
  let maxPullback = 4; // don't pull back more than 4 words
  while (refined > start + 1 && maxPullback > 0) {
    const lastWord = words[refined - 1];
    const lastHasPunc = endsWithAnyPunc(lastWord.text);

    if (isStrandable(lastWord.text, lastHasPunc)) break;
    refined--;
    maxPullback--;
  }

  // If we pulled back too far (subtitle would be < 10 chars), revert
  if (refined > start && textLength(words, start, refined) < 10) {
    refined = end; // revert, accept the bad break
  }

  end = refined;

  // Rule: Subtitle cannot end with punctuation + single word
  // e.g. "word word, lastword" or "sentence. Word" — pull back
  if (end - start >= 3) {
    const secondToLast = words[end - 2];
    if (endsWithAnyPunc(secondToLast.text)) {
      // The subtitle would end: "...word, singleWord" — pull back by 1
      const pullBackEnd = end - 1;
      if (pullBackEnd > start && textLength(words, start, pullBackEnd) >= 10) {
        end = pullBackEnd;
      }
    }
  }

  // Rule: No punctuation on second-to-last word of the subtitle
  if (g.noPunctuationOnSecondToLastWord && end - start >= 2) {
    const secondToLast = words[end - 2].text;
    if (wordHasPunc(secondToLast) && !endsWithSentencePunc(secondToLast)) {
      // Option A: extend by one word if possible
      if (end < words.length) {
        const extLen = textLength(words, start, end + 1);
        if (extLen <= g.maxTotalChars) {
          return end + 1;
        }
      }
      // Option B: pull back to the punctuation point
      return end - 1;
    }
  }

  return end;
}

function countSpeakerChanges(words: Word[], start: number, end: number): number {
  let changes = 0;
  for (let i = start + 1; i < end; i++) {
    if (words[i].speaker && words[i].speaker !== words[i - 1].speaker) {
      changes++;
    }
  }
  return changes;
}

// ===== Build a subtitle segment from words =====

function buildSegment(words: Word[], start: number, end: number, g: SubtitleGuidelines, index: number): SubtitleSegment {
  const seg: SubtitleSegment = {
    index,
    start_ms: words[start].start_ms,
    end_ms: words[end - 1].end_ms,
    lines: [],
  };

  // Check for speaker changes
  const speakers = new Set<string>();
  for (let i = start; i < end; i++) {
    if (words[i].speaker) speakers.add(words[i].speaker!);
  }

  if (speakers.size > 1) {
    seg.lines = buildSpeakerLines(words, start, end, g);
  } else {
    const fullText = words.slice(start, end).map((w) => w.text).join(" ");
    seg.lines = splitIntoLines(fullText, g);
  }

  // Enforce minimum duration
  const duration = seg.end_ms - seg.start_ms;
  const totalChars = seg.lines.join("").length;
  if (totalChars <= 10 && duration < g.minDurationShortMs) {
    seg.end_ms = seg.start_ms + g.minDurationShortMs;
  } else if (duration < g.minDurationMs) {
    seg.end_ms = seg.start_ms + g.minDurationMs;
  }

  return seg;
}

// ===== Speaker lines =====

function buildSpeakerLines(words: Word[], start: number, end: number, g: SubtitleGuidelines): string[] {
  const lines: string[] = [];
  let currentSpeaker = words[start].speaker;
  let currentWords: string[] = [];
  let isFirst = true;

  for (let i = start; i < end; i++) {
    if (words[i].speaker !== currentSpeaker && currentWords.length > 0) {
      const prefix = isFirst && !g.speakerMarkFirstSpeaker ? "" : g.speakerMarkChar;
      lines.push(prefix + currentWords.join(" "));
      currentSpeaker = words[i].speaker;
      currentWords = [];
      isFirst = false;
    }
    currentWords.push(words[i].text);
  }

  if (currentWords.length > 0) {
    const prefix = isFirst && !g.speakerMarkFirstSpeaker ? "" : g.speakerMarkChar;
    lines.push(prefix + currentWords.join(" "));
  }

  // Enforce max lines
  while (lines.length > g.maxLines) {
    const extra = lines.pop()!;
    lines[lines.length - 1] += " " + extra;
  }

  return lines;
}

// ===== Split text into lines =====

function splitIntoLines(text: string, g: SubtitleGuidelines): string[] {
  text = text.trim();

  // Fits in one line
  if (text.length <= g.maxCharsPerLine) {
    return [text];
  }

  // Don't split if below minCharsForTwoLines (unless it exceeds maxCharsPerLine)
  if (text.length <= g.minCharsForTwoLines) {
    return [text];
  }

  // Try to split into 2 lines
  if (g.maxLines >= 2) {
    const words = text.split(" ");
    let bestSplit = -1;
    let bestScore = -Infinity;

    let pos = 0;
    for (let i = 0; i < words.length - 1; i++) {
      pos += (i > 0 ? 1 : 0) + words[i].length;
      const remaining = text.length - pos - 1; // -1 for the space we skip

      // Both lines must fit
      if (pos > g.maxCharsPerLine || remaining > g.maxCharsPerLine) continue;

      let score = 0;

      // Prefer split after punctuation
      if (endsWithAnyPunc(words[i])) score += 15;

      // Prefer bottom-heavy (shorter top, longer bottom)
      if (remaining >= pos) score += 3;

      // Balanced is good too
      const imbalance = Math.abs(pos - remaining);
      score += Math.max(0, 20 - imbalance);

      // Don't split before conjunction (conjunction should start line 2 — that's GOOD)
      const nextBare = bareWord(words[i + 1]);
      if (CONJUNCTIONS.has(nextBare)) score += 8;

      // Don't split after preposition/article (stranded at end of line 1)
      const thisBare = bareWord(words[i]);
      if (PREPOSITIONS.has(thisBare) && !endsWithAnyPunc(words[i])) score -= 25;
      if (AUXILIARIES.has(thisBare) && !endsWithAnyPunc(words[i])) score -= 25;

      // Don't allow line 2 to be a single word after punctuation on line 1
      // e.g. "lep dan,\nsonce." is bad
      if (words.length - (i + 1) === 1 && endsWithAnyPunc(words[i])) score -= 30;

      if (score > bestScore) {
        bestScore = score;
        bestSplit = i;
      }
    }

    if (bestSplit >= 0) {
      const line1 = words.slice(0, bestSplit + 1).join(" ");
      const line2 = words.slice(bestSplit + 1).join(" ");
      return [line1, line2];
    }

    // Fallback: split at midpoint
    const mid = Math.floor(words.length / 2);
    return [
      words.slice(0, mid).join(" "),
      words.slice(mid).join(" "),
    ];
  }

  // Single line, truncate
  return [text.slice(0, g.maxCharsPerLine)];
}

// ===== Format timestamps =====

function formatSRT(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${mil.toString().padStart(3, "0")}`;
}

function formatVTT(ms: number): string {
  return formatSRT(ms).replace(",", ".");
}

// ===== Public API =====

export function generateSRT(tokens: Token[], guidelines: SubtitleGuidelines): string {
  const words = mergeTokensToWords(tokens);
  const segments = segmentWords(words, guidelines);

  const blocks: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    blocks.push(
      `${i + 1}\n${formatSRT(seg.start_ms)} --> ${formatSRT(seg.end_ms)}\n${seg.lines.join("\n")}`
    );
  }
  return blocks.join("\n\n") + "\n";
}

export function generateVTT(tokens: Token[], guidelines: SubtitleGuidelines): string {
  const words = mergeTokensToWords(tokens);
  const segments = segmentWords(words, guidelines);

  const blocks: string[] = ["WEBVTT", ""];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    blocks.push(
      `${i + 1}\n${formatVTT(seg.start_ms)} --> ${formatVTT(seg.end_ms)}\n${seg.lines.join("\n")}`
    );
  }
  return blocks.join("\n\n") + "\n";
}
