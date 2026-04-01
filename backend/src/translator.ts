import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getProfile } from "./subtitle-guidelines.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPromptTemplate(): string {
  const path = join(__dirname, "..", "translation-prompt.md");
  return readFileSync(path, "utf-8");
}

function loadLangRules(sourceLang: string, targetLang: string): string {
  const rulesDir = join(__dirname, "..", "lang-rules");
  const parts: string[] = [];

  // Source language rules
  const srcPath = join(rulesDir, `${sourceLang}.md`);
  if (existsSync(srcPath)) {
    parts.push(readFileSync(srcPath, "utf-8"));
  }

  // Target language rules
  const tgtPath = join(rulesDir, `${targetLang}.md`);
  if (existsSync(tgtPath)) {
    parts.push(readFileSync(tgtPath, "utf-8"));
  }

  // Language pair specific rules
  const pairPath = join(rulesDir, `${sourceLang}-${targetLang}.md`);
  if (existsSync(pairPath)) {
    parts.push(readFileSync(pairPath, "utf-8"));
  }

  return parts.join("\n\n");
}

function buildSystemPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  // Handle conditional blocks {{#VAR}}...{{/VAR}} — remove block if var is empty
  result = result.replace(/\{\{#(\w+)\}\}(.*?)\{\{\/\1\}\}/gs, (_, key, content) => {
    return vars[key] ? content.replaceAll(`{{${key}}}`, vars[key]) : "";
  });
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

const openai = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });

interface SrtBlock {
  index: number;
  start: string;
  end: string;
  text: string;
}

// ===== Parse SRT into blocks =====

export function parseSRT(srt: string): SrtBlock[] {
  const blocks: SrtBlock[] = [];
  const parts = srt.trim().split(/\n\n+/);

  for (const part of parts) {
    const lines = part.trim().split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    const timeParts = lines[1].split(" --> ");
    if (timeParts.length !== 2) continue;

    const text = lines.slice(2).join("\n");
    blocks.push({ index, start: timeParts[0].trim(), end: timeParts[1].trim(), text });
  }

  return blocks;
}

// ===== Reassemble translated blocks into SRT =====

function assembleSRT(blocks: SrtBlock[]): string {
  return blocks
    .map((b, i) => `${i + 1}\n${b.start} --> ${b.end}\n${b.text}`)
    .join("\n\n") + "\n";
}

// ===== Extract glossary of key terms/names =====

async function extractGlossary(
  allTexts: string[],
  sourceLang: string,
  targetLang: string,
  options: TranslateOptions,
): Promise<string> {
  // Sample the transcript
  const total = allTexts.length;
  const indices: number[] = [];
  for (let i = 0; i < Math.min(15, total); i++) indices.push(i);
  const mid = Math.floor(total / 2);
  for (let i = mid - 7; i < mid + 7 && i < total; i++) {
    if (i >= 0 && !indices.includes(i)) indices.push(i);
  }
  for (let i = Math.max(0, total - 15); i < total; i++) {
    if (!indices.includes(i)) indices.push(i);
  }

  const sample = indices.sort((a, b) => a - b).map((i) => allTexts[i]).join("\n");

  let systemContent = `You extract key terms for subtitle translation consistency from ${sourceLang} to ${targetLang}.`;
  if (options.contentType) systemContent += ` Content type: ${options.contentType}.`;
  if (options.description) systemContent += ` Context: ${options.description}`;

  systemContent += `

Extract from the transcript:
1. Proper nouns (people, places, organizations, brands) — provide the correct spelling/transliteration for the target language
2. Recurring technical terms or domain-specific vocabulary — provide the recommended translation
3. Any ambiguous words that could be misinterpreted (e.g., words that look like names but aren't)

Return a concise list, one per line, format: "source_term = target_translation (note)"
Only include terms that appear multiple times OR are critical for understanding.
If there are no notable terms, return "No special terms."
Keep it under 30 entries.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: `Extract key terms from this ${sourceLang} transcript (${total} subtitles):\n\n${sample}` },
    ],
  });

  return response.choices[0]?.message?.content || "";
}

// ===== Generate content summary for context =====

async function generateSummary(
  allTexts: string[],
  options: TranslateOptions,
): Promise<string> {
  const total = allTexts.length;
  const indices: number[] = [];
  for (let i = 0; i < Math.min(10, total); i++) indices.push(i);
  const mid = Math.floor(total / 2);
  for (let i = mid - 5; i < mid + 5 && i < total; i++) {
    if (i >= 0 && !indices.includes(i)) indices.push(i);
  }
  for (let i = Math.max(0, total - 10); i < total; i++) {
    if (!indices.includes(i)) indices.push(i);
  }

  const sample = indices.sort((a, b) => a - b).map((i) => allTexts[i]).join(" ");

  let systemMsg = "You summarize spoken content for subtitle translators. Be concise — 2-4 sentences max. Include: topic, speakers/roles, tone (casual/formal/emotional), any key terms or names that a translator should know.";
  if (options.contentType) systemMsg += ` This is a ${options.contentType}.`;
  if (options.description) systemMsg += ` User context: ${options.description}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: `Summarize this spoken content (sampled from a ${total}-subtitle transcript):\n\n${sample}` },
    ],
  });

  return response.choices[0]?.message?.content || "";
}

