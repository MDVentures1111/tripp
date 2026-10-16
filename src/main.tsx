import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const root = ReactDOM.createRoot(document.getElementById("root")!);
const showStartupError = () => root.render(<main role="alert" style={{padding:32,fontFamily:'system-ui'}}><h1>TRIPP could not start</h1><p>Application configuration or loading failed. Please contact the administrator.</p><button onClick={() => window.location.reload()}>Retry</button></main>);
if (import.meta.env.VITE_APP_ENV === 'demo') {
  void import('./PreviewDemo').then(({ PreviewDemo }) => root.render(<React.StrictMode><AppErrorBoundary><PreviewDemo /></AppErrorBoundary></React.StrictMode>)).catch(showStartupError);
} else {
  void import('./App').then(({ default: App }) => root.render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>)).catch(showStartupError);
}
