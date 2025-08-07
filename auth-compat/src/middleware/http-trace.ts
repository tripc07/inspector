import { Request, Response, NextFunction } from 'express';
import { HttpTrace } from '../types.js';

export interface HttpTraceCollector {
  httpTrace: HttpTrace[];
}

/**
 * Express middleware that captures HTTP requests and responses in wire format.
 * @param collector Object with httpTrace array to store captured traces
 */
export function createHttpTraceMiddleware(collector: HttpTraceCollector) {
  return (req: Request, res: Response, next: NextFunction) => {
    const trace: HttpTrace = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body && Object.keys(req.body).length > 0 ? req.body : undefined
    };

    // Capture response using Buffer approach
    const oldWrite = res.write;
    const oldEnd = res.end;
    const chunks: Buffer[] = [];

    res.write = function (chunk: any) {
      chunks.push(Buffer.from(chunk));
      return oldWrite.apply(res, arguments as any);
    };

    res.end = function (chunk?: any) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }

      const body = Buffer.concat(chunks).toString('utf8');

      // Capture response details
      trace.response = {
        status: res.statusCode,
        headers: res.getHeaders() as Record<string, any>,
        body: body
      };

      collector.httpTrace.push(trace);

      return oldEnd.apply(res, arguments as any);
    };

    next();
  };
}

export function displayTraces(serverTrace: HttpTrace[], authServerTrace: HttpTrace[]) {
  // Collect all traces and interleave them by timestamp
  const allTraces: any[] = [];

  serverTrace.forEach((trace: any) => {
    allTraces.push({ ...trace, source: 'MCP SERVER' });
  });

  authServerTrace.forEach((trace: any) => {
    allTraces.push({ ...trace, source: 'AUTH' });
  });

  // Sort all traces by timestamp for interleaved view
  if (allTraces.length > 0) {
    allTraces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Print interleaved traces
    console.log('\n  ====== INTERLEAVED HTTP TRACE ======');
    allTraces.forEach((trace: any, index: number) => {
      console.log(`\n  --- [${trace.source}] Request #${index + 1} ---`);
      console.log(`  Timestamp: ${trace.timestamp}`);

      // Request line
      console.log(`  ${trace.method} ${trace.url} HTTP/1.1`);

      // Request headers
      if (trace.headers) {
        Object.entries(trace.headers).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }

      // Request body
      if (trace.body) {
        console.log('');
        const bodyStr = typeof trace.body === 'string' ? trace.body : JSON.stringify(trace.body);
        console.log(`  ${bodyStr}`);
      }

      // Response
      if (trace.response) {
        console.log(`\n  HTTP/1.1 ${trace.response.status} ${getStatusText(trace.response.status)}`);

        // Response headers
        if (trace.response.headers) {
          Object.entries(trace.response.headers).forEach(([key, value]) => {
            console.log(`  ${key}: ${value}`);
          });
        }

        // Response body
        if (trace.response.body) {
          console.log('');
          const bodyStr = typeof trace.response.body === 'string'
            ? trace.response.body
            : JSON.stringify(trace.response.body);

          // Truncate very long responses
          if (bodyStr.length > 1000) {
            console.log(`  ${bodyStr.substring(0, 1000)}... [truncated]`);
          } else {
            console.log(`  ${bodyStr}`);
          }
        }
      }
      console.log('');
    });
    console.log('  ========================\n');
  }
}


function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    302: 'Found',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    500: 'Internal Server Error'
  };
  return statusTexts[status] || '';
}
