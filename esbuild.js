const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcher = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => console.log('[watch] build started'));
        build.onEnd((result) => {
            for (const { text, location } of result.errors) {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            }
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    // ── Main process ──────────────────────────────────────────────────
    const mainCtx = await esbuild.context({
        entryPoints: ['src/main.ts'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        outfile: 'dist/main.js',
        external: ['electron', '@google/genai', '@modelcontextprotocol/sdk', 'openai', '@anthropic-ai/sdk'],
        logLevel: 'silent',
        plugins: [problemMatcher],
    });

    // ── Preload script ────────────────────────────────────────────────
    const preloadCtx = await esbuild.context({
        entryPoints: ['src/preload.ts'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        outfile: 'dist/preload.js',
        external: ['electron'],
        logLevel: 'silent',
        plugins: [problemMatcher],
    });

    if (watch) {
        await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
    } else {
        await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild()]);
        await Promise.all([mainCtx.dispose(), preloadCtx.dispose()]);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
