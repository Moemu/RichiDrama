'use strict';

// Provider usage is the only source used for token settlement.  Reservations
// merely protect a user's balance before an upstream request is submitted.
function positiveInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function textUsage(raw) {
  const usage = raw && typeof raw === 'object' ? raw : {};
  const input = positiveInteger(usage.prompt_tokens ?? usage.input_tokens ?? usage.input_token_count);
  const output = positiveInteger(usage.completion_tokens ?? usage.output_tokens ?? usage.output_token_count);
  if (input == null && output == null) return null;
  const result = {};
  if (input != null) result.input_token = input;
  if (output != null) result.output_token = output;
  return Object.keys(result).length ? result : null;
}

function unicodeCharacterCount(value) {
  return Array.from(String(value || '')).length;
}

// UTF-8 byte length is an intentionally conservative upper bound for normal
// tokenizer input tokens.  It is never used for final settlement.
function textReservation(prompt, maxOutputTokens) {
  const input = Buffer.byteLength(String(prompt || ''), 'utf8');
  const output = positiveInteger(maxOutputTokens) ?? 8192;
  return { input_token: input, output_token: output };
}

function hasTokenMeter(snapshot) {
  return Object.keys(snapshot?.usage || {}).some((meter) => meter === 'input_token' || meter === 'output_token');
}

module.exports = { textUsage, unicodeCharacterCount, textReservation, hasTokenMeter };
