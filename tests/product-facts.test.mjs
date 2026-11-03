import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProductFacts} from '../src/product-facts.mjs';

const powerBankDescription = `支援最大100W PD3.0 快充技術
* 配備2條USB-C自帶線、1個USB-C及1個USB-A，最大165W總輸出
* 智能屏幕顯示電量、輸出/輸入功率、充電狀態等
* ActiveShield 2.0 技術全天300萬次智能監測及控溫
* 25,000mAh 特大可攜帶上機容量(90Wh , <100Wh)
* 耐用USB-C 自帶線(伸縮線及掛繩線)通過20,000次以上折曲測試`;

test('power-bank facts retain complete numeric claims and list explanations', () => {
  assert.deepEqual(extractProductFacts(powerBankDescription), [
    '支援最大100W PD3.0 快充技術',
    '配備2條USB-C自帶線、1個USB-C及1個USB-A，最大165W總輸出',
    '智能屏幕顯示電量、輸出/輸入功率、充電狀態等',
    'ActiveShield 2.0 技術全天300萬次智能監測及控溫',
    '25,000mAh 特大可攜帶上機容量(90Wh , <100Wh)',
    '耐用USB-C 自帶線(伸縮線及掛繩線)通過20,000次以上折曲測試'
  ]);
});

test('unstructured phrases split at ordinary commas without splitting numerical separators', () => {
  assert.deepEqual(extractProductFacts('25,000mAh 電池，20,000次測試;3,5mm 插孔,PD3.0 快充；2.5m 線材'), [
    '25,000mAh 電池', '20,000次測試', '3,5mm 插孔', 'PD3.0 快充', '2.5m 線材'
  ]);
  assert.deepEqual(extractProductFacts('２５，０００mAh 電池，輕巧'), ['２５，０００mAh 電池', '輕巧']);
});

test('parenthetical qualifications stay with their fact, including nested parentheses', () => {
  assert.deepEqual(extractProductFacts('容量(90Wh , <100Wh)，接口（USB-C 1, USB-A 1；最多2台），雙層（外層(1, 2), 內層）'), [
    '容量(90Wh , <100Wh)', '接口（USB-C 1, USB-A 1；最多2台）', '雙層（外層(1, 2), 內層）'
  ]);
});

test('markdown and numbered list markers are removed without removing numeric product data', () => {
  assert.deepEqual(extractProductFacts(' - 防水\n+ 便攜\n• 輕巧\n1. USB-C\n2) 25,000mAh\n（3） 2.5m\n4、3,5mm'), [
    '防水', '便攜', '輕巧', 'USB-C', '25,000mAh', '2.5m', '3,5mm'
  ]);
  assert.deepEqual(extractProductFacts('2.5m 線材；-20°C 工作；+5V 電壓；**耐用**'), [
    '2.5m 線材', '-20°C 工作', '+5V 電壓', '**耐用**'
  ]);
});

test('list-item explanations preserve commas while semicolons still separate facts', () => {
  assert.deepEqual(extractProductFacts('1. 25,000mAh battery, with 100W output; durable\n2. USB-C，支援輸入及輸出'), [
    '25,000mAh battery, with 100W output', 'durable', 'USB-C，支援輸入及輸出'
  ]);
});

test('empty input and repeated separators do not create empty facts', () => {
  for (const input of [undefined, null, '', '  ', '\r\n\n；;，,\r']) assert.deepEqual(extractProductFacts(input), []);
  assert.deepEqual(extractProductFacts('  輕巧  \r\n\r\n  防水 ; ；便攜\r耐用 '), ['輕巧', '防水', '便攜', '耐用']);
  assert.deepEqual(extractProductFacts('* \n1. \n- '), []);
});

test('coercible input is accepted and failed coercion returns no facts', () => {
  assert.deepEqual(extractProductFacts(25000), ['25000']);
  assert.deepEqual(extractProductFacts(0), ['0']);
  assert.deepEqual(extractProductFacts({toString: () => '25,000mAh'}), ['25,000mAh']);
  assert.deepEqual(extractProductFacts({toString() { throw new Error('not text'); }}), []);
});

test('input beyond the existing 20000-character boundary is ignored', () => {
  assert.deepEqual(extractProductFacts('x'.repeat(19999) + ';extra'), ['x'.repeat(19999)]);
  assert.deepEqual(extractProductFacts('x'.repeat(20001)), ['x'.repeat(20000)]);
});

test('an unclosed parenthesis does not consume following lines', () => {
  assert.deepEqual(extractProductFacts('容量(25,000mAh, 90Wh\n快充，輕巧'), ['容量(25,000mAh, 90Wh', '快充', '輕巧']);
});
