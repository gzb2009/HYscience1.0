import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import { Session } from "../session"
import { TaskScope } from "../session/task-scope"
import { TaskDecisionState } from "../session/task-decisions"

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info.omit({ custom: true })).describe("Questions to ask"),
    decision: z
      .object({
        id: z.string().describe("Stable identifier for the execution-affecting decision"),
        recommendation: z.string().describe("Recommended option label"),
        reason: z.string().optional().describe("Why this option is recommended"),
      })
      .optional()
      .describe("Use only when this answer selects a method or action that must be confirmed before execution"),
  }),
  async execute(params, ctx) {
    const session = params.decision ? await Session.get(ctx.sessionID) : undefined
    const task = session ? TaskScope.current(session.taskScope) : undefined
    if (params.decision && !task) throw new Error("Strategy confirmation requires an active task scope")
    const decision =
      params.decision && task
        ? {
            ...params.decision,
            taskID: task.id,
            expiresAt: Date.now() + 30 * 60 * 1000,
          }
        : undefined
    if (decision) {
      await TaskDecisionState.setDecision(ctx.sessionID, decision.taskID, {
        id: decision.id,
        status: "pending",
        recommendation: decision.recommendation,
        reason: decision.reason,
        options: params.questions.flatMap((question) => question.options.map((option) => option.label)),
      })
    }
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
      decision,
      onReply: async (answers) => {
        if (!decision) return
        await TaskDecisionState.setDecision(ctx.sessionID, decision.taskID, {
          id: decision.id,
          status: "chosen",
          choice: answers.flat().join(", "),
          recommendation: decision.recommendation,
          reason: decision.reason,
          options: params.questions.flatMap((question) => question.options.map((option) => option.label)),
        })
      },
      onTimeout: async () => {
        if (!decision) return
        await TaskDecisionState.setDecision(ctx.sessionID, decision.taskID, {
          id: decision.id,
          status: "recommended",
          recommendation: decision.recommendation,
          reason: decision.reason,
          options: params.questions.flatMap((question) => question.options.map((option) => option.label)),
        })
      },
    })

    function format(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.join(", ")
    }

    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(answers[i])}"`).join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers,
      },
    }
  },
})
