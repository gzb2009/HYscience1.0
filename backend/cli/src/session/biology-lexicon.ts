/**
 * Biology lexicon — the single source for domain vocabulary used by the
 * deterministic parts of the harness (direction drift, profile detection,
 * clarification slots, session-parameter capture, marker normalisation).
 *
 * Add a new platform / cancer type / marker alias here; consumers build
 * their regexes from these tables instead of hand-writing them.
 */

import { THEMES, isDirection, type BiologyTheme, type Direction } from "@hysci/util/themes"

export type { Direction }
export type Profile = BiologyTheme

const union = (parts: string[]) => parts.join("|")

/** Word-bounded English tokens and bare Chinese phrases per platform family. */
const PLATFORM = {
  imc: { en: ["imc", "imaging.?mass(?:\\s*cytometr\\w*)?", "hyperion", "mibi", "mcd"], zh: ["成像质谱"] },
  phenocycler: { en: ["phenocycler", "codex", "akoya", "cycif", "ibex"], zh: [] },
  cytof: { en: ["cytof", "flow\\s*cytometr\\w*"], zh: ["光谱流式", "流式细胞"] },
  spatial: {
    en: [
      "visium",
      "merfish",
      "xenium",
      "stereo.?seq",
      "slide.?seq",
      "seqfish",
      "stomics",
      "spatial.?transcriptom\\w*",
      "squidpy",
    ],
    zh: ["空间转录组"],
  },
  scrna: {
    en: [
      "scrna(?:-?seq)?",
      "sc-?rna",
      "snrna",
      "scatac",
      "10x(?:\\s+genomics)?",
      "chromium",
      "seurat",
      "scanpy",
      "h5ad",
      "smart-?seq",
      "bd\\s*rhapsody",
    ],
    zh: ["单细胞转录组", "单细胞测序", "单细胞 rna"],
  },
  genomics: {
    en: [
      "wgs",
      "wes",
      "gwas",
      "vcf",
      "bwa",
      "gatk",
      "crispr(?:\\s+screen)?",
      "fastq",
      "novaseq",
      "nextseq",
      "hiseq",
      "miseq",
      "illumina",
      "nanopore",
      "pacbio",
    ],
    zh: ["全基因组", "外显子组", "变异检测"],
  },
  proteomics: {
    en: [
      "proteom\\w*",
      "mass.?spec\\w*",
      "peptide",
      "mzml",
      "maxquant",
      "diann",
      "dia",
      "tmt",
      "label-free",
      "olink",
      "somascan",
    ],
    zh: ["蛋白组", "质谱"],
  },
  structure: { en: ["alphafold", "pdb", "protein structure", "docking", "folding", "cryo-?em"], zh: ["分子对接"] },
  chemo: { en: ["smiles", "ligand", "chembl", "rdkit", "qsar", "admet", "small molecule", "compound library"], zh: [] },
} as const

export type Platform = keyof typeof PLATFORM

function platformRe(keys: Platform[], flags = "i") {
  const en = keys.flatMap((k) => [...PLATFORM[k].en])
  const zh = keys.flatMap((k) => [...PLATFORM[k].zh])
  const src = [en.length ? `\\b(?:${union(en)})\\b` : "", ...zh].filter(Boolean)
  return new RegExp(union(src), flags)
}

/** File extensions that pin a direction / profile. */
export const FILES: Record<Profile, RegExp> = {
  imc: /\.(mcd)$/i,
  spatial: /\.(zarr)$/i,
  genomics: /\.(vcf|bcf|bam|sam|cram|fastq|fq|fasta|fa|fna|bed|gtf|gff3?)(\.gz)?$/i,
  "single-cell": /\.(h5ad|loom|h5seurat)$/i,
}

/** Any file extension that marks a biology workspace. */
export const BIOLOGY_FILE = /\.(vcf|bcf|bam|fastq|fq|h5ad|loom|pdb|cif|mzml|sdf|mol|mcd)\b/i

export const SPECIES =
  /(?:人类|人源|小鼠|大鼠|斑马鱼|食蟹猴|猕猴|果蝇|拟南芥|\bhuman\b|\bmouse\b|\brat\b|zebrafish|macaque|rhesus|drosophila|arabidopsis|\bpig\b|porcine)|(?:人(?:胃癌|肺癌|乳腺癌|肝癌|胰腺癌|组织|样本))/i

const CANCER_ZH = [
  "胃癌",
  "胃腺癌",
  "肺癌",
  "乳腺癌",
  "肝癌",
  "胰腺癌",
  "前列腺癌",
  "前列腺肿瘤",
  "结直肠",
  "肠癌",
  "食管癌",
  "卵巢癌",
  "宫颈癌",
  "胶质瘤",
  "黑色素瘤",
  "癌种",
]
const CANCER_EN = ["tumou?r", "cancer", "carcinoma", "gastric", "nsclc", "pdac", "crc", "melanoma", "glioma"]
const TISSUE_ZH = ["组织类型", "脾脏", "淋巴结", "骨髓", "外周血"]
const TISSUE_EN = ["pbmc", "spleen", "lymph.?node", "bone.?marrow", "peripheral.?blood"]

/** Cancer type or tissue named anywhere in the text. */
export const TISSUE = new RegExp(
  union([...CANCER_ZH, ...TISSUE_ZH, `\\b(?:${union([...CANCER_EN, ...TISSUE_EN])})\\b`]),
  "i",
)
/** Narrow cancer-type capture used for session parameters. */
export const CANCER = new RegExp(union([...CANCER_ZH.filter((w) => w !== "癌种"), "\\b(?:pdac|crc)\\b"]), "i")

