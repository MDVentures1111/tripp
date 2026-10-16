import { runGate } from './gate.ts';
Deno.test('membership denial prevents quota and provider calls', async () => {
 let quota = 0; let provider = 0;
 const result = await runGate([async () => false, async () => {quota++; return true;}, async () => {provider++; return true;}]);
 if (result !== 0 || quota !== 0 || provider !== 0) throw new Error('unauthorized side effect');
});
Deno.test('quota denial prevents provider call', async () => {
 let provider = 0;
 const result = await runGate([async () => true, async () => false, async () => {provider++; return true;}]);
 if (result !== 1 || provider !== 0) throw new Error('quota bypass');
});
Deno.test('all authorized steps run in order', async () => {
 const order: number[] = [];
 const result = await runGate([1,2,3].map(i => async () => {order.push(i); return true;}));
 if (result !== -1 || order.join(',') !== '1,2,3') throw new Error('incorrect ordering');
});
