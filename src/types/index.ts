export interface BaseChunk {
    id: string | number;
    type: ChunkType;
    granularity: ChunkGranularity
    framework?: string;
    metadata?: Record<string, any>;
}

export type ChunkGranularity = 'file' | "document" | "script" | 'function' | 'component' | 'page' | 'class' | 'method' | "module" | "package" | "project" | "workspace" | "stylesheet" | "template" | "theme" | "template-partial" | "widget" | "chunk";


export interface PatternConfig {
    pattern: string;
    semantic: string;
    type: string;
    description: string;
    priority: number;
    metadata: Record<string, any>;
    exclude?: string[];
}


export type FrameworkPatterns = {
    [key: string]: PatternConfig;
}


export interface ChunkWithEmbedding extends BaseChunk {
    embedding: number[];
    contentLength: number;
}

export interface FrameworkParserInterface {
    parseFile(file: string, patternConfig: PatternConfig): Promise<{ chunk: BaseChunk, content: string }[]>;
}

export interface SearchResult extends ChunkWithEmbedding {
    similarity: number;
    content?: string;
}

export type BaseChunkType =
    | 'component'
    | 'page'
    | 'api-endpoint'
    | 'service'
    | 'model'
    | 'utility'
    | 'config'
    | 'documentation'
    | 'test';

export type ChunkType = BaseChunkType | string;

export interface IntegrityReport {
    validChunks: BaseChunk[];
    missingContent: BaseChunk[];
    orphanedFiles: string[];
    isValid: boolean;
}