"use client";

import { FileText } from 'lucide-react';
import { EmptyView } from './HomeView';

export const DocumentsView: React.FC = () => (
  <EmptyView 
    title="Documents" 
    subtitle="Proposal and document management will appear here once initialized." 
    icon={FileText} 
  />
);