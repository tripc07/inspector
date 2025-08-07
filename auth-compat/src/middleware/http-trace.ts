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