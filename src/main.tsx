import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createLoader } from './data/loader';
import { createTransport } from './worker/transport';
import './styles/tokens.css';
import './styles/app.css';

/** One worker for the life of the tab, one loader over it. Both live outside React. */
const loader = createLoader(createTransport());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App loader={loader} />
  </StrictMode>,
);
