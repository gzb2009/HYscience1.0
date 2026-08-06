/**
 * Skill Auto-Router — 根据数据文件类型和用户查询关键词自动匹配技能。
 *
 * 当 Agent 启动一个 session 时调用 `route()` 获取应预加载的 skill 列表。
 * 路由规则按优先级排列：文件扩展名 > 查询关键词 > 默认生物学技能。
 */

export namespace SkillRouter {
  /**
   * 单个文件信息
   */
  export interface File {
    name: string
    ext: string
    path: string
  }

  /**
   * 上下文：工作目录中的文件列表 + 用户的查询文本
   */
  export interface Context {
    files: File[]
    query: string
  }

  /**
   * 路由结果
   */
  export interface Route {
    /** 应该加载的 skill 名称列表 */
    skills: string[]
    /** 匹配原因，用于 Agent 向用户解释为什么选了这些技能 */
    reason: string
  }

  /**
   * 文件扩展名 → 技能映射
   */
  const FILE_SKILL_MAP: Record<string, string[]> = {
    ".h5ad": ["scanpy", "anndata", "scvi-tools"],
    ".h5": ["anndata", "scanpy"],
    ".loom": ["scanpy", "scvelo"],
    ".mtx": ["scanpy"],
    ".tiff": ["imc-analysis", "pcf-analysis"],
    ".tif": ["imc-analysis", "pcf-analysis"],
    ".mcd": ["imc-analysis"],
    ".fcs": ["flow-cytometry-analysis"],
    ".csv": ["statistical-analysis"],
    ".tsv": ["statistical-analysis"],
    ".txt": ["statistical-analysis"],
    ".fastq": ["pysam", "scanpy"],
    ".fasta": ["biopython"],
    ".bam": ["pysam"],
    ".vcf": ["clinvar-database"],
    ".rds": ["spatial-deconv"],
  }

  /**
   * 查询关键词 → 额外技能映射
   */
  const QUERY_SKILL_MAP: Record<string, string[]> = {
    "单细胞|single.cell|scrna|scatac": ["scanpy", "scvi-tools"],
    "空间|spatial|visium|merfish|xenium|slide.seq": ["squidpy", "spatial-deconv"],
    "imc|成像质谱|imaging.mass": ["imc-analysis", "pcf-analysis"],
    "pcf|蛋白相关|protein.correlation": ["pcf-analysis"],
    "rna.velocity|velocity|分化|发育|trajectory": ["scvelo"],
    "细胞通讯|cell.chat|配体|ligand.receptor": ["cellchat"],
    "差异表达|differential|deg|de.gene": ["pydeseq2"],
    "富集|enrichment|go|kegg|pathway": ["gseapy"],
    "蛋白|proteom|proteomic": ["uniprot-database", "string-database", "pcf-analysis"],
    "流式|flow.cytom": ["flow-cytometry-analysis"],
    "多组学|multi.omic|integration|整合": ["scvi-tools", "spatial-deconv"],
    "肿瘤微环境|tme|immune.infiltrat": ["cellchat", "scanpy"],
    "调控|regulon|转录因子|tf.target": ["scenic"],
    "niche|邻域|neighborhood|微环境": ["squidpy", "imc-analysis"],
  }

  /**
   * 基础生物学技能（总是建议但优先级低）
   */
  const BASE_BIOLOGY = ["biopython"]

  /**
   * 主路由函数
   */
  export function route(ctx: Context): Route {
    const skills = new Set<string>()
    const reasons: string[] = []

    // 1. 按文件扩展名匹配
    for (const file of ctx.files) {
      const ext = file.ext.toLowerCase()
      const matched = FILE_SKILL_MAP[ext]
      if (matched) {
        for (const s of matched) skills.add(s)
        reasons.push(`检测到 ${ext} 文件 → ${matched.join(", ")}`)
      }
    }

    // 2. 按查询关键词匹配
    const query = ctx.query.toLowerCase()
    for (const [pattern, matched] of Object.entries(QUERY_SKILL_MAP)) {
      if (new RegExp(pattern, "i").test(query)) {
        for (const s of matched) skills.add(s)
        if (!reasons.some((r) => r.includes(pattern.split("|")[0])))
          reasons.push(`查询包含 "${pattern.split("|")[0]}" → ${matched.join(", ")}`)
      }
    }

    // 3. 总是加载基础技能（去重）
    for (const s of BASE_BIOLOGY) skills.add(s)

    // 4. 如果没有任何匹配，返回通用生物学技能
    const result = [...skills]
    if (result.length === BASE_BIOLOGY.length) {
      return {
        skills: ["scanpy"],
        reason: "未检测到特定数据类型，默认加载通用单细胞分析技能",
      }
    }

    return {
      skills: result,
      reason: reasons.join("；"),
    }
  }

  /**
   * 只根据查询文本路由（无文件信息时使用）
   */
  export function routeByQuery(query: string): Route {
    return route({ files: [], query })
  }
}
