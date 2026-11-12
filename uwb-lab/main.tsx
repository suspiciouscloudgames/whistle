import { createRoot } from "react-dom/client";
import Lab from "./Lab";
import "./style.css";

const root = createRoot(document.getElementById("root")!);
root.render(<Lab />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
