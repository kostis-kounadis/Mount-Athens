import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';

export default async function handler(request: Request, context: Context) {
  try {
    const store = getStore('events');
    const data = await store.get('current', { type: 'json' });

    if (!data) {
      // No data yet -- return empty events with a helpful message
      return new Response(JSON.stringify({
        events: [],
        updated_at: null,
        message: 'No events data available yet. The scraper has not run.',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[events] Error reading from Blobs: ${message}`);
    return new Response(JSON.stringify({
      events: [],
      error: 'Failed to retrieve events',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