// ===== Translate a batch of subtitle texts =====

async function translateBatch(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  context: {
    beforePairs: Array<{ original: string; translated: string }>;
    after: string[];
    summary: string;
    glossary: string;
  },
  metadata: { title?: string; contentType?: string; description?: string },
  maxCharsPerLine: number,
): Promise<string[]> {
  const template = loadPromptTemplate();
  const langRules = loadLangRules(sourceLang, targetLang);
  const systemPrompt = buildSystemPrompt(template, {
    SOURCE_LANG: sourceLang,
    TARGET_LANG: targetLang,
    TITLE: metadata.title || "",
    CONTENT_TYPE: metadata.contentType || "",
    DESCRIPTION: metadata.description || "",
    MAX_CHARS: String(maxCharsPerLine),
    GLOSSARY: context.glossary || "",
    LANG_RULES: langRules,
  });

  let userPrompt = "";

  if (context.summary) {
    userPrompt += `Content summary (for context only, do NOT translate):\n${context.summary}\n\n`;
  }

  // Send original+translated pairs as context (much better than translated-only)
  if (context.beforePairs.length > 0) {
    userPrompt += `Previously translated subtitles (original → translation):\n`;
    for (const pair of context.beforePairs) {
      userPrompt += `  "${pair.original}" → "${pair.translated}"\n`;
    }
    userPrompt += "\n";
  }

  // Send as keyed object so LLM must produce one value per key
  const inputObj: Record<string, string> = {};
  for (let i = 0; i < texts.length; i++) {
    inputObj[String(i)] = texts[i];
  }
  userPrompt += `Translate these ${texts.length} subtitles from ${sourceLang} to ${targetLang}:\n${JSON.stringify(inputObj, null, 2)}`;

  if (context.after.length > 0) {
    userPrompt += `\n\nUpcoming subtitles (untranslated, for forward context):\n${context.after.map((t) => `  "${t}"`).join("\n")}`;
  }

  userPrompt += `\n\nRespond with a JSON object using the SAME keys ("0", "1", ..., "${texts.length - 1}"). Each key maps to its translated string.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    temperature: 0.3,
    max_completion_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const choice = response.choices[0];
  const content = choice?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  if (choice.finish_reason === "length") {
    console.warn(`[translator] Response truncated (finish_reason=length). Output was cut off.`);
  }

  console.log(`[translator] Raw response (${content.length} chars, finish=${choice.finish_reason}): ${content.slice(0, 500)}`);

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    // If truncated, the JSON is likely incomplete
    if (choice.finish_reason === "length") {
      throw new Error(`Response truncated — output too long for model. Reduce batch size.`);
    }
    throw new Error(`Failed to parse OpenAI response: ${content.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object, got: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  // Check for refusal
  if (parsed.error || parsed.message || parsed.refusal) {
    const refusalMsg = parsed.error || parsed.message || parsed.refusal;
    throw new Error(`LLM refused to translate: ${refusalMsg}`);
  }

  // Reconstruct array from numbered keys
  const translations: string[] = [];
  const missing: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const key = String(i);
    if (key in parsed && typeof parsed[key] === "string") {
      translations.push(parsed[key]);
    } else {
      // Key missing — use original text as fallback and log it
      missing.push(i);
      translations.push(texts[i]);
    }
  }

  if (missing.length > 0 && missing.length <= 3) {
    console.warn(`[translator] Missing ${missing.length} keys: ${missing.join(", ")}. Used originals as fallback.`);
  } else if (missing.length > 3) {
    throw new Error(`Too many missing keys (${missing.length}/${texts.length}): ${missing.join(", ")}`);
  }

  // Detect untranslated entries — LLM echoed the source text back
  // Only warn, never throw — for related languages (sr↔sl, hr↔sr, etc.)
  // many sentences are legitimately identical after translation
  const untranslated: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const src = texts[i].trim().toLowerCase();
    const tgt = translations[i].trim().toLowerCase();
    if (src.length > 10 && src === tgt) {
      untranslated.push(i);
    }
  }

  if (untranslated.length > 0) {
    console.warn(`[translator] ${untranslated.length}/${texts.length} entries identical to source (may be correct for related languages)`);
  }

  return translations;
}

