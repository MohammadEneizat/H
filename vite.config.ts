/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Classic JSX runtime (React.createElement) so the artifact build can use the
// React UMD globals from a CDN instead of bundling React.
export default defineConfig(({ mode }) => ({
  base: './',
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
  },
  build:
    mode === 'artifact'
      ? {
          outDir: 'dist-artifact',
          emptyOutDir: true,
          cssCodeSplit: false,
          rollupOptions: {
            input: 'src/main.tsx',
            external: ['react', 'react-dom', 'react-dom/client'],
            output: {
              format: 'iife',
              entryFileNames: 'app.js',
              assetFileNames: 'app[extname]',
              globals: {
                react: 'React',
                'react-dom': 'ReactDOM',
                'react-dom/client': 'ReactDOM',
              },
            },
          },
        }
      : { outDir: 'dist' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
