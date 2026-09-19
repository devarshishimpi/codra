import { createMiddleware } from 'hono/factory';
import type { ApiEnv } from '../ports';
import { wantsHtml } from '../http';
import { readSession } from '../sessions';

export const requireSession = createMiddleware<ApiEnv>(async (c, next) => {
  const session = await readSession(c);
  if (!session) {
    if (wantsHtml(c.req.raw)) {
      return c.redirect('/');
    }

    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await next();
});
