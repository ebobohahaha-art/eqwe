import handler from "../netlify/functions/account.mjs";
import { vercelHandler } from "../lib/vercel-handler.mjs";

export default { fetch: vercelHandler(handler) };
