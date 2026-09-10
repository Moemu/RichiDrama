const test = require('node:test');
const assert = require('node:assert/strict');
const { signOpenApiRequest } = require('../src/services/volcengineOpenApiSigning');
const fixtures = require('./fixtures/volcengineOpenApiSignatures.json');

for (const fixture of fixtures.cases) {
  test(`native OpenAPI signature matches SDK vector: ${fixture.name}`, () => {
    const input = { ...fixture.input, date: new Date(fixture.input.date) };
    const before = structuredClone(input);
    assert.deepEqual(signOpenApiRequest(input), fixture.expected);
    assert.deepEqual(input, before, 'signing must not mutate the caller request');
  });
}
