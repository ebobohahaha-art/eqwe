import handler from "../netlify/functions/messages.mjs";
import { vercelHandler } from "../lib/vercel-handler.mjs";

export default { fetch: vercelHandler(handler) };
