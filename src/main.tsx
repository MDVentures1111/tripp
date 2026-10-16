import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const root = ReactDOM.createRoot(document.getElementById("root")!);
if (import.meta.env.VITE_APP_ENV === 'demo') {
  void import('./PreviewDemo').then(({ PreviewDemo }) => root.render(<React.StrictMode><AppErrorBoundary><PreviewDemo /></AppErrorBoundary></React.StrictMode>));
} else {
  void import('./App').then(({ default: App }) => root.render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>));
}
