import { handleAiTools } from './ai_tools.js';

/*
 * Deprecated compatibility file.
 * The AI tools use user-owned API keys. Paid minutes open tool access only.
 * Do not replace user keys with Worker secrets here.
 */
export async function handleAiToolsWithAccountLicense(request, env) {
  return handleAiTools(request, env);
}
