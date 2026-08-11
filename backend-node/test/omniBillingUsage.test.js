const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthorizationUsage } = require('../src/services/omniVideoService');

test('omni video freezes the canonical output-token meter without changing provider fields', () => {
  assert.deepEqual(
    buildAuthorizationUsage(['output_token'], { billing_reserve_output_tokens: 48000, billing_reserve_input_tokens: 12000 }, 5),
    { output_token: 48000 },
  );
  assert.deepEqual(
    buildAuthorizationUsage(['output_token'], { billing_reserve_input_tokens: 12000 }, 5),
    { output_token: 12000 },
  );
  assert.throws(
    () => buildAuthorizationUsage(['output_token'], {}, 5),
    /billing_reserve_output_tokens/,
  );
});

