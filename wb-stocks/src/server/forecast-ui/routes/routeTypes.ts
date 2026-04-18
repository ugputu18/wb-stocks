import type { IncomingMessage, ServerResponse } from "node:http";

export type ForecastRouteMatch = {
  match: (req: IncomingMessage, url: URL) => boolean;
  handle: (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ) => void | Promise<void>;
};
