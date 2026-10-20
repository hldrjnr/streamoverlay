import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ChatOverlay } from "./components/ChatOverlay";
import "./styles/globals.css";

const windowLabel = getCurrentWindow().label;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {windowLabel === "chat" ? <ChatOverlay /> : <App />}
  </React.StrictMode>
);
