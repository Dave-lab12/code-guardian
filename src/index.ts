import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Config } from './config/config';

import { ChunkSearcher, CodeReviewer, OpenAIEmbedder, Parser, PromptLoader, IntegrityChecker } from './lib'

const app = new Hono()

app.use('*', cors());
app.use('*', logger());

app.get('/', async (c) => {
  return c.json({
    status: 'healthy',
    service: 'Code Review API',
    timestamp: new Date().toISOString()
  });
});


app.post('/update-codebase', async (c) => {
  try {
    console.log('🔄 Starting codebase update...')
    const body = await c.req.json();
    const { targetDirectory = '/contents/mindplex' } = body;

    const parser = new Parser();
    await parser.chunkCodebase(targetDirectory);

    const embedder = new OpenAIEmbedder()
    await embedder.embedAllChunks()

    const integrityChecker = new IntegrityChecker();
    const integrityReport = await integrityChecker.checkIntegrity();

    console.log('✅ Codebase updated and embedded successfully!')

    return c.json({
      success: true,
      message: 'Codebase updated and embedded successfully',
      stats: {
        validChunks: integrityReport.validChunks.length,
        missingContent: integrityReport.missingContent.length,
        orphanedFiles: integrityReport.orphanedFiles.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error updating codebase:', error)
    return c.json({
      success: false,
      error: 'Failed to update codebase',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
})

app.post('/review-pr', async (c) => {
  try {
    const body = await c.req.json();
    const { changedCode, description, fileName } = body;

    if (!changedCode) {
      return c.json({
        success: false,
        error: 'changedCode is required'
      }, 400);
    }

    const searcher = new ChunkSearcher();
    await searcher.init();

    console.log('Finding relevant code context...')
    const relevantChunks = await searcher.findSimilarChunks(changedCode, 5);


    for (const chunk of relevantChunks) {
      chunk.content = await searcher.getChunkContent(chunk.hash);
    }

    const reviewer = new CodeReviewer();
    const contextString = reviewer.formatContext(relevantChunks);

    const config = Config.getInstance();

    const promptPath = config.getFullPath(
      config.get().paths.promptsDir,
      'review.txt'
    );

    const prompt = await PromptLoader.loadPrompt(promptPath, {
      fileName: fileName || 'Unknown file',
      description: description || 'No description provided',
      changedCode: changedCode,
      context: contextString
    });
    const review = await reviewer.generateReview(prompt);

    return c.json({
      success: true,
      review,
      relevantContext: relevantChunks.map(chunk => ({
        type: chunk.type,
        similarity: chunk.similarity,
        preview: chunk.content?.slice(0, 100) + '...'
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reviewing PR:', error)
    return c.json({
      success: false,
      error: 'Failed to review PR',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default app


// accept the new codebase and embed the new codebase 
// review pr and give feedback
