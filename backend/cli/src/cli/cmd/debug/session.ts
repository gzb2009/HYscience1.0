import { EOL } from "os"
import { Session } from "../../../session"
import { SessionStatus } from "../../../session/status"
import { SessionTrace } from "../../../session/session-trace"
import { MessageV2 } from "../../../session/message-v2"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SessionCommand = cmd({
  command: "session <sessionID>",
  describe: "show session loop status and trace",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        type: "string",
        demandOption: true,
        description: "Session ID",
      })
      .option("trace", {
        type: "number",
        default: 20,
        describe: "Number of recent trace entries to show",
      })
      .option("format", {
        type: "string",
        choices: ["json", "text"],
        default: "text",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const sessionID = args.sessionID as string
      const session = await Session.get(sessionID).catch(() => undefined)
      if (!session) {
        process.stderr.write(`Session ${sessionID} not found` + EOL)
        process.exit(1)
      }

      const status = SessionStatus.get(sessionID)
      const trace = SessionTrace.summary(sessionID)
      const recent = SessionTrace.list(sessionID).slice(-(args.trace as number))
      const messages = []
      for await (const msg of MessageV2.stream(sessionID)) messages.push(msg)

      const payload = {
        session: {
          id: session.id,
          title: session.title,
          updated: session.time.updated,
        },
        status,
        messageCount: messages.length,
        trace: {
          ...trace,
          recent,
        },
      }

      if (args.format === "json") {
        process.stdout.write(JSON.stringify(payload, null, 2) + EOL)
        return
      }

      process.stdout.write(`session  ${session.id}${EOL}`)
      process.stdout.write(`title    ${session.title}${EOL}`)
      process.stdout.write(
        `status   ${status.type}${status.type === "busy" ? ` (${status.phase ?? "processing"}, step ${status.step ?? "?"})` : ""}${EOL}`,
      )
      process.stdout.write(`messages ${messages.length}${EOL}`)
      process.stdout.write(`turns    ${trace.turns}${EOL}`)
      process.stdout.write(
        `tokens   in=${trace.tokens.input} out=${trace.tokens.output} cache=${trace.tokens.cache}${EOL}`,
      )
      if (recent.length > 0) {
        process.stdout.write(EOL + "recent trace:" + EOL)
        for (const entry of recent) {
          const tools = entry.tools?.length ? ` tools=${entry.tools.length}` : ""
          const inject = entry.injections?.length ? ` inject=${entry.injections.length}` : ""
          process.stdout.write(`  step ${entry.step} ${entry.phase}/${entry.action}${tools}${inject}${EOL}`)
        }
      }
    })
  },
})
