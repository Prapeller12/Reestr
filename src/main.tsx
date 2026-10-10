// Точка входа SPA (Vite-entry: корневой index.html -> /src/main.tsx).
// Единственное подключение стилей — src/index.css (правила проекта §4).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AccessProvider from './components/access/AccessProvider';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Корневой элемент #root не найден в index.html');
}

createRoot(container).render(
  <StrictMode>
    <AccessProvider><App /></AccessProvider>
  </StrictMode>,
);
