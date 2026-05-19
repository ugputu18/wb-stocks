import type { IncomingMessage } from "node:http";

export function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readBody(req: IncomingMessage): Promise<string> {
  return (await readBodyBuffer(req)).toString("utf8");
}
