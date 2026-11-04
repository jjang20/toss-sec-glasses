import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { capturePairingToken } from './lib/api.ts';
import './styles.css';

capturePairingToken();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
