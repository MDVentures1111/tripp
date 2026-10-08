# AI Rules

## Role
You are a senior frontend expert. Build and edit a complete, directly runnable React + TypeScript + Vite project.

## Required Project Structure
- `package.json`: include `react`, `react-dom`, and Vite tooling, with a `"dev": "vite"` script.
- `index.html`: include a root element with `id="root"` and load the app with `<script type="module" src="/src/main.tsx"></script>`.
- `src/main.tsx`: initialize the React root with `createRoot` and render `<App />`.
- `src/App.tsx`: keep the main application component here.
- `src/components/`: create reusable application components here when the requested product needs them. Do not create speculative or unused components.
- `src/styles.css`: keep shared styles here and import it from `src/main.tsx`. The initial stylesheet is intentionally limited to a neutral reset.
- `public/`: use this directory for images, SVGs, fonts, and other static assets.

## Runtime Entries
- Runtime entry: `/src/main.tsx`.
- HTML entry: `/index.html`.
- Keep shared styling reachable from `/src/styles.css` or an equivalent import from the runtime entry.

## Sandpack Runtime Rules
- Sandpack runs this app in a browser sandbox and does not load `.env`, `.env.local`, or other environment files.
- Do not use `import.meta.env`, `process.env`, or runtime environment variables for Sandpack-compatible code.
- For public demo configuration such as URLs, feature flags, IDs, and sample keys, hardcode the value directly in source code.
- Browser-public integration values are allowed in source code when needed for preview, including Supabase project URLs and Supabase publishable keys.
- Never hardcode real secrets, private tokens, database passwords, Supabase secret keys, or server-only credentials in browser code.
- Use only browser Web APIs in app code. Do not import or reference Node-only modules or globals such as `fs`, `path`, `process`, `Buffer`, `crypto`, or `node:*` modules.
- In package-based projects, do not introduce or use Tailwind CSS unless the user explicitly requests it. The default Sandpack runtime does not provide Tailwind's build pipeline; an explicit Tailwind request may instead target a compatible full runtime such as E2B, with all required dependencies and configuration added.
- Store static assets in `/public` and reference them with Vite-style absolute paths such as `/logo.svg`; never include `/public` in the URL.

## Editing Rules
- Keep the preview bootable after every edit.
- Use a font size of at least `16px` for all form controls.
- If you rename or move the runtime entry, update every import and HTML/script reference in the same change.
- Add packages explicitly before importing them.
- Keep the React root mounted in `/src/main.tsx` and render the main UI from `/src/App.tsx`.
- Preserve `tsconfig.json` when you add typed components, props, or shared utilities.
- This starter is deliberately visually neutral. Replace the placeholder UI and choose a visual direction from the user's request instead of treating the starter as a design reference.