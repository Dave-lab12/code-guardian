import { GoogleGenAI, Type } from '@google/genai';
import { SearchResult } from '../types';
import { Config } from '../config/config';
import { PromptLoader } from './promptLoader';

export class CodeReviewer {
    private ai: GoogleGenAI;
    config: Config;
    constructor() {
        this.ai = new GoogleGenAI({
            apiKey: Bun.env.GOOGLE_API_KEY
        });
        this.config = Config.getInstance();
    }

    formatContext(relevantChunks: SearchResult[]): string {
        return relevantChunks.map((chunk) => {
            const preview = chunk.content ? chunk.content.slice(0, 500) : '';
            return `### Similar ${chunk.type} (similarity: ${chunk.similarity.toFixed(3)})
  \`\`\`
  ${preview}
  \`\`\``;
        }).join('\n');
    }

    async generateReview(prompt: string): Promise<string> {
        console.log("🤖 Generating review with Gemini...");

        try {
            const response = await this.ai.models.generateContent({
                model: Bun.env.GOOGLE_MODEL || 'gemini-2.5-flash',
                contents: prompt,
            });

            const reviewText = response.text || 'No review generated';
            console.log("Review generated successfully");
            return reviewText;
        } catch (error) {
            console.error("Error generating review:", error);
            throw new Error('Failed to generate review');
        }
    }
    async generateAssistantResponse(command: string, context: AssistantContext): Promise<AssistantResponse> {
        console.log(`🤖 Processing assistant command: ${command}`);

        const promptType = this.detectCommandType(command);
        const promptPath = this.config.getFullPath(
            this.config.get().paths.promptsDir,
            `/assistant/${promptType}.txt`
        );

        const prompt = await PromptLoader.loadPrompt(promptPath, {
            command,
            issueTitle: context.issue.title,
            issueBody: context.issue.body || '',
            prFiles: context.prFiles?.map(f => `${f.filename}:\n${f.patch || f.raw_url}`).join('\n') || '',
            context: context.relevantChunks.map(c =>
                `${c.metadata?.type || c.type}: ${c.content?.slice(0, 300)}`
            ).join('\n')
        });

        try {
            const response = await this.ai.models.generateContent({
                model: Bun.env.GOOGLE_MODEL || 'gemini-2.5-flash',
                contents: prompt,
            });

            const result = response.text || 'No response generated';

            // Try to parse as JSON first
            try {
                const structured = JSON.parse(result);
                return {
                    type: 'structured',
                    data: structured,
                    raw: result
                };
            } catch {
                return {
                    type: 'text',
                    data: result,
                    raw: result
                };
            }
        } catch (error) {
            console.error("Error generating assistant response:", error);
            throw new Error('Failed to generate assistant response');
        }
    }

    async generateStructuredAssistantResponse(command: string, context: AssistantContext): Promise<AssistantResponse> {
        console.log(`🤖 Processing assistant command with structured output: ${command}`);

        const promptType = this.detectCommandType(command);
        const promptPath = this.config.getFullPath(
            this.config.get().paths.promptsDir,
            `/assistant/${promptType}.txt`
        );

        const prompt = await PromptLoader.loadPrompt(promptPath, {
            command,
            issueTitle: context.issue.title,
            issueBody: context.issue.body || '',
            prFiles: context.prFiles?.map(f => `${f.filename}:\n${f.patch || f.raw_url}`).join('\n') || '',
            context: context.relevantChunks.map(c =>
                `${c.metadata?.type || c.type}: ${c.content?.slice(0, 300)}`
            ).join('\n')
        });

        const responseSchema = {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    enum: ["create_pr", "comment_only", "needs_info", "error"]
                },
                message: {
                    type: Type.STRING,
                    description: "Main response message from Starscream"
                },
                title: {
                    type: Type.STRING,
                    description: "PR title (only for create_pr action)"
                },
                description: {
                    type: Type.STRING,
                    description: "PR description (only for create_pr action)"
                },
                questions: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.STRING
                    },
                    description: "List of questions (only for needs_info action)"
                },
                analysis: {
                    type: Type.STRING,
                    description: "Detailed analysis or explanation"
                }
            },
            required: ["action", "message"]
        };

        try {
            const response = await this.ai.models.generateContent({
                model: Bun.env.GOOGLE_MODEL || 'gemini-2.5-flash',
                contents: `${prompt}\n\nIMPORTANT: You must respond with valid JSON only. Your response should match the required schema.`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema
                }
            });

            const result = response.text || '{}';
            console.log('Raw structured LLM response:', result);

            try {
                const structured = JSON.parse(result);
                console.log('Successfully parsed structured response:', structured);

                return {
                    type: 'structured',
                    data: structured,
                    raw: result
                };
            } catch (parseError) {
                console.error('Failed to parse structured response:', parseError);
                console.error('Raw response was:', result);

                const jsonMatch = result.match(/```json\s*\n([\s\S]*?)\n\s*```/);
                if (jsonMatch) {
                    try {
                        const extractedJson = jsonMatch[1].trim();
                        console.log('Extracted JSON from markdown:', extractedJson);
                        const structured = JSON.parse(extractedJson);
                        console.log('Successfully parsed extracted JSON:', structured);

                        return {
                            type: 'structured',
                            data: structured,
                            raw: result
                        };
                    } catch (extractError) {
                        console.error('Failed to parse extracted JSON:', extractError);
                    }
                }

                // Fallback response
                return {
                    type: 'structured',
                    data: {
                        action: 'error',
                        message: 'I encountered an issue processing your request. Please try again.',
                        analysis: `Command: ${command}`
                    },
                    raw: result
                };
            }
        } catch (error) {
            console.error("Error generating structured assistant response:", error);

            return {
                type: 'structured',
                data: {
                    action: 'error',
                    message: 'I encountered a technical issue and cannot process your request right now.',
                    analysis: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                },
                raw: ''
            };
        }
    }


    private detectCommandType(command: string): string {
        const lowerCommand = command.toLowerCase();

        if (lowerCommand.includes('fix') || lowerCommand.includes('bug')) return 'fix';
        if (lowerCommand.includes('optimize') || lowerCommand.includes('performance')) return 'optimize';
        if (lowerCommand.includes('test') || lowerCommand.includes('spec')) return 'test';
        if (lowerCommand.includes('refactor') || lowerCommand.includes('clean')) return 'refactor';
        if (lowerCommand.includes('document') || lowerCommand.includes('comment')) return 'document';

        return 'general';
    }
}

export interface AssistantContext {
    issue: {
        title: string;
        body?: string;
        number: number;
    };
    prFiles?: any[];
    relevantChunks: SearchResult[];
}

export interface AssistantResponse {
    type: 'structured' | 'text';
    data: any;
    raw: string;
}