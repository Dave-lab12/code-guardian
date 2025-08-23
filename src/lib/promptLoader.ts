export class PromptLoader {
    static async loadPrompt(promptPath: string, variables: Record<string, string>): Promise<string> {
        let prompt = await Bun.file(promptPath).text();

        for (const [key, value] of Object.entries(variables)) {
            prompt = prompt.replaceAll(`{{${key}}}`, value);
        }

        return prompt;
    }
}