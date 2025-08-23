export interface BaseChunk {
    id: string | number;
    type: ChunkType;
    hash: string | number;
    granularity: ChunkGranularity;
}

export interface ChunkWithEmbedding extends BaseChunk {
    embedding: number[];
    contentLength: number;
}

export interface SearchResult extends ChunkWithEmbedding {
    similarity: number;
    content?: string;
}

export type ChunkType =
    | 'svelte-component'
    | 'svelte-page'
    | 'svelte-layout'
    | 'function'
    | 'type-definition'
    | 'css-rule'
    | 'config-file'
    | 'documentation'
    | 'class';

export type ChunkGranularity = 'file' | 'function' | 'component' | 'page';

export interface IntegrityReport {
    validChunks: BaseChunk[];
    missingContent: BaseChunk[];
    orphanedFiles: string[];
    isValid: boolean;
}