import PROMPT_GENOMICS from "../agent/prompt/biology-profiles/genomics.txt"
import PROMPT_SINGLE_CELL from "../agent/prompt/biology-profiles/single-cell.txt"
import PROMPT_IMC from "../agent/prompt/biology-profiles/imc.txt"
import PROMPT_SPATIAL from "../agent/prompt/biology-profiles/spatial.txt"
import PROMPT_PROTEOMICS from "../agent/prompt/biology-profiles/proteomics.txt"
import PROMPT_STRUCTURE from "../agent/prompt/biology-profiles/structure.txt"
import PROMPT_CHEMO from "../agent/prompt/biology-profiles/chemo.txt"

export type BiologyProfile = "genomics" | "single-cell" | "imc" | "spatial" | "proteomics" | "structure" | "chemo"

const FRAGMENTS: Record<BiologyProfile, string> = {
  genomics: PROMPT_GENOMICS,
  "single-cell": PROMPT_SINGLE_CELL,
  imc: PROMPT_IMC,
  spatial: PROMPT_SPATIAL,
  proteomics: PROMPT_PROTEOMICS,
  structure: PROMPT_STRUCTURE,
  chemo: PROMPT_CHEMO,
}

const EXT: Record<BiologyProfile, RegExp> = {
  imc: /\.(mcd)$/i,
  spatial: /\.(zarr)$/i,
  genomics: /\.(vcf|bcf|bam|sam|cram|fastq|fq|fasta|fa|fna|bed|gtf|gff3?)(\.gz)?$/i,
  "single-cell": /\.(h5ad|loom|h5seurat)$/i,
  proteomics: /\.(mzml|mzxml|raw|mgf)$/i,
  structure: /\.(pdb|cif|mmcif)$/i,
  chemo: /\.(sdf|mol|mol2|smi|smiles)$/i,
}

const SINGLE_CELL_TABLE = /(?:^|[/_-])(?:cluster[_-]?)?markers?(?:[_-].*)?\.(csv|tsv)$/i

const KEYWORDS: Record<BiologyProfile, RegExp> = {
  imc: /\b(imc|imaging.?mass|hyperion|mcd)\b|成像质谱/i,
  spatial: /\b(spatial|visium|merfish|xenium|stereo.?seq|slide.?seq|squidpy)\b|空间转录组/i,
  genomics: /\b(variant|gwas|wgs|wes|fastq|alignment|bwa|gatk|vcf|crispr)\b/i,
  "single-cell":
    /\b(single[- ]?cell|scrna|sc-rna|h5ad|scanpy|seurat|umap|leiden|cell[- ]?type|marker gene|cluster markers?)\b|单细胞|(?:细胞|亚群).{0,8}注释/i,
  proteomics: /\b(proteom|mass.?spec|peptide|mzml|maxquant|diann)\b/i,
  structure: /\b(alphafold|pdb|protein structure|docking|folding|cryo-?em)\b/i,
  chemo: /\b(smiles|ligand|chembl|rdkit|qsar|admet|small molecule|compound library)\b/i,
}

export namespace BiologyProfile {
  export function fragment(profile: BiologyProfile) {
    return FRAGMENTS[profile]
  }

  /** Explicit override from a hybio marker in the user message, if present. */
  export function fromMarker(text: string): BiologyProfile | undefined {
    const m = text.match(
      /<biology-profile>\s*(genomics|single-cell|imc|spatial|proteomics|structure|chemo)\s*<\/biology-profile>/i,
    )
    if (!m) return undefined
    return m[1].toLowerCase() as BiologyProfile
  }

  export function detect(input: { text?: string; filenames?: string[] }): BiologyProfile | undefined {
    const marked = input.text ? fromMarker(input.text) : undefined
    if (marked) return marked

    const names = input.filenames ?? []
    if (names.some((name) => SINGLE_CELL_TABLE.test(name))) return "single-cell"
    for (const profile of Object.keys(EXT) as BiologyProfile[]) {
      if (names.some((n) => EXT[profile].test(n))) return profile
    }

    const text = input.text ?? ""
    for (const profile of Object.keys(KEYWORDS) as BiologyProfile[]) {
      if (KEYWORDS[profile].test(text)) return profile
    }
    return undefined
  }
}
