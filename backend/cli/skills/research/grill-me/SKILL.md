---
name: grill-me
description: "拷问 / grill a scientific plan. Pressure-test assumptions, methods, controls, and failure modes before analysis or after the user asks to 拷问、挑战、压测方案. Use in every analysis direction. Do not use for simple factual questions."
category: research
license: Apache-2.0
metadata:
  skill-author: HYscience
---

# Grill Me（拷问）

用简短、尖锐的追问把方案问硬，而不是做一场答辩。所有分析方向（IMC、单细胞、空间转录组、基因组、通用研究）都用同一套节奏。

## When to load

- 用户明确说拷问、挑战方案、压测、挑刺、grill
- 即将开始多步或不可逆的分析（换参考基因组、重跑分割、花 GPU）
- 用户抛出一个方法选择，但关键前提还没钉死

不要用在：名词解释、一步操作、已经在跑的常规步骤。

## How to grill

先用一两句复述你理解的目标和约束，再只问**会改变下一步**的点，最多 5 个。问完给出收紧后的方案，停止继续盘问。

每问必须指向一个具体风险，例如：

1. **问题是什么** — 比较、描述，还是机制？答不出就先别开算。
2. **对照和单位** — 比的是谁，样本是病人、ROI，还是细胞？
3. **数据是否匹配方法** — IMC 别套 scRNA 流程；VCF 别套成像分割。
4. **失败会长什么样** — 什么结果会让你放弃这个结论？
5. **最贵/不可逆的一步** — 现在做是否过早？

用户语言回答。不要问卷编号连发；像同事追问。主题锁在当前 `<project-research>` 方向内，串题只提示换方向，不把拷问做成另一组学的分析。

## After grilling

用一段话给出收紧后的计划：保留什么、改什么、先做什么。然后问一句是否按这个执行。用户点头后再动数据。
