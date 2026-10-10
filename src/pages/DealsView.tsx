"use client";

import { Briefcase } from 'lucide-react';
import { EmptyView } from './HomeView';

export const DealsView: React.FC = () => (
  <EmptyView 
    title="Active Deals" 
    subtitle="No active deal pipelines are currently tracked for this organization." 
    icon={Briefcase} 
  />
);