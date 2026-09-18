export namespace BashRisk {
  export type Level = "low" | "medium" | "high"

  const HIGH =
    /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\b|\bmkfs\b|\bdd\s+if=|\bchmod\s+[-]*[0-7]*777\b|\bsudo\s+rm\b|\bgit\s+push\b[^\n]*--force|\bcurl\b[\s\S]{0,200}\|\s*(?:ba)?sh\b|\bwget\b[\s\S]{0,200}\|\s*(?:ba)?sh\b|>\s*[^\s;|&]*\.(?:h5ad|rds|vcf|bam|csv|parquet)\b/i
  const MEDIUM = /\brm\b|\bmv\b|\bchmod\b|\bchown\b|\bgit\s+reset\s+--hard\b|\btruncate\b/i

  export function classify(command: string): Level {
    if (HIGH.test(command)) return "high"
    if (MEDIUM.test(command)) return "medium"
    return "low"
  }

  export function permission(level: Level) {
    if (level === "high") return "destructive"
    return "bash"
  }
}
