import handler from "../netlify/functions/admin.mjs";
import { vercelHandler } from "../lib/vercel-handler.mjs";

export default { fetch: vercelHandler(handler) };