// ===== Main translation function =====

// ===== Retry with batch splitting =====

async function translateBatchWithRetry(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  context: {
    beforePairs: Array<{ original: string; translated: string }>;
    after: string[];
    summary: string;
    glossary: string;
  },
  metadata: { title?: string; contentType?: string; description?: string },
  maxCharsPerLine: number,
  batchNum: number,
): Promise<string[]> {
  // Attempt 1: try the full batch
  try {
    return await translateBatch(texts, sourceLang, targetLang, context, metadata, maxCharsPerLine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[translator] Batch ${batchNum} failed: ${msg}`);
    console.warn(`[translator] Rejected batch content:\n${texts.map((t, i) => `  [${i}] "${t}"`).join("\n")}`);
  }

  // Attempt 2: retry once (transient errors, count mismatches)
  try {
    console.log(`[translator] Batch ${batchNum} retrying full batch...`);
    return await translateBatch(texts, sourceLang, targetLang, context, metadata, maxCharsPerLine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[translator] Batch ${batchNum} retry failed: ${msg}`);
  }

  // Attempt 3: split batch in half and translate each half separately
  if (texts.length <= 1) {
    throw new Error(`Batch ${batchNum} failed: cannot split single subtitle further`);
  }

  const mid = Math.ceil(texts.length / 2);
  console.log(`[translator] Batch ${batchNum} splitting into two halves: ${mid} + ${texts.length - mid} subtitles`);

  const firstHalf = texts.slice(0, mid);
  const secondHalf = texts.slice(mid);

  const firstResult = await translateBatch(
    firstHalf, sourceLang, targetLang,
    context, metadata, maxCharsPerLine,
  );

  // Build context for second half using first half results
  const midContext = {
    ...context,
    beforePairs: firstHalf.map((t, idx) => ({ original: t, translated: firstResult[idx] })).slice(-8),
    after: context.after,
  };

  const secondResult = await translateBatch(
    secondHalf, sourceLang, targetLang,
    midContext, metadata, maxCharsPerLine,
  );

  return [...firstResult, ...secondResult];
}

