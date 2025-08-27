import { nanoid } from 'nanoid';
import { TypeScriptASTParser } from './typescript';
import { parse as parseSvelte } from 'svelte/compiler';
import { BaseChunk } from '../types';

export const sveltekitPatterns = {
    serverRoutes: {
        pattern: '**/*+page.server.{js,ts}',
        semantic: 'api',
        description: 'SvelteKit server-side page handler',
        priority: 10,
        metadata: { runtime: 'server', type: 'page-endpoint' }
    },
    serverActions: {
        pattern: '**/*+server.{js,ts}',
        semantic: 'api',
        description: 'SvelteKit API endpoint',
        priority: 10,
        metadata: { runtime: 'server', type: 'rest-endpoint' }
    },
    clientPages: {
        pattern: '**/*+page.svelte',
        semantic: 'page',
        description: 'SvelteKit page component',
        priority: 10,
        metadata: { runtime: 'client', type: 'route-component' }
    },
    layouts: {
        pattern: '**/*+layout.svelte',
        semantic: 'component',
        description: 'SvelteKit layout wrapper',
        priority: 10,
        metadata: { runtime: 'client', type: 'layout-component' }
    },
    pageScripts: {
        pattern: '**/*+page.{js,ts}',
        semantic: 'util',
        description: 'SvelteKit page load function',
        priority: 10,
        metadata: { runtime: 'universal', type: 'data-loader' }
    },
    layoutScripts: {
        pattern: '**/*+layout.{js,ts}',
        semantic: 'util',
        description: 'SvelteKit layout load function',
        priority: 9,
        metadata: { runtime: 'universal', type: 'layout-loader' }
    },
    layoutServerScripts: {
        pattern: '**/*+layout.server.{js,ts}',
        semantic: 'api',
        description: 'SvelteKit layout server utilities (actions/load)',
        priority: 9,
        metadata: { runtime: 'server', type: 'layout-server' }
    },
    errorPages: {
        pattern: '**/*+error.svelte',
        semantic: 'error',
        description: 'SvelteKit error page',
        priority: 8,
        metadata: { runtime: 'client', type: 'error-component' }
    },
    hooksServer: {
        pattern: '**/*hooks.server.{js,ts}',
        semantic: 'api',
        description: 'SvelteKit server hooks',
        priority: 8,
        metadata: { runtime: 'server', type: 'hook' }
    },
    hooksClient: {
        pattern: '**/*hooks.client.{js,ts}',
        semantic: 'util',
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

        let result: { chunk: BaseChunk, content: string }[] = []

        if (filePath.endsWith('.svelte')) {
            result = result.concat(await this.parseSvelteFile(filePath, patternConfig))
        } else {
            result = result.concat(await this.parseTypeScriptFile(filePath, patternConfig))
        }

        return result
    }

    private async parseSvelteFile(filePath: string, patternConfig: any): Promise<{ chunk: BaseChunk, content: string }[]> {
        const content = await Bun.file(filePath).text();
        const results: { chunk: BaseChunk, content: string }[] = [];
        const svelteAst = parseSvelte(content);


        const templateChunks = this.splitLargeTemplate(content, svelteAst);
        for (const templateChunk of templateChunks) {
            results.push({
                chunk: {
                    id: nanoid(),
                    type: templateChunk.type === 'template' ? patternConfig.semantic : 'component',
                    framework: 'sveltekit',
                    metadata: {
                        filePath,
                        section: 'template',
                        ...templateChunk.metadata,
                        ...patternConfig.metadata
                    }
                },
                content: templateChunk.content
            });
        }


        const { instanceScript, moduleScript } = this.extractScripts(content, svelteAst);

        if (instanceScript && instanceScript.trim().length > 0) {
            const moduleParsed = await TypeScriptASTParser.parseFile(instanceScript);
            const instanceMeta = this.buildSvelteScriptMetadata(instanceScript, moduleParsed);

            results.push({
                chunk: {
                    id: nanoid(),
                    type: 'util',
                    framework: 'sveltekit',
                    metadata: {
                        filePath,
                        section: 'script',
                        subtype: 'variables',
                        variables: JSON.stringify(instanceMeta.variables),
                        props: JSON.stringify(instanceMeta.props),
                        reactiveStatements: JSON.stringify(instanceMeta.reactiveStatements),
                        stores: JSON.stringify(instanceMeta.stores),
                        imports: JSON.stringify(moduleParsed.imports),
                        exports: JSON.stringify(moduleParsed.exports),
                        ...patternConfig.metadata
                    }

                },
                content: instanceScript
            });


            for (const construct of moduleParsed.constructs) {
                results.push({
                    chunk: {
                        id: nanoid(),
                        type: 'util',
                        framework: 'sveltekit',
                        metadata: {
                            filePath,
                            section: 'script',
                            constructType: construct.type,
                            constructName: construct.name,
                            ...patternConfig.metadata,
                            ...construct.metadata
                        }
                    },
                    content: construct.content
                });
            }
        }

        return results;
    }


    private splitLargeTemplate(templateContent: string, svelteAst: any, maxTokens: number = 1000): Array<{ content: string, type: string, components: string[], metadata: any }> {
        const chunks = [];

        if (!svelteAst.html || !svelteAst.html.children) {
            return [{ content: templateContent, type: 'template', components: [], metadata: {} }];
        }

        for (const child of svelteAst.html.children) {
            const processedChunks = this.processASTNodeRecursive(child, templateContent, maxTokens);
            chunks.push(...processedChunks);
        }

        return chunks.length > 0 ? chunks : [{ content: templateContent, type: 'template', components: [], metadata: {} }];
    }
    private processASTNodeRecursive(node: any, sourceContent: string, maxTokens: number): any[] {
        const nodeResult = this.processASTNode(node, sourceContent);

        if (!nodeResult || nodeResult.estimatedTokens <= maxTokens) {
            return nodeResult ? [nodeResult] : [];
        }

        if (node.children && node.children.length > 0) {
            const childChunks = [];
            for (const child of node.children) {
                childChunks.push(...this.processASTNodeRecursive(child, sourceContent, maxTokens));
            }

            if (childChunks.length > 1) {
                return childChunks;
            }
        }

        console.warn(`Large chunk: ${nodeResult.estimatedTokens} tokens`);
        return [nodeResult];
    }

    private processASTNode(node: any, sourceContent: string): { content: string, type: string, components: string[], metadata: any, estimatedTokens: number } | null {
        if (!node.start || !node.end) return null;

        const content = sourceContent.slice(node.start, node.end);
        const estimatedTokens = content.length / 4;

        switch (node.type) {
            case 'Element':
                const components = this.extractComponentsFromASTNode(node);
                return {
                    content,
                    type: `element-${node.name}`,
                    components,
                    metadata: {
                        tagName: node.name,
                        attributes: JSON.stringify(this.extractAttributes(node)),
                        hasSlots: this.hasSlots(node),
                        hasBindings: this.hasBindings(node)
                    },
                    estimatedTokens
                };

            case 'Component':
                return {
                    content,
                    type: 'component-usage',
                    components: [node.name],
                    metadata: {
                        componentName: node.name,
                        props: this.extractProps(node),
                        hasSlots: this.hasSlots(node)
                    },
                    estimatedTokens
                };

            case 'IfBlock':
            case 'EachBlock':
            case 'AwaitBlock':
            case 'KeyBlock':
                const blockComponents = this.extractComponentsFromASTNode(node);
                return {
                    content,
                    type: `block-${node.type.toLowerCase().replace('block', '')}`,
                    components: blockComponents,
                    metadata: {
                        blockType: node.type,
                        expression: this.extractExpression(node)
                    },
                    estimatedTokens
                };

            case 'Text':

                if (estimatedTokens < 50) return null;
                return {
                    content,
                    type: 'text-content',
                    components: [],
                    metadata: {},
                    estimatedTokens
                };

            default:
                return {
                    content,
                    type: `unknown-${node.type}`,
                    components: this.extractComponentsFromASTNode(node),
                    metadata: { nodeType: node.type },
                    estimatedTokens
                };
        }
    }

    private extractProps(node: any): Record<string, any> {
        const props: Record<string, any> = {};

        if (node.attributes) {
            for (const attr of node.attributes) {
                if (attr.type === 'Attribute') {
                    props[attr.name] = attr.value;
                } else if (attr.type === 'Spread') {
                    props['...spread'] = true;
                }
            }
        }

        return props;
    }
    private extractComponentsFromASTNode(node: any): string[] {
        const components = new Set<string>();


        const walkNode = (n: any) => {
            if (n.type === 'Component') {
                components.add(n.name);
            }


            if (n.children) {
                for (const child of n.children) {
                    walkNode(child);
                }
            }


            if (n.consequent) walkNode(n.consequent);
            if (n.alternate) walkNode(n.alternate);
            if (n.body) walkNode(n.body);
            if (n.pending) walkNode(n.pending);
            if (n.then) walkNode(n.then);
            if (n.catch) walkNode(n.catch);
        };

        walkNode(node);
        return Array.from(components);
    }

    private extractAttributes(node: any): Record<string, any> {
        const attrs: Record<string, any> = {};

        if (node.attributes) {
            for (const attr of node.attributes) {
                if (attr.type === 'Attribute') {
                    attrs[attr.name] = attr.value;
                } else if (attr.type === 'Binding') {
                    attrs[`bind:${attr.name}`] = attr.expression;
                }
            }
        }

        return attrs;
    }

    private extractExpression(node: any): string | null {
        switch (node.type) {
            case 'IfBlock':
                return node.expression ? this.nodeToString(node.expression) : null;

            case 'EachBlock':
                return node.expression ? this.nodeToString(node.expression) : null;

            case 'AwaitBlock':
                return node.expression ? this.nodeToString(node.expression) : null;

            case 'KeyBlock':
                return node.expression ? this.nodeToString(node.expression) : null;

            default:
                return null;
        }
    }
    private nodeToString(node: any): string {

        if (!node) return '';

        switch (node.type) {
            case 'Identifier':
                return node.name;

            case 'MemberExpression':
                return `${this.nodeToString(node.object)}.${this.nodeToString(node.property)}`;

            case 'CallExpression':
                const args = node.arguments?.map((arg: any) => this.nodeToString(arg)).join(', ') || '';
                return `${this.nodeToString(node.callee)}(${args})`;

            case 'Literal':
                return typeof node.value === 'string' ? `"${node.value}"` : String(node.value);

            default:

                return `[${node.type}]`;
        }
    }
    private hasSlots(node: any): boolean {

        return this.findInNode(node, n => n.type === 'Slot') !== null;
    }

    private hasBindings(node: any): boolean {

        return this.findInNode(node, n => n.type === 'Binding') !== null;
    }

    private findInNode(node: any, predicate: (n: any) => boolean): any {
        if (predicate(node)) return node;

        const toSearch = [
            ...(node.children || []),
            ...(node.attributes || []),
            node.consequent,
            node.alternate,
            node.body,
            node.then,
            node.catch,
            node.pending
        ].filter(Boolean);

        for (const child of toSearch) {
            const found = this.findInNode(child, predicate);
            if (found) return found;
        }

        return null;
    }

    private buildSvelteScriptMetadata(scriptText: string, tsParsed: any) {
        const variables = new Set<string>();
        const props = new Set<string>();
        const reactiveStatements = new Array<string>();
        const stores = new Set<string>();


        const exportLetRegex = /export\s+let\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
        for (const m of scriptText.matchAll(exportLetRegex)) props.add(m[1]);


        for (const c of tsParsed.constructs) {
            if (c.type === 'variable') variables.add(c.name);
            if (c.type === 'function' || c.type === 'class' || c.type === 'interface' || c.type === 'type' || c.type === 'enum') variables.add(c.name);
        }


        const reactiveRegex = /\$:\s*(.+)/g;
        for (const m of scriptText.matchAll(reactiveRegex)) reactiveStatements.push(m[1].trim());


        const storeRegex = /(^|\W)\$([A-Za-z_$][A-Za-z0-9_$]*)/g;
        for (const m of scriptText.matchAll(storeRegex)) stores.add(m[2]);

        return {
            variables: Array.from(variables),
            props: Array.from(props),
            reactiveStatements,
            stores: Array.from(stores),
            imports: tsParsed.imports,
            exports: tsParsed.exports
        };
    }

    private extractScripts(source: string, svelteAst: any) {
        let instanceScript = '';
        let moduleScript = '';

        for (const node of svelteAst.instance ? [svelteAst.instance] : []) {
            instanceScript = source.slice(node.start, node.end).replace(/^<script[^>]*>|<\/script>$/g, '').trim();
        }
        for (const node of svelteAst.module ? [svelteAst.module] : []) {
            moduleScript = source.slice(node.start, node.end).replace(/^<script[^>]*>|<\/script>$/g, '').trim();
        }
        return { instanceScript, moduleScript };
    }

    private async parseTypeScriptFile(filePath: string, patternConfig: any): Promise<{ chunk: BaseChunk, content: string }[]> {
        const content = await Bun.file(filePath).text();
        const { constructs } = await TypeScriptASTParser.parseFile(content);
        const results: { chunk: BaseChunk, content: string }[] = [];


        results.push({
            chunk: {
                id: nanoid(),
                type: patternConfig.semantic,
                framework: 'sveltekit',
                metadata: {
                    filePath,
                    ...patternConfig.metadata
                }
            },
            content
        });


        for (const construct of constructs) {
            const svelteKitType = this.classifySvelteKitConstruct(construct, filePath);

            results.push({
                chunk: {
                    id: nanoid(),
                    type: svelteKitType.semantic,
                    framework: 'sveltekit',
                    metadata: {
                        filePath,
                        constructType: construct.type,
                        constructName: construct.name,
                        svelteKitFunction: svelteKitType.function,
                        ...patternConfig.metadata,
                        constructMetadata: JSON.stringify(construct.metadata)
                    }
                },
                content: construct.content
            });
        }

        return results;
    }

    private classifySvelteKitConstruct(construct: any, filePath: string): { semantic: string, function: string } {
        const content = construct.content;


        if (construct.name === 'load' || /export\s+const\s+load/.test(content)) {
            return { semantic: 'util', function: 'load-function' };
        }


        if (filePath.includes('+page.server.') && /export\s+const\s+actions/.test(content)) {
            return { semantic: 'api', function: 'form-actions' };
        }


        if (filePath.includes('+server.') && /export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE)/.test(content)) {
            return { semantic: 'api', function: 'api-handler' };
        }


        return { semantic: 'util', function: 'helper' };
    }
}


