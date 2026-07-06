import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import PersonalityApp from "./personality/App";

const root = document.getElementById("root")!;
createRoot(root).render(
  <BrowserRouter>
    <PersonalityApp />
  </BrowserRouter>,
);
