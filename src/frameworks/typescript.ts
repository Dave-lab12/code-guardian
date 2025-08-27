import { parse } from '@typescript-eslint/typescript-estree';

export interface ExtractedConstruct {
    type: 'function' | 'class' | 'interface' | 'variable' | 'export';
    name: string;
    content: string;
    startLine: number;
    endLine: number;
    metadata?: Record<string, any>;
}

export class TypeScriptASTParser {
    static async parseFile(content: string): Promise<{
        constructs: ExtractedConstruct[];
        imports: string[];
        exports: string[];
    }> {
        try {
            const ast = parse(content, {
                jsx: true,
                loc: true,
                range: true,
                errorOnUnknownASTType: false,
                errorOnTypeScriptSyntacticAndSemanticIssues: false,
                allowInvalidAST: true,
            });

            const lines = content.split('\n');
            const constructs: ExtractedConstruct[] = [];
            const imports: string[] = [];
            const exports: string[] = [];

            for (const node of ast.body) {

                if (node.type === 'ImportDeclaration') {
                    imports.push(node.source.value as string);
                    continue;
                }


                const extracted = this.extractFromNode(node, lines);
                constructs.push(...extracted);

                if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
                    exports.push('export'); // Could be more specific
                }
            }

            return { constructs, imports, exports };

        } catch (error) {
            console.warn(`Failed to parse TypeScript file ${content}:`, error);
            return {
                content,
                constructs: [],
                imports: [],
                exports: []
            };
        }
    }

    private static extractFromNode(node: any, lines: string[]): ExtractedConstruct[] {
        const constructs: ExtractedConstruct[] = [];

        switch (node.type) {
            case 'FunctionDeclaration':
                const funcName = node.id?.name || 'anonymous';
                constructs.push({
                    type: 'function',
                    name: funcName,
                    content: this.extractNodeContent(node, lines),
                    startLine: node.loc.start.line,
                    endLine: node.loc.end.line,
                    metadata: {
                        isAsync: node.async,
                        isGenerator: node.generator
                    }
                });
                break;

            case 'TSInterfaceDeclaration':
            case 'TSTypeAliasDeclaration':
                const typeName = node.id?.name || 'anonymous';
                constructs.push({
                    type: 'interface',
                    name: typeName,
                    content: this.extractNodeContent(node, lines),
                    startLine: node.loc.start.line,
                    endLine: node.loc.end.line
                });
                break;

            case 'ClassDeclaration':
                const className = node.id?.name || 'anonymous';
                constructs.push({
                    type: 'class',
                    name: className,
                    content: this.extractNodeContent(node, lines),
                    startLine: node.loc.start.line,
                    endLine: node.loc.end.line,
                    metadata: {
                        isAbstract: node.abstract,
                        superClass: node.superClass?.name
                    }
                });
                break;

            case 'VariableDeclaration':
                for (const declaration of node.declarations) {
                    const isFunctionType = declaration.init &&
                        (declaration.init.type === 'ArrowFunctionExpression' ||
                            declaration.init.type === 'FunctionExpression');

                    if (declaration.id?.name) {
                        constructs.push({
                            type: isFunctionType ? 'function' : 'variable',
                            name: declaration.id.name,
                            content: this.extractNodeContent(node, lines),
                            startLine: node.loc.start.line,
                            endLine: node.loc.end.line,
                            metadata: {
                                isArrowFunction: declaration.init?.type === 'ArrowFunctionExpression',
                                isConst: node.kind === 'const'
                            }
                        });
                    }
                }
                break;

            case 'ExportNamedDeclaration':
                if (node.declaration) {
                    const exported = this.extractFromNode(node.declaration, lines);
                    constructs.push(...exported.map(e => ({ ...e, metadata: { ...e.metadata, isExported: true } })));
                }
                break;
        }

        return constructs;
    }

    private static extractNodeContent(node: any, lines: string[]): string {
        if (!node.loc) return '';
        const startLine = node.loc.start.line;
        const endLine = node.loc.end.line;
        return lines.slice(startLine - 1, endLine).join('\n');
    }
}