#!/usr/bin/env python3
"""
PCF — Protein Correlation Fingerprinting for spatial proteomics.

Usage:
    python pcf_analysis.py --input cells.csv --output-dir ./pcf_results

Input: CSV from imc_pipeline.py (cells_full.csv) or any cell-level data
       with columns: sample_id, x, y, intensity_{marker_name}, cluster
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats, spatial
from scipy.cluster import hierarchy
from scipy.spatial.distance import squareform
from sklearn.cluster import AgglomerativeClustering
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    HAS_MPL = True
except ImportError:
    HAS_MPL = False


class PCFFingerprinter:
    """
    Protein Correlation Fingerprinting pipeline.
    Computes co-expression matrices, microenvironment clusters,
    and differential protein networks between conditions.
    """

    def __init__(self, cells: pd.DataFrame, output_dir: str = "./pcf_results"):
        self.cells = cells
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Detect intensity columns
        self.intensity_cols = [c for c in cells.columns
                               if c.startswith("intensity_") and "DNA" not in c]
        self.markers = [c.replace("intensity_", "") for c in self.intensity_cols]

        self._corr_matrix = None  # sample × markers × markers
        self._mes_labels = None

    # ── Protein Correlation Matrix ───────────────────────────────────

    def protein_correlation(self, method: str = "spearman",
                            per_sample: bool = True):
        """
        Compute pairwise protein correlation matrix per sample.

        Args:
            method: "spearman", "pearson", or "mutual_information"
            per_sample: if True, compute per sample, else global
        """
        corr_results = {}

        for sample in self.cells["sample_id"].unique():
            mask = self.cells["sample_id"] == sample
            X = self.cells.loc[mask, self.intensity_cols].values

            if len(X) < 3:
                continue

            if method == "mutual_information":
                corr = self._mutual_info_matrix(X)
            else:
                corr = np.corrcoef(X.T) if method == "pearson" else self._spearman_matrix(X)

            np.fill_diagonal(corr, 0)
            corr_results[sample] = corr

        self._corr_matrix = corr_results

        # Global average correlation matrix
        all_mats = np.stack(list(corr_results.values()))
        global_corr = np.mean(all_mats, axis=0)
        self._save_correlation(global_corr, method)
        print(f"  ✓ Protein correlation computed ({method}, {len(corr_results)} samples)")

        return self

    def _spearman_matrix(self, X: np.ndarray) -> np.ndarray:
        """Spearman correlation matrix (n_markers × n_markers)."""
        n = X.shape[1]
        corr = np.eye(n)
        for i in range(n):
            for j in range(i + 1, n):
                r, _ = stats.spearmanr(X[:, i], X[:, j])
                corr[i, j] = corr[j, i] = r if not np.isnan(r) else 0
        return corr

    def _mutual_info_matrix(self, X: np.ndarray, bins: int = 20) -> np.ndarray:
        """Approximate mutual information matrix."""
        n = X.shape[1]
        mi = np.eye(n)
        for i in range(n):
            xi = X[:, i]
            xi_binned = np.digitize(xi, np.histogram_bin_edges(xi, bins=bins))
            for j in range(i + 1, n):
                xj = X[:, j]
                xj_binned = np.digitize(xj, np.histogram_bin_edges(xj, bins=bins))
                cont = np.histogram2d(xi_binned, xj_binned, bins=bins)[0]
                mi[i, j] = mi[j, i] = self._mutual_info(cont)
        return mi

    def _mutual_info(self, contingency: np.ndarray) -> float:
        total = contingency.sum()
        px = contingency.sum(axis=1) / total
        py = contingency.sum(axis=0) / total
        outer = np.outer(px, py)
        nonzero = (contingency > 0) & (outer > 0)
        return (contingency[nonzero] / total * np.log2(contingency[nonzero] / (total * outer[nonzero]))).sum()

    def _save_correlation(self, corr: np.ndarray, method: str):
        """Save correlation matrix as CSV and heatmap."""
        df = pd.DataFrame(corr, index=self.markers, columns=self.markers)
        df.to_csv(self.output_dir / f"protein_correlation_{method}.csv")

        if HAS_MPL:
            fig, ax = plt.subplots(figsize=(max(6, len(self.markers) * 0.4),
                                            max(5, len(self.markers) * 0.35)))
            sns.heatmap(df, cmap="RdBu_r", center=0, annot=True if len(self.markers) <= 15 else False,
                       fmt=".2f", square=True, ax=ax,
                       cbar_kws={"label": f"{method} correlation"})
            ax.set_title(f"Protein Co-expression ({method})")
            fig.tight_layout()
            fig.savefig(self.output_dir / f"protein_correlation_{method}.pdf", dpi=200)
            plt.close(fig)

    # ── Microenvironment Clustering ───────────────────────────────────

    def microenvironment_clustering(self, n_mes: int = 8, method: str = "hierarchical"):
        """
        Cluster cells into tissue microenvironments (MEs)
        based on their protein correlation fingerprint.

        Works on the neighborhood-level protein composition vector.
        """
        cells = self.cells

        # Build per-cell protein composition vector
        X = cells[self.intensity_cols].values
        X = StandardScaler().fit_transform(X)

        if method == "hierarchical":
            # Reduce to sample-level for practical clustering
            agg = cells.groupby("sample_id")[self.intensity_cols].mean()
            X_agg = StandardScaler().fit_transform(agg.values)
            clustering = AgglomerativeClustering(n_clusters=min(n_mes, len(X_agg)))
            labels = clustering.fit_predict(X_agg)
            cells["microenvironment"] = [f"ME{l+1}" for l in labels[np.searchsorted(
                agg.index.values, cells["sample_id"].values)]]
        else:
            from sklearn.cluster import KMeans
            km = KMeans(n_clusters=n_mes, random_state=42, n_init=10)
            cells["microenvironment"] = [f"ME{l+1}" for l in km.fit_predict(X)]

        self._mes_labels = cells["microenvironment"]
        self.cells = cells

        # ME composition heatmap
        self._plot_me_composition()
        print(f"  ✓ {n_mes} microenvironments identified")

        return self

    def _plot_me_composition(self):
        """Heatmap of marker expression per microenvironment."""
        if not HAS_MPL:
            return

        cells = self.cells
        me_means = cells.groupby("microenvironment")[self.intensity_cols].mean()
        me_means = me_means.rename(columns=dict(zip(self.intensity_cols, self.markers)))

        # Z-score normalize rows
        me_z = me_means.subtract(me_means.mean(axis=1), axis=0).div(me_means.std(axis=1), axis=0)

        fig, ax = plt.subplots(figsize=(max(6, len(self.markers) * 0.5), max(4, len(me_means) * 0.4)))
        sns.heatmap(me_z, cmap="RdBu_r", center=0, annot=True, fmt=".1f", ax=ax)
        ax.set_title("Microenvironment Marker Profiles (Z-score)")
        fig.tight_layout()
        fig.savefig(self.output_dir / "me_composition.pdf", dpi=200)
        plt.close(fig)

    # ── Differential Protein Networks ─────────────────────────────────

    def compare_conditions(self, group_var: str):
        """
        Compare protein correlation networks between conditions.
        Computes per-group correlation matrices and differential edges.
        """
        cells = self.cells
        groups = cells[group_var].dropna().unique()

        if len(groups) < 2:
            print(f"  ⚠ Need at least 2 groups in '{group_var}' for comparison")
            return self

        group_corrs = {}
        for grp in groups:
            mask = cells[group_var] == grp
            X = cells.loc[mask, self.intensity_cols].values
            if len(X) < 3:
                continue
            corr = np.array([stats.spearmanr(X[:, i], X[:, j])[0]
                            for i in range(len(self.markers))
                            for j in range(len(self.markers))]).reshape(len(self.markers), -1)
            np.fill_diagonal(corr, 0)
            group_corrs[grp] = corr

        # Differential correlation matrix
        grp_names = list(group_corrs.keys())
        diff = group_corrs[grp_names[1]] - group_corrs[grp_names[0]]
        diff_df = pd.DataFrame(diff, index=self.markers, columns=self.markers)
        diff_df.to_csv(self.output_dir / f"diff_correlation_{grp_names[0]}_vs_{grp_names[1]}.csv")

        if HAS_MPL:
            fig, ax = plt.subplots(figsize=(max(6, len(self.markers) * 0.4),
                                            max(5, len(self.markers) * 0.35)))
            vmax = max(abs(diff.min()), abs(diff.max()))
            sns.heatmap(diff_df, cmap="RdBu_r", center=0, vmin=-vmax, vmax=vmax,
                       annot=True if len(self.markers) <= 15 else False, fmt=".2f",
                       square=True, ax=ax)
            ax.set_title(f"Differential Correlation: {grp_names[1]} vs {grp_names[0]}")
            fig.tight_layout()
            fig.savefig(self.output_dir / f"diff_correlation_heatmap.pdf", dpi=200)
            plt.close(fig)

        print(f"  ✓ Compared {len(groups)} groups")
        return self

    # ── Run all ───────────────────────────────────────────────────────

    def run(self, method: str = "spearman", n_mes: int = 6):
        self.protein_correlation(method=method)
        self.microenvironment_clustering(n_mes=n_mes)
        self.cells.to_csv(self.output_dir / "cells_with_me.csv", index=False)
        return self


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="PCF Protein Correlation Fingerprinting")
    parser.add_argument("--input", required=True, help="Input CSV from IMC pipeline")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--method", default="spearman", choices=["spearman", "pearson", "mutual_information"])
    parser.add_argument("--n-mes", type=int, default=6, help="Number of microenvironments")
    parser.add_argument("--group-var", default=None, help="Group variable for comparison")
    args = parser.parse_args()

    cells = pd.read_csv(args.input)
    pcf = PCFFingerprinter(cells, args.output_dir)
    pcf.run(method=args.method, n_mes=args.n_mes)

    if args.group_var and args.group_var in cells.columns:
        pcf.compare_conditions(args.group_var)

    return 0


if __name__ == "__main__":
    sys.exit(main())