export interface TranslateOptions {
  sourceLang: string;
  targetLang: string;
  title?: string;
  contentType?: string;
  description?: string;
  batchSize?: number;
  maxCharsPerLine?: number;
  cachedGlossary?: string;
  onBatch?: (data: {
    batchIndex: number;
    totalBatches: number;
    translatedBlocks: SrtBlock[];
    startIndex: number;
  }) => Promise<void> | void;
}

export async function translateSRT(
  srt: string,
  options: TranslateOptions,
): Promise<{ srt: string; glossary: string }> {
  const blocks = parseSRT(srt);
  if (blocks.length === 0) return { srt, glossary: "" };

  const batchSize = options.batchSize || 15;
  const maxCharsPerLine = options.maxCharsPerLine || 42;
  const contextSize = 8; // previously translated entries for context

  const translatedBlocks: SrtBlock[] = [];
  const allTexts = blocks.map((b) => b.text);

  console.log(`[translator] Translating ${blocks.length} subtitles: ${options.sourceLang} → ${options.targetLang}`);
  console.log(`[translator] Batch size: ${batchSize}, context: ${contextSize} before + 5 after`);
  if (options.contentType) console.log(`[translator] Content type: ${options.contentType}`);
  if (options.description) console.log(`[translator] Description: ${options.description}`);

  // Step 1: Generate summary and glossary (in parallel for speed)
  const fullText = allTexts.join("\n");
  const isShort = fullText.length < 4000;

  const [summaryResult, glossaryResult] = await Promise.allSettled([
    isShort
      ? Promise.resolve(`Full transcript:\n${fullText}`)
      : generateSummary(allTexts, options),
    options.cachedGlossary
      ? Promise.resolve(options.cachedGlossary)
      : extractGlossary(allTexts, options.sourceLang, options.targetLang, options),
  ]);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : "";
  const glossary = glossaryResult.status === "fulfilled" ? glossaryResult.value : "";

  if (isShort) {
    console.log(`[translator] Using full transcript as context (${fullText.length} chars)`);
  } else {
    console.log(`[translator] Summary: ${summary.slice(0, 200)}...`);
  }
  console.log(`[translator] Glossary: ${glossary.slice(0, 300)}${glossary.length > 300 ? "..." : ""}`);

  // Step 2: Translate in batches
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batchBlocks = blocks.slice(i, i + batchSize);
    const batchTexts = batchBlocks.map((b) => b.text);

    // Build original+translated pairs for context
    const beforePairs: Array<{ original: string; translated: string }> = [];
    const startIdx = Math.max(0, translatedBlocks.length - contextSize);
    for (let j = startIdx; j < translatedBlocks.length; j++) {
      const origBlockIdx = j; // translatedBlocks aligns with blocks by index
      beforePairs.push({
        original: blocks[origBlockIdx]?.text || "",
        translated: translatedBlocks[j].text,
      });
    }

    // Forward context: next 5 untranslated
    const afterContext = allTexts.slice(i + batchSize, i + batchSize + 5);

    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(blocks.length / batchSize);
    console.log(`[translator] Batch ${batchNum}/${totalBatches} (${batchTexts.length} subtitles)`);

    const translated = await translateBatchWithRetry(
      batchTexts,
      options.sourceLang,
      options.targetLang,
      { beforePairs, after: afterContext, summary, glossary },
      { title: options.title, contentType: options.contentType, description: options.description },
      maxCharsPerLine,
      batchNum,
    );

    const batchTranslated: SrtBlock[] = [];
    for (let j = 0; j < batchBlocks.length; j++) {
      const block = { ...batchBlocks[j], text: translated[j] };
      translatedBlocks.push(block);
      batchTranslated.push(block);
    }

    if (options.onBatch) {
      await options.onBatch({
        batchIndex: Math.floor(i / batchSize),
        totalBatches: Math.ceil(blocks.length / batchSize),
        translatedBlocks: batchTranslated,
        startIndex: i,
      });
    }
  }

  console.log(`[translator] Done. ${translatedBlocks.length} subtitles translated.`);
  return { srt: assembleSRT(translatedBlocks), glossary };
}
