"use client";

import { BrainCircuit } from 'lucide-react';
import { EmptyView } from './HomeView';

export const IntelligenceView: React.FC = () => (
  <EmptyView 
    title="Lease Intelligence" 
    subtitle="AI-powered lease analysis and advisory capabilities are forthcoming." 
    icon={BrainCircuit} 
  />
);