import { isAuthorizedForDeal } from './access.ts';
Deno.test('same organization is authorized', () => {
  if (!isAuthorizedForDeal('org-a', ['org-a'])) throw new Error('denied own deal');
});
Deno.test('different organization is denied', () => {
  if (isAuthorizedForDeal('org-b', ['org-a'])) throw new Error('cross-tenant access');
});
Deno.test('missing membership is denied', () => {
  if (isAuthorizedForDeal('org-a', [])) throw new Error('missing membership');
});
