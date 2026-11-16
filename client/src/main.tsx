import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './fx.css';
import { setMotionEnabled } from './lib/motion';

setMotionEnabled(true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Application de bureau : réserve la barre de titre personnalisée.
if ((window as any).endbuyDesktop) document.documentElement.style.setProperty('--titlebar-h', '32px');
