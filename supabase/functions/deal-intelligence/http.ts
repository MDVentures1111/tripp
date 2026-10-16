export function methodStatus(method: string): number {
  if (method === 'OPTIONS') return 204;
  if (method !== 'POST') return 405;
  return 200;
}
