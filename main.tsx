import { createRoot } from "react-dom/client";
import Home from "./app/page";
import { LanguageProvider } from "./components/whistle/Language";
import "./app/globals.css";
createRoot(document.getElementById("root")!).render(<LanguageProvider><Home /></LanguageProvider>);
