import '@fontsource-variable/inter';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useLang } from './i18n/index.ts'

// Al cambio lingua l'app si ridisegna da capo: ogni testo viene ricalcolato nella lingua nuova.
function Root() { const lang = useLang(); return <App key={lang} />; }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