/** Scientific aim already stated for a panel / assay design. */
export const AIM =
  /(?:通用|全景|全免疫|广谱|均衡|balanced|atlas|偏\s*[TBtb]|偏B|偏T|偏髓系|B细胞为主|T细胞为主|髓系为主|肿瘤实质|基质为主|stromal|myeloid-focused|T-focused|B-focused|研究问题是|目的是|看的是)/i

/** Any platform that fixes reagents / channels. */
export const PLATFORM_ANY = platformRe(["imc", "phenocycler", "cytof", "spatial", "scrna"])
/** Platform names worth capturing as a session parameter. */
export const PLATFORM_NAMED =
  /\b(10X|10x|Chromium|Visium|Xenium|MERFISH|Smart-seq|SmartSeq|DIA|TMT|label-free|NovaSeq|NextSeq|Illumina|BD Rhapsody|PhenoCycler|CODEX|Hyperion|CyTOF|MIBI)\b|成像质谱|空间转录组/i

/** IMC explicitly spelled out as imaging mass cytometry. */
export const IMC_CONFIRMED = /成像质谱|imaging\s*mass\s*cytometr|\bhyperion\b/i
export const IMC_TOKEN = /\bIMC\b/i

/** Assay ontology signals used to close the reagent vocabulary. */
export const ASSAY = {
  phenocycler: /phenocycler|(?:pcf|面板|panel|平台).{0,24}(?:codex|akoya)|前身\s*CODEX/i,
  fingerprinting: /protein correlation fingerprint|指纹法|correlation fingerprint/i,
  imc: /(?:这次|面板|panel|平台|assay).{0,16}(?:成像质谱|hyperion)|成像质谱（IMC）|IMC\s*panel/i,
}

/** Keyword detection per profile (text only; file extensions live in FILES). */
export const KEYWORDS: Record<Profile, RegExp> = {
  imc: platformRe(["imc", "phenocycler"]),
  spatial: /\b(spatial|visium|merfish|xenium|stereo.?seq|slide.?seq|squidpy)\b|空间转录组/i,
  genomics: /\b(variant|gwas|wgs|wes|fastq|alignment|bwa|gatk|vcf|crispr)\b/i,
  "single-cell":
    /\b(single[- ]?cell|scrna|sc-rna|h5ad|scanpy|seurat|umap|leiden|cell[- ]?type|marker gene|cluster markers?)\b|单细胞|(?:细胞|亚群).{0,8}注释/i,
}

/**
 * Vocabulary that marks a *different* direction's execution job. Used by
 * DomainScope: when the current direction is X, any hit in FOREIGN[Y] (Y≠X)
 * suggests Y. `scrna` is deliberately the full-pipeline vocabulary, not bare
 * 「单细胞」, which IMC also uses for protein-level cells.
 */
export const FOREIGN: Record<Direction | "general", RegExp> = {
  imc: /\b(imc|imaging.?mass|hyperion|codex|phenocycler|akoya|cycif|mibi)\b|\.mcd\b|成像质谱|空间蛋白/i,
  "single-cell":
    /\b(scrna|sc-?rna|scrna-seq|10x(?:\s+genomics)?|chromium|seurat|scanpy|h5ad)\b|单细胞转录组|单细胞测序|单细胞 rna/i,
  spatial: /\b(visium|merfish|xenium|stereo.?seq|slide.?seq|spatial.?transcriptom)\b|空间转录组/i,
  genomics: /\b(wgs|wes|gwas|vcf|bwa|gatk|crispr screen)\b|\.vcf\b|\.bam\b|全基因组|外显子组|变异检测/i,
  general: /\b(smiles|docking|alphafold|fine-?tun(e|ing)|lora)\b|分子对接|大模型微调/i,
}

export const DIRECTION_TITLE = Object.fromEntries(THEMES.map((theme) => [theme.id, theme.title])) as Record<
  Direction | "general",
  string
>

/** Antibody-catalog / flow nicknames → official HGNC symbols. */
export const MARKER_ALIAS: [RegExp, string][] = [
  [/(?<![A-Za-z0-9])(?:Gr(?:z|zm|m)|Gzm)B(?![A-Za-z0-9])/gi, "GZMB"],
  [/(?<![A-Za-z0-9])GranB(?![A-Za-z0-9])/g, "GZMB"],
  [/(?<![A-Za-z0-9])GzmA(?![A-Za-z0-9])/g, "GZMA"],
  [/(?<![A-Za-z0-9])GzmK(?![A-Za-z0-9])/g, "GZMK"],
  [/(?<![A-Za-z0-9])FoxP3(?![A-Za-z0-9])/g, "FOXP3"],
  [/(?<![A-Za-z0-9])Foxp3(?![A-Za-z0-9])/g, "FOXP3"],
  [/(?<![A-Za-z0-9])T-?bet(?![A-Za-z0-9])/gi, "TBX21"],
  [/(?<![A-Za-z0-9])TCF1(?![A-Za-z0-9])/g, "TCF7"],
  [/(?<![A-Za-z0-9])Gata3(?![A-Za-z0-9])/g, "GATA3"],
  [/(?<![A-Za-z0-9])RORgt(?![A-Za-z0-9])/gi, "RORC"],
]

export namespace BiologyLexicon {
  export const platform = platformRe
  export function normalizeMarkers(text: string) {
    return MARKER_ALIAS.reduce((next, [pattern, symbol]) => next.replace(pattern, symbol), text)
  }
  export function direction(value: string | undefined): Direction | undefined {
    return isDirection(value) ? value : undefined
  }
}
