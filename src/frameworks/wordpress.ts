export const wordpressPatterns = {
    themes: { pattern: '**/themes/**/*.php', type: 'template' },
    plugins: { pattern: '**/plugins/**/*.php', type: 'plugin' },
    hooks: { pattern: '**/*-hooks.php', type: 'hook' },
    api: { pattern: '**/api/**/*.php', type: 'api-endpoint' }
};