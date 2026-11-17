import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Studio } from './Studio.js';
import '../styles.css';
import './studio.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element in skins.html.');

createRoot(root).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
