// Flat ESLint config (Q2) — run with: npm run lint
export default [
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-undef': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
        },
    },
    { ignores: ['node_modules/**', 'tmp/**', 'data/**', 'auth_info_baileys/**'] },
];
