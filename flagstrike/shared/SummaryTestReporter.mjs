import { Transform } from 'node:stream';

const SUMMARY_FIELDS = [
  ['tests', 'tests'],
  ['suites', 'suites'],
  ['pass', 'passed'],
  ['fail', 'failed'],
  ['cancelled', 'cancelled'],
  ['skipped', 'skipped'],
  ['todo', 'todo'],
];
const SUMMARY_LABELS = new Set(SUMMARY_FIELDS.map(([label]) => label).concat('duration_ms'));

export default class SummaryTestReporter extends Transform {
  constructor() {
    super({ writableObjectMode: true });
    this.failures = [];
    this.summaryLines = [];
  }

  _transform(event, _encoding, callback) {
    if (event.type === 'test:fail') this.failures.push(event.data);
    if (event.type === 'test:diagnostic') {
      const message = event.data.message;
      const label = message?.split(' ', 1)[0];
      if (SUMMARY_LABELS.has(label)) this.summaryLines.push(`# ${message}`);
    }
    callback();
  }

  _flush(callback) {
    const lines = this.summaryLines.length > 0
      ? this.summaryLines
      : [...SUMMARY_FIELDS.map(([label]) => `# ${label} 0`), '# duration_ms 0'];

    if (this.failures.length > 0) {
      const failedTests = this.failures.filter((failure) => failure.details?.type !== 'suite');
      const failuresToPrint = failedTests.length > 0 ? failedTests : this.failures;
      lines.push('# Failed tests:');
      for (const failure of failuresToPrint) {
        lines.push(...formatFailure(failure));
      }
    }

    this.push(`${lines.join('\n')}\n`);
    callback();
  }
}

function formatFailure(failure) {
  const lines = [`# Subtest: ${failure.name ?? 'unnamed test'}`];
  if (failure.file) {
    const location = [failure.file, failure.line, failure.column]
      .filter((part) => part !== undefined)
      .join(':');
    lines.push(`# location: ${location}`);
  }

  const details = failure.details ?? {};
  const error = details.error && typeof details.error === 'object'
    ? details.error
    : details;

  for (const field of ['failureType', 'code', 'name', 'error', 'message', 'expected', 'actual', 'operator']) {
    const value = error[field];
    if (value !== undefined && value !== null) {
      lines.push(`# ${field}: ${formatValue(value)}`);
    }
  }

  if (typeof error.stack === 'string') {
    lines.push('# stack:');
    for (const line of error.stack.split('\n')) lines.push(`#   ${line}`);
  }

  return lines;
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
