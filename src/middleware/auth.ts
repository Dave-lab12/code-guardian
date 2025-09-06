import { Context, Next } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';

const isPublicRoute = (path: string) => path === '/' || path === '/health';

export async function githubAuth(c: Context, next: Next) {
    const githubSecret = Bun.env.GITHUB_SECRET_KEY;
    const isDev = Bun.env.NODE_ENV === 'development';

    // If dev mode, allow all requests
    if (isDev || !githubSecret) return next();

    if (isPublicRoute(c.req.path)) return next();

    if (c.req.path === '/webhook') {
        const signature = c.req.header('x-hub-signature-256');
        const body = await c.req.text();

        const authResult = handleWebhookAuth({ githubSecret, signature, body });
        if (!authResult.success) {
            return c.json({ success: false, error: authResult.error }, 401);
        }

        // Store parsed body for webhook handler
        c.set('githubBody', authResult.data);
        return next();

    }
    const authHeader = c.req.header('x-github-secret');

    if (authHeader !== githubSecret) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    return next();
}
const handleWebhookAuth = ({
    githubSecret,
    signature,
    body
}: {
    githubSecret: string;
    signature: string | undefined;
    body: string;
}) => {
    if (!signature) {
        return { success: false, error: 'No signature provided' } as const;
    }

    const expectedSignature = 'sha256=' + createHmac('sha256', githubSecret)
        .update(body, 'utf8')
        .digest('hex');

    if (signature.length !== expectedSignature.length) {
        return { success: false, error: 'Invalid signature' };
    }

    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return { success: false, error: 'Invalid signature' } as const;
    }

    try {
        return { success: true, data: JSON.parse(body) } as const;
    } catch {
        return { success: false, error: 'Invalid JSON payload' } as const;
    }
};