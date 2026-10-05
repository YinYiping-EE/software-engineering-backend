import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate, CalculationError} from '../src/calculator.js';

const cases = [
  ['12+8', '20'], ['12-8', '4'], ['5×8', '40'], ['20÷4', '5'],
  ['1+2*3', '7'], ['(1+2)*3', '9'], ['10/2+7', '12'], ['8-3*2', '2'],
  ['-5+8', '3'], ['3*-2', '-6'], ['+2+3', '5'], ['-(2+3)*4', '-20'],
  ['.5+1.25', '1.75'], ['0.1+0.2', '0.3'], ['1/3', '0.333333333333333'],
  ['2 * (3 + 4)', '14'], ['1e3/2', '500'], ['-0', '0'],
];
for (const [expression, result] of cases) {
  test(`${expression} = ${result}`, () => assert.equal(calculate(expression).result, result));
}
for (const expression of ['', '1+', '(2+3', '2(3)', '1 2', '1..2', '1/0', '0/0', '1/(2-2)', '2**3', 'process.exit()', '1e309', '1e308*1e308']) {
  test(`rejects invalid input: ${JSON.stringify(expression)}`, () => {
    assert.throws(() => calculate(expression), CalculationError);
  });
}
test('rejects non-string and oversized expressions', () => {
  for (const value of [null, 123, {}, '1'.repeat(201)]) {
    assert.throws(() => calculate(value), CalculationError);
  }
});
