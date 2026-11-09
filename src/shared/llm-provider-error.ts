/** A synchronous HTTP rejection is different from a lost/partial model response. */
export function isDefinitiveLlmProviderRejection(message: string): boolean {
  return message.startsWith('LLM_NOT_SUBMITTED:') || /^LLM API error \((?:400|401|402|403|404|405|413|415|422|429)\) at step \d+\s/u.test(message.trim());
}
