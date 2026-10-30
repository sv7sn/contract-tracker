import App from "./App.tsx";
import { useLang } from "./i18n/index.ts";

// Al cambio lingua l'app si ridisegna da capo: ogni testo viene ricalcolato nella lingua nuova.
export default function Root() {
  const lang = useLang();
  return <App key={lang} />;
}
