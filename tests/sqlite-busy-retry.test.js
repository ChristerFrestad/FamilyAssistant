'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { withBusyRetry } = require('../server/repositories/with-busy-retry');

function sqliteBusy(message = 'database is locked') {
  const err = new Error(message);
  err.code = 'SQLITE_BUSY';
  return err;
}

describe('withBusyRetry', () => {
  test('retries once after SQLITE_BUSY then succeeds', () => {
    let calls = 0;
    const result = withBusyRetry(() => {
      calls += 1;
      if (calls === 1) throw sqliteBusy();
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('rethrows when both attempts are SQLITE_BUSY', () => {
    let calls = 0;
    assert.throws(
      () =>
        withBusyRetry(() => {
          calls += 1;
          throw sqliteBusy();
        }),
      (err) => err instanceof Error && err.code === 'SQLITE_BUSY'
    );
    assert.equal(calls, 2);
  });
});
