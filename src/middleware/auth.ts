import { Context, Next } from 'hono';

export async function githubAuth(c: Context, next: Next) {
    const githubSecret = Bun.env.GITHUB_SECRET_KEY;
    const isDev = Bun.env.NODE_ENV === 'development';

    // If no dev mode, allow all requests
    if (!githubSecret || isDev) return next();

    if (c.req.path === '/') return next();

    const authHeader = c.req.header('x-github-secret');

    if (authHeader !== githubSecret) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    return next();
}
