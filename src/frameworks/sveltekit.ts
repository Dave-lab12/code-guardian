import { nanoid } from 'nanoid';
import { TypeScriptASTParser } from './typescript';
import { parse as parseSvelte } from 'svelte/compiler';
import { BaseChunk, FrameworkPatterns } from '../types';

export const sveltekitPatterns: FrameworkPatterns = {
    serverRoutes: {
        pattern: '**/*+page.server.{js,ts}',
        type: 'api',
        semantic: 'page-endpoint',
        description: 'SvelteKit server-side page handler',
        priority: 10,
        metadata: { runtime: 'server', type: 'page-endpoint' }
    },
    serverActions: {
        pattern: '**/*+server.{js,ts}',
        semantic: 'api-endpoint',
        type: 'api',
        description: 'SvelteKit API endpoint',
        priority: 10,
        metadata: { runtime: 'server', type: 'rest-endpoint' }
    },
    clientPages: {
        pattern: '**/*+page.svelte',
        semantic: 'page',
        type: 'component',
        description: 'SvelteKit page component',
        priority: 10,
        metadata: { runtime: 'client', type: 'route-component' }
    },
    layouts: {
        pattern: '**/*+layout.svelte',
        semantic: 'component',
        type: 'component',
        description: 'SvelteKit layout wrapper',
        priority: 10,
        metadata: { runtime: 'client', type: 'layout-component' }
    },
    pageScripts: {
        pattern: '**/*+page.{js,ts}',
        semantic: 'util',
        type: 'script',
        description: 'SvelteKit page load function',
        priority: 10,
        metadata: { runtime: 'universal', type: 'data-loader' }
    },
    layoutScripts: {
        pattern: '**/*+layout.{js,ts}',
        semantic: 'util',
        type: 'script',
        description: 'SvelteKit layout load function',
        priority: 9,
        metadata: { runtime: 'universal', type: 'layout-loader' }
    },
    layoutServerScripts: {
        pattern: '**/*+layout.server.{js,ts}',
        semantic: 'api',
        type: 'api',
        description: 'SvelteKit layout server utilities',
        priority: 9,
        metadata: { runtime: 'server', type: 'layout-server' }
    },
    errorPages: {
        pattern: '**/*+error.svelte',
        semantic: 'error',
        type: 'component',
        description: 'SvelteKit error page',
        priority: 8,
        metadata: { runtime: 'client', type: 'error-component' }
    },
    hooksServer: {
        pattern: '**/*hooks.server.{js,ts}',
        semantic: 'api',
        type: 'api',
        description: 'SvelteKit server hooks',
        priority: 8,
        metadata: { runtime: 'server', type: 'hook' }
    },
    hooksClient: {
        pattern: '**/*hooks.client.{js,ts}',
        semantic: 'util',
        type: 'script',
        description: 'SvelteKit client hooks',
        priority: 7,
        metadata: { runtime: 'client', type: 'hook' }
    }
};
export interface FrameworkParserInterface {
    parseFile(file: string, patternConfig: any): Promise<{ chunk: BaseChunk, content: string }[]>;
}


export class SvelteKitParser implements FrameworkParserInterface {

    async parseFile(filePath: string, patternConfig: any): Promise<{ chunk: BaseChunk, content: string }[]> {
        const content = await Bun.file(filePath).text();

        if (filePath.endsWith('.svelte')) {
            return this.chunkSvelteFile(content, filePath, patternConfig);
        }

        return this.chunkTypeScriptFile(content, filePath, patternConfig);
    }

    private async chunkSvelteFile(content: string, filePath: string, patternConfig: any) {
        const results = [];
        const ast = parseSvelte(content);

        if (ast.instance) {
            const script = content.slice(ast.instance.start, ast.instance.end);
            results.push({
                chunk: {
                    id: nanoid(),
                    type: 'script',
                    framework: 'sveltekit',
                    metadata: { filePath, section: 'script', ...patternConfig.metadata }
                },
                content: script
            });
        }

        if (ast.html) {
            const template = content.slice(ast.html.start, ast.html.end);
            if (template.length / 4 > 2000) {
                const chunks = this.splitBySize(template, 6000);
                results.push(...chunks.map((chunk, i) => ({
                    chunk: {
                        id: nanoid(),
                        type: patternConfig.semantic,
                        granularity: 'file',
                        framework: 'sveltekit',
                        metadata: { filePath, section: 'template', part: i + 1, ...patternConfig.metadata }
                    },
                    content: chunk
                })));
            } else {
                results.push({
                    chunk: {
                        id: nanoid(),
                        type: patternConfig.semantic,
                        granularity: 'template',
                        framework: 'sveltekit',
                        metadata: { filePath, section: 'template', ...patternConfig.metadata }
                    },
                    content: template
                });
            }
        }

        return results.length ? results : [{
            chunk: {
                id: nanoid(),
                type: patternConfig.semantic,
                framework: 'sveltekit',
                metadata: { filePath, ...patternConfig.metadata }
            },
            content
        }];
    }

    private async chunkTypeScriptFile(content: string, filePath: string, patternConfig: any) {
        const { constructs } = await TypeScriptASTParser.parseFile(content);
        const results = [];
        let buffer = [];
        let bufferSize = 0;

        for (const construct of constructs) {
            const size = construct.content.length / 4;

            if (size > 1500) {
                if (buffer.length > 0) {
                    results.push(buffer.join('\n\n'));
                    buffer = [];
                    bufferSize = 0;
                }
                results.push(construct.content);
            } else if (bufferSize + size > 1500) {
                results.push(buffer.join('\n\n'));
                buffer = [construct.content];
                bufferSize = size;
            } else {
                buffer.push(construct.content);
                bufferSize += size;
            }
        }

        if (buffer.length > 0) {
            results.push(buffer.join('\n\n'));
        }

        return results.map(chunk => ({
            chunk: {
                id: nanoid(),
                type: patternConfig.semantic,
                framework: 'sveltekit',
                metadata: { filePath, ...patternConfig.metadata }
            },
            content: chunk
        }));
    }

    private splitBySize(text: string, maxChars: number): string[] {
        const chunks = [];
        const lines = text.split('\n');
        let current = [];
        let currentSize = 0;

        for (const line of lines) {
            if (currentSize + line.length > maxChars && current.length > 0) {
                chunks.push(current.join('\n'));
                current = [line];
                currentSize = line.length;
            } else {
                current.push(line);
                currentSize += line.length + 1;
            }
        }

        if (current.length > 0) {
            chunks.push(current.join('\n'));
        }

        return chunks;
    }
}
