export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      let count = 0;
      controller.enqueue(encoder.encode(': ping\n\n'));
      intervalId = setInterval(() => {
        count++;
        controller.enqueue(encoder.encode(`event: tick\ndata: ${JSON.stringify({ count, ts: Date.now() })}\n\n`));
        if (count >= 10) {
          clearInterval(intervalId);
          controller.close();
        }
      }, 1000);
    },
    cancel() {
      clearInterval(intervalId);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    }
  });
}
