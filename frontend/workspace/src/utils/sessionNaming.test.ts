import { expect, test } from "bun:test"
import { deriveSessionTitleFromMessage, isEmptyDraftSession, makeUniqueSessionTitle } from "./sessionNaming"

test("keeps spatial proteomics distinct from spatial transcriptomics", () => {
  expect(deriveSessionTitleFromMessage("我想做个空间蛋白的技术检测项目")).toBe("空间蛋白检测")
  expect(deriveSessionTitleFromMessage("分析 Visium 空间转录组数据")).toBe("空间转录组")
})

test("does not classify generic spatial work as spatial transcriptomics", () => {
  expect(deriveSessionTitleFromMessage("比较空间组学平台的技术路线")).toBe("空间组学分析")
})

test("summarizes comparison intent for the sidebar", () => {
  expect(deriveSessionTitleFromMessage("IMC和PCF有什么区别，如何选择")).toBe("IMC 与 PCF 对比")
})

test("disambiguates generated titles within one project", () => {
  expect(makeUniqueSessionTitle("空间转录组", ["空间转录组", "空间转录组（2）"])).toBe("空间转录组（3）")
  expect(makeUniqueSessionTitle("单细胞分析", ["空间转录组"])).toBe("单细胞分析")
})

test("hides untitled empty drafts from the sidebar", () => {
  expect(isEmptyDraftSession({ title: "新子任务" }, [])).toBe(true)
  expect(isEmptyDraftSession({ title: "New session - 2026-09-14T04:00:00.000Z" })).toBe(true)
  expect(isEmptyDraftSession({ title: "单细胞分析" }, [])).toBe(false)
  expect(isEmptyDraftSession({ title: "新子任务" }, [{ role: "user" }])).toBe(false)
  expect(isEmptyDraftSession({ title: "新子任务", parentID: "ses_parent" }, [])).toBe(false)
})
