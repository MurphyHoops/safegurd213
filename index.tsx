
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// --- GLOBAL CRASH PREVENTION ---
// This acts as the final safety net. If a logic error occurs that isn't caught by React,
// these listeners prevent the browser from halting the entire script execution.

// 1. Prevent unhandled promise rejections (e.g., Network failures inside async functions)
window.addEventListener('unhandledrejection', (event) => {
    console.warn('🛡️ [System Shield] Caught unhandled promise rejection:', event.reason);
    // Prevent the default browser action (which might be to log an error and stop execution in strict mode)
    event.preventDefault();
});

// 2. Prevent general runtime errors (e.g., "undefined is not a function")
window.addEventListener('error', (event) => {
    console.warn('🛡️ [System Shield] Caught global error:', event.message);
    // Returning true prevents the firing of the default event handler
    // event.preventDefault(); // Optional depending on browser
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
