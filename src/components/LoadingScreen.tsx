"use client";

import React from 'react';

export const LoadingScreen: React.FC<{ message: string }> = ({ message }) => (
  <div className="page-shell center-content">
    <div className="loading-state">
      <div className="spinner" aria-label="Loading" />
      <p>{message}</p>
    </div>
  </div>
);