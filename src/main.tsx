import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // Storage/network restrictions may prevent caching. The loaded editor remains usable.
  });
}
