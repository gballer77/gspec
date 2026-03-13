# gspec Documentation Site

The marketing and documentation website for [gspec](https://github.com/gballer77/gspec) — structured product specifications for AI-assisted development.

Built with [Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com), deployed to GitHub Pages.

## Pages

- **`/`** — Landing page with hero, problem statement, workflow overview, commands overview, and platform support
- **`/docs`** — Full documentation
- **`/getting-started`** — Getting started guide

## Development

All commands are run from the `pages/` directory:

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at localhost:4321
npm run build        # Build for production
npm run preview      # Preview the production build locally
```

## Deployment

The site is automatically deployed to GitHub Pages via the workflow at [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). Pushes to `main` trigger a build and deploy.

## Project Structure

```
pages/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable Astro components (Navbar, Hero, Footer, etc.)
│   ├── layouts/         # Page layouts (BaseLayout, SidebarLayout)
│   └── pages/           # Route pages (index, docs, getting-started)
├── astro.config.mjs     # Astro configuration
├── package.json
└── tailwind.config.mjs  # Tailwind configuration (if present)
```
