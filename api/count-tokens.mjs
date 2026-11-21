import handler from "../netlify/functions/count-tokens.mjs";
import { vercelHandler } from "../lib/vercel-handler.mjs";

export default { fetch: vercelHandler(handler) };
