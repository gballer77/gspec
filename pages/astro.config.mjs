// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://gballer77.github.io',
  base: '/gspec/',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
