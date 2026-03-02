// tests/test_css_audit.js — Test 10: CSS Audit
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

describe('Test 10: CSS Audit', () => {
  it('audit-css.sh runs with 0 errors', () => {
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'audit-css.sh');
    let output;
    try {
      output = execSync(`bash "${scriptPath}"`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 15000,
      });
    } catch (err) {
      // If script exits non-zero, the output is in err.stdout/stderr
      output = (err.stdout || '') + (err.stderr || '');
      // Fail the test with the output
      assert.fail(`CSS audit failed with exit code ${err.status}:\n${output}`);
    }

    // Check that the output contains 0 errors or a success indicator
    const hasErrors = /\d+ error/i.test(output) && !/0 error/i.test(output);
    if (hasErrors) {
      assert.fail(`CSS audit reported errors:\n${output}`);
    }
  });
});
