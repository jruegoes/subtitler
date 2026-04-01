export interface SubtitleGuidelines {
  name: string;
  language: string;

  maxCharsPerLine: number;
  maxLines: number;
  maxTotalChars: number;
  minCharsForTwoLines: number;

  minDurationMs: number;
  minDurationShortMs: number;
  maxDurationMs: number;
  typicalDurationMs: [number, number];
  minGapMs: number;
  mergeGapMs: number;

  targetCps: number;
  maxCps: number;
  cpsTolerancePct: number;
  cpsToleranceMinDurationMs: number;

  pauseThresholdMs: number;

  speakerMarkFirstSpeaker: boolean;
  speakerMarkChar: string;
  maxSpeakerChangesPerSubtitle: number;
  noPunctuationOnSecondToLastWord: boolean;
  noEndWithComma: boolean;
  conjunctionToNewLine: boolean;
  keepPrepositionsWithPhrase: boolean;
  keepAuxiliaryWithVerb: boolean;
}

export const defaultProfile: SubtitleGuidelines = {
  name: "Standard",
  language: "any",

  maxCharsPerLine: 42,
  maxLines: 2,
  maxTotalChars: 84,
  minCharsForTwoLines: 20,

  minDurationMs: 1000,
  minDurationShortMs: 833,
  maxDurationMs: 7000,
  typicalDurationMs: [2000, 6000],
  minGapMs: 83,
  mergeGapMs: 500,

  targetCps: 20,
  maxCps: 21,
  cpsTolerancePct: 0,
  cpsToleranceMinDurationMs: 0,

  pauseThresholdMs: 400,

  speakerMarkFirstSpeaker: false,
  speakerMarkChar: "-",
  maxSpeakerChangesPerSubtitle: 1,
  noPunctuationOnSecondToLastWord: true,
  noEndWithComma: false,
  conjunctionToNewLine: true,
  keepPrepositionsWithPhrase: true,
  keepAuxiliaryWithVerb: true,
};

export function getProfile(): SubtitleGuidelines {
  return defaultProfile;
}

export function listProfiles() {
  return [{ id: "standard", name: "Standard", language: "any" }];
}
