import { clockRoute } from "../shared";

export const POST = (req: Request) => clockRoute(req, () => ({ action: "resume" }));
