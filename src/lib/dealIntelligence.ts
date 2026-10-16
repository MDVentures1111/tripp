import { supabase } from './supabase';
export async function analyzeDeal(dealId: string): Promise<{ analysis: string; disclaimer: string }> {
  const { data, error } = await supabase.functions.invoke('deal-intelligence', { body: { dealId } });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      let detail = '';
      try {
        const payload = await context.clone().json() as { error?: string };
        detail = typeof payload.error === 'string' ? payload.error : '';
      } catch { /* gateway response may not be JSON */ }
      throw new Error(`Deal Intelligence HTTP ${context.status}${detail ? `: ${detail}` : ''}`);
    }
    throw new Error(`Deal Intelligence request failed: ${error.message || 'Network or gateway error'}`);
  }
  if (!data || typeof data.analysis !== 'string') throw new Error('Invalid intelligence response.');
  return { analysis: data.analysis, disclaimer: data.disclaimer ?? 'Verify AI-generated findings.' };
}
