import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    base: '/telegram-scrapper/',        // і для dev, і для build
    server: {
        port: 5173,
        open: '/telegram-scrapper/',      // одразу відкриє правильний URL
    },
    preview: {
        port: 5173,
        open: '/telegram-scrapper/',      // vite preview теж відкриє підпапку
    },
})
