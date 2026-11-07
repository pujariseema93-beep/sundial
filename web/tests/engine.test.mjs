// The engine's contract: the JavaScript port must reproduce the committed
// golden facts exactly, byte for byte after a parse. Run with:
//   node --test web/tests/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Params, build, dumps, loadEvents } from '../engine/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const CASES = [
  ['desk-5weeks.jsonl', '2026-10-26', '2026-11-01', 'L4', 'desk-week.facts.json'],
  ['android-week.jsonl', '2026-10-26', '2026-11-01', 'L2', 'android-week.facts.json'],
  ['edge-cases.jsonl', '2026-10-28', '2026-10-28', 'L4', 'edge-cases.facts.json'],
];

for (const [fixture, start, end, fidelity, golden] of CASES) {
  test(`golden: ${fixture}`, () => {
    const { events, apps } = loadEvents(read('fixtures', fixture));
    const facts = build(events, apps, new Params(), start, end, { fidelity });
    const expected = JSON.parse(read('golden', golden));
    assert.deepEqual(facts, expected);
  });
}

test('facts are deterministic', () => {
  const { events, apps } = loadEvents(read('fixtures', 'desk-5weeks.jsonl'));
  const first = dumps(build(events, apps, new Params(), '2026-10-26', '2026-11-01'));
  const second = dumps(build(events, apps, new Params(), '2026-10-26', '2026-11-01'));
  assert.equal(first, second);
});

test('params hash matches the oracle', () => {
  // Produced by: python -c "from wl_oracle.model import Params; print(Params().hash())"
  assert.equal(new Params().hash(), read('golden', 'desk-week.facts.json').includes('params_hash')
    ? JSON.parse(read('golden', 'desk-week.facts.json')).meta.params_hash
    : null);
});
