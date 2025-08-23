import { parse } from '@typescript-eslint/typescript-estree';
import { Glob } from 'bun'
import hash from 'hash-it'
import { Config } from '../config/config';
import { BaseChunk, ChunkType, ChunkGranularity } from '../types';

export class Parser {
    private config: Config;
    private jsonSchema: BaseChunk[] = [];

    constructor() {
        this.config = Config.getInstance();
    }

    async chunkCodebase(targetDir: string): Promise<BaseChunk[]> {
        this.jsonSchema = [];
        const appConfig = this.config.get();
        const path = this.config.getFullPath(appConfig.paths.codebaseRoot, targetDir);
        const fileTypes = appConfig.parsing.supportedFileTypes;

        const glob = new Glob(`${path}/**/*.{${fileTypes.join(',')}}`);

        for await (const file of glob.scan(".")) {
            await this.processFile(file);
        }

        await this.saveSchema();
        console.log(`✅ Codebase chunking completed. Total chunks: ${this.jsonSchema.length}`);
        return this.jsonSchema;
    }

    private async processFile(file: string): Promise<void> {
        const extension = file.split('.').pop() || '';

        const processors: Record<string, () => Promise<void>> = {
            'svelte': () => this.parseSvelteFile(file),
            'ts': () => this.parseTypeScriptFile(file),
            'js': () => this.parseTypeScriptFile(file),
            'css': () => this.parseSimpleFile(file, 'css-rule'),
            'md': () => this.parseSimpleFile(file, 'documentation'),
            'json': () => this.parseSimpleFile(file, 'config-file'),
            'yml': () => this.parseSimpleFile(file, 'config-file'),
            'txt': () => this.parseSimpleFile(file, 'documentation'),
            'html': () => this.parseSimpleFile(file, 'documentation')
        };

        const processor = processors[extension];
        if (processor) {
            await processor();
        }
    }

    private async parseSvelteFile(file: string): Promise<void> {
        const isLayout = file.includes('+layout');
        const isPage = file.includes('+page');
        const type: ChunkType = isLayout ? 'svelte-layout' :
            isPage ? 'svelte-page' :
                'svelte-component';

        const fileContent = await Bun.file(file).text();
        const contentHash = hash(fileContent);

        const chunk: BaseChunk = {
            id: hash(`${file}:${type}`),
            type,
            hash: contentHash,
            granularity: isPage || isLayout ? 'page' : 'component'
        };

        await this.addChunk(chunk, fileContent);

        // Extract and parse script content
        const scriptContent = this.extractScriptFromSvelte(fileContent);
        if (scriptContent) {
            await this.parseScriptContent(scriptContent, file);
        }
    }

    private async parseTypeScriptFile(file: string): Promise<void> {
        try {
            const fileContent = await Bun.file(file).text();
            const ast = parse(fileContent, {
                jsx: true,
                loc: true,
                range: true,
                errorOnUnknownASTType: false,
                errorOnTypeScriptSyntacticAndSemanticIssues: false,
                allowInvalidAST: true,
            });

            await this.extractFromAST(ast, file, fileContent);
        } catch (error) {
            console.error(`Failed to parse ${file}:`, error);
            await this.parseSimpleFile(file, 'documentation');
        }
    }

    private async parseSimpleFile(file: string, type: ChunkType): Promise<void> {
        try {
            const fileContent = await Bun.file(file).text();
            const fileName = file.split('/').pop() || 'unknown';

            const chunk: BaseChunk = {
                id: hash(`${file}:${fileName}`),
                type,
                hash: hash(fileContent),
                granularity: 'file'
            };

            await this.addChunk(chunk, fileContent);
            console.log(`✅ Parsed ${type}: ${fileName}`);
        } catch (error) {
            console.error(`Failed to parse file ${file}:`, error);
        }
    }

    private extractScriptFromSvelte(content: string): string | null {
        const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
        return scriptMatch ? scriptMatch[1] : null;
    }

    private async parseScriptContent(scriptContent: string, filePath: string): Promise<void> {
        try {
            const ast = parse(scriptContent, {
                jsx: true,
                loc: true,
                range: true,
                errorOnUnknownASTType: false,
                errorOnTypeScriptSyntacticAndSemanticIssues: false,
                allowInvalidAST: true
            });
            await this.extractFromAST(ast, filePath, scriptContent);
        } catch (error) {
            console.log(`Failed to parse script in ${filePath}:`, error);
        }
    }

