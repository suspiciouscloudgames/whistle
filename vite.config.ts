import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { attachRooms } from "./server/rooms";
export default defineConfig({
  base: "/whistle/",
  plugins: [react(), {
    name: "whistle-rooms",
    configureServer(server) { if (server.httpServer) attachRooms(server.httpServer); },
    configurePreviewServer(server) { attachRooms(server.httpServer); },
  }],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        audioLab: fileURLToPath(new URL("./audio-lab/index.html", import.meta.url)),
      },
    },
  },
});
