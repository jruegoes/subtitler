 Done. Here's the full translation pipeline:

  How it works:
  1. Pick a target language from the dropdown (29 languages available)
  2. Click Translate — backend generates the original SRT, then sends it to OpenAI in batches of 25 subtitles
  3. Each batch includes 5 previously translated entries as context + 3 upcoming untranslated entries for forward context
  4. GPT-4o-mini translates with temperature 0 (deterministic), enforcing character limits and subtitle formatting
  5. A Translated tab appears in the view toggle showing the result
  6. Download Translated SRT button to save it

  Translation approach:
  - Strips timestamps before sending to OpenAI (saves tokens)
  - Sends subtitle text as JSON arrays, expects JSON array back (1:1 mapping)
  - Preserves original timestamps exactly
  - System prompt enforces: natural translation, character limits per line, speaker markers, concise phrasing
  - Handles response format variations (array vs object wrapper)
  - Falls back to original text if count mismatch

  Restart both servers and try it out.