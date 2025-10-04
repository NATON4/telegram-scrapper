import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    base: '/telegram-scrapper/',
    server: {
        port: 5173,
        open: '/telegram-scrapper/',
    },
    preview: {
        port: 5173,
        open: '/telegram-scrapper/',
    },
})
