export namespace PromptTemplate {
  export function render(text: string, vars: Record<string, string>) {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match)
  }

  export function defaults(input?: { model?: string; date?: string; credentials?: string }) {
    return {
      date: input?.date ?? new Date().toISOString().slice(0, 10),
      model_name: input?.model ?? "",
      credential_status: input?.credentials ?? "",
    }
  }
}
