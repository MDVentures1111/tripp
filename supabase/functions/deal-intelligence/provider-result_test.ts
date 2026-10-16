import { extractAnalysis } from './provider-result.ts';
Deno.test('valid provider payload', () => {
  if (extractAnalysis({choices:[{message:{content:'Assessment: pending'}}]}) !== 'Assessment: pending') throw Error('valid');
});
Deno.test('empty and malformed provider payloads', () => {
  for (const payload of [null, {}, {choices:[]}, {choices:[{message:{content:''}}]}, {choices:[{message:{content:42}}]}]) {
    if (extractAnalysis(payload) !== null) throw Error('invalid');
  }
});
Deno.test('provider output is bounded', () => {
  if (extractAnalysis({choices:[{message:{content:'x'.repeat(9000)}}]})?.length !== 7000) throw Error('length');
});
