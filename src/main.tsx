import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
if (import.meta.env.VITE_APP_ENV === 'demo') {
  void import('./PreviewDemo').then(({ PreviewDemo }) => root.render(<React.StrictMode><PreviewDemo /></React.StrictMode>));
} else {
  void import('./App').then(({ default: App }) => root.render(<React.StrictMode><App /></React.StrictMode>));
}
