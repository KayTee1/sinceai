import { clockRoute } from "../shared";

// { days } fast-forwards; { toNextEvent: true } jumps to the next due event.
export const POST = (req: Request) =>
  clockRoute(req, (b) => (b.toNextEvent === true ? { action: "next_due" } : { action: "advance", days: Number(b.days) }));
