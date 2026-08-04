import { createRoot, type Root } from 'react-dom/client';
import { App } from './app/App';
import { ApplicationErrorBoundary } from './app/ApplicationErrorBoundary';
import './styles.css';

declare global {
  interface Window {
    __storydreamReactRoot?: Root;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

window.__storydreamReactRoot ??= createRoot(rootElement);
window.__storydreamReactRoot.render(
  <ApplicationErrorBoundary>
    <App />
  </ApplicationErrorBoundary>,
);