    private async extractFromAST(ast: any, filePath: string, fileContent: string): Promise<void> {
        const lines = fileContent.split('\n');

        for (const node of ast.body) {
            const nodeProcessors: Record<string, () => Promise<void>> = {
                'FunctionDeclaration': () => this.createFunctionChunk(node, filePath, lines),
                'VariableDeclaration': () => this.handleVariableDeclaration(node, filePath, lines),
                'TSInterfaceDeclaration': () => this.createTypeChunk(node, filePath, lines),
                'TSTypeAliasDeclaration': () => this.createTypeChunk(node, filePath, lines),
                'ClassDeclaration': () => this.createClassChunk(node, filePath, lines),
                'ExportNamedDeclaration': () => {
                    if (node.declaration) {
                        return this.extractFromAST({ body: [node.declaration] }, filePath, fileContent);
                    }
                    return Promise.resolve();
                }
            };

            const processor = nodeProcessors[node.type];
            if (processor) {
                await processor();
            }
        }
    }

    private async createFunctionChunk(node: any, filePath: string, lines: string[]): Promise<void> {
        const functionName = node.id?.name || 'anonymous';
        const content = this.extractNodeContent(node, lines);

        const chunk: BaseChunk = {
            id: hash(`${filePath}:${functionName}`),
            type: 'function',
            hash: hash(content),
            granularity: 'function'
        };

        await this.addChunk(chunk, content);
        console.log(`  Found function: ${functionName}`);
    }

    private async createTypeChunk(node: any, filePath: string, lines: string[]): Promise<void> {
        const typeName = node.id?.name || 'anonymous';
        const content = this.extractNodeContent(node, lines);

        const chunk: BaseChunk = {
            id: hash(`${filePath}:${typeName}`),
            type: 'type-definition',
            hash: hash(content),
            granularity: 'function'
        };

        await this.addChunk(chunk, content);
        console.log(`  Found type: ${typeName}`);
    }

    private async createClassChunk(node: any, filePath: string, lines: string[]): Promise<void> {
        const className = node.id?.name || 'anonymous';
        const content = this.extractNodeContent(node, lines);

        const chunk: BaseChunk = {
            id: hash(`${filePath}:${className}`),
            type: 'class',
            hash: hash(content),
            granularity: 'function'
        };

        await this.addChunk(chunk, content);
        console.log(`  Found class: ${className}`);

        // Extract individual methods
        if (node.body?.body) {
            for (const method of node.body.body) {
                if (method.type === 'MethodDefinition') {
                    await this.createMethodChunk(method, filePath, lines, className);
                }
            }
        }
    }

    private async createMethodChunk(node: any, filePath: string, lines: string[], className: string): Promise<void> {
        const methodName = node.key?.name || 'anonymous';
        const content = this.extractNodeContent(node, lines);

        const chunk: BaseChunk = {
            id: hash(`${filePath}:${className}.${methodName}`),
            type: 'function',
            hash: hash(content),
            granularity: 'function'
        };

        await this.addChunk(chunk, content);
        console.log(`    Found method: ${className}.${methodName}`);
    }

    private async handleVariableDeclaration(node: any, filePath: string, lines: string[]): Promise<void> {
        for (const declaration of node.declarations) {
            const isFunctionType = declaration.init &&
                (declaration.init.type === 'ArrowFunctionExpression' ||
                    declaration.init.type === 'FunctionExpression');

            if (isFunctionType) {
                const functionName = declaration.id?.name || 'anonymous';
                const content = this.extractNodeContent(node, lines);

                const chunk: BaseChunk = {
                    id: hash(`${filePath}:${functionName}`),
                    type: 'function',
                    hash: hash(content),
                    granularity: 'function'
                };

                await this.addChunk(chunk, content);
                console.log(`  Found arrow function: ${functionName}`);
            }
        }
    }

    private extractNodeContent(node: any, lines: string[]): string {
        const startLine = node.loc.start.line;
        const endLine = node.loc.end.line;
        return lines.slice(startLine - 1, endLine).join('\n');
    }

    private async addChunk(chunk: BaseChunk, content: string): Promise<void> {
        this.jsonSchema.push(chunk);
        await this.saveChunkContent(chunk.hash, content);
    }

    private async saveChunkContent(contentHash: string | number, content: string): Promise<void> {
        const config = this.config.get();
        const fileName = `${contentHash}.txt`;
        const filePath = this.config.getFullPath(config.paths.chunksDir, fileName);

        try {
            await Bun.write(filePath, content);
        } catch (error) {
            console.error(`❌ Failed to write content file ${fileName}:`, error);
        }
    }

    private async saveSchema(): Promise<void> {
        const config = this.config.get();
        const schemaPath = this.config.getFullPath(config.paths.chunksDir, config.paths.schemaFile);

        try {
            await Bun.write(schemaPath, JSON.stringify(this.jsonSchema, null, 2));
            console.log(`✅ Schema saved to ${schemaPath}`);
        } catch (error) {
            console.error('❌ Failed to save schema:', error);
            throw error;
        }
    }
}
// (async () => {x

// const parser = new Parser();
// const integrityChecker = new IntegrityChecker();
// await parser.chunkCodebase('/contents/mindplex')
// await integrityChecker.checkIntegrity('/contents/mindplex-chunks')
// })