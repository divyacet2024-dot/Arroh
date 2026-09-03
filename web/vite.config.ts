import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The backend already allows CORS from these dev origins, so a proxy is
    // optional. Keeping Vite's default port (5173) means the SPA runs against
    // the live API via VITE_API_BASE_URL without any backend change.
    port: 5173,
  },
});
