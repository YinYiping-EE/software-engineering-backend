export class CalculationError extends Error {}

export function calculate(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new CalculationError('请输入要计算的算式');
  }
  if (input.length > 200) throw new CalculationError('算式不能超过 200 个字符');
  const source = input.replaceAll('×', '*').replaceAll('÷', '/')
      .replaceAll('−', '-');
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset++; continue; }
    const number = source.slice(offset).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new CalculationError('输入的数字过大');
      tokens.push({type: 'number', value});
      offset += number[0].length;
    } else if ('+-*/()'.includes(source[offset])) {
      tokens.push({type: source[offset++]});
    } else {
      throw new CalculationError('仅支持数字、四则运算和括号');
    }
  }
  let index = 0;
  const peek = () => tokens[index]?.type;
  function finite(value) {
    if (!Number.isFinite(value)) throw new CalculationError('结果超出可计算范围');
    return value;
  }
  function primary() {
    if (peek() === 'number') return tokens[index++].value;
    if (peek() === '(') {
      index++;
      const value = sum();
      if (peek() !== ')') throw new CalculationError('请检查括号是否配对');
      index++;
      return value;
    }
    throw new CalculationError('算式不完整，请检查数字和运算符');
  }
  function unary() {
    if (peek() === '+' || peek() === '-') {
      const sign = tokens[index++].type;
      return sign === '-' ? -unary() : unary();
    }
    return primary();
  }
  function product() {
    let value = unary();
    while (peek() === '*' || peek() === '/') {
      const operator = tokens[index++].type;
      const right = unary();
      if (operator === '/' && right === 0) throw new CalculationError('不能除以零');
      value = finite(operator === '*' ? value * right : value / right);
    }
    return value;
  }
  function sum() {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[index++].type;
      const right = product();
      value = finite(operator === '+' ? value + right : value - right);
    }
    return value;
  }
  const value = sum();
  if (index !== tokens.length) throw new CalculationError('请检查括号和运算符');
  const result = Number.isSafeInteger(value) ? String(value) :
      String(Number(value.toPrecision(15)));
  return {expression: input.trim(), result};
}
