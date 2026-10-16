import { supabase } from './supabase';
export async function analyzeDeal(dealId: string): Promise<{ analysis: string; disclaimer: string }> {
  const { data, error } = await supabase.functions.invoke('deal-intelligence', { body: { dealId } });
  if (error) throw new Error('Deal intelligence is unavailable. Please try again.');
  if (!data || typeof data.analysis !== 'string') throw new Error('Invalid intelligence response.');
  return { analysis: data.analysis, disclaimer: data.disclaimer ?? 'Verify AI-generated findings.' };
}
