import { defineConfig } from 'vite';

// The plugin URL is only known at runtime, so every asset (worker, codec
// chunks, .wasm files) is emitted flat into build/ and resolved relative to
// import.meta.url.
const output = {
	entryFileNames: '[name].js',
	chunkFileNames: '[name]-[hash].js',
	assetFileNames: '[name]-[hash][extname]',
};

export default defineConfig( {
	base: './',
	build: {
		outDir: 'build',
		assetsDir: '',
		emptyOutDir: true,
		target: 'es2022',
		modulePreload: false,
		rollupOptions: {
			input: 'src/main.js',
			output,
		},
	},
	worker: {
		format: 'es',
		rollupOptions: { output },
	},
} );
